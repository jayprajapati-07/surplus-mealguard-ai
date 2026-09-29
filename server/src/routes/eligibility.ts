import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { decideEligibility } from '../lib/eligibility';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;

const DEFAULT_MIN_QTY = 10;

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

type Verdict = 'ELIGIBLE' | 'REVIEW_REQUIRED' | 'INELIGIBLE';

const assessSchema = z.object({
  kitchenUnitId: z.string().min(1).optional(),
  foodDescription: z.string().trim().min(2, 'Food description needs at least 2 characters.').max(200, 'Food description is too long.'),
  foodItemId: z.string().min(1).optional(),
  quantityKg: z.coerce.number().positive('Quantity must be greater than 0 kg.').max(100000, 'Quantity looks too large.'),
  foodCategory: z.string().trim().min(2, 'Food category is required.').max(80, 'Food category is too long.'),
  preparedAt: z.string().min(1, 'Preparation time is required.'),
  holdingInfo: z.string().trim().min(3, 'Holding/storage information needs at least 3 characters.').max(300, 'Holding information is too long.'),
  storageArea: z.string().trim().min(2, 'Storage area is required (text only).').max(120, 'Storage area is too long.'),
  availableUntil: z.string().min(1, 'Availability deadline is required.'),
  expiryDate: z.string().optional(),
  qualityConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'Manual quality confirmation is required — an assessment can never become eligible without it.' }),
  }),
  qualityNote: z.string().trim().max(500, 'Quality note is too long.').optional(),
});

// POST /api/eligibility/assess — human-confirmed operational eligibility (never a safety certificate)
router.post('/assess', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = assessSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;
  let kitchenName: string | null = null;
  if (v.kitchenUnitId) {
    const k = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
    if (!k) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
    kitchenName = k.name;
  }
  if (v.foodItemId) {
    const f = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
    if (!f) return res.status(400).json({ error: 'Food item not found in your organization.' });
  }
  const preparedAt = new Date(v.preparedAt);
  if (isNaN(preparedAt.getTime())) return res.status(400).json({ error: 'Preparation time is not a valid date-time.' });
  const availableUntil = new Date(v.availableUntil);
  if (isNaN(availableUntil.getTime())) return res.status(400).json({ error: 'Availability deadline is not a valid date-time.' });
  let expiry: Date | null = null;
  if (v.expiryDate !== undefined && v.expiryDate !== '') {
    expiry = new Date(v.expiryDate);
    if (isNaN(expiry.getTime())) return res.status(400).json({ error: 'Expiry date is not valid.' });
  }
  const cfg = await prisma.eligibilityConfig.findUnique({ where: { organizationId: orgId } });
  const min = cfg?.minQuantityKg ?? DEFAULT_MIN_QTY;
  const { verdict, reasons } = decideEligibility(
    {
      quantityKg: v.quantityKg,
      expiryDate: expiry ? expiry.toISOString().slice(0, 10) : null,
      availableUntil: availableUntil.toISOString(),
      qualityNote: v.qualityNote?.trim() || undefined,
    },
    min
  );
  const recorded = {
    verdict,
    foodCategory: v.foodCategory.trim(), preparedAt: preparedAt.toISOString(),
    holdingInfo: v.holdingInfo.trim(), storageArea: v.storageArea.trim(),
    availableUntil: availableUntil.toISOString(), expiryDate: expiry ? expiry.toISOString().slice(0, 10) : null,
    qualityConfirmed: true, qualityNote: v.qualityNote?.trim() || null,
    kitchen: kitchenName, minQuantityKg: min,
    evaluatedRules: ['below-operational-minimum', 'recorded-expiry-or-deadline', 'two-hour-logistics-margin', 'marginal-quantity'],
  };
  const assessment = await prisma.surplusEligibilityAssessment.create({
    data: {
      organizationId: orgId, kitchenUnitId: v.kitchenUnitId ?? null,
      foodDescription: v.foodDescription.trim(), quantityKg: v.quantityKg,
      recordedInfoJson: JSON.stringify(recorded),
      humanConfirmed: true, eligible: verdict === 'ELIGIBLE',
      reason: reasons.join(' '), assessedById: req.userId,
    },
  });
  await audit('eligibility.assess', { userId: req.userId, organizationId: orgId, entityType: 'SurplusEligibilityAssessment', entityId: assessment.id,
    metadata: { verdict, quantityKg: v.quantityKg } });
  let disposalEntry: { id: string; quantityKg: number } | null = null;
  if (verdict === 'INELIGIBLE') {
    const entry = await prisma.foodFlowEntry.create({
      data: {
        organizationId: orgId, kitchenUnitId: v.kitchenUnitId ?? null, foodItemId: v.foodItemId ?? null,
        stage: 'WASTE', quantityKg: v.quantityKg, mealType: null, entryKind: 'WASTE', direction: 'ADD',
        reason: `Disposal from eligibility assessment ${assessment.id}: ${reasons.join(' ')}`.slice(0, 500),
        createdById: req.userId, createdByName: req.currentUser?.name ?? req.currentUser?.email ?? 'Staff',
      },
    });
    await audit('eligibility.disposal', { userId: req.userId, organizationId: orgId, entityType: 'FoodFlowEntry', entityId: entry.id,
      metadata: { assessmentId: assessment.id, quantityKg: v.quantityKg } });
    disposalEntry = { id: entry.id, quantityKg: entry.quantityKg };
  }
  return res.status(201).json({
    message: `Assessment recorded: ${verdict}.`,
    assessment: { ...assessment, verdict },
    disposalEntry,
  });
});

// GET /api/eligibility/assessments
router.get('/assessments', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1).optional(), verdict: z.enum(['ELIGIBLE', 'REVIEW_REQUIRED', 'INELIGIBLE']).optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const where: { organizationId: string; kitchenUnitId?: string; eligible?: boolean } = { organizationId: orgId };
  if (parsed.data.kitchenUnitId) where.kitchenUnitId = parsed.data.kitchenUnitId;
  if (parsed.data.verdict === 'ELIGIBLE') where.eligible = true;
  const rows = await prisma.surplusEligibilityAssessment.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 100,
    include: { kitchenUnit: true },
  });
  const withVerdict = rows.map((a) => {
    let verdict: Verdict = a.eligible ? 'ELIGIBLE' : 'INELIGIBLE';
    try {
      const rec = JSON.parse((a.recordedInfoJson ?? '{}') as string) as { verdict?: Verdict };
      if (rec.verdict === 'ELIGIBLE' || rec.verdict === 'REVIEW_REQUIRED' || rec.verdict === 'INELIGIBLE') {
        verdict = rec.verdict;
      }
    } catch { /* fall back to eligible flag */ }
    return { ...a, verdict };
  });
  const filtered = parsed.data.verdict && parsed.data.verdict !== 'ELIGIBLE'
    ? withVerdict.filter((a) => a.verdict === parsed.data.verdict)
    : withVerdict;
  return res.json({ assessments: filtered });
});

// GET /api/eligibility/config
router.get('/config', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const row = await prisma.eligibilityConfig.findUnique({ where: { organizationId: orgId } });
  return res.json({
    config: row ? { minQuantityKg: row.minQuantityKg } : null,
    defaults: { minQuantityKg: DEFAULT_MIN_QTY },
    note: row ? null : 'No custom minimum saved — 10 kg default applies. This is an operational cutoff, not a universal food-safety rule.',
  });
});

// PUT /api/eligibility/config
router.put('/config', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    minQuantityKg: z.coerce.number().min(1, 'Minimum must be at least 1 kg.').max(1000, 'Minimum looks too large.'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const row = await prisma.eligibilityConfig.upsert({
    where: { organizationId: orgId },
    update: { minQuantityKg: parsed.data.minQuantityKg, updatedById: req.userId },
    create: { organizationId: orgId, minQuantityKg: parsed.data.minQuantityKg, updatedById: req.userId },
  });
  await audit('eligibility.config', { userId: req.userId, organizationId: orgId, entityType: 'EligibilityConfig', entityId: row.id,
    metadata: { minQuantityKg: row.minQuantityKg } });
  return res.json({ message: 'Eligibility minimum saved.', config: { minQuantityKg: row.minQuantityKg } });
});

export default router;
