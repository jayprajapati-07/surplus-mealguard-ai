// E2E: menu creation -> CSV import of daily records.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { req, auth, onboardAs } from '../helpers.mjs';

const DAY = new Date().toISOString().slice(0, 10);

describe('journey: menu and import', () => {
  it('creates food, menu, then imports matching daily records', async () => {
    const { token, kitchenId } = await onboardAs('e2e-menu');
    const h = auth(token);
    const stamp = Date.now();
    const fi = await req('/food-items', { method: 'POST', headers: h,
      body: JSON.stringify({ name: `E2E Rice ${stamp}`, category: 'Grains', mealType: 'LUNCH' }) });
    assert.equal(fi.status, 201);
    const foodId = fi.data.item.id;
    const mn = await req('/menus', { method: 'POST', headers: h,
      body: JSON.stringify({ kitchenUnitId: kitchenId, date: DAY, scope: 'DAILY', mealType: 'LUNCH',
        items: [{ foodItemId: foodId, quantityKg: 10 }] }) });
    assert.equal(mn.status, 201);
    assert.ok(mn.data.menu.id);

    const csv = ['Date,Food Item,Target,Produced,Sold,Waste,Surplus/Remaining,Meal,Unit',
      `${DAY},E2E Rice ${stamp},12,12,10,1,1,Lunch,kg`].join('\n');
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'e2e.csv');
    fd.append('kitchenUnitId', kitchenId);
    fd.append('mapping', JSON.stringify({}));
    const token2 = token;
    const res = await fetch('http://localhost:4000/api/imports/confirm', {
      method: 'POST', headers: { Authorization: `Bearer ${token2}` }, body: fd,
    });
    const data = await res.json().catch(() => ({}));
    assert.equal(res.status, 201, JSON.stringify(data).slice(0, 200));
    assert.ok((data.accepted ?? 0) >= 1, JSON.stringify(data).slice(0, 200));

    const fr = await req(`/food-records?kitchenUnitId=${kitchenId}`, { headers: h });
    assert.equal(fr.status, 200);
    assert.ok((fr.data.records || []).some((x) => x.foodItemId === foodId));
  });
});
