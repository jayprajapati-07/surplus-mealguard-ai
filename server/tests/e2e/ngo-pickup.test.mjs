// E2E: eligible surplus -> match -> notify -> accept -> schedule -> handover -> receipt.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { req, auth, login, onboardAs } from '../helpers.mjs';

describe('journey: NGO acceptance and pickup', () => {
  it('completes a full redistribution with impact', async () => {
    const { token, kitchenId } = await onboardAs('e2e-ngo');
    const h = auth(token);
    const stamp = Date.now();
    const fi = await req('/food-items', { method: 'POST', headers: h,
      body: JSON.stringify({ name: `E2E Meals ${stamp}`, category: 'Cooked Veg', mealType: 'LUNCH' }) });
    const foodId = fi.data.item.id;
    const now = Date.now();
    const as = await req('/eligibility/assess', { method: 'POST', headers: h,
      body: JSON.stringify({ kitchenUnitId: kitchenId, foodDescription: `E2E Meals ${stamp}`,
        foodItemId: foodId, quantityKg: 15, foodCategory: 'Cooked Veg',
        preparedAt: new Date(now - 3600000).toISOString(), holdingInfo: 'Covered vessels',
        storageArea: 'Cold room', availableUntil: new Date(now + 5 * 3600000).toISOString(),
        qualityConfirmed: true }) });
    assert.equal(as.status, 201);
    assert.equal(as.data.assessment.verdict, 'ELIGIBLE');
    const assessId = as.data.assessment.id;

    const ngos = await req('/ngos', { headers: h });
    const seedNgo = (ngos.data.ngos || []).find((n) => n.name === 'City Food Helpers');
    assert.ok(seedNgo, 'seed NGO present');
    const mt = await req(`/redistribution/matches?assessmentId=${assessId}`, { headers: h });
    assert.equal(mt.status, 200);
    const seedMatch = (mt.data.matches || []).find((m) => m.ngo.id === seedNgo.id);
    assert.ok(seedMatch && seedMatch.score > 0, JSON.stringify(mt.data.matches).slice(0, 200));

    const nt = await req('/redistribution/notify', { method: 'POST', headers: h,
      body: JSON.stringify({ assessmentId: assessId, ngoIds: [seedNgo.id] }) });
    assert.equal(nt.status, 200, JSON.stringify(nt.data).slice(0, 200));
    assert.equal(nt.data.results[0].channel, 'simulated');
    const recordId = nt.data.recordIds[0];
    assert.ok(recordId);

    const ngo = await login('ngo@mealguard.local', 'Ngo123456!');
    const nh = auth(ngo);
    const pickupAt = new Date(now + 2 * 3600000).toISOString();
    const ac = await req(`/redistribution/${recordId}/accept`, { method: 'POST', headers: nh,
      body: JSON.stringify({ intendedPickupAt: pickupAt }) });
    assert.equal(ac.status, 200, JSON.stringify(ac.data).slice(0, 200));
    assert.equal(ac.data.record.status, 'ACCEPTED');

    const sc = await req(`/redistribution/${recordId}/schedule`, { method: 'POST', headers: h,
      body: JSON.stringify({ pickupAt }) });
    assert.equal(sc.status, 200);
    assert.equal(sc.data.record.status, 'PICKUP_SCHEDULED');

    const ho = await req(`/redistribution/${recordId}/handover`, { method: 'POST', headers: h, body: JSON.stringify({}) });
    assert.equal(ho.status, 200);
    assert.equal(ho.data.record.status, 'HANDED_OVER');

    const rc = await req(`/redistribution/${recordId}/confirm-receipt`, { method: 'POST', headers: nh, body: JSON.stringify({}) });
    assert.equal(rc.status, 200, JSON.stringify(rc.data).slice(0, 200));
    assert.equal(rc.data.record.status, 'COMPLETED');
    assert.equal(rc.data.impact.foodSavedKg, 15);
  });
});
