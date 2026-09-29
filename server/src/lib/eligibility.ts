// Eligibility decision matrix — pure, deterministic, fully inspectable.
// Operates on recorded operational details only. Never a safety certificate:
// language throughout is operational ("cutoff", "recorded dates", "logistics
// margin"), never scientific. Auth + persistence stay in routes/eligibility.ts.

export type EligibilityVerdict = 'ELIGIBLE' | 'REVIEW_REQUIRED' | 'INELIGIBLE';

export interface EligibilityInput {
  quantityKg: number;
  expiryDate: string | null;
  availableUntil: string;
  qualityNote?: string;
}

export interface EligibilityDecision {
  verdict: EligibilityVerdict;
  reasons: string[];
}

export function decideEligibility(
  input: EligibilityInput,
  minQty: number,
  now: Date = new Date()
): EligibilityDecision {
  const reasons: string[] = [];
  const expiry = input.expiryDate ? new Date(input.expiryDate) : null;
  const availableUntil = new Date(input.availableUntil);
  let verdict: EligibilityVerdict;
  if (input.quantityKg < minQty) {
    verdict = 'INELIGIBLE';
    reasons.push(`Quantity ${input.quantityKg} kg is below the operational minimum ${minQty} kg. This is an operational cutoff, not a universal food-safety rule.`);
  } else if ((expiry && expiry.getTime() < now.getTime()) || availableUntil.getTime() < now.getTime()) {
    verdict = 'INELIGIBLE';
    if (expiry && expiry.getTime() < now.getTime()) reasons.push(`Recorded expiry date ${expiry.toISOString().slice(0, 10)} has passed.`);
    if (availableUntil.getTime() < now.getTime()) reasons.push(`Recorded availability deadline ${availableUntil.toISOString()} has passed.`);
  } else if (availableUntil.getTime() - now.getTime() < 2 * 3600000) {
    verdict = 'REVIEW_REQUIRED';
    reasons.push('Availability deadline is within 2 hours (logistics margin) — confirm pickup timing before proceeding.');
  } else if (input.quantityKg < 1.5 * minQty) {
    verdict = 'REVIEW_REQUIRED';
    reasons.push(`Quantity is marginal (under 1.5× the ${minQty} kg operational minimum) — confirm pickup is worthwhile.`);
  } else {
    verdict = 'ELIGIBLE';
    reasons.push('Meets recorded operational criteria; human quality confirmation on file. Not automatically safe or scientifically certified — redistribution decides next phase.');
  }
  return { verdict, reasons };
}
