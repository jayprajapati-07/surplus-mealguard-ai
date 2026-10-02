// Unit: keyless geo layer — Nominatim geocoding + Overpass charity search (mocked HTTP).
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import og from '../../src/lib/open-geo.ts';

const { geocodeNominatim, geocodeHotelAddress, reverseGeocode, searchOverpassCharities } = og;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('geocodeNominatim', () => {
  it('resolves coordinates without any API key', async () => {
    let ua = '';
    globalThis.fetch = (async (url, init) => {
      ua = String(init?.headers?.['User-Agent'] ?? '');
      return {
        ok: true, status: 200,
        json: async () => [{ lat: '23.0225', lon: '72.5714', display_name: 'Ahmedabad, Gujarat, India' }],
      };
    });
    const g = await geocodeNominatim('Gota, Ahmedabad, Gujarat, India');
    assert.equal(g?.lat, 23.0225);
    assert.equal(g?.lng, 72.5714);
    assert.ok(ua.length > 10, 'must identify with a User-Agent per Nominatim policy');
  });

  it('returns null on empty results instead of guessing', async () => {
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => [] }));
    assert.equal(await geocodeNominatim('Nowhere XYZ 123'), null);
  });
});

describe('geocodeHotelAddress', () => {
  it('falls back to country-appended variants when the raw address fails', async () => {    const queries = [];
    globalThis.fetch = (async (url) => {
      queries.push(String(url));
      if (queries.length === 1) return { ok: true, status: 200, json: async () => [] };
      return {
        ok: true, status: 200,
        json: async () => [{ lat: '23.101', lon: '72.5408', display_name: 'Gota, Ahmedabad' }],
      };
    });
    const g = await geocodeHotelAddress({ address: 'Gota, Ahmedabad, Gujarat', city: 'Ahmedabad', state: null, country: null });
    assert.equal(g?.lat, 23.101);
    assert.ok(queries.length >= 2, 'must retry with a broader variant');
  });

  it('fixes common state typos and drops to city level for messy addresses', async () => {
    const queries = [];
    globalThis.fetch = (async (url) => {
      queries.push(decodeURIComponent(String(url).split('q=')[1].split('&')[0]));
      return { ok: true, status: 200, json: async () => [] };
    });
    await geocodeHotelAddress({ address: 'Chandansar Rd', city: 'Virar, Mumbai', state: 'Maharastra', country: 'India' });
    assert.ok(queries.some((q) => q.includes('Maharashtra')), 'must correct the Maharastra typo');
    assert.ok(queries.some((q) => q === 'Virar, Maharashtra, India'), 'must try a city-level variant');
  });
});

describe('reverseGeocode', () => {
  it('returns a display address for coordinates', async () => {
    globalThis.fetch = (async () => ({
      ok: true, status: 200, json: async () => ({ display_name: 'Gota, Ahmedabad, Gujarat, India' }),
    }));
    assert.equal(await reverseGeocode(23.101, 72.5408), 'Gota, Ahmedabad, Gujarat, India');
  });

  it('returns null on failure instead of inventing', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }));
    assert.equal(await reverseGeocode(0, 0), null);
  });
});

describe('searchOverpassCharities', () => {
  const overpass = {
    elements: [
      {
        type: 'node', id: 101, lat: 23.03, lon: 72.58,
        tags: {
          name: 'Helping Hands Kitchen', office: 'charity',
          'addr:housenumber': '5', 'addr:road': 'Service Lane', 'addr:suburb': 'Gota', 'addr:city': 'Ahmedabad',
          phone: '+91 79 1111 2222', website: 'https://helping.example.org', 'contact:email': 'hello@realngo.org',
        },
      },
      {
        type: 'way', id: 202,
        center: { lat: 23.04, lon: 72.59 },
        tags: { name: 'No Name Shelter', amenity: 'social_facility' },
      },
      { type: 'node', id: 303, lat: 23.05, lon: 72.6, tags: { office: 'charity' } },
    ],
  };

  it('normalizes real OSM elements, skipping nameless ones, never inventing', async () => {
    const seen = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => overpass };
    });
    const out = await searchOverpassCharities({ lat: 23.0225, lng: 72.5714, radiusM: 10000 });
    assert.equal(out.error, undefined);
    assert.equal(out.places.length, 2);
    const first = out.places[0];
    assert.equal(first.osmId, 'node/101');
    assert.equal(first.name, 'Helping Hands Kitchen');
    assert.equal(first.phone, '+91 79 1111 2222');
    assert.equal(first.email, 'hello@realngo.org');
    assert.ok((first.address ?? '').includes('Ahmedabad'));
    assert.match(String(seen[0].init.body), /office/);
    assert.ok(!String(seen[0].url).includes('key=') && !String(seen[0].init.body).includes('key'), 'no key material sent');
  });

  it('tries the fallback endpoint when the primary fails', async () => {
    const urls = [];
    globalThis.fetch = (async (url) => {
      urls.push(String(url));
      if (urls.length === 1) throw new Error('down');
      return { ok: true, status: 200, json: async () => ({ elements: [] }) };
    });
    const out = await searchOverpassCharities({ lat: 23, lng: 72, radiusM: 5000 });
    assert.equal(urls.length, 2);
    assert.deepEqual(out.places, []);
  });
});
