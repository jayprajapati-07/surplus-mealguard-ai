// Shared helpers for API/E2E suites (plain Node fetch, no deps).
export const BASE = 'http://localhost:4000/api';

export async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export async function login(email, password) {
  const r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r.status !== 200 || !r.data.token) throw new Error(`login failed for ${email}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Full signup -> verify -> login -> onboard journey. Returns { token, orgId, kitchenId }.
export async function onboardAs(prefix, role = 'INSTITUTION_ADMIN') {
  const stamp = Date.now();
  const email = `${prefix}.${stamp}@test.local`;
  const pass = 'TestPass123!';
  let r = await req('/auth/signup', { method: 'POST', body: JSON.stringify({ name: `Test ${prefix}`, email, password: pass, role }) });
  if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.data)}`);
  const token = await login(email, pass);
  const orgName = `Test Org ${prefix} ${stamp}`;
  r = await req('/organizations/onboarding', { method: 'POST', headers: auth(token), body: JSON.stringify({
    sector: 'PRIVATE', institutionType: 'HOSTEL_MESS', name: orgName, address: '9 Test Road', city: 'Pune',
    contactName: 'Test Owner', contactPhone: '+91-9000000000', contactEmail: email, operatingHours: '8am-8pm',
    peopleServedDaily: 200, kitchenCapacityKg: 100,
    kitchens: [{ name: 'Main Test Kitchen', mealTimings: 'Lunch 12-2pm', storageAreas: 'Dry store', foodCategories: 'Grains', productionCapacityKg: 100 }],
  }) });
  if (r.status !== 201) throw new Error(`onboarding failed: ${JSON.stringify(r.data)}`);
  const me = await req('/auth/me', { headers: auth(token) });
  return { token, orgId: me.data.user.organizationId, kitchenId: me.data.user.organization.kitchens[0].id, email };
}
