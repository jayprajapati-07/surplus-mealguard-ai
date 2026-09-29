const BASE = 'http://localhost:4000/api';
async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function main() {
  const l = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'staff@mealguard.local', password: 'Staff12345!' }) });
  const t = l.data.token;
  const me = await req('/auth/me', { headers: { Authorization: `Bearer ${t}` } });
  const kid = me.data.user.organization.kitchens[0].id;
  const base = { kitchenUnitId: kid, foodDescription: 'dbg', foodCategory: 'Cooked grains',
    preparedAt: new Date(Date.now() - 3600000).toISOString(),
    holdingInfo: 'Covered vessels', storageArea: 'Cold room',
    availableUntil: new Date(Date.now() + 5 * 3600000).toISOString(),
    expiryDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) };
  const mk = (extra) => req('/eligibility/assess', { method: 'POST', headers: { Authorization: `Bearer ${t}` },
    body: JSON.stringify({ ...base, ...extra }) });
  let r = await mk({ quantityKg: 15, qualityConfirmed: true, availableUntil: new Date(Date.now() + 30 * 60000).toISOString() });
  console.log('tight:', r.status, r.data.assessment?.verdict, '|', r.data.assessment?.reason);
  r = await mk({ quantityKg: 15, qualityConfirmed: true, qualityNote: 'checked' });
  console.log('full:', r.status, r.data.assessment?.verdict, '|', r.data.assessment?.reason);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
