// Shared analytics builders — deterministic aggregation over filtered,
// deduplicated persisted rows. No external calls. Every section carries
// the raw numbers it was computed from so charts and tables always agree.
import { PrismaClient, Prisma as PrismaTypes } from '@prisma/client';
import { dedupeToLatest, utcDayKey } from './kitchen-memory';
import { analyzeWasteDay } from './waste-analysis';
import { computeImpact, resolveFactors, type ResolvedFactors } from './impact';

type Db = PrismaClient;

export interface Filters {
  from: string;
  to: string;
  kitchenUnitId?: string;
  mealType?: string;
  foodItemId?: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function parseRange(from: string, to: string): { start: Date; end: Date; days: string[] } {
  const s = new Date(`${from}T00:00:00Z`);
  const e = new Date(`${to}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) throw new Error('From/to dates must be valid YYYY-MM-DD.');
  if (s > e) throw new Error('From date must not be after to date.');
  const spanDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  if (spanDays > 366) throw new Error('Date range must be 366 days or fewer.');
  const days: string[] = [];
  for (let i = 0; i < spanDays; i++) {
    days.push(new Date(s.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return { start: s, end: new Date(e.getTime() + 86400000), days };
}

export interface LoadedData {
  records: PrismaTypes.DailyFoodRecordGetPayload<{ include: { foodItem: true; kitchenUnit: true } }>[];
  targets: PrismaTypes.ProductionTargetGetPayload<{ include: { foodItem: true } }>[];
  forecasts: Awaited<ReturnType<Db['forecastSnapshot']['findMany']>>;
  redistributions: Awaited<ReturnType<Db['redistributionRecord']['findMany']>>;
  assessments: Awaited<ReturnType<Db['surplusEligibilityAssessment']['findMany']>>;
  recommendations: Awaited<ReturnType<Db['recommendation']['findMany']>>;
  factors: Awaited<ReturnType<Db['impactFactor']['findMany']>>;
  kitchens: Awaited<ReturnType<Db['kitchenUnit']['findMany']>>;
  foods: Awaited<ReturnType<Db['foodItem']['findMany']>>;
}

export async function loadFiltered(db: Db, orgId: string, f: Filters): Promise<LoadedData> {
  const { start, end } = parseRange(f.from, f.to);
  const recWhere: Record<string, unknown> = { organizationId: orgId, date: { gte: start, lt: end } };
  const tgtWhere: Record<string, unknown> = { organizationId: orgId, date: { gte: start, lt: end } };
  if (f.kitchenUnitId) { recWhere.kitchenUnitId = f.kitchenUnitId; tgtWhere.kitchenUnitId = f.kitchenUnitId; }
  if (f.mealType) { recWhere.mealType = f.mealType; tgtWhere.mealType = f.mealType; }
  if (f.foodItemId) { recWhere.foodItemId = f.foodItemId; tgtWhere.foodItemId = f.foodItemId; }
  // Redistributions carry no food/meal link, so they scope by kitchen + completion
  // window only; assessments scope by creation window. Both documented in UI.
  const redWhere: Record<string, unknown> = { organizationId: orgId };
  if (f.kitchenUnitId) redWhere.kitchenUnitId = f.kitchenUnitId;
  const [records, targets, forecasts, allRedistributions, assessments, recommendations, factors, kitchens, foods] = await Promise.all([
    db.dailyFoodRecord.findMany({ where: recWhere, orderBy: { date: 'asc' }, take: 5000, include: { foodItem: true, kitchenUnit: true } }),
    db.productionTarget.findMany({ where: tgtWhere, take: 2000, include: { foodItem: true } }),
    db.forecastSnapshot.findMany({ where: { organizationId: orgId, date: { gte: start, lt: end }, ...(f.kitchenUnitId ? { kitchenUnitId: f.kitchenUnitId } : {}) }, take: 2000 }),
    db.redistributionRecord.findMany({ where: redWhere, orderBy: { createdAt: 'asc' }, take: 2000, include: { ngo: true, assessment: true } }),
    db.surplusEligibilityAssessment.findMany({ where: { organizationId: orgId, createdAt: { gte: start, lt: end } }, take: 2000 }),
    db.recommendation.findMany({ where: { organizationId: orgId, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.impactFactor.findMany({ where: { OR: [{ organizationId: orgId }, { organizationId: null }] }, take: 200 }),
    db.kitchenUnit.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } }),
    db.foodItem.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } }),
  ]);
  // Completion window: deliveredAt when set, else createdAt. Documented in UI.
  const redistributions = allRedistributions.filter((r) => {
    const t = (r.deliveredAt ?? r.createdAt).getTime();
    return t >= start.getTime() && t < end.getTime();
  });
  return { records: dedupeToLatest(records), targets, forecasts, redistributions, assessments, recommendations, factors, kitchens, foods };
}

const soldOf = (r: { soldKg: number | null; servedKg: number }) => r.soldKg ?? r.servedKg;
const effOf = (t: { adjustedKg: number | null; recommendedKg: number }) => t.adjustedKg ?? t.recommendedKg;

export interface ProductionSection {
  targetTotal: number; actualTotal: number;
  daily: { date: string; target: number; actual: number }[];
  byFood: { foodItemId: string; food: string; target: number; actual: number }[];
  sameDay: { foodItemId: string; food: string; mealType: string; currentSold: number; priorSold: number | null; priorDate: string | null; note: string | null }[];
}

export function buildProduction(loaded: LoadedData, days: string[]): ProductionSection {
  const byDay = new Map<string, { target: number; actual: number }>();
  for (const d of days) byDay.set(d, { target: 0, actual: 0 });
  for (const t of loaded.targets) {
    const k = utcDayKey(new Date(t.date));
    const e = byDay.get(k);
    if (e) e.target = r3(e.target + effOf(t));
  }
  for (const r of loaded.records) {
    const k = utcDayKey(new Date(r.date));
    const e = byDay.get(k);
    if (e) e.actual = r3(e.actual + r.preparedKg);
  }
  const daily = days.map((date) => ({ date, ...byDay.get(date)! }));
  const byFoodMap = new Map<string, { foodItemId: string; food: string; target: number; actual: number }>();
  const bump = (id: string, name: string, dt: number, da: number) => {
    const e = byFoodMap.get(id) ?? { foodItemId: id, food: name, target: 0, actual: 0 };
    e.target = r3(e.target + dt);
    e.actual = r3(e.actual + da);
    byFoodMap.set(id, e);
  };
  for (const t of loaded.targets) bump(t.foodItemId, t.foodItem?.name ?? 'Unknown item', effOf(t), 0);
  for (const r of loaded.records) bump(r.foodItemId ?? 'unknown', r.foodItem?.name ?? 'Unknown item', 0, r.preparedKg);
  const byFood = [...byFoodMap.values()];
  // Same-day comparison: latest in-range day per (food, meal) vs 7 days earlier.
  const latest = new Map<string, { sold: number; date: string }>();
  for (const r of loaded.records) {
    const k = `${r.foodItemId ?? ''}|${r.mealType}`;
    const cur = latest.get(k);
    if (!cur || new Date(r.date) > new Date(cur.date)) {
      latest.set(k, { sold: soldOf(r), date: utcDayKey(new Date(r.date)) });
    }
  }
  const prior = new Map<string, { sold: number; date: string }>();
  for (const r of loaded.records) {
    const k = `${r.foodItemId ?? ''}|${r.mealType}|${utcDayKey(new Date(r.date))}`;
    if (!prior.has(k)) prior.set(k, { sold: soldOf(r), date: utcDayKey(new Date(r.date)) });
  }
  const sameDay = [...latest.entries()].map(([key, cur]) => {
    const [foodItemId, mealType] = key.split('|');
    const d = new Date(`${cur.date}T00:00:00Z`);
    const pk = `${foodItemId}|${mealType}|${new Date(d.getTime() - 7 * 86400000).toISOString().slice(0, 10)}`;
    const p = prior.get(pk);
    const food = loaded.records.find((r) => (r.foodItemId ?? '') === foodItemId)?.foodItem?.name ?? 'Unknown item';
    return {
      foodItemId, food, mealType, currentSold: cur.sold,
      priorSold: p ? p.sold : null, priorDate: p ? p.date : null,
      note: p ? null : 'No comparable record 7 days earlier.',
    };
  });
  return {
    targetTotal: r3(daily.reduce((a, d) => a + d.target, 0)),
    actualTotal: r3(daily.reduce((a, d) => a + d.actual, 0)),
    daily, byFood, sameDay,
  };
}

export interface SalesSection {
  soldKg: number; remainingKg: number; producedKg: number; utilizationPct: number | null;
  byFood: { foodItemId: string; food: string; sold: number; remaining: number }[];
  daily: { date: string; sold: number; remaining: number }[];
}

export function buildSales(loaded: LoadedData, days: string[]): SalesSection {
  const sold = r3(loaded.records.reduce((a, r) => a + soldOf(r), 0));
  const remaining = r3(loaded.records.reduce((a, r) => a + (r.remainingKg ?? 0), 0));
  const produced = r3(loaded.records.reduce((a, r) => a + r.preparedKg, 0));
  const byMap = new Map<string, { foodItemId: string; food: string; sold: number; remaining: number }>();
  for (const r of loaded.records) {
    const id = r.foodItemId ?? 'unknown';
    const e = byMap.get(id) ?? { foodItemId: id, food: r.foodItem?.name ?? 'Unknown item', sold: 0, remaining: 0 };
    e.sold = r3(e.sold + soldOf(r));
    e.remaining = r3(e.remaining + (r.remainingKg ?? 0));
    byMap.set(id, e);
  }
  const daily = days.map((date) => {
    const rows = loaded.records.filter((r) => utcDayKey(new Date(r.date)) === date);
    return {
      date,
      sold: r3(rows.reduce((a, r) => a + soldOf(r), 0)),
      remaining: r3(rows.reduce((a, r) => a + (r.remainingKg ?? 0), 0)),
    };
  });
  return { soldKg: sold, remainingKg: remaining, producedKg: produced,
    utilizationPct: produced > 0 ? r3((sold / produced) * 100) : null,
    byFood: [...byMap.values()], daily };
}

export interface WasteSection {
  totalKg: number; pctOfProduced: number | null;
  byFood: { foodItemId: string; food: string; waste: number }[];
  daily: { date: string; waste: number }[];
  contributors: { contributor: string; attributableKg: number; days: number }[];
  label: string;
}

export function buildWaste(loaded: LoadedData, days: string[]): WasteSection {
  const total = r3(loaded.records.reduce((a, r) => a + r.wasteKg, 0));
  const produced = loaded.records.reduce((a, r) => a + r.preparedKg, 0);
  const byMap = new Map<string, { foodItemId: string; food: string; waste: number }>();
  for (const r of loaded.records) {
    const id = r.foodItemId ?? 'unknown';
    const e = byMap.get(id) ?? { foodItemId: id, food: r.foodItem?.name ?? 'Unknown item', waste: 0 };
    e.waste = r3(e.waste + r.wasteKg);
    byMap.set(id, e);
  }
  const daily = days.map((date) => ({
    date,
    waste: r3(loaded.records.filter((r) => utcDayKey(new Date(r.date)) === date).reduce((a, r) => a + r.wasteKg, 0)),
  }));
  // Aggregate quantified contributors by re-running the documented analysis per in-range day.
  const history = loaded.records.map((r) => ({
    foodItemId: r.foodItemId, mealType: r.mealType, date: new Date(r.date),
    excessKg: r3(r.wasteKg + (r.remainingKg ?? 0)),
  }));
  const agg = new Map<string, { contributor: string; attributableKg: number; days: Set<string> }>();
  for (const date of days) {
    const dayRows = loaded.records
      .filter((r) => utcDayKey(new Date(r.date)) === date)
      .map((r) => {
        const t = loaded.targets.find((x) => x.foodItemId === r.foodItemId && x.mealType === r.mealType &&
          utcDayKey(new Date(x.date)) === date);
        return { id: r.id, foodItemId: r.foodItemId, foodName: r.foodItem?.name ?? 'Unknown item', mealType: r.mealType,
          date: new Date(r.date),
          preparedKg: r.preparedKg, soldKg: soldOf(r), wasteKg: r.wasteKg, remainingKg: r.remainingKg ?? 0,
          targetKg: t ? effOf(t) : null, adjustmentReason: r.adjustmentReason, correctionReason: r.correctionReason, notes: r.notes };
      });
    const { rows } = analyzeWasteDay({ dayRecords: dayRows, history, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), inventoryFlags: [] });
    for (const row of rows) {
      for (const c of row.claims) {
        const e = agg.get(c.contributor) ?? { contributor: c.contributor, attributableKg: 0, days: new Set<string>() };
        e.attributableKg = r3(e.attributableKg + c.attributableKg);
        e.days.add(date);
        agg.set(c.contributor, e);
      }
    }
  }
  return { totalKg: total, pctOfProduced: produced > 0 ? r3((total / produced) * 100) : null,
    byFood: [...byMap.values()], daily,
    contributors: [...agg.values()].map((c) => ({ contributor: c.contributor, attributableKg: c.attributableKg, days: c.days.size })),
    label: 'Contributors reuse the documented waste-analysis rules per in-range day.' };
}

export interface SurplusSection {
  predictedKg: number; actualRemainingKg: number; eligibleKg: number;
  redistributedKg: number; unredistributedKg: number; redistributionRatePct: number | null;
}

export function buildSurplus(loaded: LoadedData): SurplusSection {
  const predicted = r3(loaded.forecasts.reduce((a, f) => a + f.predictedDemandKg, 0));
  const actualRemaining = r3(loaded.records.reduce((a, r) => a + (r.remainingKg ?? 0), 0));
  const eligible = r3(loaded.assessments.filter((a) => a.eligible).reduce((a, x) => a + x.quantityKg, 0));
  const redistributed = r3(loaded.redistributions.filter((x) => x.status === 'COMPLETED').reduce((a, x) => a + x.quantityKg, 0));
  const unredistributed = r3(Math.max(0, eligible - redistributed));
  return { predictedKg: predicted, actualRemainingKg: actualRemaining, eligibleKg: eligible,
    redistributedKg: redistributed, unredistributedKg: unredistributed,
    redistributionRatePct: eligible > 0 ? r3((redistributed / eligible) * 100) : null };
}

export interface AiSection {
  pairs: { date: string; food: string; mealType: string; predictedKg: number; actualSoldKg: number; absPctErr: number | null }[];
  meanAbsPctErr: number | null;
  accuracyDefinition: string;
  recommendations: { id: string; type: string; title: string; status: string }[];
}

export function buildAI(loaded: LoadedData): AiSection {
  const pairs: AiSection['pairs'] = [];
  for (const t of loaded.targets) {
    const rec = loaded.records.find((r) => r.foodItemId === t.foodItemId && r.mealType === t.mealType &&
      utcDayKey(new Date(r.date)) === utcDayKey(new Date(t.date)));
    if (!rec) continue;
    const actual = soldOf(rec);
    const pred = effOf(t);
    pairs.push({ date: utcDayKey(new Date(t.date)), food: t.foodItem?.name ?? 'Unknown item', mealType: t.mealType,
      predictedKg: pred, actualSoldKg: actual,
      absPctErr: actual > 0 ? r3((Math.abs(actual - pred) / actual) * 100) : null });
  }
  const errs = pairs.map((p) => p.absPctErr).filter((e): e is number => e !== null);
  return {
    pairs,
    meanAbsPctErr: errs.length > 0 ? r3(errs.reduce((a, b) => a + b, 0) / errs.length) : null,
    accuracyDefinition: `Mean absolute percentage error of memory-v1 predicted demand (effective target) vs recorded sold, over ${errs.length} paired record(s). Lower is better; null when no pairs.`,
    recommendations: loaded.recommendations.map((r) => ({ id: r.id, type: r.type, title: r.title, status: r.status })),
  };
}

export interface SustainabilitySection {
  foodSavedKg: number; wasteReducedKg: number; redistributedKg: number;
  costSavedEstimate: number; co2AvoidedKgEstimate: number;
  howCalculated: string[];
  scopeNote: string | null;
  baseline: { periodLabel: string; days: number; wasteKg: number };
  factorsUsed: { key: string; value: number; unit: string; source: string }[];
}

export function buildSustainability(
  loaded: LoadedData,
  days: string[],
  scope: { foodItemId?: string | null; mealType?: string | null; category?: string | null; organizationId?: string | null }
): SustainabilitySection {  const factors = resolveFactors(loaded.factors, scope);
  // Baseline = earliest third of the selected range (calendar days).
  const n = days.length;
  const cut = Math.max(1, Math.floor(n / 3));
  const baseDays = days.slice(0, cut);
  const baseSet = new Set(baseDays);
  const baseRows = loaded.records.filter((r) => baseSet.has(utcDayKey(new Date(r.date))));
  const baseWaste = r3(baseRows.reduce((a, r) => a + r.wasteKg, 0));
  const actualWaste = r3(loaded.records.reduce((a, r) => a + r.wasteKg, 0));
  const completed = r3(loaded.redistributions.filter((x) => x.status === 'COMPLETED').reduce((a, x) => a + x.quantityKg, 0));
  const periodLabel = `${baseDays[0]} to ${baseDays[baseDays.length - 1]} (earliest third of selected range)`;
  const impact = computeImpact({
    completedQtyKg: completed, baselineWasteKg: baseWaste, baselineDays: baseRows.length > 0 ? baseDays.length : 0,
    baselineLabel: periodLabel, actualWasteKg: actualWaste, reportDays: n, factors,
  });
  const costRow = loaded.factors.find((f) => f.key === 'COST_PER_KG_FOOD');
  const co2Row = loaded.factors.find((f) => f.key === 'CO2_PER_KG_FOOD');
  const used: SustainabilitySection['factorsUsed'] = [
    { key: 'COST_PER_KG_FOOD', value: factors.costPerKg, unit: costRow?.unit ?? '', source: factors.costSource },
    { key: 'CO2_PER_KG_FOOD', value: factors.co2PerKg, unit: co2Row?.unit ?? '', source: factors.co2Source },
  ];
  // Redistribution rows carry no food/meal link, so with food/meal filters the
  // redistributed total stays organization-wide (kitchen-scoped when set).
  const scopeNote = scope.foodItemId || scope.mealType
    ? 'Redistributed quantity is organization-wide for the range (kitchen-scoped when a kitchen is selected); record-level food/meal filters do not narrow completed redistributions.'
    : null;
  return { ...impact, scopeNote, baseline: { periodLabel, days: baseRows.length > 0 ? baseDays.length : 0, wasteKg: baseWaste }, factorsUsed: used };
}
