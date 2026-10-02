// API authorization: role gates, org isolation via ID tampering, NGO scoping.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { req, login, auth, onboardAs } from '../helpers.mjs';

const DAY = new Date().toISOString().slice(0, 10);
let admin, manager, staff, ngo, superT;
let foodId, recordId, menuId, invId, kitchenId;

async function seedFixtures() {
  admin = await login('admin@mealguard.local', 'Admin12345!');
  manager = await login('manager@mealguard.local', 'Manager123!');
  staff = await login('staff@mealguard.local', 'Staff12345!');
  ngo = await login('ngo@mealguard.local', 'Ngo123456!');
  superT = await login('superadmin@mealguard.local', 'SuperAdmin123!');
  // Link the demo NGO login to a real API-created registry row (no seed NGOs exist).
  const stamp0 = Date.now();
  const nc0 = await req('/ngos', { method: 'POST', headers: auth(superT),
    body: JSON.stringify({ name: `Authz Probe NGO ${stamp0}`, city: 'Pune', address: '9 Test Road, Pune' }) });
  if (nc0.status !== 201) throw new Error(`ngo create failed: ${JSON.stringify(nc0.data)}`);
  const link0 = await req(`/ngos/${nc0.data.ngo.id}/link`, { method: 'POST', headers: auth(superT),
    body: JSON.stringify({ email: 'ngo@mealguard.local' }) });
  if (link0.status !== 200) throw new Error(`ngo link failed: ${JSON.stringify(link0.data)}`);
  const me = await req('/auth/me', { headers: auth(admin) });
  kitchenId = me.data.user.organization.kitchens[0].id;
  const stamp = Date.now();
  const fi = await req('/food-items', { method: 'POST', headers: auth(admin),
    body: JSON.stringify({ name: `Authz Probe ${stamp}`, category: 'Grains', mealType: 'LUNCH' }) });
  foodId = fi.data.item.id;
  const fr = await req('/food-records', { method: 'POST', headers: auth(admin),
    body: JSON.stringify({ date: DAY, kitchenUnitId: kitchenId, foodItemId: foodId, mealType: 'LUNCH',
      producedKg: 20, soldKg: 15, wasteKg: 2, remainingKg: 3 }) });
  recordId = fr.data.record.id;
  const mn = await req('/menus', { method: 'POST', headers: auth(admin),
    body: JSON.stringify({ kitchenUnitId: kitchenId, date: DAY, scope: 'DAILY', mealType: 'LUNCH',
      items: [{ foodItemId: foodId, quantityKg: 10 }] }) });
  menuId = mn.data.menu.id;
  const iv = await req('/inventory', { method: 'POST', headers: auth(admin),
    body: JSON.stringify({ foodItemId: foodId, quantityKg: 30, storageArea: 'Dry store' }) });
  invId = iv.data.item.id;
}

describe('authorization', () => {
  before(async () => { await seedFixtures(); });

  it('rejects unauthenticated access with 401', async () => {
    for (const p of ['/food-items', '/food-records', '/menus', '/inventory', '/dashboard/overview', '/targets']) {
      const r = await req(p);
      assert.equal(r.status, 401, p);
    }
  });

  it('blocks cross-organization ID tampering with 404', async () => {
    const orgB = await onboardAs('authz-b');
    const bad = { headers: auth(orgB.token) };
    let r = await req(`/food-items/${foodId}`, { method: 'PUT', headers: bad.headers, body: JSON.stringify({ name: 'Hijack', category: 'Grains' }) });
    assert.equal(r.status, 404);
    r = await req(`/food-records/${recordId}`, { method: 'PUT', headers: bad.headers,
      body: JSON.stringify({ date: DAY, kitchenUnitId: orgB.kitchenId, foodItemId: foodId, mealType: 'LUNCH', producedKg: 1, soldKg: 1, wasteKg: 0, remainingKg: 0, correctionReason: 'x'.repeat(10) }) });
    assert.equal(r.status, 404);
    r = await req(`/menus/${menuId}`, { method: 'DELETE', headers: bad.headers });
    assert.equal(r.status, 404);
    r = await req(`/inventory/${invId}/adjust`, { method: 'PUT', headers: bad.headers, body: JSON.stringify({ deltaKg: 1, reason: 'evil adjustment attempt' }) });
    assert.equal(r.status, 404);
    r = await req(`/targets/${'c'.repeat(20)}/adjust`, { method: 'PUT', headers: bad.headers, body: JSON.stringify({ adjustedKg: 1, reason: 'evil attempt here' }) });
    assert.ok([400, 404].includes(r.status));
    r = await req(`/eod/close`, { method: 'POST', headers: bad.headers, body: JSON.stringify({ kitchenUnitId: kitchenId, date: DAY }) });
    assert.equal(r.status, 400); // kitchen belongs to another org
  });

  it('blocks staff from admin-only mutations with 403', async () => {
    const s = { headers: auth(staff) };
    const bodies = {
      menu: { kitchenUnitId: kitchenId, date: DAY, mealType: 'LUNCH', items: [{ foodItemId: foodId, quantityKg: 1 }] },
      buffer: { mode: 'PERCENT', value: 10 },
      thresholds: { lowStockKg: 1, nearExpiryDays: 1, excessKg: 10 },
      close: { kitchenUnitId: kitchenId, date: DAY },
    };
    assert.equal((await req('/menus', { method: 'POST', headers: s.headers, body: JSON.stringify(bodies.menu) })).status, 403);
    assert.equal((await req('/targets/buffer', { method: 'PUT', headers: s.headers, body: JSON.stringify(bodies.buffer) })).status, 403);
    assert.equal((await req('/targets/generate', { method: 'POST', headers: s.headers, body: JSON.stringify({ kitchenUnitId: kitchenId, date: DAY }) })).status, 403);
    assert.equal((await req('/inventory/thresholds', { method: 'PUT', headers: s.headers, body: JSON.stringify(bodies.thresholds) })).status, 403);
    assert.equal((await req('/eod/close', { method: 'POST', headers: s.headers, body: JSON.stringify(bodies.close) })).status, 403);
    assert.equal((await req('/impact/factors', { method: 'POST', headers: s.headers, body: JSON.stringify({ key: 'X', name: 'X', value: 1, unit: 'kg', source: 's', effectiveDate: DAY }) })).status, 403);
    assert.equal((await req('/ngos', { method: 'POST', headers: s.headers, body: JSON.stringify({ name: 'X' }) })).status, 403);
  });

  it('scopes NGO users to their own opportunities only', async () => {
    const n = { headers: auth(ngo) };
    assert.equal((await req('/food-items', { method: 'POST', headers: n.headers, body: JSON.stringify({ name: 'X', category: 'Y' }) })).status, 403);
    assert.equal((await req('/food-items', n)).status, 404); // no organization → org guard, not data leak
    assert.equal((await req('/food-records', { method: 'POST', headers: n.headers, body: JSON.stringify({}) })).status, 403);
    const opps = await req('/redistribution/opportunities', n);
    assert.equal(opps.status, 200);
    const me = await req('/auth/me', n);
    const myNgo = me.data.user.ngoOrganizationId;
    assert.ok((opps.data.records || []).every((o) => !o.ngoId || o.ngoId === myNgo || o.ngo?.id === myNgo));
  });

  it('rejects tampered record reads across organizations', async () => {
    const orgB = await onboardAs('authz-b2');
    const r = await req(`/food-records?kitchenUnitId=${kitchenId}`, { headers: auth(orgB.token) });
    assert.equal(r.status, 200);
    assert.ok(!(r.data.records || []).some((x) => x.id === recordId));
  });
});

