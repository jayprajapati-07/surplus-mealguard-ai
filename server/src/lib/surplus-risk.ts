// Surplus-Before-Surplus engine — deterministic pace arithmetic over live Food Flow entries.
// No external calls, no randomness, no model training: every output is a reproducible
// function of persisted entries + configured thresholds. All quantities in kilograms.

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER';

// Documented default service windows (local server time). Shown in every risk explanation.
// Overridable per organization via PUT /risk-thresholds.
export const MEAL_WINDOWS: Record<MealType, { start: string; end: string }> = {
  BREAKFAST: { start: '07:00', end: '10:30' },
  LUNCH: { start: '11:30', end: '15:00' },
  DINNER: { start: '18:00', end: '21:30' },
};

export interface RiskThresholds {
  medKg: number;
  highKg: number;
  minSales: number;
  minSpanMin: number;
  windows: Record<MealType, { start: string; end: string }>;
}

export function defaultThresholds(): RiskThresholds {
  return { medKg: 2, highKg: 5, minSales: 2, minSpanMin: 30, windows: MEAL_WINDOWS };
}

export interface PaceInputs {
  saleQtys: number[];
  saleTimes: Date[];
  producedToDate: number;
  wasteToDate: number;
  now: Date;
  mealType: string;
}

export interface RiskResult {
  estimable: boolean;
  reason: string | null;
  paceKgPerHour: number | null;
  elapsedHours: number | null;
  remainingHours: number | null;
  windowEnd: string | null;
  projectedEodSoldKg: number | null;
  predictedUnsoldKg: number | null;
  risk: 'low' | 'medium' | 'high' | null;
  medKg: number;
  highKg: number;
  explanation: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function windowEndFor(mealType: string, now: Date, windows: RiskThresholds['windows']): { end: Date; label: string } {
  const w = (windows as Record<string, { start: string; end: string }>)[mealType] ?? windows.LUNCH;
  const [h, m] = w.end.split(':').map(Number);
  const end = new Date(now);
  end.setHours(h, m, 0, 0);
  return { end, label: w.end };
}

/**
 * Pace projection: pace = sold ÷ elapsed hours between first and last sale;
 * projected end-of-day sales = sold + pace × remaining window hours;
 * predicted unsold = max(0, produced − projected − waste).
 */
export function assessSurplusRisk(t: RiskThresholds, p: PaceInputs): RiskResult {
  const base = { medKg: t.medKg, highKg: t.highKg, paceKgPerHour: null as number | null,
    elapsedHours: null as number | null, remainingHours: null as number | null,
    windowEnd: null as string | null, projectedEodSoldKg: null as number | null,
    predictedUnsoldKg: null as number | null, risk: null as 'low' | 'medium' | 'high' | null };
  const uniqTimes = [...new Set(p.saleTimes.map((d) => d.getTime()))];
  if (p.saleQtys.length < t.minSales || uniqTimes.length < t.minSales) {
    const n = Math.min(p.saleQtys.length, uniqTimes.length);
    return { ...base, estimable: false,
      reason: `Only ${n} sale entr${n === 1 ? 'y' : 'ies'} with distinct timestamps (need ${t.minSales}). Record more sales to unlock the estimate.`,
      explanation: `Cannot reliably estimate yet: only ${n} distinct-timestamp sale(s), need ${t.minSales}.` };
  }
  const spanMin = (Math.max(...uniqTimes) - Math.min(...uniqTimes)) / 60000;
  if (spanMin < t.minSpanMin) {
    return { ...base, estimable: false,
      reason: `Sales span only ${r2(spanMin)} minutes (need ${t.minSpanMin}). Pace over a shorter span is not reliable — record sales further apart.`,
      explanation: `Cannot reliably estimate yet: sales span ${r2(spanMin)} min, need ${t.minSpanMin} min.` };
  }
  const { end, label } = windowEndFor(p.mealType, p.now, t.windows);
  if (p.now.getTime() >= end.getTime()) {
    return { ...base, estimable: false, windowEnd: label,
      reason: `Service window (ends ${label}) has ended; use end-of-day totals from Food Data.`,
      explanation: `Service window ended at ${label}; pace projection no longer applies.` };
  }
  const sold = r2(p.saleQtys.reduce((a, b) => a + b, 0));
  const elapsedH = Math.max(spanMin / 60, 1 / 60);
  const pace = r2(sold / elapsedH);
  const remainingH = r2(Math.max(0, (end.getTime() - p.now.getTime()) / 3600000));
  const projected = r2(sold + pace * remainingH);
  const unsold = r2(Math.max(0, r2(p.producedToDate) - projected - r2(p.wasteToDate)));
  const risk = unsold >= t.highKg ? 'high' : unsold >= t.medKg ? 'medium' : 'low';
  return { ...base, estimable: true, reason: null, paceKgPerHour: pace,
    elapsedHours: r2(elapsedH), remainingHours: remainingH, windowEnd: label,
    projectedEodSoldKg: projected, predictedUnsoldKg: unsold, risk,
    explanation: `Pace ${pace.toFixed(2)} kg/h from ${sold.toFixed(2)} kg over ${r2(elapsedH).toFixed(2)} h; ` +
      `window ends ${label} leaving ${remainingH.toFixed(2)} h; projected end-of-day sales ${projected.toFixed(2)} kg; ` +
      `predicted unsold = ${r2(p.producedToDate).toFixed(2)} - ${projected.toFixed(2)} - ${r2(p.wasteToDate).toFixed(2)} = ${unsold.toFixed(2)} kg; ` +
      `bands low<${t.medKg}, medium≥${t.medKg}, high≥${t.highKg} kg.` };
}

// In-app notification types for the notification center. Auth/token types
// (EMAIL_VERIFICATION, PASSWORD_RESET) must never appear in the general notification center.
export const INAPP_TYPES = [
  'SURPLUS_RISK_HIGH',
  'SURPLUS_RISK_MEDIUM',
  'PRODUCTION_ABOVE_TARGET',
  'PRODUCTION_BELOW_TARGET',
  'TARGET_GENERATED',
  'HIGH_WASTE',
  'NGO_OPPORTUNITY',
  'NGO_CALLBACK',
];
