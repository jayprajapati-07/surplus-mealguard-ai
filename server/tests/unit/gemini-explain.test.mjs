// Unit: Gemini prediction explanations — ML numbers in, human words out.
// Gemini must echo the exact ML numbers; anything else falls back to template.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import gx from '../../src/lib/gemini-explain.ts';

const { explanationContainsNumbers, explainPrediction, summarizeDayReport } = gx;

describe('explanationContainsNumbers', () => {
  it('accepts text echoing every ML number', () => {
    assert.equal(explanationContainsNumbers('About 38 kg of Rice is recommended (RMSE 2.5 kg).', [38, 2.5]), true);
  });

  it('rejects text that drops or changes a number', () => {
    assert.equal(explanationContainsNumbers('About 40 kg of Rice is recommended.', [38]), false);
    assert.equal(explanationContainsNumbers('Rice looks good today.', [38]), false);
  });
});

describe('explainPrediction', () => {
  it('uses the deterministic template when Gemini is unavailable, with real numbers only', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const out = await explainPrediction({
        predictedKg: 38, foodName: 'Rice', mealType: 'LUNCH', dayLabel: 'Friday',
        sampleSize: 21, modelName: 'seasonal-naive', rmse: 2.5,
      });
      assert.equal(out.source, 'template');
      assert.match(out.text, /38/);
      assert.match(out.text, /Rice/);
      assert.match(out.text, /21/);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });
});

describe('summarizeDayReport', () => {
  it('summarizes with real numbers only when Gemini is unavailable', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const out = await summarizeDayReport({
        dateLabel: '2026-09-21', hotelName: 'Sunrise Canteen',
        predictedKg: 100, producedKg: 100, soldKg: 82, surplusKg: 18, wasteKg: 2,
        inconsistency: false,
      });
      assert.equal(out.source, 'template');
      for (const n of ['100', '82', '18']) assert.match(out.text, new RegExp(n));
      assert.match(out.text, /Sunrise Canteen/);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });

  it('reports inconsistency honestly instead of hiding it', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const out = await summarizeDayReport({
        dateLabel: '2026-09-21', hotelName: 'Sunrise Canteen',
        predictedKg: null, producedKg: 50, soldKg: 55, surplusKg: 0, wasteKg: 1,
        inconsistency: true,
      });
      assert.match(out.text, /inconsistency/i);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });
});
