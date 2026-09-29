// Unit: production-target math (buffer + feedback).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import tg from '../../src/lib/targets.ts';
const { bufferKgFor, validateBuffer, computeFeedback } = tg;

describe('bufferKgFor', () => {
  it('percent mode takes a percentage of predicted demand', () => {
    assert.equal(bufferKgFor(100, { mode: 'PERCENT', value: 10 }), 10);
    assert.equal(bufferKgFor(55.5, { mode: 'PERCENT', value: 20 }), 11.1);
  });
  it('fixed mode returns the flat value', () => {
    assert.equal(bufferKgFor(100, { mode: 'FIXED_KG', value: 5 }), 5);
    assert.equal(bufferKgFor(0, { mode: 'FIXED_KG', value: 5 }), 5);
  });
  it('never returns negative', () => {
    assert.equal(bufferKgFor(100, { mode: 'PERCENT', value: -5 }), 0);
    assert.equal(bufferKgFor(100, { mode: 'FIXED_KG', value: -5 }), 0);
  });
});

describe('validateBuffer', () => {
  it('accepts valid settings', () => {
    assert.equal(validateBuffer('PERCENT', 10), null);
    assert.equal(validateBuffer('FIXED_KG', 0), null);
  });
  it('rejects bad mode, non-numbers, and out-of-range values', () => {
    assert.match(validateBuffer('BOGUS', 10) ?? '', /mode/i);
    assert.match(validateBuffer('PERCENT', 'x') ?? '', /number/i);
    assert.match(validateBuffer('PERCENT', 150) ?? '', /0 and 100/);
    assert.match(validateBuffer('FIXED_KG', 51) ?? '', /0 and 50/);
  });
});

describe('computeFeedback', () => {
  it('computes signed errors from actuals', () => {
    const f = computeFeedback(100, 90, { producedKg: 95, soldKg: 80 });
    assert.equal(f.hasActuals, true);
    assert.equal(f.targetErrorKg, -5);
    assert.equal(f.demandErrorKg, -10);
    assert.equal(f.overKg, 15);
    assert.equal(f.underKg, 0);
  });
  it('reports under-production when sold exceeds produced', () => {
    const f = computeFeedback(100, 90, { producedKg: 70, soldKg: 75 });
    assert.equal(f.overKg, 0);
    assert.equal(f.underKg, 5);
  });
  it('returns empty feedback without actuals', () => {
    const f = computeFeedback(100, 90, null);
    assert.equal(f.hasActuals, false);
    assert.equal(f.targetErrorKg, null);
  });
});
