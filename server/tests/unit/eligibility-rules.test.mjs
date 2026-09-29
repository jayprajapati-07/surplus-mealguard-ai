// Unit: eligibility decision matrix (pure rules; route adds auth + persistence).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import el from '../../src/lib/eligibility.ts';
const { decideEligibility } = el;

const base = {
  quantityKg: 15,
  expiryDate: null,
  availableUntil: new Date(Date.now() + 5 * 3600000).toISOString(),
  qualityConfirmed: true,
};
const NOW = new Date();

describe('decideEligibility', () => {
  it('rejects below-minimum quantity as INELIGIBLE (operational cutoff, not safety)', () => {
    const r = decideEligibility({ ...base, quantityKg: 2 }, 10, NOW);
    assert.equal(r.verdict, 'INELIGIBLE');
    assert.ok(r.reasons.some((x) => /operational minimum 10 kg/i.test(x)));
    assert.ok(r.reasons.every((x) => !/automatically safe|scientifically certified/i.test(x)));
  });

  it('rejects past expiry as INELIGIBLE on recorded dates', () => {
    const r = decideEligibility({ ...base, expiryDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }, 10, NOW);
    assert.equal(r.verdict, 'INELIGIBLE');
    assert.ok(r.reasons.some((x) => /expiry.*passed/i.test(x)));
  });

  it('flags tight deadlines as REVIEW_REQUIRED', () => {
    const r = decideEligibility(
      { ...base, availableUntil: new Date(Date.now() + 30 * 60000).toISOString() }, 10, NOW);
    assert.equal(r.verdict, 'REVIEW_REQUIRED');
  });

  it('flags marginal quantity as REVIEW_REQUIRED', () => {
    const r = decideEligibility({ ...base, quantityKg: 12 }, 10, NOW);
    assert.equal(r.verdict, 'REVIEW_REQUIRED');
  });

  it('returns ELIGIBLE with human-confirmation language for a clean case', () => {
    const r = decideEligibility({ ...base, qualityNote: 'Smell, look, texture checked' }, 10, NOW);
    assert.equal(r.verdict, 'ELIGIBLE');
    assert.ok(r.reasons.some((x) => /human quality confirmation/i.test(x)));
    assert.ok(r.reasons.some((x) => /Not automatically safe/i.test(x)));
  });

  it('is deterministic across runs', () => {
    assert.deepEqual(decideEligibility(base, 10, NOW), decideEligibility(base, 10, NOW));
  });
});
