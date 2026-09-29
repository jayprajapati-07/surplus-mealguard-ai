// Unit: kitchen-memory deterministic forecasting.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import km from '../../src/lib/kitchen-memory.ts';
const { forecastForDate, utcDayKey } = km;

function mondaySeries(sold, startIso = '2026-09-07T00:00:00Z', meal = 'LUNCH') {
  // 2026-09-07 is a Monday; +7d steps stay Monday (UTC).
  const base = new Date(startIso).getTime();
  return sold.map((s, i) => ({
    date: new Date(base + i * 7 * 86400000),
    soldKg: s, producedKg: s + 2, wasteKg: 1, remainingKg: 1,
    onMenu: false, isCorrection: false,
  }));
}

describe('forecastForDate', () => {
  it('constant history predicts the constant (baseline == trend == prediction)', () => {
    const series = mondaySeries([10, 10, 10, 10]);
    const r = forecastForDate(series, new Date('2026-10-05T00:00:00Z')); // next Monday
    assert.equal(r.insufficient, false);
    assert.equal(r.fallbackUsed, false);
    assert.equal(r.predictedKg, 10);
    assert.equal(r.baselineKg, 10);
    assert.equal(r.recentTrendKg, 10);
    assert.equal(r.stdDevKg, 0);
    assert.equal(r.lowerKg, 10);
    assert.equal(r.upperKg, 10);
    assert.equal(r.comparableCount, 4);
  });

  it('is deterministic: same input twice gives byte-identical output', () => {
    const series = mondaySeries([8, 12, 9, 14, 11]);
    const a = forecastForDate(series, new Date('2026-10-05T00:00:00Z'));
    const b = forecastForDate(series, new Date('2026-10-05T00:00:00Z'));
    assert.deepEqual(a, b);
  });

  it('falls back with reason when fewer than 3 same-weekday records exist', () => {
    const series = [
      ...mondaySeries([10], '2026-09-07T00:00:00Z'),
      { date: new Date('2026-09-09T00:00:00Z'), soldKg: 20, producedKg: 22, wasteKg: 1, remainingKg: 1, onMenu: false, isCorrection: false },
    ];
    const r = forecastForDate(series, new Date('2026-10-05T00:00:00Z'));
    assert.equal(r.fallbackUsed, true);
    assert.match(r.fallbackReason ?? '', /Only 1 same-weekday/);
    assert.equal(r.comparableCount, 2);
  });

  it('reports insufficient below 2 comparable records', () => {
    const r = forecastForDate(mondaySeries([10], '2026-09-07T00:00:00Z'), new Date('2026-10-05T00:00:00Z'));
    assert.equal(r.insufficient, true);
    assert.match(r.message ?? '', /at least 2 comparable/);
  });

  it('caps the menu multiplier at 1.3 and reports on/off means', () => {
    const base = new Date('2026-09-07T00:00:00Z').getTime();
    const series = [10, 10, 20, 20].map((s, i) => ({
      date: new Date(base + i * 7 * 86400000), soldKg: s, producedKg: s + 2,
      wasteKg: 1, remainingKg: 1, onMenu: i >= 2, isCorrection: false,
    }));
    const r = forecastForDate(series, new Date('2026-10-05T00:00:00Z'));
    assert.equal(r.menuMultiplier, 1.3);
    assert.equal(r.menuOnMeanKg, 20);
    assert.equal(r.menuOffMeanKg, 10);
  });

  it('utcDayKey buckets by UTC calendar day', () => {
    assert.equal(utcDayKey(new Date('2026-09-29T23:30:00Z')), '2026-09-29');
  });
});
