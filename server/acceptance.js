const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4000/api';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-test-suite': 'true', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const adminEmail = `accept.admin.${stamp}@e2e.mealguard.local`;
  const staffEmail = `accept.staff.${stamp}@e2e.mealguard.local`;
  const pass = 'TestPass123!';

  // 1. signup admin
  let r = await req('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Accept Admin', email: adminEmail, password: pass, role: 'INSTITUTION_ADMIN' }) });
  results.push(['signup admin 201', r.status === 201, r.status, r.data.error || r.data.message]);

  // 2. login works immediately without verification
  r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: adminEmail, password: pass }) });
  const adminToken = r.data.token;
  results.push(['login immediate 200 + token', r.status === 200 && !!adminToken, r.status, adminToken ? 'token ok' : r.data.error]);

  // 6. me has no org
  r = await req('/auth/me', { headers: { Authorization: `Bearer ${adminToken}` } });
  results.push(['me no org yet', r.status === 200 && r.data.user && !r.data.user.organizationId, r.status, '']);

  // 7. invalid onboarding rejected (empty name)
  r = await req('/organizations/onboarding', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ sector: 'PRIVATE', institutionType: 'COLLEGE_CANTEEN', name: '', address: 'x', city: 'Pune', contactName: 'A', contactPhone: '123', contactEmail: 'bad', operatingHours: '8-8', peopleServedDaily: 0, kitchenCapacityKg: -1, kitchens: [] }) });
  results.push(['invalid onboarding 400, nothing saved', r.status === 400, r.status, r.data.error]);

  // 8. valid onboarding
  const orgName = `Accept Org ${stamp}`;
  r = await req('/organizations/onboarding', {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      sector: 'PRIVATE', institutionType: 'HOSTEL_MESS', name: orgName, address: '1 Test Road, Block A', city: 'Pune Test Area',
      contactName: 'Accept Admin', contactPhone: '+91-1111111111', contactEmail: adminEmail, operatingHours: '8am-8pm',
      peopleServedDaily: 300, kitchenCapacityKg: 120,
      kitchens: [{ name: 'Test Kitchen', mealTimings: 'Lunch 12-2pm', storageAreas: 'Dry store', foodCategories: 'Grains', productionCapacityKg: 120 }],
    }),
  });
  results.push(['valid onboarding 201', r.status === 201, r.status, r.data.message || r.data.error]);

  // 9. me now has org (session persistence simulation = fresh /me call)
  r = await req('/auth/me', { headers: { Authorization: `Bearer ${adminToken}` } });
  results.push(['me has org after onboarding', r.status === 200 && !!r.data.user?.organizationId, r.status, r.data.user?.organization?.name || '']);

  // 10. staff signup/login then onboarding blocked 403
  await req('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Accept Staff', email: staffEmail, password: pass, role: 'STAFF' }) });
  let l = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: staffEmail, password: pass }) });
  const staffToken = l.data.token;
  r = await req('/organizations/onboarding', { method: 'POST', headers: { Authorization: `Bearer ${staffToken}` }, body: JSON.stringify({ sector: 'PRIVATE', institutionType: 'OTHER', name: `Blocked ${stamp}`, address: '123 Street Address', city: 'Pune', contactName: 'S', contactPhone: '1234567', contactEmail: staffEmail, operatingHours: '9-5', peopleServedDaily: 10, kitchenCapacityKg: 10, kitchens: [{ name: 'K', mealTimings: 'Lunch', storageAreas: 'Store', foodCategories: 'Grains', productionCapacityKg: 5 }] }) });
  results.push(['STAFF blocked from onboarding 403', r.status === 403, r.status, r.data.error]);

  // 11. non-super-admin blocked from /admin/users
  r = await req('/admin/users', { headers: { Authorization: `Bearer ${adminToken}` } });
  results.push(['non-superadmin blocked from admin API 403', r.status === 403, r.status, r.data.error]);

  // 12. superadmin can list users
  l = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'superadmin@mealguard.local', password: 'SuperAdmin123!' }) });
  r = await req('/admin/users', { headers: { Authorization: `Bearer ${l.data.token}` } });
  results.push(['superadmin can list users 200', r.status === 200 && Array.isArray(r.data.users), r.status, `${(r.data.users || []).length} users`]);

  // 13. forgot + reset flow
  const fg = await req('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: adminEmail }) });
  let resetToken = fg.data.debugToken;
  if (!resetToken) {
    const u = await prisma.user.findUnique({ where: { email: adminEmail } });
    resetToken = u?.resetToken;
  }
  results.push(['forgot generates reset token', !!resetToken, 200, resetToken ? 'token ok' : 'missing']);
  r = await req('/auth/reset', { method: 'POST', body: JSON.stringify({ token: resetToken, newPassword: 'NewPass123!' }) });
  results.push(['reset with token 200', r.status === 200, r.status, r.data.message || r.data.error]);
  // old session should be dead after reset
  r = await req('/auth/me', { headers: { Authorization: `Bearer ${adminToken}` } });
  results.push(['old session dead after reset 401', r.status === 401, r.status, r.data.error || '']);
  // login with new password
  r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: adminEmail, password: 'NewPass123!' }) });
  const newToken = r.data.token;
  results.push(['login with new password 200', r.status === 200 && !!newToken, r.status, '']);

  // 14. logout ends session
  await req('/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${newToken}` } });
  r = await req('/auth/me', { headers: { Authorization: `Bearer ${newToken}` } });
  results.push(['logout ends session 401', r.status === 401, r.status, r.data.error || '']);

  await prisma.$disconnect();

  console.log('\nACCEPTANCE RESULTS:');
  let fail = 0;
  for (const [name, ok, status, info] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'} [${status}] ${name} :: ${info}`);
    if (!ok) fail++;
  }
  console.log(fail === 0 ? '\nALL ACCEPTANCE TESTS PASSED' : `\n${fail} FAILURES`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
