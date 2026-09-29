// Production-target math — pure, deterministic, fully inspectable.
// recommended target = predicted demand + configured buffer.
// Feedback compares persisted targets against persisted actuals; actuals
// automatically feed the next forecast because the memory engine reads
// the same DailyFoodRecord rows (self-correction mechanism).

export const TARGET_VERSION = 'memory-v1';
export const DEFAULT_BUFFER = { mode: 'PERCENT', value: 10 } as const;

export interface BufferSetting {
  mode: 'FIXED_KG' | 'PERCENT';
  value: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Buffer in kg for a predicted demand. Never negative. */
export function bufferKgFor(predictedKg: number, b: BufferSetting): number {
  if (b.mode === 'FIXED_KG') return r3(Math.max(0, b.value));
  return r3(Math.max(0, (predictedKg * b.value) / 100));
}

/** Returns an error message, or null when the setting is valid. */
export function validateBuffer(mode: string, value: unknown): string | null {
  if (mode !== 'FIXED_KG' && mode !== 'PERCENT') {
    return 'Buffer mode must be FIXED_KG or PERCENT.';
  }
  const v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v)) return 'Buffer value must be a number.';
  if (mode === 'FIXED_KG' && (v < 0 || v > 50)) {
    return 'Fixed buffer must be between 0 and 50 kg.';
  }
  if (mode === 'PERCENT' && (v < 0 || v > 100)) {
    return 'Percentage buffer must be between 0 and 100.';
  }
  return null;
}

export interface Feedback {
  hasActuals: boolean;
  producedKg: number | null;
  soldKg: number | null;
  targetErrorKg: number | null;
  demandErrorKg: number | null;
  overKg: number | null;
  underKg: number | null;
}

/**
 * Compare a target against recorded actuals.
 * effectiveTargetKg is adjustedKg when a manager adjustment exists, else recommendedKg.
 */
export function computeFeedback(
  effectiveTargetKg: number,
  predictedKg: number,
  actual: { producedKg: number; soldKg: number } | null
): Feedback {
  const none: Feedback = {
    hasActuals: false, producedKg: null, soldKg: null,
    targetErrorKg: null, demandErrorKg: null, overKg: null, underKg: null,
  };
  if (!actual) return none;
  return {
    hasActuals: true,
    producedKg: actual.producedKg,
    soldKg: actual.soldKg,
    targetErrorKg: r3(actual.producedKg - effectiveTargetKg),
    demandErrorKg: r3(actual.soldKg - predictedKg),
    overKg: r3(Math.max(0, actual.producedKg - actual.soldKg)),
    underKg: r3(Math.max(0, actual.soldKg - actual.producedKg)),
  };
}
