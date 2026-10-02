// Unit: multi-sheet .xlsx combine — Phase 1.
// Builds real workbooks in-memory and verifies the actual parseFile combine logic.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import imp from '../../src/routes/imports.ts';

const { parseFile } = imp;

function bookToBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('parseFile multi-sheet combine', () => {
  it('combines two sheets with different columns into one dataset', () => {
    const buf = bookToBuffer([
      ['Lunch', [
        ['Date', 'Food Item', 'Produced', 'Sold', 'Waste', 'Meal'],
        ['2026-09-21', 'Rice', 42, 36, 2, 'Lunch'],
        ['', '', '', '', '', ''],
        ['21/09/2026', 'dal', 18, 15, 1, 'Lunch'],
      ]],
      ['Dinner', [
        ['Date', 'Dish', 'Produced', 'Sold', 'Waste', 'Meal', 'Notes'],
        ['2026-09-21', 'Chapati', 25, 22, 1, 'Dinner', 'extra col'],
      ]],
    ]);
    const out = parseFile(buf, 'hotel_history.xlsx');
    assert.equal(out.combined, true);
    assert.equal(out.sheets.length, 2);
    assert.equal(out.rows.length, 3);
    assert.ok(out.headers.includes('Food Item'));
    assert.ok(out.headers.includes('Dish'));
    assert.ok(out.headers.includes('Notes'));
    assert.ok(out.rows.every((r) => r._sheet === 'Lunch' || r._sheet === 'Dinner'));
  });

  it('keeps single-sheet files uncombined', () => {
    const buf = bookToBuffer([
      ['FoodFlow', [
        ['Date', 'Food Item', 'Target', 'Produced', 'Sold', 'Waste', 'Surplus/Remaining', 'Meal', 'Unit'],
        ['2026-09-21', 'Rice', 40, 42, 36, 2, 4, 'Lunch', 'kg'],
      ]],
    ]);
    const out = parseFile(buf, 'standard.xlsx');
    assert.equal(out.combined, false);
    assert.equal(out.rows.length, 1);
    assert.equal(out.headers.length, 9);
  });

  it('skips fully empty sheets', () => {
    const buf = bookToBuffer([
      ['Empty', [['', '', ''], ['', '', '']]],
      ['Data', [
        ['Date', 'Food Item', 'Produced', 'Sold', 'Waste'],
        ['2026-09-21', 'Rice', 42, 36, 2],
      ]],
    ]);
    const out = parseFile(buf, 'with-empty.xlsx');
    assert.equal(out.combined, false);
    assert.equal(out.sheets.length, 1);
    assert.equal(out.rows.length, 1);
  });
});
