// Unit: NGO discovery math — distance, relevance, ranking, email extraction.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nd from '../../src/lib/ngo-discovery.ts';

const { haversineKm, keywordRelevance, inferAcceptance, isCandidate, rankScore, extractEmailsFromHtml, dedupeByPlaceId, fetchWebsiteContacts, classifyRelevance } = nd;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('haversineKm', () => {
  it('measures Ahmedabad old-city to SG Highway at ~7-9 km', () => {
    const d = haversineKm(23.0225, 72.5714, 23.0737, 72.5178);
    assert.ok(d > 5 && d < 12, `got ${d}`);
  });

  it('is zero for identical points', () => {
    assert.equal(haversineKm(23, 72, 23, 72), 0);
  });
});

describe('keywordRelevance', () => {
  it('rates food banks high', () => {
    assert.equal(keywordRelevance('City Food Bank', ['food_bank']).level, 'high');
    assert.equal(keywordRelevance('Food Rescue Team', []).level, 'high');
  });

  it('rates generic charities likely at best', () => {
    assert.equal(keywordRelevance('Sunshine Charitable Trust', ['nonprofit']).level, 'likely');
  });

  it('is unknown for unrelated businesses', () => {
    assert.equal(keywordRelevance('Sharma Electronics', ['electronics_store']).level, 'unknown');
  });
});

describe('inferAcceptance', () => {
  it('marks food banks likely, never confirmed without evidence', () => {
    assert.equal(inferAcceptance(['food_bank']), 'likely');
    assert.equal(inferAcceptance(['charity']), 'unknown');
  });
});

describe('isCandidate', () => {
  it('rejects permanently closed places and food refusers', () => {
    assert.equal(isCandidate({ businessStatus: 'CLOSED_PERMANENTLY', acceptance: 'unknown' }), false);
    assert.equal(isCandidate({ businessStatus: 'OPERATIONAL', acceptance: 'does_not_accept' }), false);
    assert.equal(isCandidate({ businessStatus: 'OPERATIONAL', acceptance: 'unknown' }), true);
  });
});

describe('rankScore', () => {
  it('is deterministic and documented: nearer + verified + accepting wins', () => {
    const near = rankScore({ distanceKm: 1, maxRadiusKm: 20, relevance: 'high', verificationStatus: 'admin_verified', acceptance: 'confirmed', businessStatus: 'OPERATIONAL' });
    const far = rankScore({ distanceKm: 19, maxRadiusKm: 20, relevance: 'unknown', verificationStatus: 'unverified', acceptance: 'unknown', businessStatus: 'OPERATIONAL' });
    assert.ok(near.total > far.total);
    assert.equal(near.total, near.parts.distance + near.parts.relevance + near.parts.verification + near.parts.acceptance);
    assert.ok(near.total <= 100 && far.total >= 0);
  });

  it('gives zero distance points beyond the radius', () => {
    const s = rankScore({ distanceKm: 50, maxRadiusKm: 20, relevance: 'unknown', verificationStatus: 'unverified', acceptance: 'unknown', businessStatus: 'OPERATIONAL' });
    assert.equal(s.parts.distance, 0);
  });
});

describe('extractEmailsFromHtml', () => {
  it('finds mailto and plain emails, skipping junk and fakes', () => {
    const html = '<a href="mailto:contact@helpingkitchen.org">mail</a> info@helpingkitchen.org test@example.com noreply@x.org admin@test.local';
    const out = extractEmailsFromHtml(html);
    assert.ok(out.includes('contact@helpingkitchen.org'));
    assert.ok(out.includes('info@helpingkitchen.org'));
    assert.ok(!out.some((e) => e.includes('example.com') || e.includes('.local') || e.startsWith('noreply@')));
  });
});

describe('fetchWebsiteContacts', () => {
  it('extracts emails from a reachable homepage', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => (h === 'content-type' ? 'text/html' : null) },
      text: async () => '<a href="mailto:hello@realngo.org">Contact</a>',
    }));
    const out = await fetchWebsiteContacts('https://realngo.org');
    assert.ok(out.emails.includes('hello@realngo.org'));
    assert.equal(out.reachable, true);
  });

  it('reports unreachable instead of inventing contacts', async () => {
    globalThis.fetch = (async () => { throw new Error('timeout'); });
    const out = await fetchWebsiteContacts('https://down.example');
    assert.equal(out.reachable, false);
    assert.deepEqual(out.emails, []);
  });
});

describe('classifyRelevance', () => {
  it('returns unknown without a Gemini key', async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const out = await classifyRelevance({ name: 'X', address: null, types: [], website: null });
      assert.equal(out.relevance, 'unknown');
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });

  it('accepts only valid enum values from Gemini output', async () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"relevance":"banana","reason":"x","food_related":"maybe"}' }] } }] }),
    }));
    try {
      const out = await classifyRelevance({ name: 'X', address: null, types: [], website: null });
      assert.equal(out.relevance, 'unknown');
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
      else delete process.env.GEMINI_API_KEY;
    }
  });
});

describe('dedupeByPlaceId', () => {
  it('keeps the first record per place id', () => {
    const out = dedupeByPlaceId([
      { placeId: 'a', relevance: 'unknown' },
      { placeId: 'b', relevance: 'high' },
      { placeId: 'a', relevance: 'high' },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out.find((p) => p.placeId === 'a')?.relevance, 'unknown');
  });
});
