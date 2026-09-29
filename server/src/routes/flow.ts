import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import {
  assessSurplusRisk,
  defaultThresholds,
  type RiskThresholds,
} from '../lib/surplus-risk';
import { buildSeries, forecastForDate } from '../lib/kitchen-memory';
import { notifyOrg } from './notifications';

const router = Router();
router.use(requireAuth);

const FLOW_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
const ENTRY_KINDS = ['PRODUCTION', 'SALE', 'WASTE', 'ADJUSTMENT'] as const;
const REF_KINDS = ['PRODUCTION', 'SALE', 'WASTE'] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the entry.', details: err.errors });
}

function dayBounds(dateStr?: string): { start: Date; end: Date; key: string; error?: string } {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  if (isNaN(d.getTime())) return { start: new Date(), end: new Date(), key: '', error: 'Date must be YYYY-MM-DD.' };
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return { start, end, key };
}

type EntryRow = {
  id: string; recordedAt: Date; entryKind: string; direction: string;
  quantityKg: number; refKind: string | null; reason: string | null;
  createdByName: string | null; foodItemId: string | null; mealType: string | null;
  foodItem?: { name: string } | null;
};

function signedOf(e: EntryRow): number {
  return e.direction === 'SUBTRACT' ? -e.quantityKg : e.quantityKg;
}

function bucketTotals(entries: EntryRow[]) {
  const groups = new Map<string, { foodItemId: string; food: string; mealType: string; produced: number; sold: number; wasted: number; adjustments: unknown[] }>();
  for (const e of entries) {
    const key = `${e.foodItemId ?? ''}|${e.mealType ?? ''}`;
    const g = groups.get(key) ?? {
      foodItemId: e.foodItemId ?? '', food: e.foodItem?.name ?? 'Unknown item',
      mealType: e.mealType ?? '', produced: 0, sold: 0, wasted: 0, adjustments: [] as unknown[],
    };
    const s = r2(signedOf(e));
    if (e.entryKind === 'PRODUCTION') g.produced = r2(g.produced + s);
    else if (e.entryKind === 'SALE') g.sold = r2(g.sold + s);
    else if (e.entryKind === 'WASTE') g.wasted = r2(g.wasted + s);
    else if (e.entryKind === 'ADJUSTMENT' && e.refKind === 'PRODUCTION') g.produced = r2(g.produced + s);
    else if (e.entryKind === 'ADJUSTMENT' && e.refKind === 'SALE') g.sold = r2(g.sold + s);
    else if (e.entryKind === 'ADJUSTMENT' && e.refKind === 'WASTE') g.wasted = r2(g.wasted + s);
    if (e.entryKind === 'ADJUSTMENT') {
      g.adjustments.push({ id: e.id, refKind: e.refKind, signedKg: s, reason: e.reason, author: e.createdByName ?? '—', recordedAt: e.recordedAt });
    }
    groups.set(key, g);
  }
  return [...groups.values()];
}

async function thresholdsFor(orgId: string): Promise<RiskThresholds> {
  const row = await prisma.riskThreshold.findUnique({ where: { organizationId: orgId } });
  if (!row) return defaultThresholds();
  let windows = defaultThresholds().windows;
  if (row.windowsJson) {
    try {
      const w = JSON.parse(row.windowsJson) as RiskThresholds['windows'];
      if (w?.BREAKFAST?.end && w?.LUNCH?.end && w?.DINNER?.end) windows = w;
    } catch { /* defaults stand */ }
  }
  return { medKg: row.medKg, highKg: row.highKg, minSales: row.minSales, minSpanMin: row.minSpanMin, windows };
}

const entrySchema = z.object({
  kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
  foodItemId: z.string().min(1, 'Please choose a food item.'),
  mealType: z.enum(MEAL_TYPES, { errorMap: () => ({ message: 'Meal must be breakfast, lunch, or dinner.' }) }),
  entryKind: z.enum(ENTRY_KINDS, { errorMap: () => ({ message: 'Entry kind must be production, sale, waste, or adjustment.' }) }),
  quantityKg: z.coerce.number().positive('Quantity must be greater than 0 kg.').max(1000000, 'Quantity looks too large.'),
  direction: z.enum(['ADD', 'SUBTRACT']).optional().default('ADD'),
  refKind: z.enum(REF_KINDS).optional(),
  reason: z.string().trim().max(500, 'Reason is too long.').optional(),
  recordedAt: z.string().optional(),
});

// POST /api/flow/entries — live Food Flow log (staff and managers)
router.post('/entries', requireRole(...FLOW_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = entrySchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;
  if (v.entryKind === 'ADJUSTMENT' && !v.refKind) {
    return res.status(400).json({ error: 'Adjustment entries must state which total they correct (refKind: production, sale, or waste).' });
  }
  if (v.entryKind !== 'ADJUSTMENT' && v.refKind) {
    return res.status(400).json({ error: 'refKind only applies to ADJUSTMENT entries.' });
  }
  if (v.entryKind === 'ADJUSTMENT' && (!v.reason || v.reason.trim().length < 5)) {
    return res.status(400).json({ error: 'Adjustment entries need a reason (min 5 characters) so corrections stay traced.' });
  }
  let recordedAt = new Date();
  if (v.recordedAt) {
    recordedAt = new Date(v.recordedAt);
    if (isNaN(recordedAt.getTime())) return res.status(400).json({ error: 'recordedAt is not a valid date-time.' });
    if (recordedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return res.status(400).json({ error: 'recordedAt cannot be in the future.' });
    }
    if (recordedAt.getTime() < Date.now() - 48 * 3600 * 1000) {
      return res.status(400).json({ error: 'recordedAt cannot be older than 48 hours.' });
    }
  }
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
  if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  const author = req.currentUser?.name ?? req.currentUser?.email ?? 'Staff';
  const entry = await prisma.foodFlowEntry.create({
    data: {
      organizationId: orgId, kitchenUnitId: v.kitchenUnitId, foodItemId: v.foodItemId,
      stage: v.entryKind, quantityKg: v.quantityKg, mealType: v.mealType,
      entryKind: v.entryKind, direction: v.direction ?? 'ADD', refKind: v.refKind ?? null,
      reason: v.reason?.trim() || null, recordedAt,
      createdById: req.userId, createdByName: author,
    },
    include: { foodItem: true },
  });
  await audit('flow.entry', { userId: req.userId, organizationId: orgId, entityType: 'FoodFlowEntry', entityId: entry.id,
    metadata: { kind: entry.entryKind, quantityKg: entry.quantityKg, foodItemId: entry.foodItemId } });
  const dayStart = new Date(recordedAt);
  dayStart.setHours(0, 0, 0, 0);
  const triggered = await evaluateAndNotify(orgId, v.kitchenUnitId, dayStart);
  return res.status(201).json({
    entry: { ...entry, signedKg: entry.direction === 'SUBTRACT' ? -entry.quantityKg : entry.quantityKg, author },
    triggered,
  });
});

// GET /api/flow/entries — chronological timeline
router.get('/entries', requireRole(...FLOW_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1).optional(), date: z.string().optional(), foodItemId: z.string().min(1).optional(), mealType: z.enum(MEAL_TYPES).optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const q = parsed.data;
  const where: { organizationId: string; kitchenUnitId?: string; foodItemId?: string; mealType?: 'BREAKFAST' | 'LUNCH' | 'DINNER'; recordedAt?: { gte: Date; lt: Date } } = { organizationId: orgId };
  if (q.kitchenUnitId) where.kitchenUnitId = q.kitchenUnitId;
  if (q.foodItemId) where.foodItemId = q.foodItemId;
  if (q.mealType) where.mealType = q.mealType;
  if (q.date) {
    const b = dayBounds(q.date);
    if (b.error) return res.status(400).json({ error: b.error });
    where.recordedAt = { gte: b.start, lt: b.end };
  }
  const entries = await prisma.foodFlowEntry.findMany({
    where, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }], take: 500,
    include: { foodItem: true, kitchenUnit: true },
  });
  return res.json({
    entries: entries.map((e) => ({
      id: e.id, recordedAt: e.recordedAt, entryKind: e.entryKind, direction: e.direction,
      signedKg: e.direction === 'SUBTRACT' ? -e.quantityKg : e.quantityKg, quantityKg: e.quantityKg,
      refKind: e.refKind, reason: e.reason, author: e.createdByName ?? '—',
      foodItemId: e.foodItemId, food: e.foodItem?.name ?? 'Unknown item',
      mealType: e.mealType, kitchen: e.kitchenUnit?.name ?? '—', kitchenUnitId: e.kitchenUnitId,
    })),
  });
});

// GET /api/flow/today — server-recomputed totals
router.get('/today', requireRole(...FLOW_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'), date: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const b = dayBounds(parsed.data.date);
  if (b.error) return res.status(400).json({ error: b.error });
  const entries = await prisma.foodFlowEntry.findMany({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, recordedAt: { gte: b.start, lt: b.end } },
    orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }], take: 1000,
    include: { foodItem: true },
  });
  const totals = bucketTotals(entries);
  const dayTotals = {
    produced: r2(totals.reduce((x, t) => x + t.produced, 0)),
    sold: r2(totals.reduce((x, t) => x + t.sold, 0)),
    wasted: r2(totals.reduce((x, t) => x + t.wasted, 0)),
  };
  return res.json({ date: b.key, kitchen: { id: kitchen.id, name: kitchen.name }, totals, dayTotals, entryCount: entries.length });
});

// GET /api/flow/risk — surplus-before-surplus estimates per food/meal
router.get('/risk', requireRole(...FLOW_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'), date: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const b = dayBounds(parsed.data.date);
  if (b.error) return res.status(400).json({ error: b.error });
  const risks = await risksForDay(orgId, kitchen.id, b.start, b.end, new Date());
  return res.json({ date: b.key, kitchen: { id: kitchen.id, name: kitchen.name }, risks });
});

async function risksForDay(orgId: string, kitchenUnitId: string, dayStart: Date, dayEnd: Date, now: Date) {
  const [entries, thresholds, targets, records, menus] = await Promise.all([
    prisma.foodFlowEntry.findMany({
      where: { organizationId: orgId, kitchenUnitId, recordedAt: { gte: dayStart, lt: dayEnd } },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }], take: 1000,
      include: { foodItem: true },
    }),
    thresholdsFor(orgId),
    prisma.productionTarget.findMany({ where: { organizationId: orgId, kitchenUnitId, date: { gte: dayStart, lt: dayEnd } }, take: 200 }),
    prisma.dailyFoodRecord.findMany({ where: { organizationId: orgId }, orderBy: { date: 'asc' }, take: 5000 }),
    prisma.menu.findMany({ where: { organizationId: orgId }, take: 500, include: { items: true } }),
  ]);
  const totals = bucketTotals(entries);
  return totals.map((t) => {
    const groupEntries = entries.filter((e) => (e.foodItemId ?? '') === t.foodItemId && (e.mealType ?? '') === t.mealType);
    const saleEvents = groupEntries.filter((e) =>
      (e.entryKind === 'SALE' && e.direction === 'ADD') ||
      (e.entryKind === 'ADJUSTMENT' && e.refKind === 'SALE'));
    const saleQtys = saleEvents.map((e) => r2(signedOf(e)));
    const saleTimes = saleEvents.map((e) => new Date(e.recordedAt));
    const netSold = r2(saleQtys.reduce((a, q) => a + q, 0));
    let assessed;
    if (netSold <= 0) {
      assessed = { estimable: false as const, reason: 'No net sales recorded yet — pace cannot be measured.',
        explanation: 'Cannot reliably estimate yet: no net sales recorded.', paceKgPerHour: null,
        elapsedHours: null, remainingHours: null, windowEnd: null, projectedEodSoldKg: null,
        predictedUnsoldKg: null, risk: null, medKg: thresholds.medKg, highKg: thresholds.highKg };
    } else {
      assessed = assessSurplusRisk(thresholds,
        { saleQtys, saleTimes, producedToDate: t.produced, wasteToDate: t.wasted, now, mealType: t.mealType });
    }
    const series = buildSeries(records, menus, kitchenUnitId, t.foodItemId, t.mealType);
    const mem = forecastForDate(series, dayStart);
    const target = targets.find((x) => x.foodItemId === t.foodItemId && x.mealType === t.mealType) ?? null;
    return {
      foodItemId: t.foodItemId, food: t.food, mealType: t.mealType,
      producedToDate: t.produced, soldToDate: t.sold, wasteToDate: t.wasted,
      saleEntries: saleEvents.length,
      targetKg: target ? (target.adjustedKg ?? target.recommendedKg) : null,
      memoryPredictedKg: mem.insufficient ? null : mem.predictedKg,
      dataConfidence: mem.insufficient ? 'low' : mem.dataConfidence,
      memoryLimitation: mem.insufficient ? (mem.message ?? 'Not enough history for a demand reference.') : null,
      ...assessed,
    };
  });
}

async function evaluateAndNotify(orgId: string, kitchenUnitId: string, dayStart: Date): Promise<string[]> {
  const triggered: string[] = [];
  try {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayKey = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
    const risks = await risksForDay(orgId, kitchenUnitId, dayStart, dayEnd, new Date());
    const kitchen = await prisma.kitchenUnit.findUnique({ where: { id: kitchenUnitId } });
    for (const r of risks) {
      const linkPath = `/flow?kitchen=${kitchenUnitId}&date=${dayKey}`;
      if (r.risk === 'high' || r.risk === 'medium') {
        const type = r.risk === 'high' ? 'SURPLUS_RISK_HIGH' : 'SURPLUS_RISK_MEDIUM';
        const ok = await notifyOrg(orgId, type,
          `${r.risk === 'high' ? 'High' : 'Medium'} surplus risk: ${r.food} (${r.mealType})`,
          `Predicted unsold ${r.predictedUnsoldKg} kg before day close at ${kitchen?.name ?? 'kitchen'}. ${r.explanation} Estimate only — verify on the floor.`,
          linkPath);
        if (ok) triggered.push(type);
      }
      if (r.targetKg !== null && r.targetKg > 0) {
        if (r.producedToDate >= 1.1 * r.targetKg) {
          const ok = await notifyOrg(orgId, 'PRODUCTION_ABOVE_TARGET',
            `Production above target: ${r.food} (${r.mealType})`,
            `Produced ${r.producedToDate} kg vs target ${r.targetKg} kg at ${kitchen?.name ?? 'kitchen'}.`,
            linkPath);
          if (ok) triggered.push('PRODUCTION_ABOVE_TARGET');
        } else if (r.producedToDate <= 0.9 * r.targetKg && r.producedToDate > 0) {
          const ok = await notifyOrg(orgId, 'PRODUCTION_BELOW_TARGET',
            `Production below target: ${r.food} (${r.mealType})`,
            `Produced ${r.producedToDate} kg vs target ${r.targetKg} kg at ${kitchen?.name ?? 'kitchen'}.`,
            linkPath);
          if (ok) triggered.push('PRODUCTION_BELOW_TARGET');
        }
      }
      const thresholds = await thresholdsFor(orgId);
      if (r.wasteToDate >= thresholds.medKg && r.producedToDate > 0 && r.wasteToDate / r.producedToDate >= 0.15) {
        const ok = await notifyOrg(orgId, 'HIGH_WASTE',
          `High waste pace: ${r.food} (${r.mealType})`,
          `Waste ${r.wasteToDate} kg is ${Math.round((r.wasteToDate / r.producedToDate) * 100)}% of produced at ${kitchen?.name ?? 'kitchen'}. Review portions and holding.`,
          linkPath);
        if (ok) triggered.push('HIGH_WASTE');
      }
    }
  } catch { /* notifications must never break entry logging */ }
  return [...new Set(triggered)];
}

// POST /api/flow/actions/adjust-production — suggestion only, never mutates records
router.post('/actions/adjust-production', requireRole(...FLOW_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1), foodItemId: z.string().min(1),
    mealType: z.enum(MEAL_TYPES), date: z.string().min(1, 'Date is required.'),
    suggestedDeltaKg: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 1000, 'Suggested change must be non-zero and within ±1000 kg.'),
    rationale: z.string().trim().min(5, 'Rationale needs at least 5 characters.').max(1000, 'Rationale is too long.'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
  if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  const dir = v.suggestedDeltaKg < 0 ? 'reduction' : 'additional production';
  const rec = await prisma.recommendation.create({
    data: { organizationId: orgId, kitchenUnitId: v.kitchenUnitId, type: 'PRODUCTION_ADJUST_SUGGESTION', status: 'PENDING',
      title: `Suggested production ${dir}: ${food.name} (${v.mealType}) ${v.suggestedDeltaKg > 0 ? '+' : ''}${v.suggestedDeltaKg} kg`,
      detail: `${v.rationale.trim()} Suggestion only — recorded production is unchanged. Confirm with kitchen staff before acting.` },
  });
  await audit('flow.action.adjust-suggestion', { userId: req.userId, organizationId: orgId, entityType: 'Recommendation', entityId: rec.id,
    metadata: { foodItemId: v.foodItemId, deltaKg: v.suggestedDeltaKg } });
  return res.status(201).json({ recommendation: rec, audited: true });
});

// POST /api/flow/actions/special-offer — internal promotion note (no payment integration)
router.post('/actions/special-offer', requireRole(...FLOW_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1), foodItemId: z.string().min(1),
    mealType: z.enum(MEAL_TYPES), date: z.string().min(1, 'Date is required.'),
    title: z.string().trim().min(3, 'Offer title needs at least 3 characters.').max(120, 'Offer title is too long.'),
    note: z.string().trim().min(5, 'Offer note needs at least 5 characters.').max(1000, 'Offer note is too long.'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
  if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  const rec = await prisma.recommendation.create({
    data: { organizationId: orgId, kitchenUnitId: v.kitchenUnitId, type: 'INTERNAL_PROMOTION', status: 'PENDING',
      title: v.title.trim(),
      detail: `${v.note.trim()} [${food.name}, ${v.mealType}, ${v.date}] Internal note only — no payment-system integration.` },
  });
  await audit('flow.action.special-offer', { userId: req.userId, organizationId: orgId, entityType: 'Recommendation', entityId: rec.id,
    metadata: { foodItemId: v.foodItemId } });
  return res.status(201).json({ recommendation: rec, audited: true });
});

// POST /api/flow/actions/prepare-redistribution — draft only, no eligibility, no NGO
router.post('/actions/prepare-redistribution', requireRole(...FLOW_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1), foodItemId: z.string().min(1),
    mealType: z.enum(MEAL_TYPES), date: z.string().min(1, 'Date is required.'),
    quantityKg: z.coerce.number().positive('Quantity must be greater than 0 kg.').max(100000, 'Quantity looks too large.'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
  if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  const draft = await prisma.redistributionRecord.create({
    data: { organizationId: orgId, kitchenUnitId: v.kitchenUnitId, quantityKg: v.quantityKg,
      status: 'DRAFT', ngoId: null, assessmentId: null,
      notes: `Surplus preparation draft for ${food.name} (${v.mealType}, ${v.date}) — eligibility NOT assessed; no NGO notified.` },
  });
  await audit('flow.action.prepare-redistribution', { userId: req.userId, organizationId: orgId, entityType: 'RedistributionRecord', entityId: draft.id,
    metadata: { foodItemId: v.foodItemId, quantityKg: v.quantityKg } });
  return res.status(201).json({ draft, audited: true });
});

export default router;
