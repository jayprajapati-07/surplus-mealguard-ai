import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth';
import { dedupeToLatest, utcDayKey } from '../lib/kitchen-memory';
import { analyzeWasteDay, WASTE_LABEL, type HistoryPoint } from '../lib/waste-analysis';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the request.', details: err.errors });
}

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

// GET /api/waste/analysis — explainable waste breakdown for one kitchen/day
router.get('/analysis', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
    date: z.string().min(1, 'Date is required (YYYY-MM-DD).'),
    foodItemId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const raw = new Date(parsed.data.date);
  if (isNaN(raw.getTime())) return res.status(400).json({ error: 'Date is not valid (use YYYY-MM-DD).' });
  const day = new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
  const next = new Date(day.getTime() + 86400000);

  const [dayRecords, allRecords, targets, lots, thresholds] = await Promise.all([
    prisma.dailyFoodRecord.findMany({
      where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next } },
      orderBy: { createdAt: 'asc' }, take: 1000,
      include: { foodItem: true },
    }),
    prisma.dailyFoodRecord.findMany({
      where: { organizationId: orgId, kitchenUnitId: kitchen.id },
      orderBy: { date: 'asc' }, take: 5000,
    }),
    prisma.productionTarget.findMany({
      where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next } }, take: 500,
    }),
    prisma.inventoryItem.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' }, take: 1000,
      include: { foodItem: true },
    }),
    prisma.inventoryThreshold.findUnique({ where: { organizationId: orgId } }),
  ]);

  const nearDays = thresholds?.nearExpiryDays ?? 3;
  const nowDay = new Date();
  nowDay.setHours(0, 0, 0, 0);
  const dayRows = dedupeToLatest(dayRecords)
    .filter((r) => !parsed.data.foodItemId || r.foodItemId === parsed.data.foodItemId)
    .map((r) => {
      const t = targets.find((x) => x.foodItemId === r.foodItemId && x.mealType === r.mealType);
      return {
        id: r.id, foodItemId: r.foodItemId, foodName: r.foodItem?.name ?? 'Unknown item', mealType: r.mealType,
        date: r.date,
        preparedKg: r.preparedKg, soldKg: r.soldKg ?? r.servedKg, wasteKg: r.wasteKg, remainingKg: r.remainingKg ?? 0,
        targetKg: t ? (t.adjustedKg ?? t.recommendedKg) : null,
        adjustmentReason: r.adjustmentReason, correctionReason: r.correctionReason, notes: r.notes,
      };
    });

  const history: HistoryPoint[] = dedupeToLatest(allRecords).map((r) => ({
    foodItemId: r.foodItemId, mealType: r.mealType, date: new Date(r.date),
    excessKg: Math.round(((r.wasteKg ?? 0) + (r.remainingKg ?? 0)) * 1000) / 1000,
  }));

  const inventoryFlags = lots
    .filter((l) => l.expiryDate)
    .map((l) => {
      const d = Math.round((new Date(l.expiryDate as Date).getTime() - nowDay.getTime()) / 86400000);
      return { foodItemId: l.foodItemId, lot: l.batchCode || l.id.slice(-6), expiryDate: (l.expiryDate as Date).toISOString().slice(0, 10), quantityKg: l.quantityKg, days: d };
    })
    .filter((l) => l.days <= nearDays)
    .map((l) => ({ foodItemId: l.foodItemId, lot: l.lot, expiryDate: l.expiryDate, quantityKg: l.quantityKg, flag: (l.days < 0 ? 'expired' : 'near-expiry') as 'expired' | 'near-expiry' }));

  const { rows, label } = analyzeWasteDay({
    dayRecords: dayRows, history, weekday: day.getUTCDay(), inventoryFlags,
  });
  return res.json({ date: parsed.data.date, kitchen: { id: kitchen.id, name: kitchen.name }, rows, label });
});

export default router;
