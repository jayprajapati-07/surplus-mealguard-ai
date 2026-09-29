import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import {
  MEMORY_VERSION,
  buildSeries,
  dedupeToLatest,
  forecastForDate,
  summarize,
  utcDayKey,
} from '../lib/kitchen-memory';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const REFRESH_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;
const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;

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

const filterSchema = z.object({
  kitchenUnitId: z.string().min(1).optional(),
  foodItemId: z.string().min(1).optional(),
  mealType: z.enum(MEAL_TYPES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function parseDateBound(v: string | undefined, label: string): { date?: Date; error?: string } {
  if (!v) return {};
  const d = new Date(v);
  if (isNaN(d.getTime())) return { error: `${label} is not a valid date.` };
  return { date: d };
}

async function loadScoped(req: AuthenticatedRequest, orgId: string, q: z.infer<typeof filterSchema>) {
  if (q.kitchenUnitId) {
    const k = await prisma.kitchenUnit.findFirst({ where: { id: q.kitchenUnitId, organizationId: orgId } });
    if (!k) return { error: 'Kitchen/unit not found in your organization.' };
  }
  if (q.foodItemId) {
    const f = await prisma.foodItem.findFirst({ where: { id: q.foodItemId, organizationId: orgId } });
    if (!f) return { error: 'Food item not found in your organization.' };
  }
  const { date: from, error: fromErr } = parseDateBound(q.from, 'From date');
  if (fromErr) return { error: fromErr };
  const { date: to, error: toErr } = parseDateBound(q.to, 'To date');
  if (toErr) return { error: toErr };
  const where: Record<string, unknown> = { organizationId: orgId };
  if (q.kitchenUnitId) where.kitchenUnitId = q.kitchenUnitId;
  if (q.foodItemId) where.foodItemId = q.foodItemId;
  if (q.mealType) where.mealType = q.mealType;
  if (from || to) {
    const dr: Record<string, Date> = {};
    if (from) dr.gte = from;
    if (to) dr.lte = to;
    where.date = dr;
  }
  const records = await prisma.dailyFoodRecord.findMany({
    where,
    orderBy: { date: 'asc' },
    take: 2000,
    include: { foodItem: true, kitchenUnit: true },
  });
  const menus = await prisma.menu.findMany({
    where: { organizationId: orgId },
    orderBy: { date: 'asc' },
    take: 500,
    include: { items: true },
  });
  return { records, menus };
}

// GET /api/memory/summary — patterns + normalized records the model uses
router.get('/summary', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const loaded = await loadScoped(req, orgId, parsed.data);
  if ('error' in loaded) return res.status(400).json({ error: loaded.error });
  const { records, menus } = loaded;
  const patterns = summarize(records);
  const menuDays = new Set<string>();
  for (const m of menus) {
    for (const i of m.items) {
      menuDays.add([m.kitchenUnitId ?? '', i.foodItemId ?? '', m.mealType, utcDayKey(new Date(m.date))].join('|'));
    }
  }
  const normalized = dedupeToLatest(records).map((r) => ({
    id: r.id,
    date: r.date,
    kitchen: r.kitchenUnit?.name ?? '—',
    food: r.foodItem?.name ?? 'Unknown item',
    meal: r.mealType,
    producedKg: r.preparedKg,
    soldKg: r.soldKg ?? r.servedKg,
    wasteKg: r.wasteKg,
    remainingKg: r.remainingKg ?? 0,
    onMenu: menuDays.has([r.kitchenUnitId, r.foodItemId ?? '', r.mealType, utcDayKey(new Date(r.date))].join('|')),
    isCorrection: r.isCorrection,
  }));
  const [kitchens, foods] = await Promise.all([
    prisma.kitchenUnit.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } }),
    prisma.foodItem.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: 'asc' } }),
  ]);
  return res.json({
    patterns,
    records: normalized,
    filters: {
      kitchens: kitchens.map((k) => ({ id: k.id, name: k.name })),
      foods: foods.map((f) => ({ id: f.id, name: f.name })),
    },
    version: MEMORY_VERSION,
  });
});

// GET /api/memory/forecast — full inputs breakdown ("how this learned")
router.get('/forecast', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = filterSchema.extend({ date: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const q = parsed.data;
  if (!q.kitchenUnitId || !q.foodItemId || !q.mealType) {
    return res.status(400).json({ error: 'kitchenUnitId, foodItemId, and mealType are required to explain an estimate.' });
  }
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const target = q.date ? new Date(q.date) : (() => { const t = new Date(); t.setUTCDate(t.getUTCDate() + 1); return t; })();
  if (isNaN(target.getTime())) return res.status(400).json({ error: 'Target date is not valid.' });
  const loaded = await loadScoped(req, orgId, q);
  if ('error' in loaded) return res.status(400).json({ error: loaded.error });
  const series = buildSeries(loaded.records, loaded.menus, q.kitchenUnitId, q.foodItemId, q.mealType);
  const forecast = forecastForDate(series, target);
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: q.kitchenUnitId, organizationId: orgId } });
  const food = await prisma.foodItem.findFirst({ where: { id: q.foodItemId, organizationId: orgId } });
  return res.json({
    forecast,
    version: MEMORY_VERSION,
    inputs: {
      kitchen: kitchen?.name ?? q.kitchenUnitId,
      food: food?.name ?? q.foodItemId,
      meal: q.mealType,
      targetDate: target.toISOString().slice(0, 10),
      weekday: target.getUTCDay(),
    },
  });
});

const refreshSchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(14).optional().default(7),
});

// POST /api/memory/refresh — deterministic learning refresh (NOT neural-network training)
router.post('/refresh', requireRole(...REFRESH_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = refreshSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const daysAhead = parsed.data.daysAhead ?? 7;
  try {
    const [records, menus, kitchens, foods] = await Promise.all([
      prisma.dailyFoodRecord.findMany({ where: { organizationId: orgId }, orderBy: { date: 'asc' }, take: 5000 }),
      prisma.menu.findMany({ where: { organizationId: orgId }, take: 500, include: { items: true } }),
      prisma.kitchenUnit.findMany({ where: { organizationId: orgId } }),
      prisma.foodItem.findMany({ where: { organizationId: orgId, isActive: true } }),
    ]);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const snapshots: { organizationId: string; kitchenUnitId: string; date: Date; predictedDemandKg: number; method: string; inputsJson: string }[] = [];
    for (const k of kitchens) {
      for (const f of foods) {
        for (const meal of MEAL_TYPES) {
          const series = buildSeries(records, menus, k.id, f.id, meal);
          if (series.length < 2) continue;
          for (let d = 1; d <= daysAhead; d++) {
            const target = new Date(today.getTime() + d * 86400000);
            const fc = forecastForDate(series, target);
            if (fc.insufficient) continue;
            snapshots.push({
              organizationId: orgId,
              kitchenUnitId: k.id,
              date: target,
              predictedDemandKg: fc.predictedKg,
              method: MEMORY_VERSION,
              inputsJson: JSON.stringify({
                foodItemId: f.id, foodName: f.name, mealType: meal,
                baselineKg: fc.baselineKg, recentTrendKg: fc.recentTrendKg, menuMultiplier: fc.menuMultiplier,
                lowerKg: fc.lowerKg, upperKg: fc.upperKg, dataConfidence: fc.dataConfidence,
                comparableCount: fc.comparableCount, fallbackUsed: fc.fallbackUsed,
              }),
            });
          }
        }
      }
    }
    // Replace previous memory-v1 outputs so refresh means recompute, not accumulate.
    await prisma.forecastSnapshot.deleteMany({ where: { organizationId: orgId, method: MEMORY_VERSION } });
    if (snapshots.length > 0) {
      for (let i = 0; i < snapshots.length; i += 200) {
        await prisma.forecastSnapshot.createMany({ data: snapshots.slice(i, i + 200) });
      }
    }
    // Recommendations from repeated patterns (capped, deterministic order).
    const byKitchenFood = new Map<string, typeof records>();
    for (const r of dedupeToLatest(records)) {
      const key = `${r.kitchenUnitId}|${r.foodItemId ?? ''}`;
      const arr = byKitchenFood.get(key) ?? [];
      arr.push(r);
      byKitchenFood.set(key, arr);
    }
    const kitchenName = new Map(kitchens.map((k) => [k.id, k.name]));
    const foodName = new Map(foods.map((f) => [f.id, f.name]));
    const recs: { organizationId: string; kitchenUnitId: string; type: string; title: string; detail: string; status: string }[] = [];
    const overEntries = [...byKitchenFood.entries()]
      .map(([key, arr]) => {
        const over = arr.filter((r) => (r.remainingKg ?? 0) > 0.15 * r.preparedKg);
        const meanRem = over.length === 0 ? 0 : over.reduce((x, r) => x + (r.remainingKg ?? 0), 0) / over.length;
        return { key, over: over.length, total: arr.length, meanRem };
      })
      .filter((e) => e.over >= 3)
      .sort((a, b) => b.over - a.over)
      .slice(0, 10);
    for (const e of overEntries) {
      const [kid, fid] = e.key.split('|');
      recs.push({
        organizationId: orgId, kitchenUnitId: kid, type: 'FORECAST_WASTE_RISK', status: 'PENDING',
        title: `Repeated surplus: ${foodName.get(fid) ?? 'item'} (${kitchenName.get(kid) ?? 'kitchen'})`,
        detail: `On ${e.over} of ${e.total} recorded days, remaining food exceeded 15% of produced (mean surplus ${Math.round(e.meanRem * 10) / 10} kg). ` +
          ` learned from persisted records — consider trimming production by about that mean surplus on high-surplus weekdays. Estimate only, confirm with kitchen staff.`,
      });
    }
    const underEntries = [...byKitchenFood.entries()]
      .map(([key, arr]) => ({
        key,
        under: arr.filter((r) => !!r.adjustmentReason || (r.targetKg !== null && r.preparedKg < 0.9 * (r.targetKg as number))).length,
        total: arr.length,
      }))
      .filter((e) => e.under >= 2)
      .sort((a, b) => b.under - a.under)
      .slice(0, 10);
    for (const e of underEntries) {
      const [kid, fid] = e.key.split('|');
      recs.push({
        organizationId: orgId, kitchenUnitId: kid, type: 'FORECAST_SHORTFALL_WATCH', status: 'PENDING',
        title: `Shortfall watch: ${foodName.get(fid) ?? 'item'} (${kitchenName.get(kid) ?? 'kitchen'})`,
        detail: `${e.under} recorded shortfall day(s) found in persisted history. Forecasts for this item may under-serve; review targets before service. Estimate only.`,
      });
    }
    await prisma.recommendation.deleteMany({ where: { organizationId: orgId, type: { in: ['FORECAST_WASTE_RISK', 'FORECAST_SHORTFALL_WATCH'] }, status: 'PENDING' } });
    if (recs.length > 0) {
      for (let i = 0; i < recs.length; i += 100) {
        await prisma.recommendation.createMany({ data: recs.slice(i, i + 100) });
      }
    }
    await audit('memory.refresh', {
      userId: req.userId, organizationId: orgId, entityType: 'Organization', entityId: orgId,
      metadata: { method: MEMORY_VERSION, daysAhead, snapshotsCreated: snapshots.length, recommendationsCreated: recs.length },
    });
    return res.json({
      message: `Kitchen memory refreshed deterministically: ${snapshots.length} forecast snapshot(s), ${recs.length} recommendation(s).`,
      snapshotsCreated: snapshots.length,
      recommendationsCreated: recs.length,
      method: MEMORY_VERSION,
    });
  } catch {
    return res.status(500).json({ error: 'Refresh failed before anything was saved. Previous snapshots are untouched.' });
  }
});

// GET /api/memory/snapshots — latest persisted outputs + last refresh info
router.get('/snapshots', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const [snapshots, recommendations, lastRefresh] = await Promise.all([
    prisma.forecastSnapshot.findMany({
      where: { organizationId: orgId, method: MEMORY_VERSION },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { kitchenUnit: true },
    }),
    prisma.recommendation.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.auditLog.findFirst({ where: { organizationId: orgId, action: 'memory.refresh' }, orderBy: { createdAt: 'desc' } }),
  ]);
  return res.json({
    snapshots: snapshots.map((s) => ({
      id: s.id, date: s.date, kitchen: s.kitchenUnit?.name ?? '—',
      predictedKg: s.predictedDemandKg, method: s.method, inputs: s.inputsJson ? JSON.parse(s.inputsJson as string) : null,
      createdAt: s.createdAt,
    })),
    recommendations,
    lastRefresh,
    method: MEMORY_VERSION,
  });
});

export default router;
