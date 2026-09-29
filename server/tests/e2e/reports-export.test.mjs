// E2E: build a report and download all three export formats.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { req, auth, onboardAs } from '../helpers.mjs';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx');

const DAY = new Date().toISOString().slice(0, 10);

describe('journey: reports and exports', () => {
  it('builds a daily report and downloads CSV, XLSX, PDF with real content', async () => {
    const { token, kitchenId } = await onboardAs('e2e-report');
    const h = auth(token);
    const stamp = Date.now();
    const fi = await req('/food-items', { method: 'POST', headers: h,
      body: JSON.stringify({ name: `E2E Export ${stamp}`, category: 'Grains', mealType: 'LUNCH' }) });
    const foodId = fi.data.item.id;
    const fr = await req('/food-records', { method: 'POST', headers: h,
      body: JSON.stringify({ date: DAY, kitchenUnitId: kitchenId, foodItemId: foodId, mealType: 'LUNCH',
        producedKg: 40, soldKg: 30, wasteKg: 3, remainingKg: 7 }) });
    assert.equal(fr.status, 201);

    const rep = await req(`/reports/data?type=daily&date=${DAY}`, { headers: h });
    assert.equal(rep.status, 200);
    assert.equal(rep.data.report.production.actualTotal, 40);

    const q = `type=daily&date=${DAY}`;
    const csvRes = await fetch(`http://localhost:4000/api/reports/export.csv?${q}`, { headers: { Authorization: h.Authorization } });
    assert.equal(csvRes.status, 200);
    const csv = await csvRes.text();
    assert.ok(csv.includes('E2E Export'));
    assert.ok(csv.includes('40'));

    const xRes = await fetch(`http://localhost:4000/api/reports/export.xlsx?${q}`, { headers: { Authorization: h.Authorization } });
    assert.equal(xRes.status, 200);
    assert.ok((xRes.headers.get('content-type') || '').includes('spreadsheetml'));
    const xBuf = Buffer.from(await xRes.arrayBuffer());
    const wb = XLSX.read(xBuf, { type: 'buffer' });
    assert.ok(wb.SheetNames.includes('Summary'));
    assert.ok(wb.SheetNames.includes('Daily'));

    const pRes = await fetch(`http://localhost:4000/api/reports/export.pdf?${q}`, { headers: { Authorization: h.Authorization } });
    assert.equal(pRes.status, 200);
    const pBuf = Buffer.from(await pRes.arrayBuffer());
    assert.equal(pBuf.slice(0, 4).toString(), '%PDF');
    assert.ok(pBuf.length > 2000, `pdf too small: ${pBuf.length}`);
  });
});
