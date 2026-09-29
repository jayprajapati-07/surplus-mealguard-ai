// Unit: deterministic NGO matching.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mt from '../../src/lib/matching.ts';
const { scoreNgoMatch } = mt;

const inst = { city: 'Pune', address: '12 Campus Road, Block B', operatingHours: '8:00am - 8:00pm' };
const need = { quantityKg: 15, foodCategory: 'Cooked Veg', availableUntil: new Date(Date.now() + 5 * 3600000).toISOString() };

describe('scoreNgoMatch', () => {
  it('scores a fully suitable NGO at 100 with reasons summing correctly', () => {
    const r = scoreNgoMatch({
      ngo: { isActive: true, city: 'Pune', address: '5 Service Lane', acceptedCategories: JSON.stringify(['Cooked Veg', 'Grains']),
        pickupCapable: true, operatingHours: '08:00-20:00', capacityKg: 100 },
      assessment: need, institution: inst,
    });
    assert.equal(r.eligible, true);
    assert.equal(r.score, 100);
    assert.equal(r.reasons.reduce((a, x) => a + x.points, 0), 100);
    assert.ok(r.reasons.every((x) => x.detail.length > 0));
  });

  it('excludes inactive NGOs entirely', () => {
    const r = scoreNgoMatch({
      ngo: { isActive: false, city: 'Pune', address: 'x', acceptedCategories: '[]', pickupCapable: true, operatingHours: '08:00-20:00', capacityKg: 100 },
      assessment: need, institution: inst,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.score, 0);
  });

  it('gives a low score with named reasons for incompatible NGOs', () => {
    const r = scoreNgoMatch({
      ngo: { isActive: true, city: 'Mahabaleshwar', address: '1 Hill Top', acceptedCategories: JSON.stringify(['Dairy']),
        pickupCapable: true, operatingHours: '10:00-16:00', capacityKg: 30 },
      assessment: need, institution: inst,
    });
    assert.equal(r.score, 60); // pickup + hours + capacity pass; area + category fail
    const byCrit = Object.fromEntries(r.reasons.map((x) => [x.criterion, x]));
    assert.equal(byCrit.area.points, 0);
    assert.equal(byCrit.hours.points, 20);
    assert.match(byCrit.hours.detail, /overlap/i);
    assert.equal(byCrit.category.points, 0);
    assert.equal(byCrit.capacity.points, 20);
    assert.match(byCrit.category.detail, /Dairy|Cooked Veg/);
  });

  it('treats unparseable hours as neutral, never fabricated', () => {
    const r = scoreNgoMatch({
      ngo: { isActive: true, city: 'Pune', address: 'x', acceptedCategories: JSON.stringify(['Cooked Veg']),
        pickupCapable: true, operatingHours: 'whenever we can', capacityKg: 100 },
      assessment: need, institution: { ...inst, operatingHours: 'flexible timings' },
    });
    const hours = r.reasons.find((x) => x.criterion === 'hours');
    assert.equal(hours?.points, 0);
    assert.match(hours?.detail ?? '', /neutral|not comparable/i);
  });

  it('is deterministic across runs', () => {
    const args = {
      ngo: { isActive: true, city: 'Pune', address: 'x', acceptedCategories: 'Cooked Veg', pickupCapable: false, operatingHours: '09:00-18:00', capacityKg: 20 },
      assessment: need, institution: inst,
    };
    assert.deepEqual(scoreNgoMatch(args), scoreNgoMatch(args));
  });
});
