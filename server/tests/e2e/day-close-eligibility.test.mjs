// E2E: record day -> close day -> eligibility assessment.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { req, auth, onboardAs } from '../helpers.mjs';

const DAY = new Date().toISOString().slice(0, 10);

describe('journey: day close and eligibility', () => {
  it('closes a coherent day and assesses surplus as eligible', async () => {
    const { token, kitchenId } = await onboardAs('e2e-eod');
    const h = auth(token);
    const stamp = Date.now();
    const fi = await req('/food-items', { method: 'POST', headers: h,
      body: JSON.stringify({ name: `E2E Khichdi ${stamp}`, category: 'Grains', mealType: 'DINNER' }) });
    const foodId = fi.data.item.id;
    const fr = await req('/food-records', { method: 'POST', headers: h,
      body: JSON.stringify({ date: DAY, kitchenUnitId: kitchenId, foodItemId: foodId, mealType: 'DINNER',
        producedKg: 30, soldKg: 20, wasteKg: 2, remainingKg: 8 }) });
    assert.equal(fr.status, 201);

    const pv = await req(`/eod/preview?kitchenUnitId=${kitchenId}&date=${DAY}`, { headers: h });
    assert.equal(pv.status, 200);
    assert.equal(pv.data.totals.preparedKg, 30);
    const cl = await req('/eod/close', { method: 'POST', headers: h,
      body: JSON.stringify({ kitchenUnitId: kitchenId, date: DAY, notes: 'E2E close' }) });
    assert.equal(cl.status, 201, JSON.stringify(cl.data).slice(0, 200));
    assert.equal(cl.data.report.totalSurplusKg, 8);

    const now = Date.now();
    const as = await req('/eligibility/assess', { method: 'POST', headers: h,
      body: JSON.stringify({ kitchenUnitId: kitchenId, foodDescription: `E2E Khichdi ${stamp}`,
        foodItemId: foodId, quantityKg: 15, foodCategory: 'Grains',
        preparedAt: new Date(now - 3600000).toISOString(), holdingInfo: 'Covered vessels',
        storageArea: 'Cold room shelf 2', availableUntil: new Date(now + 5 * 3600000).toISOString(),
        qualityConfirmed: true, qualityNote: 'Smell, look, texture checked' }) });
    assert.equal(as.status, 201, JSON.stringify(as.data).slice(0, 200));
    assert.equal(as.data.assessment.verdict, 'ELIGIBLE');
  });
});
