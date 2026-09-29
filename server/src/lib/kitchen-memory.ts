// AI Kitchen Digital Memory — deterministic learning engine (algorithm version memory-v1).
// Operates ONLY on persisted organization records. No external calls, no randomness,
// no neural networks: every output is a reproducible function of its inputs.

export const MEMORY_VERSION = 'memory-v1';

export interface MemoryPoint {
  date: Date;
  soldKg: number;
  producedKg: number;
  wasteKg: number;
  remainingKg: number;
  onMenu: boolean;
  isCorrection: boolean;
}

export interface ForecastResult {
  predictedKg: number;
  lowerKg: number;
  upperKg: number;
  dataConfidence: 'high' | 'medium' | 'low';
  baselineKg: number;
  recentTrendKg: number;
  menuMultiplier: number;
  menuOnMeanKg: number | null;
  menuOffMeanKg: number | null;
  comparableCount: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  stdDevKg: number;
  sampleValues: number[];
  sampleDates: string[];
  insufficient: boolean;
  message: string | null;
}

export interface WeekdayStat {
  weekday: number;
  count: number;
  meanSold: number;
  meanProduced: number;
  meanWaste: number;
  meanRemaining: number;
}

export interface GroupStat {
  key: string;
  label: string;
  count: number;
  meanSold: number;
}

export interface PatternSummary {
  totals: { records: number; producedKg: number; soldKg: number; wasteKg: number; remainingKg: number };
  means: { producedKg: number; soldKg: number; wasteKg: number; remainingKg: number };
  perWeekday: WeekdayStat[];
  perMeal: GroupStat[];
  perFood: GroupStat[];
  overproductionDays: number;
  underproductionDays: number;
  quality: { sampleSize: number; spanDays: number; correctionCount: number; status: 'OK' | 'SPARSE' | 'INSUFFICIENT' };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mean = (a: number[]) => (a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length);

export function utcDayKey(d: Date): string {
  const t = d instanceof Date ? d : new Date(d);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function soldOf(record: { soldKg: number | null; servedKg: number }): number {
  return record.soldKg ?? record.servedKg;
}

type RecordLike = {
  id: string;
  kitchenUnitId: string;
  foodItemId: string | null;
  date: Date | string;
  mealType: string;
  targetKg: number | null;
  preparedKg: number;
  servedKg: number;
  soldKg: number | null;
  wasteKg: number;
  remainingKg: number | null;
  adjustmentReason: string | null;
  isCorrection: boolean;
  createdAt: Date | string;
};

/** Same (kitchen, food, meal, UTC day) keeps the latest-created record (corrections supersede). */
export function dedupeToLatest<T extends RecordLike>(records: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of records) {
    const key = [r.kitchenUnitId, r.foodItemId ?? '', r.mealType, utcDayKey(new Date(r.date))].join('|');
    const prev = byKey.get(key);
    if (!prev || new Date(r.createdAt).getTime() >= new Date(prev.createdAt).getTime()) {
      byKey.set(key, r);
    }
  }
  return [...byKey.values()];
}

type MenuLike = {
  kitchenUnitId: string | null;
  date: Date | string;
  mealType: string;
  items: { foodItemId: string | null }[];
};

/**
 * Build the comparable series for one (kitchen, food, meal), oldest first.
 * onMenu is true when a persisted Menu covers the same kitchen + UTC day + meal
 * and lists the food item.
 */
export function buildSeries(
  records: RecordLike[],
  menus: MenuLike[],
  kitchenUnitId: string,
  foodItemId: string,
  mealType: string
): MemoryPoint[] {
  const menuDays = new Set<string>();
  for (const m of menus) {
    if (m.kitchenUnitId && m.kitchenUnitId !== kitchenUnitId) continue;
    if (m.mealType !== mealType) continue;
    if (!m.items.some((i) => i.foodItemId === foodItemId)) continue;
    menuDays.add(utcDayKey(new Date(m.date)));
  }
  return dedupeToLatest(records)
    .filter((r) => r.kitchenUnitId === kitchenUnitId && r.foodItemId === foodItemId && r.mealType === mealType)
    .map((r) => ({
      date: new Date(r.date),
      soldKg: soldOf(r),
      producedKg: r.preparedKg,
      wasteKg: r.wasteKg,
      remainingKg: r.remainingKg ?? 0,
      onMenu: menuDays.has(utcDayKey(new Date(r.date))),
      isCorrection: r.isCorrection,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Deterministic forecast for a target date:
 * baseline = age-decayed weighted mean of same-weekday sold (weight 1/(1+weeksAgo));
 * recent trend = linear-weighted moving average of last <=6 comparables;
 * menu multiplier = mean(sold|on menu) / mean(sold|off menu) from comparable menu
 * history only, capped to [0.7, 1.3], 1.0 when either side has <2 samples;
 * forecast = (0.6 * baseline + 0.4 * recent) * multiplier;
 * range = forecast +/- stddev of comparable sold values.
 */
export function forecastForDate(series: MemoryPoint[], targetDate: Date): ForecastResult {
  const empty: ForecastResult = {
    predictedKg: 0, lowerKg: 0, upperKg: 0, dataConfidence: 'low',
    baselineKg: 0, recentTrendKg: 0, menuMultiplier: 1, menuOnMeanKg: null, menuOffMeanKg: null,
    comparableCount: 0, fallbackUsed: false, fallbackReason: null, stdDevKg: 0,
    sampleValues: [], sampleDates: [], insufficient: true, message: 'Insufficient history: at least 2 comparable records are needed for an estimate.',
  };
  const dow = targetDate.getUTCDay();
  const soldOfPoint = (p: MemoryPoint) => p.soldKg;
  let pool = series.filter((p) => new Date(p.date).getUTCDay() === dow);
  let fallbackUsed = false;
  let fallbackReason: string | null = null;
  if (pool.length < 3) {
    fallbackUsed = true;
    fallbackReason =
      `Only ${pool.length} same-weekday record(s) found; using all ${series.length} comparable record(s) ` +
      `for this food and meal. Confidence is lower because weekday patterns cannot be isolated.`;
    pool = series;
  }
  if (pool.length < 2) {
    return { ...empty, comparableCount: pool.length, fallbackUsed, fallbackReason, sampleValues: pool.map(soldOfPoint), sampleDates: pool.map((p) => utcDayKey(p.date)) };
  }
  const msPerWeek = 7 * 86400000;
  const nowMs = targetDate.getTime();
  let wSum = 0;
  let bSum = 0;
  for (const p of pool) {
    const weeksAgo = Math.max(0, (nowMs - new Date(p.date).getTime()) / msPerWeek);
    const w = 1 / (1 + weeksAgo);
    wSum += w;
    bSum += w * p.soldKg;
  }
  const baseline = bSum / wSum;
  const recent = pool.slice(-6);
  let rwSum = 0;
  let rSum = 0;
  recent.forEach((p, i) => {
    const w = i + 1;
    rwSum += w;
    rSum += w * p.soldKg;
  });
  const recentWma = rSum / rwSum;
  const on = pool.filter((p) => p.onMenu).map(soldOfPoint);
  const off = pool.filter((p) => !p.onMenu).map(soldOfPoint);
  const onMean = on.length > 0 ? mean(on) : null;
  const offMean = off.length > 0 ? mean(off) : null;
  let menuMultiplier = 1;
  if (on.length >= 2 && off.length >= 2 && (offMean ?? 0) > 0) {
    menuMultiplier = Math.min(1.3, Math.max(0.7, (onMean as number) / (offMean as number)));
  }
  const predicted = r3((0.6 * baseline + 0.4 * recentWma) * menuMultiplier);
  const m = mean(pool.map(soldOfPoint));
  const variance = mean(pool.map((p) => (p.soldKg - m) ** 2));
  const std = Math.sqrt(variance);
  const lower = r3(Math.max(0, predicted - std));
  const upper = r3(predicted + std);
  const cv = m > 0 ? std / m : 1;
  const dataConfidence = pool.length >= 8 && cv <= 0.25 ? 'high' : pool.length >= 4 ? 'medium' : 'low';
  return {
    predictedKg: predicted, lowerKg: lower, upperKg: upper, dataConfidence,
    baselineKg: r3(baseline), recentTrendKg: r3(recentWma), menuMultiplier: r3(menuMultiplier),
    menuOnMeanKg: onMean === null ? null : r3(onMean), menuOffMeanKg: offMean === null ? null : r3(offMean),
    comparableCount: pool.length, fallbackUsed, fallbackReason, stdDevKg: r3(std),
    sampleValues: pool.map(soldOfPoint), sampleDates: pool.map((p) => utcDayKey(p.date)),
    insufficient: false, message: null,
  };
}

/** Aggregate patterns over deduped records. Thresholds are part of the contract — shown in UI. */
export function summarize(records: RecordLike[]): PatternSummary {
  const rows = dedupeToLatest(records);
  const n = rows.length;
  const sum = (f: (r: RecordLike) => number) => rows.reduce((x, r) => x + f(r), 0);
  const totals = {
    records: n,
    producedKg: r3(sum((r) => r.preparedKg)),
    soldKg: r3(sum((r) => soldOf(r))),
    wasteKg: r3(sum((r) => r.wasteKg)),
    remainingKg: r3(sum((r) => r.remainingKg ?? 0)),
  };
  const means = {
    producedKg: r3(n === 0 ? 0 : totals.producedKg / n),
    soldKg: r3(n === 0 ? 0 : totals.soldKg / n),
    wasteKg: r3(n === 0 ? 0 : totals.wasteKg / n),
    remainingKg: r3(n === 0 ? 0 : totals.remainingKg / n),
  };
  const perWeekday: WeekdayStat[] = [];
  for (let w = 0; w < 7; w++) {
    const g = rows.filter((r) => new Date(r.date).getUTCDay() === w);
    perWeekday.push({
      weekday: w,
      count: g.length,
      meanSold: r3(mean(g.map(soldOf))),
      meanProduced: r3(mean(g.map((r) => r.preparedKg))),
      meanWaste: r3(mean(g.map((r) => r.wasteKg))),
      meanRemaining: r3(mean(g.map((r) => r.remainingKg ?? 0))),
    });
  }
  const group = (keyOf: (r: RecordLike) => string, labelOf: (r: RecordLike) => string): GroupStat[] => {
    const map = new Map<string, { label: string; vals: number[] }>();
    for (const r of rows) {
      const k = keyOf(r);
      const e = map.get(k) ?? { label: labelOf(r), vals: [] };
      e.vals.push(soldOf(r));
      map.set(k, e);
    }
    return [...map.entries()].map(([key, e]) => ({
      key, label: e.label, count: e.vals.length, meanSold: r3(mean(e.vals)),
    }));
  };
  const perMeal = group(
    (r) => r.mealType,
    (r) => r.mealType
  );
  const perFood = group(
    (r) => r.foodItemId ?? 'unknown',
    (r) => r.foodItemId ?? 'Unknown item'
  );
  const overproductionDays = rows.filter((r) => (r.remainingKg ?? 0) > 0.15 * r.preparedKg).length;
  const underproductionDays = rows.filter(
    (r) => !!r.adjustmentReason || (r.targetKg !== null && r.preparedKg < 0.9 * (r.targetKg as number))
  ).length;
  const days = new Set(rows.map((r) => utcDayKey(new Date(r.date)))).size;
  const correctionCount = rows.filter((r) => r.isCorrection).length;
  const quality = {
    sampleSize: n,
    spanDays: days,
    correctionCount,
    status: (n >= 12 ? 'OK' : n >= 4 ? 'SPARSE' : 'INSUFFICIENT') as 'OK' | 'SPARSE' | 'INSUFFICIENT',
  };
  return { totals, means, perWeekday, perMeal, perFood, overproductionDays, underproductionDays, quality };
}
