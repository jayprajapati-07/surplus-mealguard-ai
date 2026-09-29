// API: audit-log visibility for major actions (authorized only).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { req, login, auth } from '../helpers.mjs';

describe('audit log', () => {
  let admin, manager, staff;
  before(async () => {
    admin = await login('admin@mealguard.local', 'Admin12345!');
    manager = await login('manager@mealguard.local', 'Manager123!');
    staff = await login('staff@mealguard.local', 'Staff12345!');
  });

  it('super-admin sees entries including login events', async () => {
    const superT = await login('superadmin@mealguard.local', 'SuperAdmin123!');
    const r = await req('/admin/audit-log?limit=5', { headers: auth(superT) });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.entries));
    assert.ok(r.data.entries.length >= 1);
    assert.ok(r.data.entries[0].action);
    assert.ok('createdAt' in r.data.entries[0]);
  });

  it('institution admin sees own org entries but not cross-org rows', async () => {
    const r = await req('/admin/audit-log?action=user.login&limit=50', { headers: auth(admin) });
    assert.equal(r.status, 200);
    // every row either belongs to our org or to ourselves (org-less login events)
    const me = await req('/auth/me', { headers: auth(admin) });
    const myOrg = me.data.user.organizationId;
    const myId = me.data.user.id;
    for (const e of r.data.entries) {
      assert.ok(e.organizationId === myOrg || e.userId === myId, JSON.stringify(e).slice(0, 160));
    }
  });

  it('supports action and entity filters', async () => {
    const r = await req('/admin/audit-log?action=flow.record&limit=10', { headers: auth(manager) });
    assert.equal(r.status, 200);
    assert.ok((r.data.entries || []).every((e) => (e.action || '').includes('flow.record')));
  });

  it('rejects staff, NGO, and unauthenticated readers', async () => {
    const ngo = await login('ngo@mealguard.local', 'Ngo123456!');
    assert.equal((await req('/admin/audit-log', { headers: auth(staff) })).status, 403);
    assert.equal((await req('/admin/audit-log', { headers: auth(ngo) })).status, 403);
    assert.equal((await req('/admin/audit-log')).status, 401);
  });

  it('records a fresh login event visible to super-admin', async () => {
    const stamp = Date.now();
    const email = `audit.probe.${stamp}@test.local`;
    await req('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Audit Probe', email, password: 'TestPass123!', role: 'STAFF' }) });
    const superT = await login('superadmin@mealguard.local', 'SuperAdmin123!');
    const r = await req('/admin/audit-log?action=user.signup&limit=50', { headers: auth(superT) });
    assert.equal(r.status, 200);
    assert.ok((r.data.entries || []).some((e) => JSON.stringify(e.metadataJson || e.metadata || '').includes(email) || JSON.stringify(e).includes(email)));
  });
});

