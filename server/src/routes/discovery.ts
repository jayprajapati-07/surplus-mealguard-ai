import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { googleConfigured, searchTextPlaces, fetchPlaceDetails, geocodeAddressVerbose } from '../lib/google-places';
import {
  haversineKm, keywordRelevance, inferAcceptance, isCandidate, rankScore,
  dedupeByPlaceId, fetchWebsiteContacts, classifyRelevance,
  type Relevance,
} from '../lib/ngo-discovery';

const router = Router();
router.use(requireAuth);

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;
const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;

const SEARCH_QUERIES = [
  'food bank', 'food donation', 'food rescue', 'food distribution', 'food charity',
  'community food service', 'charity', 'NGO', 'non-profit organization',
  'shelter', 'homeless shelter', 'community kitchen',
];
const DETAILS_CAP = 20;
const MAX_RADIUS_KM = 50;

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the request.', details: err.errors });
}

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

/** Hotel coordinates: stored first, geocoded from the real address only when missing. */
async function hotelCoords(orgId: string): Promise<{ lat: number; lng: number; geocoded: boolean; error?: string }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return { lat: 0, lng: 0, geocoded: false, error: 'Organization not found.' };
  if (typeof org.latitude === 'number' && typeof org.longitude === 'number') {
    return { lat: org.latitude, lng: org.longitude, geocoded: false };
  }
  const address = [org.address, org.city, org.state, org.country].filter(Boolean).join(', ');
  const g = await geocodeAddressVerbose(address);
  if (!g.ok) {
    const hint = g.failure.code === 'zero-results'
      ? `Could not geocode the hotel address ("${address}"). Update the address or enter coordinates manually.`
      : `Could not geocode the hotel address: ${g.failure.message}`;
    return { lat: 0, lng: 0, geocoded: false, error: hint };
  }
  await prisma.organization.update({ where: { id: orgId }, data: { latitude: g.lat, longitude: g.lng } });
  return { lat: g.lat, lng: g.lng, geocoded: true };
}

interface DiscoveredRow {
  placeId: string;
  name: string;
  distanceKm: number | null;
  relevance: Relevance;
  verificationStatus: string;
  acceptance: string;
  rank: number;
}

// POST /api/discovery/search — live Google Places discovery around the hotel.
router.post('/search', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ radiusKm: z.coerce.number().min(1).max(MAX_RADIUS_KM).optional().default(10) });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  if (!googleConfigured()) {
    return res.status(503).json({ error: 'Unable to retrieve nearby organizations right now: Google Places is not configured.' });
  }
  const coords = await hotelCoords(orgId);
  if (coords.error) return res.status(400).json({ error: coords.error });

  const radii = [parsed.data.radiusKm, parsed.data.radiusKm * 2, parsed.data.radiusKm * 4]
    .filter((r, i, a) => r <= MAX_RADIUS_KM && a.indexOf(r) === i);
  let searched = 0;
  let collected: Awaited<ReturnType<typeof searchTextPlaces>>['places'] = [];
  let radiusUsedKm = radii[0];
  let queryErrors: string[] = [];
  const raw: Awaited<ReturnType<typeof searchTextPlaces>>['places'] = [];
  for (const rKm of radii) {
    for (const q of SEARCH_QUERIES) {
      const out = await searchTextPlaces({ query: q, lat: coords.lat, lng: coords.lng, radiusM: Math.round(rKm * 1000) });
      searched++;
      if (out.error) {
        queryErrors.push(`${q}: ${out.error.message}`);
        if (out.error.code === 'quota' || out.error.code === 'forbidden') {
          return res.status(502).json({ error: out.error.message, searched });
        }
        continue;
      }
      raw.push(...out.places);
    }
    collected = dedupeByPlaceId(raw);
    radiusUsedKm = rKm;
    const promising = collected.filter((p) => {
      if (!isCandidate({ businessStatus: p.businessStatus, acceptance: 'unknown' })) return false;
      return keywordRelevance(p.name ?? '', p.types).level !== 'unknown';
    });
    if (promising.length >= 5) break;
  }
  const unique = dedupeByPlaceId(raw);
  // Rank keyword priority so Details quota goes to the most promising places.
  const prioritized = unique
    .map((p) => ({ p, rel: keywordRelevance(p.name ?? '', p.types) }))
    .sort((a, b) => {
      const order = { high: 0, likely: 1, unknown: 2 } as const;
      return order[a.rel.level] - order[b.rel.level];
    })
    .slice(0, DETAILS_CAP);

  let detailsFetched = 0;
  let saved = 0;
  const rows: DiscoveredRow[] = [];
  for (const { p, rel } of prioritized) {
    const details = await fetchPlaceDetails(p.placeId);
    if (details.error) {
      queryErrors.push(`${p.name ?? p.placeId}: ${details.error.message}`);
      continue;
    }
    detailsFetched++;
    const distanceKm = details.lat !== null && details.lng !== null
      ? haversineKm(coords.lat, coords.lng, details.lat, details.lng)
      : null;
    let relevance = rel.level;
    let relevanceReason = rel.reason;
    if (relevance === 'unknown') {
      const cls = await classifyRelevance({
        name: details.name ?? '', address: details.address, types: details.types, website: details.website,
      });
      if (cls.relevance !== 'unknown') {
        relevance = cls.relevance;
        relevanceReason = `Gemini classification: ${cls.reason}`;
      }
    }
    const acceptance = inferAcceptance(details.types);
    if (!isCandidate({ businessStatus: details.businessStatus, acceptance })) continue;

    let email: string | null = null;
    let websiteReachable = false;
    let websiteFoodEvidence = false;
    if (details.website) {
      const wc = await fetchWebsiteContacts(details.website);
      websiteReachable = wc.reachable;
      websiteFoodEvidence = wc.hasFoodEvidence;
      if (wc.emails.length > 0) email = wc.emails[0];
    }
    const verificationStatus = websiteReachable && (email !== null || websiteFoodEvidence)
      ? 'website_verified'
      : relevance === 'unknown'
        ? 'verification_pending'
        : 'unverified';

    const existing = await prisma.ngoOrganization.findUnique({ where: { googlePlaceId: p.placeId } });
    const keepAdmin = existing && (existing.verificationStatus === 'admin_verified' || existing.verificationStatus === 'darpan_verified');
    const keepAcceptance = existing && (existing.foodAcceptanceStatus === 'confirmed' || existing.foodAcceptanceStatus === 'does_not_accept');
    const keepEmail = existing && existing.emailVerified && existing.contactEmail;
    const data = {
      name: details.name ?? p.name ?? 'Unnamed organization',
      address: details.address,
      city: null as string | null,
      latitude: details.lat,
      longitude: details.lng,
      contactPhone: details.phone,
      website: details.website,
      contactEmail: keepEmail ? existing.contactEmail : email,
      emailSource: keepEmail ? existing.emailSource : email ? 'website' : null,
      emailVerified: keepEmail ? true : false,
      emailLastChecked: email || keepEmail ? new Date() : null,
      googleMapsUri: details.mapsUri,
      googleBusinessStatus: details.businessStatus,
      googleTypes: JSON.stringify(details.types),
      verificationStatus: keepAdmin ? existing.verificationStatus : verificationStatus,
      verificationSource: keepAdmin ? existing.verificationSource : verificationStatus === 'website_verified' ? 'official_website' : null,
      foodAcceptanceStatus: keepAcceptance ? existing.foodAcceptanceStatus : acceptance,
      acceptsCookedFood: keepAcceptance ? existing.acceptsCookedFood : null,
      acceptsPreparedFood: keepAcceptance ? existing.acceptsPreparedFood : null,
      acceptsPackagedFood: keepAcceptance ? existing.acceptsPackagedFood : null,
      acceptedCategories: JSON.stringify(details.types.slice(0, 10)),
      distanceKm,
      relevance,
      relevanceReason: websiteFoodEvidence && !relevanceReason.includes('website')
        ? `${relevanceReason} Official website mentions food-donation work.`
        : relevanceReason,
      source: 'google_places',
      lastCheckedAt: new Date(),
      isActive: details.businessStatus ? details.businessStatus !== 'CLOSED_PERMANENTLY' : true,
    };
    try {
      if (existing) {
        await prisma.ngoOrganization.update({ where: { googlePlaceId: p.placeId }, data });
      } else {
        try {
          await prisma.ngoOrganization.create({ data: { ...data, googlePlaceId: p.placeId } });
        } catch (e) {
          // Name collision with a manually added row: merge into it.
          if (e instanceof Error && e.message.includes('Unique constraint')) {
            const byName = await prisma.ngoOrganization.findUnique({ where: { name: data.name } });
            if (byName) await prisma.ngoOrganization.update({ where: { id: byName.id }, data: { ...data, googlePlaceId: p.placeId } });
            else throw e;
          } else throw e;
        }
      }
      saved++;
    } catch (e) {
      queryErrors.push(`${data.name}: ${e instanceof Error ? e.message : 'save failed'}`);
      continue;
    }
    const rank = rankScore({
      distanceKm, maxRadiusKm: radiusUsedKm, relevance,
      verificationStatus: keepAdmin ? (existing?.verificationStatus ?? verificationStatus) : verificationStatus,
      acceptance: keepAcceptance ? (existing?.foodAcceptanceStatus as 'confirmed' | 'does_not_accept') : acceptance,
      businessStatus: details.businessStatus,
    });
    rows.push({
      placeId: p.placeId, name: data.name, distanceKm, relevance,
      verificationStatus: (keepAdmin ? existing?.verificationStatus : verificationStatus) ?? verificationStatus,
      acceptance: (keepAcceptance ? existing?.foodAcceptanceStatus : acceptance) ?? acceptance,
      rank: rank.total,
    });
  }
  rows.sort((a, b) => b.rank - a.rank);
  await audit('discovery.search', {
    userId: req.userId, organizationId: orgId, entityType: 'NgoOrganization', entityId: orgId,
    metadata: { radiusUsedKm, searched, detailsFetched, saved, geocoded: coords.geocoded },
  });
  return res.json({
    message: rows.length > 0 ? `Found ${rows.length} organizations.` : 'No verified food-distribution organizations were found near this location.',
    searched, radiusUsedKm, detailsFetched, saved,
    geocodedHotel: coords.geocoded,
    errors: queryErrors.slice(0, 10),
    places: rows,
  });
});

// GET /api/discovery/status — backend-verified automation health for the dashboard.
router.get('/status', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  const last = await prisma.ngoOrganization.findFirst({
    where: { source: 'google_places' },
    orderBy: { lastCheckedAt: 'desc' },
  });
  const count = await prisma.ngoOrganization.count({ where: { source: 'google_places' } });
  return res.json({
    googleConfigured: googleConfigured(),
    hotelCoordsPresent: typeof org?.latitude === 'number' && typeof org?.longitude === 'number',
    hotelCoords: org && typeof org.latitude === 'number' && typeof org.longitude === 'number'
      ? { lat: org.latitude, lng: org.longitude }
      : null,
    lastSearchAt: last?.lastCheckedAt ?? null,
    discoveredCount: count,
  });
});

export default router;
