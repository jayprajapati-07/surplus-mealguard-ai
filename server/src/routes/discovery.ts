import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { geocodeHotelAddress, searchOverpassCharities, reverseGeocode } from '../lib/open-geo';
import {
  haversineKm, keywordRelevance, inferAcceptance, isCandidate, isExcludedPlace, rankScore,
  fetchContactDetails, classifyRelevance,
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

// POST /api/discovery/search — starts a background discovery job and returns
// immediately (202). The client polls GET /jobs/:id. Long searches can never
// time out a request again; progress streams through stage + counts.
router.post('/search', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ radiusKm: z.coerce.number().min(1).max(MAX_RADIUS_KM).optional().default(10) });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const job: DiscoveryJob = {
    id: `disc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    orgId, userId: req.userId,
    state: 'running', stage: 'Starting…',
    searched: 0, radiusUsedKm: parsed.data.radiusKm, enriched: 0, saved: 0,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  void runDiscoveryJob(job, parsed.data.radiusKm);
  return res.status(202).json({ jobId: job.id, message: 'Search started. Results stream in automatically.' });
});

// GET /api/discovery/jobs/:id — poll job progress (fast, never blocks).
router.get('/jobs/:id', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Search job not found or expired. Start a new search.' });
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId || me.organizationId !== job.orgId) {
    return res.status(404).json({ error: 'Search job not found or expired.' });
  }
  return res.json({ job });
});

interface DiscoveryJob {
  id: string;
  orgId: string;
  userId?: string;
  state: 'running' | 'done' | 'failed';
  stage: string;
  searched: number;
  radiusUsedKm: number;
  enriched: number;
  saved: number;
  result?: {
    message: string; searched: number; radiusUsedKm: number; saved: number;
    geocodedHotel: boolean; errors: string[];
    places: DiscoveredRow[];
  };
  error?: string;
  startedAt: string;
  updatedAt: string;
}

const jobs = new Map<string, DiscoveryJob>();
const jobCleaner = setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) {
    if (new Date(j.updatedAt).getTime() < cutoff) jobs.delete(id);
  }
}, 10 * 60 * 1000);
if (typeof (jobCleaner as unknown as { unref?: () => void }).unref === 'function') {
  (jobCleaner as unknown as { unref: () => void }).unref();
}

function touch(job: DiscoveryJob, patch: Partial<DiscoveryJob>): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(size, items.length)).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runDiscoveryJob(job: DiscoveryJob, radiusKm: number): Promise<void> {
  const orgId = job.orgId;
  try {
    touch(job, { stage: 'Locating your kitchen…' });
    const coords = await hotelCoords(orgId);
    if (coords.error) {
      touch(job, { state: 'failed', error: coords.error, stage: 'Failed' });
      return;
    }
    const radii = [radiusKm, radiusKm * 2, radiusKm * 4]
      .filter((r, i, a) => r <= MAX_RADIUS_KM && a.indexOf(r) === i);
    let searched = 0;
    let collected: Awaited<ReturnType<typeof searchOverpassCharities>>['places'] = [];
    let radiusUsedKm = radii[0];
    let lastError: string | null = null;
    for (const rKm of radii) {
      touch(job, { stage: `Searching mapped organizations within ${rKm} km…`, searched });
      const out = await searchOverpassCharities({ lat: coords.lat, lng: coords.lng, radiusM: Math.round(rKm * 1000) });
      searched++;
      touch(job, { searched, radiusUsedKm: rKm });
      if (out.error) {
        lastError = out.error.message;
        continue;
      }
      lastError = null;
      const seen = new Set(collected.map((p) => p.osmId));
      for (const p of out.places) {
        if (!seen.has(p.osmId)) {
          seen.add(p.osmId);
          collected.push(p);
        }
      }
      radiusUsedKm = rKm;
      const promising = collected.filter((p) =>
        !isExcludedPlace(p.name, p.types) && keywordRelevance(p.name, p.types).level !== 'unknown');
      if (promising.length >= 5 || collected.length >= 20) break;
    }
    if (collected.length === 0) {
      touch(job, {
        state: 'done', stage: 'Done',
        result: {
          message: lastError ?? 'No verified food-distribution organizations were found near this location.',
          searched, radiusUsedKm, saved: 0, geocodedHotel: coords.geocoded, errors: lastError ? [lastError] : [], places: [],
        },
      });
      return;
    }
    // Best-first so enrichment budget goes to the most promising places.
    const order = { high: 0, likely: 1, unknown: 2 } as const;
    const prioritized = collected
      .filter((p) => !isExcludedPlace(p.name, p.types))
      .map((p) => ({ p, rel: keywordRelevance(p.name, p.types) }))
      .sort((a, b) => order[a.rel.level] - order[b.rel.level])
      .slice(0, SAVE_CAP);

    touch(job, { stage: `Reading official websites for contact details (0/${prioritized.length})…` });
    let enriched = 0;
    const enrichedRows = await pool(prioritized, 4, async ({ p, rel }) => {
      let relevance = rel.level;
      let relevanceReason = rel.reason;
      if (relevance === 'unknown') {
        const cls = await classifyRelevance({ name: p.name, address: p.address, types: p.types, website: p.website });
        if (cls.relevance !== 'unknown') {
          relevance = cls.relevance;
          relevanceReason = `Classification: ${cls.reason}`;
        }
      }
      // Contact enrichment: mapped details first, then official website.
      let email = p.email;
      let emailSource = p.email ? 'openstreetmap' : null;
      let phone = p.phone;
      let phoneSource = p.phone ? 'openstreetmap' : null;
      let websiteReachable = false;
      let websiteFoodEvidence = false;
      if (p.website) {
        const wc = await fetchContactDetails(p.website);
        websiteReachable = wc.reachable;
        websiteFoodEvidence = wc.hasFoodEvidence;
        if (!email && wc.emails.length > 0) {
          email = wc.emails[0];
          emailSource = 'website';
        }
        if (!phone && wc.phones.length > 0) {
          phone = wc.phones[0];
          phoneSource = 'website';
        }
      }
      enriched++;
      touch(job, { enriched, stage: `Reading official websites for contact details (${enriched}/${prioritized.length})…` });
      return { p, relevance, relevanceReason, email, emailSource, phone, phoneSource, websiteReachable, websiteFoodEvidence };
    });

    // Fill missing street addresses via reverse-geocoding (polite: sequential).
    touch(job, { stage: 'Completing missing addresses…' });
    const needAddr = enrichedRows.filter((r) => !r.p.address).slice(0, 10);
    for (const r of needAddr) {
      if (r.p.lat !== null && r.p.lng !== null) {
        const addr = await reverseGeocode(r.p.lat, r.p.lng);
        if (addr) r.p.address = addr;
        await sleep(1100);
      }
    }

    touch(job, { stage: 'Saving verified results…' });
    let saved = 0;
    const rows: DiscoveredRow[] = [];
    const notes: string[] = [];
    for (const r of enrichedRows) {
      const { p } = r;
      const distanceKm = p.lat !== null && p.lng !== null
        ? haversineKm(coords.lat, coords.lng, p.lat, p.lng)
        : null;
      const acceptance = inferAcceptance(p.types);
      if (!isCandidate({ businessStatus: null, acceptance })) continue;
      const verificationStatus = r.websiteReachable && (r.email !== null || r.websiteFoodEvidence)
        ? 'website_verified'
        : r.relevance === 'unknown'
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
      // Never destroy a previously found contact when a refresh finds nothing.
      const finalEmail = keepEmail ? existing.contactEmail : (r.email ?? existing?.contactEmail ?? null);
      const finalEmailSource = keepEmail ? existing.emailSource : r.email ? r.emailSource : (existing?.contactEmail ? existing.emailSource : null);
      const finalPhone = p.phone ?? r.phone ?? existing?.contactPhone ?? null;
      const finalPhoneSource = p.phone ? 'openstreetmap' : r.phone ? 'website' : (existing?.contactPhone ? existing.phoneSource : null);
      const keepPhone = existing && existing.contactPhone && !p.phone && !r.phone;
      const data = {
        name: p.name,
        address: p.address,
        city: null as string | null,
        latitude: p.lat,
        longitude: p.lng,
        contactPhone: finalPhone,
        phoneSource: finalPhoneSource,
        website: p.website,
        contactEmail: finalEmail,
        emailSource: finalEmailSource,
        emailVerified: keepEmail ? true : false,
        emailLastChecked: finalEmail ? new Date() : (existing?.emailLastChecked ?? null),
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
        relevance: r.relevance,
        relevanceReason: r.websiteFoodEvidence && !r.relevanceReason.includes('website')
          ? `${r.relevanceReason} Official website mentions food-donation work.`
          : r.relevanceReason,
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
            if (e instanceof Error && e.message.includes('Unique constraint')) {
              const byName = await prisma.ngoOrganization.findUnique({ where: { name: data.name } });
              if (byName) await prisma.ngoOrganization.update({ where: { id: byName.id }, data: { ...data, externalPlaceId: externalId } });
              else throw e;
            } else throw e;
          }
        }
        saved++;
        touch(job, { saved });
      } catch (e) {
        notes.push(`${data.name}: ${e instanceof Error ? e.message : 'save failed'}`);
        continue;
      }
      const rank = rankScore({
        distanceKm, maxRadiusKm: radiusUsedKm, relevance: r.relevance,
        verificationStatus: keepAdmin ? (existing?.verificationStatus ?? verificationStatus) : verificationStatus,
        acceptance: keepAcceptance ? (existing?.foodAcceptanceStatus as 'confirmed' | 'does_not_accept') : acceptance,
        businessStatus: 'OPERATIONAL',
      });
      rows.push({
        placeId: externalId, name: data.name, distanceKm, relevance: r.relevance,
        verificationStatus: (keepAdmin ? existing?.verificationStatus : verificationStatus) ?? verificationStatus,
        acceptance: (keepAcceptance ? existing?.foodAcceptanceStatus : acceptance) ?? acceptance,
        rank: rank.total,
      });
    }
    rows.sort((a, b) => b.rank - a.rank);
    await audit('discovery.search', {
      userId: job.userId, organizationId: orgId, entityType: 'NgoOrganization', entityId: orgId,
      metadata: { provider: 'openstreetmap', radiusUsedKm, searched, saved, geocoded: coords.geocoded },
    });
    touch(job, {
      state: 'done', stage: 'Done',
      result: {
        message: rows.length > 0 ? `Found ${rows.length} organizations.` : 'No verified food-distribution organizations were found near this location.',
        searched, radiusUsedKm, saved, geocodedHotel: coords.geocoded, errors: notes.slice(0, 10), places: rows,
      },
    });
  } catch (err) {
    touch(job, { state: 'failed', stage: 'Failed', error: err instanceof Error ? err.message : 'Search failed. Please try again.' });
  }
}

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

export default router;
