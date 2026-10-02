import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { geocodeHotelAddress, searchOverpassCharities } from '../lib/open-geo';
import {
  haversineKm, keywordRelevance, inferAcceptance, isCandidate, rankScore,
  fetchWebsiteContacts, classifyRelevance,
  type Relevance,
} from '../lib/ngo-discovery';

const router = Router();
router.use(requireAuth);

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;
const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;

const SAVE_CAP = 50;
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

/** Hotel coordinates: stored first, resolved via keyless Nominatim only when missing. */
async function hotelCoords(orgId: string): Promise<{ lat: number; lng: number; geocoded: boolean; error?: string }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return { lat: 0, lng: 0, geocoded: false, error: 'Organization not found.' };
  if (typeof org.latitude === 'number' && typeof org.longitude === 'number') {
    return { lat: org.latitude, lng: org.longitude, geocoded: false };
  }
  const g = await geocodeHotelAddress({ address: org.address, city: org.city, state: org.state, country: org.country });
  if (!g) {
    return { lat: 0, lng: 0, geocoded: false, error: `Could not locate the hotel address ("${[org.address, org.city, org.state, org.country].filter(Boolean).join(', ')}"). Update the address or enter coordinates manually in Organization settings.` };
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

// POST /api/discovery/search — live OpenStreetMap charity discovery around the hotel.
// Keyless: Nominatim + Overpass. Every field stored comes from mapped data,
// official websites, or admin verification — nothing invented.
router.post('/search', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ radiusKm: z.coerce.number().min(1).max(MAX_RADIUS_KM).optional().default(10) });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const coords = await hotelCoords(orgId);
  if (coords.error) return res.status(400).json({ error: coords.error });

  const radii = [parsed.data.radiusKm, parsed.data.radiusKm * 2, parsed.data.radiusKm * 4]
    .filter((r, i, a) => r <= MAX_RADIUS_KM && a.indexOf(r) === i);
  let searched = 0;
  let radiusUsedKm = radii[0];
  let collected = dedupePlaces([] as Awaited<ReturnType<typeof searchOverpassCharities>>['places']);
  let lastError: string | null = null;
  for (const rKm of radii) {
    const out = await searchOverpassCharities({ lat: coords.lat, lng: coords.lng, radiusM: Math.round(rKm * 1000) });
    searched++;
    if (out.error) {
      lastError = out.error.message;
      continue;
    }
    lastError = null;
    collected = dedupePlaces([...collected, ...out.places]);
    radiusUsedKm = rKm;
    const promising = collected.filter((p) => keywordRelevance(p.name, p.types).level !== 'unknown');
    if (promising.length >= 5 || collected.length >= 20) break;
  }
  if (collected.length === 0) {
    return res.status(502).json({
      error: lastError ?? 'No verified food-distribution organizations were found near this location.',
      searched, radiusUsedKm,
    });
  }
  // Keyword priority first so website checks go to the most promising places.
  const prioritized = collected
    .map((p) => ({ p, rel: keywordRelevance(p.name, p.types) }))
    .sort((a, b) => {
      const order = { high: 0, likely: 1, unknown: 2 } as const;
      return order[a.rel.level] - order[b.rel.level];
    })
    .slice(0, SAVE_CAP);

  let saved = 0;
  const rows: DiscoveredRow[] = [];
  const notes: string[] = [];
  for (const { p, rel } of prioritized) {
    const distanceKm = p.lat !== null && p.lng !== null
      ? haversineKm(coords.lat, coords.lng, p.lat, p.lng)
      : null;
    let relevance = rel.level;
    let relevanceReason = rel.reason;
    if (relevance === 'unknown') {
      const cls = await classifyRelevance({ name: p.name, address: p.address, types: p.types, website: p.website });
      if (cls.relevance !== 'unknown') {
        relevance = cls.relevance;
        relevanceReason = `Classification: ${cls.reason}`;
      }
    }
    const acceptance = inferAcceptance(p.types);
    if (!isCandidate({ businessStatus: null, acceptance })) continue;

    // Email: mapped OSM contact first, else official website, else none.
    let email = p.email;
    let emailSource = p.email ? 'openstreetmap' : null;
    let websiteReachable = false;
    let websiteFoodEvidence = false;
    if (!email && p.website) {
      const wc = await fetchWebsiteContacts(p.website);
      websiteReachable = wc.reachable;
      websiteFoodEvidence = wc.hasFoodEvidence;
      if (wc.emails.length > 0) {
        email = wc.emails[0];
        emailSource = 'website';
      }
    } else if (p.website) {
      const wc = await fetchWebsiteContacts(p.website);
      websiteReachable = wc.reachable;
      websiteFoodEvidence = wc.hasFoodEvidence;
    }
    const verificationStatus = websiteReachable && (email !== null || websiteFoodEvidence)
      ? 'website_verified'
      : relevance === 'unknown'
        ? 'verification_pending'
        : 'unverified';
    const externalId = `osm:${p.osmId}`;
    const mapsUri = p.lat !== null && p.lng !== null
      ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`
      : null;

    const existing = await prisma.ngoOrganization.findUnique({ where: { externalPlaceId: externalId } });
    const keepAdmin = existing && (existing.verificationStatus === 'admin_verified' || existing.verificationStatus === 'darpan_verified');
    const keepAcceptance = existing && (existing.foodAcceptanceStatus === 'confirmed' || existing.foodAcceptanceStatus === 'does_not_accept');
    const keepEmail = existing && existing.emailVerified && existing.contactEmail;
    const data = {
      name: p.name,
      address: p.address,
      city: null as string | null,
      latitude: p.lat,
      longitude: p.lng,
      contactPhone: p.phone,
      website: p.website,
      contactEmail: keepEmail ? existing.contactEmail : email,
      emailSource: keepEmail ? existing.emailSource : email ? emailSource : null,
      emailVerified: keepEmail ? true : false,
      emailLastChecked: email || keepEmail ? new Date() : null,
      mapsUri,
      operationalStatus: 'OPERATIONAL',
      placeTypes: JSON.stringify(p.types),
      verificationStatus: keepAdmin ? existing.verificationStatus : verificationStatus,
      verificationSource: keepAdmin ? existing.verificationSource : verificationStatus === 'website_verified' ? 'official_website' : null,
      foodAcceptanceStatus: keepAcceptance ? existing.foodAcceptanceStatus : acceptance,
      acceptsCookedFood: keepAcceptance ? existing.acceptsCookedFood : null,
      acceptsPreparedFood: keepAcceptance ? existing.acceptsPreparedFood : null,
      acceptsPackagedFood: keepAcceptance ? existing.acceptsPackagedFood : null,
      acceptedCategories: JSON.stringify(p.types.slice(0, 10)),
      distanceKm,
      relevance,
      relevanceReason: websiteFoodEvidence && !relevanceReason.includes('website')
        ? `${relevanceReason} Official website mentions food-donation work.`
        : relevanceReason,
      source: 'openstreetmap',
      lastCheckedAt: new Date(),
      isActive: true,
    };
    try {
      if (existing) {
        await prisma.ngoOrganization.update({ where: { externalPlaceId: externalId }, data });
      } else {
        try {
          await prisma.ngoOrganization.create({ data: { ...data, externalPlaceId: externalId } });
        } catch (e) {
          // Name collision with a manually added row: merge into it.
          if (e instanceof Error && e.message.includes('Unique constraint')) {
            const byName = await prisma.ngoOrganization.findUnique({ where: { name: data.name } });
            if (byName) await prisma.ngoOrganization.update({ where: { id: byName.id }, data: { ...data, externalPlaceId: externalId } });
            else throw e;
          } else throw e;
        }
      }
      saved++;
    } catch (e) {
      notes.push(`${data.name}: ${e instanceof Error ? e.message : 'save failed'}`);
      continue;
    }
    const rank = rankScore({
      distanceKm, maxRadiusKm: radiusUsedKm, relevance,
      verificationStatus: keepAdmin ? (existing?.verificationStatus ?? verificationStatus) : verificationStatus,
      acceptance: keepAcceptance ? (existing?.foodAcceptanceStatus as 'confirmed' | 'does_not_accept') : acceptance,
      businessStatus: 'OPERATIONAL',
    });
    rows.push({
      placeId: externalId, name: data.name, distanceKm, relevance,
      verificationStatus: (keepAdmin ? existing?.verificationStatus : verificationStatus) ?? verificationStatus,
      acceptance: (keepAcceptance ? existing?.foodAcceptanceStatus : acceptance) ?? acceptance,
      rank: rank.total,
    });
  }
  rows.sort((a, b) => b.rank - a.rank);
  await audit('discovery.search', {
    userId: req.userId, organizationId: orgId, entityType: 'NgoOrganization', entityId: orgId,
    metadata: { provider: 'openstreetmap', radiusUsedKm, searched, saved, geocoded: coords.geocoded },
  });
  return res.json({
    message: rows.length > 0 ? `Found ${rows.length} organizations.` : 'No verified food-distribution organizations were found near this location.',
    searched, radiusUsedKm, saved,
    geocodedHotel: coords.geocoded,
    errors: notes.slice(0, 10),
    places: rows,
  });
});

// GET /api/discovery/status — backend-verified discovery health for the dashboard.
router.get('/status', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  const last = await prisma.ngoOrganization.findFirst({
    where: { source: 'openstreetmap' },
    orderBy: { lastCheckedAt: 'desc' },
  });
  const count = await prisma.ngoOrganization.count({ where: { source: 'openstreetmap' } });
  return res.json({
    provider: 'openstreetmap',
    keyRequired: false,
    hotelCoordsPresent: typeof org?.latitude === 'number' && typeof org?.longitude === 'number',
    hotelCoords: org && typeof org.latitude === 'number' && typeof org.longitude === 'number'
      ? { lat: org.latitude, lng: org.longitude }
      : null,
    lastSearchAt: last?.lastCheckedAt ?? null,
    discoveredCount: count,
  });
});

function dedupePlaces<T extends { osmId: string }>(places: T[]): T[] {
  const seen = new Map<string, T>();
  for (const p of places) {
    if (!seen.has(p.osmId)) seen.set(p.osmId, p);
  }
  return [...seen.values()];
}

export default router;
