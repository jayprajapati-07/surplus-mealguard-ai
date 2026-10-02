// ml-v1 forecasting engine — deterministic, dependency-free, fully inspectable.
// Trains ONLY on persisted DailyFoodRecord actuals (soldKg). Predictions of this
// engine are NEVER fed back as training data (see routes/targets.ts:generate).
// Validation is rolling-origin (train on past, test on future) — no shuffling,
// no future leakage. Metrics are genuine; small samples report insufficiency.

export const ML_VERSION = 'ml-v1';

export interface MlPoint {
  date: Date | string;
  soldKg: number;
}

export interface FeatureRow {
  target: number;
  dow: number;
  prevDay: number | null;
  prevWeekSameDay: number | null;
  rollMean3: number;
  rollMean6: number;
  histMean: number;
  trendSlope: number;
  count: number;
}

export type ModelName = 'seasonal-naive' | 'weighted-baseline' | 'trend-blend' | 'global-mean';

const CANDIDATES: ModelName[] = ['seasonal-naive', 'weighted-baseline', 'trend-blend', 'global-mean'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mean = (a: number[]) => (a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length);
const dowOf = (d: Date | string) => new Date(d).getUTCDay();

function slopeLast(history: number[]): number {
  const k = history.slice(-6);
  if (k.length < 2) return 0;
  const n = k.length;
  const mx = (n - 1) / 2;
  const my = mean(k);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (k[i] - my);
    den += (i - mx) * (i - mx);
  }
  return den === 0 ? 0 : num / den;
}

/** Features for row i use ONLY history before i. Row 0 has nulls and zero means. */
export function buildFeatureRows(series: MlPoint[]): FeatureRow[] {
  return series.map((p, i) => {
    const hist = series.slice(0, i).map((q) => q.soldKg);
    const histDows = series.slice(0, i).map((q) => dowOf(q.date));
    const dow = dowOf(p.date);
    let prevWeekSameDay: number | null = null;
    for (let j = hist.length - 1; j >= 0; j--) {
      if (histDows[j] === dow) {
        prevWeekSameDay = hist[j];
        break;
      }
    }
    return {
      target: p.soldKg,
      dow,
      prevDay: hist.length > 0 ? hist[hist.length - 1] : null,
      prevWeekSameDay,
      rollMean3: r3(mean(hist.slice(-3))),
      rollMean6: r3(mean(hist.slice(-6))),
      histMean: r3(mean(hist)),
      trendSlope: r3(slopeLast(hist)),
      count: hist.length,
    };
  });
}

export function mae(actuals: number[], preds: number[]): number {
  if (actuals.length === 0) return 0;
  return r3(mean(actuals.map((a, i) => Math.abs(a - preds[i]))));
}

export function rmse(actuals: number[], preds: number[]): number {
  if (actuals.length === 0) return 0;
  return r3(Math.sqrt(mean(actuals.map((a, i) => (a - preds[i]) ** 2))));
}

/** MAPE (%) skipping zero actuals; null when no usable actual. */
export function mape(actuals: number[], preds: number[]): number | null {
  const pairs = actuals.map((a, i) => ({ a, p: preds[i] })).filter((x) => x.a !== 0);
  if (pairs.length === 0) return null;
  return r3(mean(pairs.map((x) => (Math.abs(x.a - x.p) / Math.abs(x.a)) * 100)));
}

/** R²; null when actuals have no variance or fewer than 2 points. */
export function r2(actuals: number[], preds: number[]): number | null {
  if (actuals.length < 2) return null;
  const m = mean(actuals);
  const ssTot = actuals.reduce((x, a) => x + (a - m) ** 2, 0);
  if (ssTot === 0) return null;
  const ssRes = actuals.reduce((x, a, i) => x + (a - preds[i]) ** 2, 0);
  return r3(1 - ssRes / ssTot);
}

/** One candidate's forecast from history only. Never negative, never NaN. */
export function predictCandidate(history: number[], historyDows: number[], targetDow: number, model: ModelName): number {
  if (history.length === 0) return 0;
  const last = history[history.length - 1];
  const m = mean(history);
  switch (model) {
    case 'seasonal-naive': {
      for (let j = history.length - 1; j >= 0; j--) {
        if (historyDows[j] === targetDow) return r3(Math.max(0, history[j]));
      }
      return r3(Math.max(0, last));
    }
    case 'weighted-baseline': {
      let wSum = 0;
      let s = 0;
      history.forEach((v, i) => {
        const w = i + 1;
        wSum += w;
        s += w * v;
      });
      return r3(Math.max(0, s / wSum));
    }
    case 'trend-blend': {
      const s = slopeLast(history);
      return r3(Math.max(0, 0.5 * (last + s) + 0.5 * m));
    }
    case 'global-mean':
      return r3(Math.max(0, m));
  }
}

export interface ValidationResult {
  modelName: ModelName;
  mae: number;
  rmse: number;
  mape: number | null;
  r2: number | null;
  folds: number;
  sampleSize: number;
}

export type EvaluateOutput = { best: ValidationResult; all: ValidationResult[] } | { insufficient: true };

/**
 * Rolling-origin evaluation: last ≤3 points are each predicted from strictly
 * older history (trainEnd = testIndex). No shuffling, no future leakage.
 */
export function rollingOriginEvaluate(sold: number[], dows: number[], minTrain = 4): EvaluateOutput {
  const n = sold.length;
  if (n < 2) return { insufficient: true };
  const testIdx: number[] = [];
  for (let t = Math.max(minTrain, n - 3); t < n; t++) testIdx.push(t);
  if (testIdx.length === 0) return { insufficient: true };
  const all: ValidationResult[] = CANDIDATES.map((model) => {
    const actuals: number[] = [];
    const preds: number[] = [];
    for (const t of testIdx) {
      actuals.push(sold[t]);
      preds.push(predictCandidate(sold.slice(0, t), dows.slice(0, t), dows[t], model));
    }
    return {
      modelName: model,
      mae: mae(actuals, preds),
      rmse: rmse(actuals, preds),
      mape: mape(actuals, preds),
      r2: r2(actuals, preds),
      folds: testIdx.length,
      sampleSize: n,
    };
  });
  let best = all[0];
  for (const c of all) {
    if (c.rmse < best.rmse - 1e-9) best = c;
  }
  return { best, all };
}

/** Honest history summary for confidence rules and explanations. */
export function describeHistory(sold: number[]): { n: number; mean: number; std: number; cv: number } {
  const n = sold.length;
  if (n === 0) return { n: 0, mean: 0, std: 0, cv: 1 };
  const m = mean(sold);
  const std = Math.sqrt(mean(sold.map((v) => (v - m) ** 2)));
  return { n, mean: r3(m), std: r3(std), cv: m > 0 ? r3(std / m) : 1 };
}

/** Next-point forecast under a chosen model + history spread for intervals. */
export function predictNext(
  sold: number[],
  dows: number[],
  targetDow: number,
  model: ModelName
): { predicted: number; std: number; sampleSize: number } {
  const predicted = predictCandidate(sold, dows, targetDow, model);
  const m = mean(sold);
  const std = sold.length === 0 ? 0 : Math.sqrt(mean(sold.map((v) => (v - m) ** 2)));
  return { predicted, std: r3(std), sampleSize: sold.length };
}

export default {
  ML_VERSION, buildFeatureRows, mae, rmse, mape, r2,
  predictCandidate, rollingOriginEvaluate, predictNext, describeHistory,
};
