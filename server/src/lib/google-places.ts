// Google Places API (New) + Geocoding wrappers — server-only. NEVER import from client.
// Discovery layer only: returns REAL Google data or typed errors. Missing
// fields become null ("Unavailable" is a UI concern) — never invented.
// No scraping of Google Maps webpages; official APIs only.
const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY.trim());
}

export interface PlacesError {
  code: 'not-configured' | 'http' | 'quota' | 'forbidden' | 'bad-request';
  message: string;
}

export interface PlaceSummary {
  placeId: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  businessStatus: string | null;
  types: string[];
  primaryType: string | null;
  mapsUri: string | null;
}

const SEARCH_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.businessStatus', 'places.types', 'places.primaryType', 'places.googleMapsUri',
].join(',');

const DETAILS_MASK = [
  'id', 'displayName', 'formattedAddress', 'location', 'businessStatus', 'types',
  'primaryType', 'googleMapsUri', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri',
].join(',');

async function timedFetch(url: string, init: RequestInit, ms = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(status: number): PlacesError {
  if (status === 429) {
    return { code: 'quota', message: 'Google Places quota exceeded. Try again later or raise quota in Google Cloud Console.' };
  }
  if (status === 403) {
    return { code: 'forbidden', message: 'Google API key rejected (403). Check key restrictions and enabled APIs.' };
  }
  if (status === 400) {
    return { code: 'bad-request', message: 'Google Places rejected the request (400). Check query parameters.' };
  }
  return { code: 'http', message: `Google Places request failed (HTTP ${status}).` };
}

function toSummary(p: {
  id?: string; displayName?: { text?: string }; formattedAddress?: string;
  location?: { latitude?: number; longitude?: number }; businessStatus?: string;
  types?: string[]; primaryType?: string; googleMapsUri?: string;
}): PlaceSummary {
  const id = typeof p.id === 'string' ? p.id : '';
  return {
    placeId: id.startsWith('places/') ? id : `places/${id}`,
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    lat: typeof p.location?.latitude === 'number' ? p.location.latitude : null,
    lng: typeof p.location?.longitude === 'number' ? p.location.longitude : null,
    businessStatus: p.businessStatus ?? null,
    types: Array.isArray(p.types) ? p.types : [],
    primaryType: p.primaryType ?? null,
    mapsUri: p.googleMapsUri ?? null,
  };
}

/** Text Search around a center point. One page (up to 20). Never throws. */
export async function searchTextPlaces(args: {
  query: string; lat: number; lng: number; radiusM: number; maxResults?: number;
}): Promise<{ places: PlaceSummary[]; error?: PlacesError }> {
  if (!googleConfigured()) {
    return { places: [], error: { code: 'not-configured', message: 'GOOGLE_MAPS_API_KEY is not configured.' } };
  }
  try {
    const res = await timedFetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY as string,
        'X-Goog-FieldMask': SEARCH_MASK,
      },
      body: JSON.stringify({
        textQuery: args.query,
        locationBias: { circle: { center: { latitude: args.lat, longitude: args.lng }, radius: args.radiusM } },
        maxResultCount: Math.min(20, Math.max(1, args.maxResults ?? 20)),
        rankPreference: 'DISTANCE',
      }),
    });
    if (!res.ok) return { places: [], error: mapHttpError(res.status) };
    const data = (await res.json()) as { places?: Parameters<typeof toSummary>[0][] };
    return { places: (data.places ?? []).map(toSummary) };
  } catch (err) {
    return { places: [], error: { code: 'http', message: err instanceof Error ? err.message : 'Places search failed.' } };
  }
}

export interface PlaceDetails extends PlaceSummary {
  phone: string | null;
  website: string | null;
}

/** Details by place id. Missing phone/website → null (never invented). */
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails & { error?: PlacesError }> {
  if (!googleConfigured()) {
    return {
      placeId, name: null, address: null, lat: null, lng: null, businessStatus: null,
      types: [], primaryType: null, mapsUri: null, phone: null, website: null,
      error: { code: 'not-configured', message: 'GOOGLE_MAPS_API_KEY is not configured.' },
    };
  }
  const id = placeId.replace(/^places\//, '');
  try {
    const res = await timedFetch(`${DETAILS_URL}${encodeURIComponent(id)}`, {
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY as string,
        'X-Goog-FieldMask': DETAILS_MASK,
      },
    });
    if (!res.ok) {
      const e = mapHttpError(res.status);
      return {
        placeId, name: null, address: null, lat: null, lng: null, businessStatus: null,
        types: [], primaryType: null, mapsUri: null, phone: null, website: null, error: e,
      };
    }
    const p = (await res.json()) as {
      nationalPhoneNumber?: string; internationalPhoneNumber?: string; websiteUri?: string;
    } & Parameters<typeof toSummary>[0];
    const base = toSummary(p);
    return {
      ...base,
      phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
    };
  } catch (err) {
    return {
      placeId, name: null, address: null, lat: null, lng: null, businessStatus: null,
      types: [], primaryType: null, mapsUri: null, phone: null, website: null,
      error: { code: 'http', message: err instanceof Error ? err.message : 'Place details failed.' },
    };
  }
}

/** Address → coordinates. Null on zero results or failure (never guessed). */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; formatted: string } | null> {
  if (!googleConfigured()) return null;
  try {
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY as string)}`;
    const res = await timedFetch(url, {}, 12000);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }[];
    };
    if (data.status !== 'OK' || !data.results || data.results.length === 0) return null;
    const first = data.results[0];
    const lat = first.geometry?.location?.lat;
    const lng = first.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng, formatted: first.formatted_address ?? address };
  } catch {
    return null;
  }
}

export default { googleConfigured, searchTextPlaces, fetchPlaceDetails, geocodeAddress };
