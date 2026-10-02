// Phase 3: automatic end-of-day report math — deterministic, fully inspectable.
// Surplus is ALWAYS computed here (produced - sold). Gemini never calculates.
// Negative surplus is never reported as a number; it becomes a flagged
// data-inconsistency condition. Scheduling helpers use server-local time.

export const EOD_AUTO_HOUR = 22;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface SurplusResult {
  producedKg: number;
  soldKg: number;
  /** Reportable surplus (never negative). */
  surplusKg: number;
  /** Unclamped produced - sold, kept for audit. */
  rawKg: number;
  inconsistency: boolean;
  message: string | null;
}

export function computeSurplus(producedKg: number, soldKg: number): SurplusResult {
  const p = r3(producedKg);
  const s = r3(soldKg);
  const raw = r3(p - s);
  if (raw < 0) {
    return {
      producedKg: p, soldKg: s, surplusKg: 0, rawKg: raw, inconsistency: true,
      message: `Data inconsistency detected: sold quantity (${s} kg) exceeds produced quantity (${p} kg). Flagged for review — no negative surplus reported or forwarded.`,
    };
  }
  return { producedKg: p, soldKg: s, surplusKg: raw, rawKg: raw, inconsistency: false, message: null };
}

export interface PredictionError {
  absErrKg: number | null;
  pctErr: number | null;
  /** Did the kitchen over- or under-produce relative to prediction? */
  bias: 'over' | 'under' | 'exact' | null;
}

export function predictionError(predictedKg: number | null, actualSoldKg: number): PredictionError {
  const none: PredictionError = { absErrKg: null, pctErr: null, bias: null };
  if (predictedKg === null || !Number.isFinite(predictedKg)) return none;
  if (!(actualSoldKg > 0)) return none;
  const abs = r3(Math.abs(actualSoldKg - predictedKg));
  const pct = r3((abs / actualSoldKg) * 100);
  const bias = actualSoldKg > predictedKg ? 'under' : actualSoldKg < predictedKg ? 'over' : 'exact';
  return { absErrKg: abs, pctErr: pct, bias };
}

/** True at/after 22:00 server-local time — the auto-report window. */
export function shouldAutoRun(now: Date = new Date()): boolean {
  return now.getHours() >= EOD_AUTO_HOUR;
}

/** Next 22:00 server-local strictly after `now` (schedule the timer for this). */
export function nextRunAfter(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setHours(EOD_AUTO_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export default { EOD_AUTO_HOUR, computeSurplus, predictionError, shouldAutoRun, nextRunAfter };
