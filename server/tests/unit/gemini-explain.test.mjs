// Unit: Gemini prediction explanations — ML numbers in, human words out.
// Gemini must echo the exact ML numbers; anything else falls back to template.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import gx from '../../src/lib/gemini-explain.ts';

const { explanationContainsNumbers, explainPrediction } = gx;

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
