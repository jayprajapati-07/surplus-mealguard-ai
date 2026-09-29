// E2E: generate target -> record Food Flow -> totals reflect entries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { req, auth, onboardAs } from '../helpers.mjs';

const DAY = new Date().toISOString().slice(0, 10);

describe('journey: target and food flow', () => {
  it('generates a target then logs production and sales', async () => {
    const { token, kitchenId } = await onboardAs('e2e-target');
    const h = auth(token);
    const stamp = Date.now();
    const fi = await req('/food-items', { method: 'POST', headers: h,
      body: JSON.stringify({ name: `E2E Dal ${stamp}`, category: 'Pulses', mealType: 'LUNCH' }) });
    const foodId = fi.data.item.id;
    // history so the forecast has comparable records
    for (const back of [7, 14, 21]) {
      const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
      await req('/food-records', { method: 'POST', headers: h,
        body: JSON.stringify({ date: d, kitchenUnitId: kitchenId, foodItemId: foodId, mealType: 'LUNCH',
          producedKg: 20, soldKg: 16, wasteKg: 1, remainingKg: 3 }) });
    }
    const g = await req('/targets/generate', { method: 'POST', headers: h,
      body: JSON.stringify({ kitchenUnitId: kitchenId, date: DAY }) });
    assert.equal(g.status, 200, JSON.stringify(g.data).slice(0, 200));
    const tg = await req(`/targets?kitchenUnitId=${kitchenId}&date=${DAY}`, { headers: h });
    assert.ok((tg.data.targets || []).some((t) => t.foodItemId === foodId));

    for (const [kind, qty] of [['PRODUCTION', 25], ['SALE', 10], ['SALE', 8], ['WASTE', 1]]) {
      const e = await req('/flow/entries', { method: 'POST', headers: h,
        body: JSON.stringify({ kitchenUnitId: kitchenId, foodItemId: foodId, mealType: 'LUNCH', entryKind: kind, quantityKg: qty }) });
      assert.equal(e.status, 201, `${kind}: ${JSON.stringify(e.data).slice(0, 150)}`);
    }
    const t = await req(`/flow/today?kitchenUnitId=${kitchenId}&date=${DAY}`, { headers: h });
    assert.equal(t.status, 200);
    assert.equal(t.data.dayTotals.produced, 25);
    assert.equal(t.data.dayTotals.sold, 18);
    assert.equal(t.data.dayTotals.wasted, 1);
  });
});
