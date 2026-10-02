// Unit: Phase 3 automatic EOD reports — deterministic surplus, errors, schedule.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import eod from '../../src/lib/eod-report.ts';

const { computeSurplus, predictionError, shouldAutoRun, nextRunAfter, EOD_AUTO_HOUR } = eod;

describe('computeSurplus', () => {
  it('computes surplus as produced minus sold', () => {
    const r = computeSurplus(100, 82);
    assert.equal(r.surplusKg, 18);
    assert.equal(r.inconsistency, false);
    assert.equal(r.message, null);
  });

  it('flags sold exceeding produced instead of reporting negative surplus', () => {
    const r = computeSurplus(50, 55);
    assert.equal(r.inconsistency, true);
    assert.equal(r.surplusKg, 0);
    assert.match(r.message ?? '', /inconsistency/i);
    assert.equal(r.rawKg, -5);
  });

  it('handles zeros honestly', () => {
    const r = computeSurplus(0, 0);
    assert.equal(r.surplusKg, 0);
    assert.equal(r.inconsistency, false);
  });
});

describe('predictionError', () => {
  it('reports absolute and percentage error with bias direction', () => {
    const e = predictionError(100, 82);
    assert.equal(e.absErrKg, 18);
    assert.ok(Math.abs((e.pctErr ?? 0) - (18 / 82) * 100) < 1e-3);
    assert.equal(e.bias, 'over');
  });

  it('returns nulls when no prediction or no actual exists', () => {
    assert.equal(predictionError(null, 82).absErrKg, null);
    assert.equal(predictionError(100, 0).pctErr, null);
  });
});

describe('auto-run schedule', () => {
  it('runs only at/after 10 PM server-local time', () => {
    assert.equal(EOD_AUTO_HOUR, 22);
    const day = new Date(2026, 8, 21, 21, 59, 0);
    assert.equal(shouldAutoRun(day), false);
    assert.equal(shouldAutoRun(new Date(2026, 8, 21, 22, 0, 0)), true);
    assert.equal(shouldAutoRun(new Date(2026, 8, 21, 23, 30, 0)), true);
  });

  it('computes the next 10 PM strictly after now', () => {
    const before = nextRunAfter(new Date(2026, 8, 21, 9, 0, 0));
    assert.equal(before.getHours(), 22);
    assert.equal(before.getDate(), 21);
    const after = nextRunAfter(new Date(2026, 8, 21, 22, 30, 0));
    assert.equal(after.getHours(), 22);
    assert.equal(after.getDate(), 22);
  });
});
