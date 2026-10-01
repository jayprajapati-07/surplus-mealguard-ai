import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth';
import { dedupeToLatest, utcDayKey } from '../lib/kitchen-memory';
import { computeFeedback } from '../lib/targets';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;

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

// GET /api/dashboard/overview?kitchenUnitId=&date= — everything the core dashboard needs
router.get('/overview', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1).optional(), date: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;

  let kitchen = parsed.data.kitchenUnitId
    ? await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } })
    : await prisma.kitchenUnit.findFirst({ where: { organizationId: orgId }, orderBy: { name: 'asc' } });
  if (parsed.data.kitchenUnitId && !kitchen) {
    return res.status(404).json({ error: 'Kitchen/unit not found in your organization.' });
  }
  if (!kitchen) return res.status(404).json({ error: 'No kitchen/unit yet. Complete onboarding first.' });

  const rawDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (isNaN(rawDate.getTime())) return res.status(400).json({ error: 'Date is not valid.' });
  const day = new Date(Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()));
  const nextDay = new Date(day.getTime() + 86400000);
  const lastWeekDay = new Date(day.getTime() - 7 * 86400000);

  const targets = await prisma.productionTarget.findMany({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: nextDay } },
    orderBy: [{ mealType: 'asc' }],
    take: 200,
    include: { foodItem: true },
  });

  const records = await prisma.dailyFoodRecord.findMany({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id },
    orderBy: { date: 'asc' },
    take: 5000,
  });
  const deduped = dedupeToLatest(records);
  const byKey = new Map(deduped.map((r) => [`${r.foodItemId ?? ''}|${r.mealType}|${utcDayKey(new Date(r.date))}`, r]));
  const dayKey = utcDayKey(day);
  const lastWeekKey = utcDayKey(lastWeekDay);

  const rows = [];
  for (const t of targets) {
    const effective = t.adjustedKg ?? t.recommendedKg;
    const actual = byKey.get(`${t.foodItemId}|${t.mealType}|${dayKey}`) ?? null;
    const actualPair = actual ? { producedKg: actual.preparedKg, soldKg: actual.soldKg ?? actual.servedKg } : null;
    const feedback = computeFeedback(effective, t.predictedKg, actualPair);
    const stored = t.feedbackJson ?? null;
    const fresh = JSON.stringify(feedback);
    if (stored !== fresh) {
      // Best-effort feedback refresh — never fail the dashboard read on a write race.
      await prisma.productionTarget.update({ where: { id: t.id }, data: { feedbackJson: fresh } }).catch(() => undefined);
    }
    const lw = byKey.get(`${t.foodItemId}|${t.mealType}|${lastWeekKey}`) ?? null;
    let inputs: unknown = null;
    try {
      inputs = t.inputsJson ? JSON.parse(t.inputsJson as string) : null;
    } catch {
      inputs = null;
    }
    rows.push({
      id: t.id, foodItemId: t.foodItemId, food: t.foodItem?.name ?? '—', mealType: t.mealType,
      predictedKg: t.predictedKg, bufferKg: t.bufferKg, recommendedKg: t.recommendedKg,
      adjustedKg: t.adjustedKg, adjustReason: t.adjustReason, effectiveKg: effective,
      status: t.status, memoryVersion: t.memoryVersion,
      inputs,
      feedback,
      actual: actual ? {
        producedKg: actual.preparedKg, soldKg: actual.soldKg ?? actual.servedKg,
        wasteKg: actual.wasteKg, remainingKg: actual.remainingKg ?? 0,
      } : null,
      progressProduced: actual && effective > 0 ? r3(actual.preparedKg / effective) : null,
      progressSold: actual && effective > 0 ? r3((actual.soldKg ?? actual.servedKg) / effective) : null,
      lastWeek: lw ? { soldKg: lw.soldKg ?? lw.servedKg, producedKg: lw.preparedKg, wasteKg: lw.wasteKg, remainingKg: lw.remainingKg ?? 0 } : null,
      lastWeekDate: lastWeekKey,
      lastWeekMessage: lw ? null : `No comparable record for ${lastWeekKey} yet — record Food Data for that day to unlock comparison.`,
    });
  }

  const withActuals = rows.filter((r) => r.actual);
  const flowSummary = {
    producedKg: r3(withActuals.reduce((x, r) => x + (r.actual?.producedKg ?? 0), 0)),
    soldKg: r3(withActuals.reduce((x, r) => x + (r.actual?.soldKg ?? 0), 0)),
    wasteKg: r3(withActuals.reduce((x, r) => x + (r.actual?.wasteKg ?? 0), 0)),
    remainingKg: r3(withActuals.reduce((x, r) => x + (r.actual?.remainingKg ?? 0), 0)),
    recordsCount: withActuals.length,
  };

  const rank: Record<string, number> = { low: 0, medium: 1, high: 2 };
  let worst: 'high' | 'medium' | 'low' = 'high';
  let basedOn = 0;
  for (const r of rows) {
    const c = (r.inputs as { dataConfidence?: unknown } | null)?.dataConfidence as 'high' | 'medium' | 'low' | undefined;
    if (!c || !(c in rank)) { worst = 'low'; continue; }
    basedOn++;
    if (rank[c] < rank[worst]) worst = c;
  }
  if (rows.length > 0 && basedOn === 0) worst = 'low';

  const allRecs = await prisma.recommendation.findMany({
    where: { organizationId: orgId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  const recommendations = [
    ...allRecs.filter((r) => r.type === 'TARGET_TUNING'),
    ...allRecs.filter((r) => r.type !== 'TARGET_TUNING'),
  ].slice(0, 10);

  const bufferRow = await prisma.bufferConfig.findUnique({ where: { organizationId: orgId } });
  const activeNgosCount = await prisma.ngoOrganization.count({ where: { isActive: true } });

  return res.json({
    date: dayKey,
    kitchen: { id: kitchen.id, name: kitchen.name },
    targets: rows,
    flowSummary,
    confidence: { level: rows.length === 0 ? 'low' : worst, basedOn, targets: rows.length },
    recommendations,
    buffer: bufferRow ? { mode: bufferRow.mode, value: bufferRow.value } : null,
    activeNgosCount,
  });
});

export default router;
