import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { notifyOrg } from './notifications';
import { buildSeries, forecastForDate, MEMORY_VERSION, utcDayKey } from '../lib/kitchen-memory';
import { bufferKgFor, validateBuffer, DEFAULT_BUFFER, type BufferSetting } from '../lib/targets';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;
const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

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

async function bufferFor(orgId: string): Promise<BufferSetting> {
  const row = await prisma.bufferConfig.findUnique({ where: { organizationId: orgId } });
  if (!row) return { ...DEFAULT_BUFFER };
  return { mode: row.mode as BufferSetting['mode'], value: row.value };
}

// GET /api/targets/buffer
router.get('/buffer', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const row = await prisma.bufferConfig.findUnique({ where: { organizationId: orgId } });
  return res.json({ buffer: row ? { mode: row.mode, value: row.value } : null });
});

// PUT /api/targets/buffer
router.put('/buffer', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ mode: z.string(), value: z.coerce.number() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const err = validateBuffer(parsed.data.mode, parsed.data.value);
  if (err) return res.status(400).json({ error: err });
  const row = await prisma.bufferConfig.upsert({
    where: { organizationId: orgId },
    update: { mode: parsed.data.mode, value: parsed.data.value, updatedById: req.userId },
    create: { organizationId: orgId, mode: parsed.data.mode, value: parsed.data.value, updatedById: req.userId },
  });
  await audit('targets.buffer', { userId: req.userId, organizationId: orgId, entityType: 'BufferConfig', entityId: row.id, metadata: { mode: row.mode, value: row.value } });
  return res.json({ message: 'Production safety buffer saved.', buffer: { mode: row.mode, value: row.value } });
});

const generateSchema = z.object({
  kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
  date: z.string().min(1, 'Date is required.'),
  daysAhead: z.coerce.number().int().min(1).max(7).optional().default(1),
});

// POST /api/targets/generate
router.post('/generate', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const start = new Date(parsed.data.date);
  if (isNaN(start.getTime())) return res.status(400).json({ error: 'Date is not valid.' });
  const daysAhead = parsed.data.daysAhead ?? 1;
  try {
    const buffer = await bufferFor(orgId);
    const [records, menus, foods] = await Promise.all([
      prisma.dailyFoodRecord.findMany({ where: { organizationId: orgId }, orderBy: { date: 'asc' }, take: 5000 }),
      prisma.menu.findMany({ where: { organizationId: orgId }, take: 500, include: { items: true } }),
      prisma.foodItem.findMany({ where: { organizationId: orgId, isActive: true } }),
    ]);
    let created = 0;
    let updated = 0;
    for (const f of foods) {
      for (const meal of MEAL_TYPES) {
        const series = buildSeries(records, menus, kitchen.id, f.id, meal);
        if (series.length < 2) continue;
        for (let d = 0; d < daysAhead; d++) {
          const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d));
          const fc = forecastForDate(series, target);
          if (fc.insufficient) continue;
          const bKg = bufferKgFor(fc.predictedKg, buffer);
          const recommended = r3(fc.predictedKg + bKg);
          const inputs = {
            foodItemId: f.id, foodName: f.name, mealType: meal,
            baselineKg: fc.baselineKg, recentTrendKg: fc.recentTrendKg, menuMultiplier: fc.menuMultiplier,
            menuOnMeanKg: fc.menuOnMeanKg, menuOffMeanKg: fc.menuOffMeanKg,
            lowerKg: fc.lowerKg, upperKg: fc.upperKg, dataConfidence: fc.dataConfidence,
            comparableCount: fc.comparableCount, fallbackUsed: fc.fallbackUsed, fallbackReason: fc.fallbackReason,
            sampleValues: fc.sampleValues, sampleDates: fc.sampleDates, stdDevKg: fc.stdDevKg,
            bufferMode: buffer.mode, bufferValue: buffer.value,
          };
          const existing = await prisma.productionTarget.findFirst({
            where: { organizationId: orgId, kitchenUnitId: kitchen.id, foodItemId: f.id, mealType: meal, date: target },
          });
          if (existing) {
            // Never silently overwrite a manager decision: keep adjustedKg/adjustReason/status.
            await prisma.productionTarget.update({
              where: { id: existing.id },
              data: { predictedKg: fc.predictedKg, bufferKg: bKg, recommendedKg: recommended, memoryVersion: MEMORY_VERSION, inputsJson: JSON.stringify(inputs) },
            });
            updated++;
          } else {
            await prisma.productionTarget.create({
              data: {
                organizationId: orgId, kitchenUnitId: kitchen.id, foodItemId: f.id, mealType: meal, date: target,
                predictedKg: fc.predictedKg, bufferKg: bKg, recommendedKg: recommended,
                status: 'PROPOSED', memoryVersion: MEMORY_VERSION, inputsJson: JSON.stringify(inputs),
              },
            });
            created++;
          }
        }
      }
    }
    // TARGET_TUNING recommendations from paired target-vs-actual history.
    const paired = await prisma.productionTarget.findMany({
      where: { organizationId: orgId, feedbackJson: { not: null } },
      take: 2000,
    });
    type Pair = { foodId: string; foodName: string; meal: string; weekday: number; overPct: number; overKg: number };
    const pairs: Pair[] = [];
    for (const t of paired) {
      try {
        const fb = JSON.parse(t.feedbackJson as string) as { hasActuals: boolean; producedKg: number | null; soldKg: number | null };
        if (!fb.hasActuals || fb.soldKg === null || fb.soldKg <= 0 || fb.producedKg === null) continue;
        const food = foods.find((f) => f.id === t.foodItemId);
        pairs.push({
          foodId: t.foodItemId, foodName: food?.name ?? 'item', meal: t.mealType,
          weekday: new Date(t.date).getUTCDay(),
          overPct: ((fb.producedKg - fb.soldKg) / fb.soldKg) * 100,
          overKg: fb.producedKg - fb.soldKg,
        });
      } catch { /* ignore unparseable legacy rows */ }
    }
    const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const groups = new Map<string, Pair[]>();
    for (const p of pairs) {
      const key = `${p.foodId}|${p.meal}|${p.weekday}`;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    const recs: { organizationId: string; kitchenUnitId: string; type: string; title: string; detail: string; status: string }[] = [];
    for (const arr of groups.values()) {
      if (arr.length < 3) continue;
      const meanPct = arr.reduce((x, p) => x + p.overPct, 0) / arr.length;
      const meanKg = arr.reduce((x, p) => x + p.overKg, 0) / arr.length;
      if (Math.abs(meanPct) < 10) continue;
      const p0 = arr[0];
      const dir = meanPct > 0 ? 'exceeded' : 'fell short of';
      const verb = meanPct > 0 ? 'reducing' : 'raising';
      recs.push({
        organizationId: orgId, kitchenUnitId: kitchen.id, type: 'TARGET_TUNING', status: 'PENDING',
        title: `${WD[p0.weekday]} ${p0.foodName} production ${dir} observed demand by approximately ${Math.abs(Math.round(meanPct * 10) / 10)}% across ${arr.length} comparable records; consider ${verb} target by ${Math.abs(r3(meanKg))} kg.`,
        detail: `Computed from persisted target-vs-actual pairs (no external data). Mean over/under-production ${r3(meanKg)} kg per record. This is a recommendation, not an operational mandate — confirm with kitchen staff.`,
      });
    }
    recs.sort((a, b) => b.title.length - a.title.length);
    const topRecs = recs.slice(0, 10);
    await prisma.recommendation.deleteMany({ where: { organizationId: orgId, type: 'TARGET_TUNING', status: 'PENDING' } });
    if (topRecs.length > 0) {
      await prisma.recommendation.createMany({ data: topRecs });
    }
    // Historical accuracy — computed, labeled, never claimed.
    let historicalAccuracy: { pct: number; pairs: number } | null = null;
    const scored: number[] = [];
    for (const t of paired) {
      try {
        const fb = JSON.parse(t.feedbackJson as string) as { hasActuals: boolean; soldKg: number | null };
        if (!fb.hasActuals || fb.soldKg === null || fb.soldKg <= 0) continue;
        scored.push(Math.abs(fb.soldKg - t.predictedKg) / fb.soldKg);
      } catch { /* ignore */ }
    }
    if (scored.length >= 5) {
      const meanErr = scored.reduce((x, y) => x + y, 0) / scored.length;
      historicalAccuracy = { pct: r3(Math.max(0, 100 * (1 - meanErr))), pairs: scored.length };
    }
    await audit('targets.generate', {
      userId: req.userId, organizationId: orgId, entityType: 'KitchenUnit', entityId: kitchen.id,
      metadata: { date: parsed.data.date, daysAhead, created, updated, recommendations: topRecs.length },
    });
    await notifyOrg(orgId, 'TARGET_GENERATED',
      `Targets generated for ${kitchen.name}`,
      `${created} new, ${updated} refreshed from ${start.toISOString().slice(0, 10)}. Open the dashboard to review per-food targets.`,
      '/');
    return res.json({
      message: `Targets generated for ${kitchen.name} from ${start.toISOString().slice(0, 10)}: ${created} new, ${updated} refreshed, ${topRecs.length} tuning recommendation(s).`,
      targetsCreated: created,
      targetsUpdated: updated,
      recommendationsCreated: topRecs.length,
      historicalAccuracy,
      method: MEMORY_VERSION,
    });
  } catch {
    return res.status(500).json({ error: 'Target generation failed before anything was saved.' });
  }
});

const adjustSchema = z.object({
  adjustedKg: z.coerce.number().min(0, 'Adjusted target cannot be negative.').max(1000000, 'Adjusted target looks too large.'),
  reason: z.string().trim().min(5, 'A manager adjustment needs a reason (min 5 characters) so the original target stays auditable.').max(500, 'Reason is too long.'),
});

// PUT /api/targets/:id/adjust — manager adjustment keeps the original
router.put('/:id/adjust', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = adjustSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.productionTarget.findFirst({
    where: { id: req.params.id, organizationId: orgId },
    include: { foodItem: true },
  });
  if (!existing) return res.status(404).json({ error: 'Production target not found in your organization.' });
  const target = await prisma.productionTarget.update({
    where: { id: existing.id },
    data: { adjustedKg: parsed.data.adjustedKg, adjustReason: parsed.data.reason.trim(), status: 'ADJUSTED' },
    include: { foodItem: true, kitchenUnit: true },
  });
  await audit('targets.adjust', {
    userId: req.userId, organizationId: orgId, entityType: 'ProductionTarget', entityId: target.id,
    metadata: { fromKg: existing.recommendedKg, toKg: target.adjustedKg, reason: target.adjustReason },
  });
  return res.json({ message: `Target adjusted; original ${existing.recommendedKg} kg retained for audit.`, target });
});

// GET /api/targets
router.get('/', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1).optional(), date: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const where: Record<string, unknown> = { organizationId: orgId };
  if (parsed.data.kitchenUnitId) where.kitchenUnitId = parsed.data.kitchenUnitId;
  if (parsed.data.date) {
    const d = new Date(parsed.data.date);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Date is not valid.' });
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    where.date = { gte: day, lt: new Date(day.getTime() + 86400000) };
  }
  const targets = await prisma.productionTarget.findMany({
    where,
    orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
    take: 300,
    include: { foodItem: true, kitchenUnit: true },
  });
  return res.json({
    targets: targets.map((t) => ({
      id: t.id, kitchenUnitId: t.kitchenUnitId, kitchen: t.kitchenUnit?.name ?? '—',
      foodItemId: t.foodItemId, food: t.foodItem?.name ?? '—',
      mealType: t.mealType, date: t.date,
      predictedKg: t.predictedKg, bufferKg: t.bufferKg, recommendedKg: t.recommendedKg,
      adjustedKg: t.adjustedKg, adjustReason: t.adjustReason,
      effectiveKg: t.adjustedKg ?? t.recommendedKg,
      status: t.status, memoryVersion: t.memoryVersion,
      inputs: t.inputsJson ? JSON.parse(t.inputsJson as string) : null,
      feedback: t.feedbackJson ? JSON.parse(t.feedbackJson as string) : null,
    })),
  });
});

export default router;
