import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { coherenceError, normalizeDay, MEALS } from '../lib/flow';

const router = Router();
router.use(requireAuth);

const recordSchema = z.object({
  date: z.string().min(1, 'Date is required.'),
  kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
  foodItemId: z.string().min(1, 'Please choose a saved food item.'),
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER'], { errorMap: () => ({ message: 'Meal must be breakfast, lunch, or dinner.' }) }),
  targetKg: z.coerce.number().min(0, 'Target cannot be negative.').max(1000000, 'Target looks too large.').optional(),
  producedKg: z.coerce.number().min(0, 'Produced cannot be negative.').max(1000000, 'Produced looks too large.'),
  soldKg: z.coerce.number().min(0, 'Sold cannot be negative.').max(1000000, 'Sold looks too large.'),
  wasteKg: z.coerce.number().min(0, 'Waste cannot be negative.').max(1000000, 'Waste looks too large.'),
  remainingKg: z.coerce.number().min(0, 'Remaining/surplus cannot be negative.').max(1000000, 'Remaining looks too large.'),
  notes: z.string().trim().max(1000, 'Notes are too long.').optional(),
  adjustmentReason: z.string().trim().max(500).optional(),
  isCorrection: z.coerce.boolean().optional().default(false),
  correctionReason: z.string().trim().max(500).optional(),
});

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the form.', details: err.errors });
}

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

async function findDuplicate(orgId: string, kitchenUnitId: string, foodItemId: string, date: Date, mealType: string, exceptId?: string) {
  const day = normalizeDay(date);
  const next = new Date(day.getTime() + 86400000);
  return prisma.dailyFoodRecord.findFirst({
    where: {
      organizationId: orgId,
      kitchenUnitId,
      foodItemId,
      mealType,
      isCorrection: false,
      date: { gte: day, lt: next },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
  });
}

// GET /api/food-records
router.get('/', async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const where: Record<string, unknown> = { organizationId: orgId };
  if (typeof req.query.kitchenUnitId === 'string' && req.query.kitchenUnitId) where.kitchenUnitId = req.query.kitchenUnitId;
  if (typeof req.query.foodItemId === 'string' && req.query.foodItemId) where.foodItemId = req.query.foodItemId;
  if (typeof req.query.from === 'string' && req.query.from) {
    const d = new Date(req.query.from);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid "from" date.' });
    (where as { date?: object }).date = { ...(where.date as object ?? {}), gte: d };
  }
  if (typeof req.query.to === 'string' && req.query.to) {
    const d = new Date(req.query.to);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid "to" date.' });
    (where as { date?: object }).date = { ...(where.date as object ?? {}), lte: d };
  }
  const records = await prisma.dailyFoodRecord.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 200,
    include: { foodItem: true, kitchenUnit: true },
  });
  return res.json({ records });
});

// POST /api/food-records — Staff and above (NGO blocked)
router.post('/', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'), async (req: AuthenticatedRequest, res) => {
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;

  const date = new Date(v.date);
  if (isNaN(date.getTime())) return res.status(400).json({ error: 'Date is not valid.' });
  if (!MEALS.includes(v.mealType)) return res.status(400).json({ error: 'Meal must be breakfast, lunch, or dinner.' });

  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(404).json({ error: 'Kitchen/unit not found in your organization.' });
  const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
  if (!food) return res.status(404).json({ error: 'Food item not found in your organization. Menu lines must reuse saved food items.' });
  if (!food.isActive) return res.status(400).json({ error: `“${food.name}” is archived. Restore it before recording flow.` });

  const err = coherenceError(v.producedKg, v.soldKg, v.wasteKg, v.remainingKg, v.adjustmentReason);
  if (err) return res.status(400).json({ error: err });
  if (v.isCorrection && (!v.correctionReason || v.correctionReason.trim().length < 5)) {
    return res.status(400).json({ error: 'Corrections need a reason (min 5 characters) so the audit trail stays honest.' });
  }
  if (!v.isCorrection && (await findDuplicate(orgId, v.kitchenUnitId, v.foodItemId, date, v.mealType))) {
    return res.status(409).json({ error: 'A record for this date, kitchen, food item, and meal already exists. Save it as a correction with a reason instead.' });
  }

  const record = await prisma.dailyFoodRecord.create({
    data: {
      organizationId: orgId,
      kitchenUnitId: v.kitchenUnitId,
      foodItemId: v.foodItemId,
      date,
      mealType: v.mealType,
      targetKg: v.targetKg,
      preparedKg: v.producedKg,
      servedKg: v.soldKg,
      soldKg: v.soldKg,
      wasteKg: v.wasteKg,
      remainingKg: v.remainingKg,
      adjustmentReason: v.adjustmentReason?.trim() || undefined,
      isCorrection: v.isCorrection ?? false,
      correctionReason: v.correctionReason?.trim() || undefined,
      notes: v.notes?.trim() || undefined,
    },
    include: { foodItem: true, kitchenUnit: true },
  });
  await audit('flow.record', { userId: req.userId, organizationId: orgId, entityType: 'DailyFoodRecord', entityId: record.id });
  return res.status(201).json({ message: 'Food Flow record saved (operational quantities, not financials).', record });
});

// PUT /api/food-records/:id — edit with correction reason when numbers change
router.put('/:id', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'), async (req: AuthenticatedRequest, res) => {
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.dailyFoodRecord.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Record not found.' });
  const v = parsed.data;
  const date = new Date(v.date);
  if (isNaN(date.getTime())) return res.status(400).json({ error: 'Date is not valid.' });
  // Validate kitchen/food ownership on edit — moves are allowed but must stay in-org.
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
  if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  const err = coherenceError(v.producedKg, v.soldKg, v.wasteKg, v.remainingKg, v.adjustmentReason);
  if (err) return res.status(400).json({ error: err });
  const numbersChanged =
    existing.preparedKg !== v.producedKg || existing.soldKg !== v.soldKg || (existing.wasteKg !== v.wasteKg) ||
    (existing.remainingKg ?? null) !== v.remainingKg;
  if (numbersChanged && (!v.correctionReason || v.correctionReason.trim().length < 5)) {
    return res.status(400).json({ error: 'Changing quantities needs a correction reason (min 5 characters).' });
  }
  if (!existing.isCorrection && (await findDuplicate(orgId, v.kitchenUnitId, v.foodItemId, date, v.mealType, existing.id))) {
    return res.status(409).json({ error: 'Another record already covers this date, kitchen, food item, and meal.' });
  }
  const record = await prisma.dailyFoodRecord.update({
    where: { id: existing.id },
    data: {
      date,
      kitchenUnitId: v.kitchenUnitId,
      foodItemId: v.foodItemId,
      mealType: v.mealType,
      targetKg: v.targetKg ?? null,
      preparedKg: v.producedKg,
      servedKg: v.soldKg,
      soldKg: v.soldKg,
      wasteKg: v.wasteKg,
      remainingKg: v.remainingKg,
      adjustmentReason: v.adjustmentReason?.trim() || null,
      isCorrection: numbersChanged ? true : existing.isCorrection,
      correctionReason: v.correctionReason?.trim() || existing.correctionReason,
      notes: v.notes?.trim() || null,
    },
    include: { foodItem: true, kitchenUnit: true },
  });
  await audit('flow.correct', { userId: req.userId, organizationId: orgId, entityType: 'DailyFoodRecord', entityId: record.id });
  return res.json({ message: 'Record updated with audit trail.', record });
});

export default router;
