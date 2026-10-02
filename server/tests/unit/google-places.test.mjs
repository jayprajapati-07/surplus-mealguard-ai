// Unit: Google Places API (New) wrappers — mocked HTTP, no live calls.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import gp from '../../src/lib/google-places.ts';

const { googleConfigured, searchTextPlaces, fetchPlaceDetails, geocodeAddress, geocodeAddressVerbose } = gp;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function saveEnv() {
  return { GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY };
}
function restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('googleConfigured', () => {
  it('is false without a key', () => {
    const saved = saveEnv();
    delete process.env.GOOGLE_MAPS_API_KEY;
    try {
      assert.equal(googleConfigured(), false);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('searchTextPlaces', () => {
  it('returns normalized places and sends field masks, never raw dumps', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const seen = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          places: [
            {
              id: 'ChIJ123',
              displayName: { text: 'Helping Kitchen' },
              formattedAddress: '1 Main St, Ahmedabad',
              location: { latitude: 23.03, longitude: 72.58 },
              businessStatus: 'OPERATIONAL',
              types: ['food_bank', 'point_of_interest'],
              googleMapsUri: 'https://maps.google.com/?cid=1',
            },
          ],
        }),
      };
    });
    try {
      const out = await searchTextPlaces({ query: 'food bank', lat: 23.02, lng: 72.57, radiusM: 10000 });
      assert.equal(out.places.length, 1);
      assert.equal(out.places[0].placeId, 'places/ChIJ123');
      assert.equal(out.places[0].name, 'Helping Kitchen');
      assert.equal(out.places[0].lat, 23.03);
      assert.ok(String(seen[0].init.headers['X-Goog-FieldMask']).includes('places.id'));
      assert.match(String(seen[0].url), /places:searchText/);
    } finally {
      restoreEnv(saved);
    }
  });

  it('maps quota failures to a typed error, never fake places', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => ({}) }));
    try {
      const out = await searchTextPlaces({ query: 'food bank', lat: 23, lng: 72, radiusM: 5000 });
      assert.equal(out.places.length, 0);
      assert.equal(out.error?.code, 'quota');
    } finally {
      restoreEnv(saved);
    }
  });

  it('refuses without a key', async () => {
    const saved = saveEnv();
    delete process.env.GOOGLE_MAPS_API_KEY;
    try {
      const out = await searchTextPlaces({ query: 'food bank', lat: 23, lng: 72, radiusM: 5000 });
      assert.equal(out.error?.code, 'not-configured');
    } finally {
      restoreEnv(saved);
    }
  });

  it('surfaces Google auth rejections with the real reason', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'bad-key';
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 401, message: 'API keys are not supported by this API.', status: 'UNAUTHENTICATED' } }),
    }));
    try {
      const out = await searchTextPlaces({ query: 'food bank', lat: 23, lng: 72, radiusM: 5000 });
      assert.equal(out.error?.code, 'forbidden');
      assert.match(out.error?.message ?? '', /API keys are not supported/);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('fetchPlaceDetails', () => {
  it('returns phone and website only when Google provides them', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'places/ChIJ123',
        displayName: { text: 'Helping Kitchen' },
        nationalPhoneNumber: '+91 79 1111 2222',
        websiteUri: 'https://helping.example.org',
      }),
    }));
    try {
      const d = await fetchPlaceDetails('places/ChIJ123');
      assert.equal(d.phone, '+91 79 1111 2222');
      assert.equal(d.website, 'https://helping.example.org');
    } finally {
      restoreEnv(saved);
    }
  });

  it('yields nulls — never invented values — when Google omits fields', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = (async () => ({
      ok: true, status: 200, json: async () => ({ id: 'places/X', displayName: { text: 'N' } }),
    }));
    try {
      const d = await fetchPlaceDetails('places/X');
      assert.equal(d.phone, null);
      assert.equal(d.website, null);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('geocodeAddress', () => {
  it('resolves coordinates from a real geocode response', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        results: [{ formatted_address: 'Ahmedabad, Gujarat, India', geometry: { location: { lat: 23.0225, lng: 72.5714 } } }],
      }),
    }));
    try {
      const g = await geocodeAddress('Ahmedabad, Gujarat, India');
      assert.equal(g?.lat, 23.0225);
      assert.equal(g?.lng, 72.5714);
    } finally {
      restoreEnv(saved);
    }
  });

  it('returns null on zero results instead of guessing', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) }));
    try {
      assert.equal(await geocodeAddress('Nowhere XYZ 123'), null);
    } finally {
      restoreEnv(saved);
    }
  });

  it('reports key denials with the real reason via verbose geocode', async () => {
    const saved = saveEnv();
    process.env.GOOGLE_MAPS_API_KEY = 'bad-key';
    globalThis.fetch = (async () => ({
      ok: true, status: 200, json: async () => ({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid. ', results: [] }),
    }));
    try {
      const out = await geocodeAddressVerbose('Gota, Ahmedabad');
      assert.equal(out.ok, false);
      assert.equal(out.failure.code, 'denied');
      assert.match(out.failure.message, /invalid/);
    } finally {
      restoreEnv(saved);
    }
  });
});
