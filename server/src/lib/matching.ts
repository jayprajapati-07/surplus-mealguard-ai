// Deterministic NGO matching — pure functions over recorded text only.
// No maps, no distance math, no external calls. Every point is explained
// in reasons[]. Wording rule: always "suitable registered NGO".

export interface MatchReason {
  criterion: string;
  points: number;
  detail: string;
}

export interface MatchResult {
  eligible: boolean;
  score: number;
  reasons: MatchReason[];
}

export interface NgoProfile {
  isActive: boolean;
  city: string | null;
  address: string | null;
  acceptedCategories: string | null;
  pickupCapable: boolean;
  operatingHours: string | null;
  capacityKg: number | null;
}

export interface AssessmentNeed {
  quantityKg: number;
  foodCategory: string;
  availableUntil: string;
}

export interface InstitutionProfile {
  city: string;
  address: string;
  operatingHours: string;
}

const norm = (s: string) => s.toLowerCase().trim();

function parseCategories(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.map((x) => norm(String(x))).filter(Boolean);
  } catch {
    return raw.split(',').map(norm).filter(Boolean);
  }
  return [];
}

function extractRanges(text: string): { start: number; end: number }[] {
  // Finds HH:MM-HH:MM pairs (hyphen, en-dash U+2013, or "to"), with optional
  // am/pm markers (e.g. "8:00am - 8:00pm"). Unparseable text yields [].
  const out: { start: number; end: number }[] = [];
  const SEP = '(?:-|–|to)';
  const re = new RegExp('(\\d{1,2}):(\\d{2})\\s*([ap]m)?\\s*' + SEP + '\\s*(\\d{1,2}):(\\d{2})\\s*([ap]m)?', 'gi');
  const toMin = (h: string, mi: string, ap: string | undefined) => {
    // Deterministic rule: bare numbers are 24-hour clock; a marker applies
    // only to the number it follows (12am -> 0, 12pm -> 12).
    let hh = Number(h);
    if (ap) {
      hh = hh % 12;
      if (ap.toLowerCase() === 'pm') hh += 12;
    }
    return hh * 60 + Number(mi);
  };
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 10) {
    const s = toMin(m[1], m[2], m[3]);
    const e = toMin(m[4], m[5], m[6]);
    if (s >= 0 && s < 1440 && e > 0 && e <= 1440 && e > s) out.push({ start: s, end: e });
  }
  return out;
}

function rangesOverlap(a: { start: number; end: number }[], b: { start: number; end: number }[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end));
}

export function scoreNgoMatch(args: {
  ngo: NgoProfile;
  assessment: AssessmentNeed;
  institution: InstitutionProfile;
}): MatchResult {
  const { ngo, assessment, institution } = args;
  if (!ngo.isActive) {
    return { eligible: false, score: 0, reasons: [{ criterion: 'active', points: 0, detail: 'NGO is inactive.' }] };
  }
  const reasons: MatchReason[] = [];
  let score = 0;

  // 1. Service-area match (20): same city (either direction contains), else
  // address-text overlap. Pure recorded-text comparison, no geography.
  const ngoCity = norm(ngo.city ?? '');
  const instCity = norm(institution.city);
  const ngoAddr = norm(ngo.address ?? '');
  const instAddr = norm(institution.address);
  if (ngoCity && instCity && (ngoCity === instCity || ngoCity.includes(instCity) || instCity.includes(ngoCity))) {
    score += 20;
    reasons.push({ criterion: 'area', points: 20, detail: `Same service city ("${ngo.city ?? '—'}").` });
  } else if (
    (ngoAddr && instAddr && (ngoAddr.includes(instAddr) || instAddr.includes(ngoAddr))) ||
    (ngoAddr && instCity && ngoAddr.includes(instCity)) ||
    (instAddr && ngoCity && instAddr.includes(ngoCity))
  ) {
    score += 20;
    reasons.push({ criterion: 'area', points: 20, detail: `Service-area text overlaps ("${ngo.city ?? '—'}" vs "${institution.city}").` });
  } else {
    reasons.push({ criterion: 'area', points: 0, detail: `No service-area text overlap ("${ngo.city ?? '—'}" vs "${institution.city}").` });
  }

  // 2. Accepted food category (20).
  const cats = parseCategories(ngo.acceptedCategories);
  const want = norm(assessment.foodCategory);
  if (cats.includes('any') || cats.includes('all') || cats.includes(want)) {
    score += 20;
    reasons.push({ criterion: 'category', points: 20, detail: `Accepts "${assessment.foodCategory}" (registered: ${cats.join(', ') || '—'}).` });
  } else {
    reasons.push({ criterion: 'category', points: 0, detail: `Does not list "${assessment.foodCategory}" (registered: ${cats.join(', ') || 'none'}).` });
  }

  // 3. Pickup capability (20).
  if (ngo.pickupCapable) {
    score += 20;
    reasons.push({ criterion: 'pickup', points: 20, detail: 'Pickup capability recorded.' });
  } else {
    reasons.push({ criterion: 'pickup', points: 0, detail: 'No pickup capability recorded.' });
  }

  // 4. Operating-hours overlap (20, neutral when not comparable).
  const nr = extractRanges(ngo.operatingHours ?? '');
  const ir = extractRanges(institution.operatingHours);
  if (nr.length === 0 || ir.length === 0) {
    reasons.push({ criterion: 'hours', points: 0, detail: 'Hours not comparable from recorded text — treated as neutral, no points.' });
  } else if (rangesOverlap(nr, ir)) {
    score += 20;
    reasons.push({ criterion: 'hours', points: 20, detail: `Operating hours overlap ("${ngo.operatingHours}" vs "${institution.operatingHours}").` });
  } else {
    reasons.push({ criterion: 'hours', points: 0, detail: `Operating hours do not overlap ("${ngo.operatingHours}" vs "${institution.operatingHours}").` });
  }

  // 5. Available capacity (20, neutral when unstated).
  if (ngo.capacityKg === null || ngo.capacityKg === undefined) {
    score += 20;
    reasons.push({ criterion: 'capacity', points: 20, detail: 'No capacity stated — treated as neutral, full points.' });
  } else if (ngo.capacityKg >= assessment.quantityKg) {
    score += 20;
    reasons.push({ criterion: 'capacity', points: 20, detail: `Capacity ${ngo.capacityKg} kg covers ${assessment.quantityKg} kg.` });
  } else {
    reasons.push({ criterion: 'capacity', points: 0, detail: `Capacity ${ngo.capacityKg} kg below needed ${assessment.quantityKg} kg.` });
  }

  return { eligible: true, score, reasons };
}
