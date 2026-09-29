// Unit: waste-analysis contribution rules.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import wa from '../../src/lib/waste-analysis.ts';
const { analyzeWasteDay } = wa;

const base = {
  id: 'r1', foodItemId: 'f1', foodName: 'Rice', mealType: 'LUNCH',
  date: new Date('2026-09-29T00:00:00Z'),
  preparedKg: 30, soldKg: 20, wasteKg: 5, remainingKg: 5,
  targetKg: 28, adjustmentReason: null, correctionReason: null, notes: null,
};

describe('analyzeWasteDay', () => {
  it('names demand-overestimate with a normalized 100% share for a lone claim', () => {
    const { rows } = analyzeWasteDay({ dayRecords: [base], history: [], weekday: 2, inventoryFlags: [] });
    assert.equal(rows.length, 1);
    // overestimate: min(28,30)-20 = 8; overproduction: 30-max(28,20) = 2
    const over = rows[0].claims.find((c) => c.contributor === 'demand-overestimate');
    const prod = rows[0].claims.find((c) => c.contributor === 'overproduction');
    assert.equal(over?.attributableKg, 8);
    assert.equal(prod?.attributableKg, 2);
    const sum = rows[0].claims.reduce((a, c) => a + (c.sharePct ?? 0), 0);
    assert.ok(Math.abs(sum - 100) < 0.5, `shares sum to 100, got ${sum}`);
    assert.match(over?.evidence ?? '', /28/);
    assert.equal(rows[0].percentagesWithheld, false);
  });

  it('withholds percentages and keeps evidence when nothing is quantifiable', () => {
    const rec = { ...base, preparedKg: 10, soldKg: 10, wasteKg: 3, remainingKg: 0, targetKg: null, notes: 'Scale drift verified' };
    const { rows } = analyzeWasteDay({ dayRecords: [rec], history: [], weekday: 2, inventoryFlags: [] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].claims.length, 0);
    assert.equal(rows[0].percentagesWithheld, true);
    assert.ok(rows[0].evidence.some((e) => e.contributor === 'manual-reason'));
    assert.match(rows[0].recommendedAction, /Scale drift verified/);
  });

  it('skips rows with zero excess and lists expiry evidence without percentages', () => {
    const { rows } = analyzeWasteDay({
      dayRecords: [{ ...base, wasteKg: 0, remainingKg: 0 }],
      history: [],
      weekday: 2,
      inventoryFlags: [{ foodItemId: 'f1', lot: 'L1', expiryDate: '2026-09-30', quantityKg: 12, flag: 'near-expiry' }],
    });
    assert.equal(rows.length, 0);
  });

  it('detects day-pattern from repeated weekday excess', () => {
    const tue = ['2026-09-01', '2026-09-08', '2026-09-15'].map((d) => ({
      foodItemId: 'f9', mealType: 'DINNER', date: new Date(`${d}T00:00:00Z`), excessKg: 15,
    }));
    const other = ['2026-09-02', '2026-09-03', '2026-09-04'].map((d) => ({
      foodItemId: 'f9', mealType: 'DINNER', date: new Date(`${d}T00:00:00Z`), excessKg: 2,
    }));
    const rec = { ...base, preparedKg: 40, soldKg: 20, wasteKg: 6, remainingKg: 6, targetKg: null };
    const { rows } = analyzeWasteDay({ dayRecords: [rec], history: [...tue, ...other], weekday: 2, inventoryFlags: [] });
    const dp = rows[0].claims.find((c) => c.contributor === 'day-pattern');
    assert.ok(dp, 'day-pattern claim present');
    assert.equal(dp?.attributableKg, 6.5); // min(excess 12, weekday mean 15 − overall mean 8.5)
    assert.match(dp?.evidence ?? '', /15/);
  });
});
