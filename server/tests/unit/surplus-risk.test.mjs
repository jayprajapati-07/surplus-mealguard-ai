// Unit: surplus-risk pace projection.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sr from '../../src/lib/surplus-risk.ts';
const { assessSurplusRisk, defaultThresholds } = sr;

const T = defaultThresholds(); // med 2, high 5, minSales 2, minSpanMin 30, LUNCH window ends 15:00

describe('assessSurplusRisk', () => {
  it('projects pace by hand: 6kg over 2h, 3h left, 40 produced -> unsold 25, high risk', () => {
    const r = assessSurplusRisk(T, {
      saleQtys: [3, 2, 1],
      saleTimes: [new Date('2026-09-29T10:00:00'), new Date('2026-09-29T12:00:00')],
      producedToDate: 40, wasteToDate: 0,
      now: new Date('2026-09-29T12:00:00'), mealType: 'LUNCH',
    });
    assert.equal(r.estimable, true);
    assert.equal(r.paceKgPerHour, 3);
    assert.equal(r.elapsedHours, 2);
    assert.equal(r.remainingHours, 3);
    assert.equal(r.windowEnd, '15:00');
    assert.equal(r.projectedEodSoldKg, 15);
    assert.equal(r.predictedUnsoldKg, 25);
    assert.equal(r.risk, 'high');
    assert.match(r.explanation, /kg\/h/);
  });

  it('refuses with too few distinct-timestamp sales', () => {
    const r = assessSurplusRisk(T, {
      saleQtys: [5], saleTimes: [new Date('2026-09-29T12:00:00')],
      producedToDate: 40, wasteToDate: 0, now: new Date('2026-09-29T12:00:00'), mealType: 'LUNCH',
    });
    assert.equal(r.estimable, false);
    assert.match(r.reason ?? '', /need 2/);
  });

  it('refuses when the span is shorter than the minimum', () => {
    const r = assessSurplusRisk(T, {
      saleQtys: [5, 5],
      saleTimes: [new Date('2026-09-29T12:00:00'), new Date('2026-09-29T12:10:00')],
      producedToDate: 40, wasteToDate: 0, now: new Date('2026-09-29T12:10:00'), mealType: 'LUNCH',
    });
    assert.equal(r.estimable, false);
    assert.match(r.reason ?? '', /30/);
  });

  it('refuses after the service window ends', () => {
    const r = assessSurplusRisk(T, {
      saleQtys: [5, 5],
      saleTimes: [new Date('2026-09-29T10:00:00'), new Date('2026-09-29T12:00:00')],
      producedToDate: 40, wasteToDate: 0, now: new Date('2026-09-29T16:00:00'), mealType: 'LUNCH',
    });
    assert.equal(r.estimable, false);
    assert.equal(r.windowEnd, '15:00');
  });

  it('grades medium and low bands', () => {
    const med = assessSurplusRisk(T, {
      saleQtys: [10, 10],
      saleTimes: [new Date('2026-09-29T10:00:00'), new Date('2026-09-29T12:00:00')],
      producedToDate: 35, wasteToDate: 0, now: new Date('2026-09-29T12:00:00'), mealType: 'LUNCH',
    });
    // pace 10/h, 3h left -> projected 50, unsold max(0, 35-50-0)=0 -> low
    assert.equal(med.risk, 'low');
    const med2 = assessSurplusRisk(T, {
      saleQtys: [2, 2],
      saleTimes: [new Date('2026-09-29T10:00:00'), new Date('2026-09-29T12:00:00')],
      producedToDate: 12, wasteToDate: 0, now: new Date('2026-09-29T12:00:00'), mealType: 'LUNCH',
    });
    // pace 2/h, projected 4+6=10, unsold 12-10=2 -> medium (>=2)
    assert.equal(med2.risk, 'medium');
    assert.equal(med2.predictedUnsoldKg, 2);
  });
});
