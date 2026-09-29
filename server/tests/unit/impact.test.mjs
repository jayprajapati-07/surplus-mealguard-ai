// Unit: impact factor resolution + impact formulas.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import im from '../../src/lib/impact.ts';
const { resolveFactors, computeImpact } = im;

function row(over) {
  return {
    key: 'COST_PER_KG_FOOD', value: 100, unit: 'INR/kg', name: 'Cost', source: 'test',
    isActive: true, effectiveDate: new Date('2024-01-01'),
    organizationId: null, category: null, foodItemId: null, ...over,
  };
}

describe('resolveFactors', () => {
  const rows = [
    row({ key: 'COST_PER_KG_FOOD', value: 100 }),
    row({ key: 'COST_PER_KG_FOOD', value: 120, organizationId: 'org1' }),
    row({ key: 'COST_PER_KG_FOOD', value: 130, organizationId: 'org1', category: 'Grains' }),
    row({ key: 'COST_PER_KG_FOOD', value: 140, organizationId: 'org1', category: 'Grains', foodItemId: 'f1' }),
    row({ key: 'COST_PER_KG_FOOD', value: 999, organizationId: 'org1', isActive: false }),
    row({ key: 'COST_PER_KG_FOOD', value: 999, organizationId: 'org1', effectiveDate: new Date('2999-01-01') }),
    row({ key: 'CO2_PER_KG_FOOD', value: 2.5, unit: 'kgCO2e/kg' }),
  ];

  it('prefers food item over category over organization over global', () => {
    const f = resolveFactors(rows, { foodItemId: 'f1', category: 'Grains', organizationId: 'org1' });
    assert.equal(f.costPerKg, 140);
  });
  it('falls back down the chain when narrower rows are absent', () => {
    assert.equal(resolveFactors(rows, { foodItemId: 'fx', category: 'Grains', organizationId: 'org1' }).costPerKg, 130);
    assert.equal(resolveFactors(rows, { category: 'Other', organizationId: 'org1' }).costPerKg, 120);
    assert.equal(resolveFactors(rows, { organizationId: 'org9' }).costPerKg, 100);
  });
  it('ignores inactive and future-dated rows', () => {
    const f = resolveFactors(rows, { organizationId: 'org1' });
    assert.equal(f.costPerKg, 120);
    assert.equal(f.co2PerKg, 2.5);
  });
  it('yields 0 with a configure-one source when the key is missing', () => {
    const f = resolveFactors([], { organizationId: 'org1' });
    assert.equal(f.costPerKg, 0);
    assert.match(f.costSource, /configure one/);
  });
});

describe('computeImpact', () => {
  it('sums measured redistribution and estimated prevention with labeled math', () => {
    const r = computeImpact({
      completedQtyKg: 10, baselineWasteKg: 30, baselineDays: 3, baselineLabel: '2026-09-01 to 2026-09-03',
      actualWasteKg: 20, reportDays: 3,
      factors: { costPerKg: 100, costSource: 't', co2PerKg: 2.5, co2Source: 't' },
    });
    // expected = 10/day * 3 = 30; prevented = 30-20 = 10; saved = 10+10 = 20
    assert.equal(r.wasteReducedKg, 10);
    assert.equal(r.foodSavedKg, 20);
    assert.equal(r.redistributedKg, 10);
    assert.equal(r.costSavedEstimate, 2000);
    assert.equal(r.co2AvoidedKgEstimate, 50);
    assert.ok(r.howCalculated.length >= 3);
    assert.ok(r.howCalculated.some((h) => /estimate/i.test(h)));
  });

  it('treats missing baseline as zero prevention, honestly labeled', () => {
    const r = computeImpact({
      completedQtyKg: 5, baselineWasteKg: 0, baselineDays: 0, baselineLabel: 'none',
      actualWasteKg: 99, reportDays: 3,
      factors: { costPerKg: 100, costSource: 't', co2PerKg: 2, co2Source: 't' },
    });
    assert.equal(r.wasteReducedKg, 0);
    assert.equal(r.foodSavedKg, 5);
    assert.ok(r.howCalculated.some((h) => /No baseline/i.test(h)));
  });
});
