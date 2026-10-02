// Keyless geo layer — Nominatim geocoding + Overpass charity search. No keys,
// no billing, no accounts. Usage policy respected: identifying User-Agent,
// single bounded query per call, 25s timeouts. Returns REAL mapped data or
// typed errors — missing fields are null, never invented.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = { 'User-Agent': 'SurplusMealGuard/1.0 (NGO discovery; contact via hosted app)' };

export interface GeoError {
  code: 'http' | 'unavailable';
  message: string;
}

async function timedFetch(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Address → coordinates via Nominatim. Null when unresolvable (never guessed). */
export async function geocodeNominatim(address: string): Promise<{ lat: number; lng: number; formatted: string } | null> {  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
    const res = await timedFetch(url, { headers: { ...UA, Accept: 'application/json' } }, 12000);
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, formatted: data[0].display_name ?? address };
  } catch {
    return null;
  }
}

export interface OsmPlace {
  osmId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  types: string[];
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function elementPoint(e: OsmElement): { lat: number; lng: number } | null {
  if (typeof e.lat === 'number' && typeof e.lon === 'number') return { lat: e.lat, lng: e.lon };
  if (e.center && typeof e.center.lat === 'number' && typeof e.center.lon === 'number') {
    return { lat: e.center.lat, lng: e.center.lon };
  }
  return null;
}

function elementAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:road']].filter(Boolean).join(' '),
    tags['addr:suburb'] ?? tags['addr:neighbourhood'],
    tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:village'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter((x) => x && x.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

function toPlace(e: OsmElement): OsmPlace | null {
  const tags = e.tags ?? {};
  const name = (tags.name ?? '').trim();
  if (!name) return null; // nameless geometries are not contactable organizations
  const pt = elementPoint(e);
  const typeTags = Object.entries(tags)
    .filter(([k]) => ['office', 'amenity', 'shop', 'healthcare', 'social_facility'].includes(k))
    .map(([k, v]) => `${k}=${v}`);
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = (tags[k] ?? '').trim();
      if (v) return v;
    }
    return null;
  };
  return {
    osmId: `${e.type}/${e.id}`,
    name,
    address: elementAddress(tags),
    lat: pt?.lat ?? null,
    lng: pt?.lng ?? null,
    phone: pick('contact:phone', 'phone'),
    website: pick('contact:website', 'website'),
    email: pick('contact:email', 'email'),
    types: typeTags,
  };
}

function buildQuery(lat: number, lng: number, radiusM: number): string {
  const around = `around:${Math.round(radiusM)},${lat},${lng}`;
  return [
    '[out:json][timeout:25];',
    '(',
    `  nwr(${around})["office"~"^(charity|ngo|foundation)$"];`,
    `  nwr(${around})["amenity"="social_facility"];`,
    ');',
    'out center tags 200;',
  ].join('\n');
}

/** Real charity/social-facility POIs around a center. Falls back across mirrors. */
export async function searchOverpassCharities(args: {
  lat: number; lng: number; radiusM: number;
}): Promise<{ places: OsmPlace[]; error?: GeoError }> {
  const body = buildQuery(args.lat, args.lng, args.radiusM);
  let lastError = '';
  for (const url of OVERPASS_URLS) {
    try {
      const res = await timedFetch(url, {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: `data=${encodeURIComponent(body)}`,
      }, 30000);
      if (!res.ok) {
        lastError = `Overpass mirror rejected the query (HTTP ${res.status}).`;
        continue;
      }
      const data = (await res.json()) as { elements?: OsmElement[] };
      const places = ((data.elements ?? []).map(toPlace).filter((p): p is OsmPlace => p !== null)).slice(0, 200);
      return { places };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Overpass query failed.';
    }
  }
  return { places: [], error: { code: 'unavailable', message: `Unable to retrieve nearby organizations right now. ${lastError}`.trim() } };
}

/** Hotel address → coordinates with resilient variants.
 * Tries the full address first, then appends the country when missing, then
 * falls back to city-level. Returns the first real hit — never a guess. */
export async function geocodeHotelAddress(parts: {
  address: string; city: string; state?: string | null; country?: string | null;
}): Promise<{ lat: number; lng: number; formatted: string } | null> {
  const base = [parts.address, parts.city, parts.state, parts.country].filter(Boolean).join(', ');
  const variants = [base];
  if (!/india/i.test(base)) variants.push(`${base}, India`);
  if (parts.city) variants.push([parts.city, parts.state, 'India'].filter(Boolean).join(', '));
  for (const v of [...new Set(variants)].filter((x) => x.trim() !== '')) {
    const g = await geocodeNominatim(v);
    if (g) return g;
  }
  return null;
}

/** Coordinates → display address via Nominatim reverse. Null on failure. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `${NOMINATIM_URL.replace('/search', '/reverse')}?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await timedFetch(url, { headers: { ...UA, Accept: 'application/json' } }, 12000);
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return typeof data.display_name === 'string' && data.display_name ? data.display_name : null;
  } catch {
    return null;
  }
}

export default { geocodeNominatim, geocodeHotelAddress, reverseGeocode, searchOverpassCharities };
