// Unit: Gemini mapping validation — never trust AI blindly.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import gm from '../../src/lib/gemini.ts';

const { validateGeminiMapping, geminiConfigured } = gm;

describe('validateGeminiMapping', () => {
  it('accepts a mapping whose columns all exist in actual headers', () => {
    const r = validateGeminiMapping(
      { date: 'Date', food: 'Food Item', produced: 'Produced', sold: 'Sold', waste: 'Waste' },
      ['Date', 'Food Item', 'Produced', 'Sold', 'Waste', 'Meal']
    );
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });

  it('rejects hallucinated columns not present in actual headers', () => {
    const r = validateGeminiMapping(
      { date: 'Date', food: 'Dish Name', produced: 'Produced', sold: 'Sold', waste: 'Waste' },
      ['Date', 'Food Item', 'Produced', 'Sold', 'Waste']
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('Dish Name')));
  });

  it('rejects mapping missing required fields', () => {
    const r = validateGeminiMapping({ date: 'Date', food: 'Food Item' }, ['Date', 'Food Item']);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });
});

describe('geminiConfigured', () => {
  it('is false when GEMINI_API_KEY is absent', () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    assert.equal(geminiConfigured(), false);
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  });
});
