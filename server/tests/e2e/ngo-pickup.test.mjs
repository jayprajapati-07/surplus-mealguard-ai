// E2E: eligible surplus -> match -> notify -> accept -> schedule -> handover -> receipt.
// Uses an API-created NGO (no seed organizations exist anymore).
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

    // Create a real registry entry through the admin API (super-admin only).
    const superToken = await login('superadmin@mealguard.local', 'SuperAdmin123!');
    const sh = auth(superToken);
    const ngoName = `E2E Partner ${stamp}`;
    const nc = await req('/ngos', { method: 'POST', headers: sh,
      body: JSON.stringify({ name: ngoName, city: 'Pune', address: '9 Test Road, Pune',
        acceptedCategories: ['Cooked Veg'], pickupCapable: true, operatingHours: '08:00-20:00' }) });
    assert.equal(nc.status, 201, JSON.stringify(nc.data).slice(0, 200));
    const ngoId = nc.data.ngo.id;

    const mt = await req(`/redistribution/matches?assessmentId=${assessId}`, { headers: h });
    assert.equal(mt.status, 200);
    const created = (mt.data.matches || []).find((m) => m.ngo.id === ngoId);
    assert.ok(created && created.score > 0, JSON.stringify(mt.data.matches).slice(0, 200));

    const nt = await req('/redistribution/notify', { method: 'POST', headers: h,
      body: JSON.stringify({ assessmentId: assessId, ngoIds: [ngoId] }) });
    assert.equal(nt.status, 200, JSON.stringify(nt.data).slice(0, 200));
    assert.equal(nt.data.results[0].channel, 'simulated');
    const recordId = nt.data.recordIds[0];
    assert.ok(recordId);

    // Link a dedicated NGO login to the new organization, then accept as that NGO.
    const ngoUser = await onboardAs('e2e-ngouser', 'NGO', { skipOnboarding: true });
    const link = await req(`/ngos/${ngoId}/link`, { method: 'POST', headers: sh,
      body: JSON.stringify({ email: ngoUser.email }) });
    assert.equal(link.status, 200, JSON.stringify(link.data).slice(0, 200));
    const nh = auth(ngoUser.token);
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
