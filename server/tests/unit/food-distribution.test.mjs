// Unit: Phase 4 auto-distribution decisions + surplus email content (pure logic).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fd from '../../src/lib/food-distribution.ts';

const { shouldAutoDistribute, isMailableNgo, buildSurplusEmail, selectTopNgos, distributionKeyFor } = fd;

describe('shouldAutoDistribute', () => {
  it('starts only when surplus is positive and data is consistent', () => {
    assert.equal(shouldAutoDistribute({ surplusKg: 18, inconsistency: false }).start, true);
  });

  it('refuses zero surplus', () => {
    const r = shouldAutoDistribute({ surplusKg: 0, inconsistency: false });
    assert.equal(r.start, false);
    assert.match(r.reason, /zero/i);
  });

  it('refuses inconsistent data even with apparent surplus', () => {
    const r = shouldAutoDistribute({ surplusKg: 0, inconsistency: true });
    assert.equal(r.start, false);
    assert.match(r.reason, /inconsistency/i);
  });
});

describe('isMailableNgo', () => {
  it('accepts active NGOs with a valid email', () => {
    assert.equal(isMailableNgo({ isActive: true, contactEmail: 'help@ngo.org' }), true);
  });

  it('rejects inactive, missing or malformed contacts', () => {
    assert.equal(isMailableNgo({ isActive: false, contactEmail: 'help@ngo.org' }), false);
    assert.equal(isMailableNgo({ isActive: true, contactEmail: null }), false);
    assert.equal(isMailableNgo({ isActive: true, contactEmail: 'not-an-email' }), false);
  });
});

describe('buildSurplusEmail', () => {
  const input = {
    hotelName: 'Sunrise Canteen', location: 'Ahmedabad, Gujarat, India',
    contactPhone: '+91 98765 43210', ngoName: 'City Food Helpers',
    surplusKg: 18, dateLabel: '2026-09-21',
  };

  it('uses the exact template with real values only', () => {
    const { subject, text } = buildSurplusEmail(input);
    assert.match(subject, /Surplus Food Available from Sunrise Canteen/);
    assert.match(subject, /2026-09-21/);
    for (const v of ['City Food Helpers', 'Sunrise Canteen', 'Ahmedabad, Gujarat, India', '+91 98765 43210', '18']) {
      assert.ok(text.includes(v), `email must contain ${v}`);
    }
  });

  it('contains no unfilled placeholders', () => {
    const { subject, text } = buildSurplusEmail(input);
    assert.ok(!/\[.+\]/.test(subject), 'subject has placeholders');
    assert.ok(!/\[Hotel|\[NGO|\[X kg|\[Date|\[Location/.test(text), 'body has placeholders');
  });
});

describe('distributionKeyFor', () => {
  it('is stable per hotel, kitchen and day', () => {
    const a = distributionKeyFor('org1', 'kit1', '2026-10-02');
    const b = distributionKeyFor('org1', 'kit1', '2026-10-02');
    assert.equal(a, b);
    assert.match(a, /org1/);
    assert.match(a, /2026-10-02/);
  });

  it('differs across days and kitchens', () => {
    assert.notEqual(distributionKeyFor('org1', 'kit1', '2026-10-02'), distributionKeyFor('org1', 'kit1', '2026-10-03'));
    assert.notEqual(distributionKeyFor('org1', 'kit1', '2026-10-02'), distributionKeyFor('org1', 'kit2', '2026-10-02'));
  });
});

describe('selectTopNgos', () => {
  it('keeps positive scores, sorts best-first, caps at the limit', () => {
    const scored = [
      { ngoId: 'a', score: 40 }, { ngoId: 'b', score: 0 },
      { ngoId: 'c', score: 95 }, { ngoId: 'd', score: -5 },
    ];
    const out = selectTopNgos(scored, 2);
    assert.deepEqual(out.map((x) => x.ngoId), ['c', 'a']);
  });
});
