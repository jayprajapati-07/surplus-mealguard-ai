// NGO discovery math — deterministic, fully inspectable, no external calls.
// Layers: keyword relevance (deterministic) → optional Gemini classification
// (validated enums only) → transparent ranking. Nothing here invents facts:
// unknown stays unknown, and confirmation requires admin evidence.

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(a));
  return Math.round(d * 1000) / 1000;
}

const HIGH_KEYWORDS = [
  'food bank', 'foodbank', 'food rescue', 'food donation', 'food distribution',
  'community kitchen', 'community fridge', 'langar', 'annakshetra', 'food charity',
  'hunger', 'meals on wheels', 'ration',
];
const LIKELY_KEYWORDS = [
  'charity', 'charit', 'foundation', 'trust', 'ngo', 'nonprofit', 'non-profit',
  'seva', 'shelter', 'mission', 'welfare', 'relief', 'community', 'orphan',
  'old age', 'ashram', 'gurudwara', 'temple kitchen',
];

export type Relevance = 'high' | 'likely' | 'unknown';

/** Deterministic keyword relevance over the real name + Google types. */
export function keywordRelevance(name: string, types: string[]): { level: Relevance; reason: string } {
  const hay = `${name} ${(types ?? []).join(' ')}`.toLowerCase();
  const hitHigh = HIGH_KEYWORDS.find((k) => hay.includes(k));
  if (hitHigh) return { level: 'high', reason: `Name/types match food-redistribution keyword "${hitHigh}".` };
  const hitLikely = LIKELY_KEYWORDS.find((k) => hay.includes(k));
  if (hitLikely) return { level: 'likely', reason: `Name/types match charitable keyword "${hitLikely}" — food role unconfirmed.` };
  return { level: 'unknown', reason: 'No food-redistribution keywords in name or types.' };
}

export type Acceptance = 'confirmed' | 'likely' | 'unknown' | 'does_not_accept';

/**
 * Heuristic acceptance from Google types ONLY. 'confirmed' is never returned
 * here — confirmation requires admin evidence (route layer enforces this).
 */
export function inferAcceptance(types: string[]): 'likely' | 'unknown' {
  const t = (types ?? []).map((x) => x.toLowerCase());
  if (t.includes('food_bank')) return 'likely';
  return 'unknown';
}

/** Display candidate? Closed places and food refusers are excluded. */
export function isCandidate(args: { businessStatus: string | null; acceptance: Acceptance }): boolean {
  if (args.businessStatus === 'CLOSED_PERMANENTLY') return false;
  if (args.acceptance === 'does_not_accept') return false;
  return true;
}

export interface RankInput {
  distanceKm: number | null;
  maxRadiusKm: number;
  relevance: Relevance;
  verificationStatus: string;
  acceptance: Acceptance;
  businessStatus: string | null;
}

export interface RankOutput {
  total: number;
  parts: { distance: number; relevance: number; verification: number; acceptance: number };
}

/**
 * Transparent ranking (max 100), documented formula:
 * distance 40 linear (0 beyond radius) + relevance 30/15/5 +
 * verification 20 (admin/darpan) or 10 (website) + acceptance 10/5/0.
 */
export function rankScore(i: RankInput): RankOutput {
  const distance =
    i.distanceKm === null ? 0 : Math.round(40 * Math.max(0, 1 - i.distanceKm / Math.max(1, i.maxRadiusKm)));
  const relevance = i.relevance === 'high' ? 30 : i.relevance === 'likely' ? 15 : 5;
  const verification =
    i.verificationStatus === 'admin_verified' || i.verificationStatus === 'darpan_verified'
      ? 20
      : i.verificationStatus === 'website_verified'
        ? 10
        : 0;
  const acceptance = i.acceptance === 'confirmed' ? 10 : i.acceptance === 'likely' ? 5 : 0;
  return { total: distance + relevance + verification + acceptance, parts: { distance, relevance, verification, acceptance } };
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK_SUFFIXES = ['example.com', 'example.org', 'example.net', '.local', '.invalid', '.test'];
const JUNK_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'postmaster', 'mailer-daemon'];

/** Extract candidate contact emails from homepage HTML. Junk and fakes excluded. */
export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();
  const mailtos = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi) ?? [];
  for (const m of mailtos) {
    const e = m.slice('mailto:'.length).split('?')[0].toLowerCase();
    found.add(e);
  }
  for (const m of html.match(EMAIL_RE) ?? []) found.add(m.toLowerCase());
  return [...found].filter((e) => {
    if (JUNK_SUFFIXES.some((s) => e.endsWith(s))) return false;
    if (JUNK_PREFIXES.some((p) => e.startsWith(p + '@'))) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  });
}

/** First record per place id wins (stable across repeated searches). */
export function dedupeByPlaceId<T extends { placeId: string }>(places: T[]): T[] {
  const seen = new Map<string, T>();
  for (const p of places) {
    if (!seen.has(p.placeId)) seen.set(p.placeId, p);
  }
  return [...seen.values()];
}

/** Extract callable phone numbers: tel: links plus international-format digit runs. */
export function extractPhonesFromHtml(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.match(/tel:([+\d][\d\s\-().]{6,20})/gi) ?? []) {
    found.add(m.slice('tel:'.length).trim());
  }
  const digits = (s: string) => s.replace(/\D/g, '');
  for (const m of html.match(/(?:\+?\d[\d\s\-().]{8,}\d)/g) ?? []) {
    const d = digits(m);
    // Plausible phone: 10-13 digits, not a year or small counter.
    if (d.length >= 10 && d.length <= 13 && !(d.length === 10 && d.startsWith('19')) && !(d.length === 10 && d.startsWith('20'))) {
      found.add(d.length === 10 ? `+91${d}` : m.startsWith('+') ? `+${d}` : d);
    }
  }
  return [...found].slice(0, 5);
}

const EXCLUDED_KEYWORDS = [
  'hospital', 'nursing home', 'clinic', 'doctor', 'dental', 'pharmacy',
  'school', 'college', 'university', 'tuition', 'coaching',
  'bank', 'atm', 'insurance',
  'restaurant', 'hotel', 'cafe', 'cafeteria', 'canteen', 'dhaba', 'eatery',
  'petrol', 'fuel', 'parking', 'car wash', 'salon', 'gym',
];
const OVERRIDE_KEYWORDS = ['food bank', 'foodbank', 'food rescue', 'langar', 'community kitchen', 'food donation', 'charity kitchen', 'seva kitchen'];

/** Exclude clearly non-NGO businesses unless strong food-charity signals exist. */
export function isExcludedPlace(name: string, types: string[]): boolean {
  const hay = `${name} ${(types ?? []).join(' ')}`.toLowerCase();
  if (OVERRIDE_KEYWORDS.some((k) => hay.includes(k))) return false;
  return EXCLUDED_KEYWORDS.some((k) => hay.includes(k));
}

export interface NearbyPlace {
  placeId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

const normName = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Merge same-name places within range, filling missing contacts from dupes.
 * Distinct names (e.g. "Nirant" vs "Nirant 2") are never merged.
 */
export function dedupeNearbyByName<T extends NearbyPlace>(places: T[], maxMeters = 300): T[] {
  const out: T[] = [];
  for (const p of places) {
    const hit = out.find((q) =>
      normName(q.name) === normName(p.name) &&
      q.lat !== null && q.lng !== null && p.lat !== null && p.lng !== null &&
      haversineKm(q.lat, q.lng, p.lat, p.lng) * 1000 <= maxMeters
    );
    if (!hit) {
      out.push(p);
      continue;
    }
    if (!hit.phone && p.phone) hit.phone = p.phone;
    if (!hit.email && p.email) hit.email = p.email;
    if (!hit.website && p.website) hit.website = p.website;
  }
  return out;
}

export interface WebsiteContacts {
  reachable: boolean;
  emails: string[];
  phones: string[];
  hasFoodEvidence: boolean;
}

const FOOD_EVIDENCE = [
  'food donation', 'donate food', 'food bank', 'food rescue', 'redistribut',
  'community kitchen', 'langar', 'free meal', 'free food', 'hunger', 'ration kit',
];

/**
 * Single homepage GET (8s, 200KB cap) for contact discovery and food-role
 * evidence. No crawling, no aggressive scraping. Unreachable → empty result.
 */
export async function fetchWebsiteContacts(website: string): Promise<WebsiteContacts> {
  const none: WebsiteContacts = { reachable: false, emails: [], phones: [], hasFoodEvidence: false };
  let url: string;
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return none;
    url = u.toString();
  } catch {
    return none;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'MealGuardBot/1.0 (+contact discovery)', Accept: 'text/html' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return none;
    if (!String(res.headers.get('content-type') ?? '').includes('text/html')) return none;
    const text = (await res.text()).slice(0, 200000);
    const lower = text.toLowerCase();
    return {
      reachable: true,
      emails: extractEmailsFromHtml(text).slice(0, 5),
      phones: extractPhonesFromHtml(text),
      hasFoodEvidence: FOOD_EVIDENCE.some((k) => lower.includes(k)),
    };
  } catch {
    return none;
  }
}

async function fetchPage(url: string, ms: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'MealGuardBot/1.0 (+contact discovery)', Accept: 'text/html' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    if (!String(res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return (await res.text()).slice(0, 150000);
  } catch {
    return null;
  }
}

/**
 * Contact discovery across homepage + contact pages (max 3 polite GETs, 5s
 * each). Stops early once an email is found. Returns only real extracted data.
 */
export async function fetchContactDetails(website: string): Promise<WebsiteContacts> {
  const none: WebsiteContacts = { reachable: false, emails: [], phones: [], hasFoodEvidence: false };
  let base: string;
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return none;
    base = `${u.protocol}//${u.host}`;
  } catch {
    return none;
  }
  const emails = new Set<string>();
  const phones = new Set<string>();
  let reachable = false;
  let hasFoodEvidence = false;
  const paths = ['', '/contact', '/contact-us'];
  for (const path of paths) {
    const html = await fetchPage(`${base}${path}`, 5000);
    if (html === null) continue;
    reachable = true;
    for (const e of extractEmailsFromHtml(html)) emails.add(e);
    for (const p of extractPhonesFromHtml(html)) phones.add(p);
    if (FOOD_EVIDENCE.some((k) => html.toLowerCase().includes(k))) hasFoodEvidence = true;
    if (emails.size > 0) break;
    if (paths.indexOf(path) >= 2) break;
  }
  return {
    reachable,
    emails: [...emails].slice(0, 5),
    phones: [...phones].slice(0, 5),
    hasFoodEvidence,
  };
}

export interface RelevanceVerdict {
  relevance: 'high' | 'likely' | 'unknown';
  reason: string;
  foodRelated: boolean;
}

/**
 * Optional Gemini second opinion over REAL place facts. Strict enum
 * validation: anything off-spec (or any failure) becomes 'unknown'.
 * Never converts unknown into true; never creates facts.
 */
export async function classifyRelevance(place: {
  name: string; address: string | null; types: string[]; website: string | null;
}): Promise<RelevanceVerdict> {
  const unknown: RelevanceVerdict = { relevance: 'unknown', reason: 'Insufficient information for classification.', foodRelated: false };
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.trim()) return unknown;
  try {
    const prompt =
      'Classify this real organization for surplus food redistribution relevance. ' +
      'Return ONLY JSON: {"relevance": "high"|"likely"|"unknown", "reason": "short", "food_related": true|false}. ' +
      'Use "unknown" unless the name or website clearly indicates food work. Never invent facts.\n' +
      `Name: ${place.name}\nAddress: ${place.address ?? '—'}\nTypes: ${place.types.join(', ') || '—'}\nWebsite: ${place.website ?? '—'}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
          }),
          signal: ctrl.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return unknown;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: { relevance?: string; reason?: string; food_related?: boolean };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return unknown;
      try {
        parsed = JSON.parse(m[0]) as typeof parsed;
      } catch {
        return unknown;
      }
    }
    if (parsed.relevance !== 'high' && parsed.relevance !== 'likely' && parsed.relevance !== 'unknown') return unknown;
    if (typeof parsed.food_related !== 'boolean') return unknown;
    return {
      relevance: parsed.relevance,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : 'Classified without a reason.',
      foodRelated: parsed.food_related,
    };
  } catch {
    return unknown;
  }
}

export default {
  haversineKm, keywordRelevance, inferAcceptance, isCandidate, isExcludedPlace,
  rankScore, extractEmailsFromHtml, extractPhonesFromHtml, dedupeByPlaceId, dedupeNearbyByName,
  fetchWebsiteContacts, fetchContactDetails, classifyRelevance,
};
