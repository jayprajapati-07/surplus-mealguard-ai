// E2E: signup -> onboarding (fresh institution, all real steps).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { req, auth, onboardAs } from '../helpers.mjs';

describe('journey: signup and onboarding', () => {
  it('creates an institution with kitchen and persists session', async () => {
    const { token, orgId, kitchenId, email } = await onboardAs('e2e-onboard');
    assert.ok(token);
    assert.ok(orgId);
    assert.ok(kitchenId);
    const me = await req('/auth/me', { headers: auth(token) });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, email);
    assert.equal(me.data.user.organizationId, orgId);
    assert.ok((me.data.user.organization.kitchens || []).length >= 1);
  });

  it('blocks staff from onboarding', async () => {
    const stamp = Date.now();
    const email = `e2e-staff.${stamp}@e2e.mealguard.local`;
    await req('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'E2E Staff', email, password: 'TestPass123!', role: 'STAFF' }) });
    const l = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'TestPass123!' }) });
    assert.equal(l.status, 200, `login failed: ${JSON.stringify(l.data)}`);
    const r = await req('/organizations/onboarding', { method: 'POST', headers: auth(l.data.token),
      body: JSON.stringify({ sector: 'PRIVATE', institutionType: 'OTHER', name: `Blocked ${stamp}`, address: 'x', city: 'Pune',
        contactName: 'S', contactPhone: '1234567', contactEmail: email, operatingHours: '9-5', peopleServedDaily: 10,
        kitchenCapacityKg: 10, kitchens: [{ name: 'K', mealTimings: 'Lunch', storageAreas: 'Store', foodCategories: 'Grains', productionCapacityKg: 5 }] }) });
    assert.equal(r.status, 403);
  });
});
