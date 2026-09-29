// Shared deterministic helpers for Food Flow entry + CSV/XLSX import.
// No external AI, no hidden behavior: pure functions, fully inspectable.

export const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
export type Meal = (typeof MEALS)[number];

/** UTC-midnight day bucket used for duplicate detection. */
export function normalizeDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Coherence rule: produced must cover sold + waste + remaining unless an adjustment reason is given. */
export function coherenceError(
  produced: number,
  sold: number,
  waste: number,
  remaining: number,
  adjustmentReason?: string | null
): string | null {
  if (sold + waste + remaining <= produced + 1e-9) return null;
  if (adjustmentReason && adjustmentReason.trim().length >= 5) return null;
  return 'Produced must cover sold + waste + remaining (kg), or provide an adjustment reason (min 5 characters).';
}

/** Trim + collapse inner whitespace. Display casing is preserved. */
export function normalizeFoodName(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** Known quantity-unit → kg factors. Returns null when conversion is unknown (caller must flag). */
const UNIT_TO_KG: Record<string, number> = {
  kg: 1,
  kgs: 1,
  kilogram: 1,
  kilograms: 1,
  g: 0.001,
  gm: 0.001,
  gms: 0.001,
  gram: 0.001,
  grams: 0.001,
  quintal: 100,
  quintals: 100,
  tonne: 1000,
  tonnes: 1000,
  ton: 1000,
  tons: 1000,
  lb: 0.453592,
  lbs: 0.453592,
  pound: 0.453592,
  pounds: 0.453592,
  oz: 0.0283495,
  ounce: 0.0283495,
  ounces: 0.0283495,
};

export function unitToKg(unit: string): number | null {
  const key = unit.trim().toLowerCase();
  if (!key) return 1; // blank unit means kilograms
  return UNIT_TO_KG[key] ?? null;
}

/** Meal aliases → canonical enum. Null when unrecognized. */
export function normalizeMeal(v: string): Meal | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('break')) return 'BREAKFAST';
  if (s.includes('lunch')) return 'LUNCH';
  if (s.includes('dinner') || s.includes('supper')) return 'DINNER';
  const up = s.toUpperCase();
  if ((MEALS as readonly string[]).includes(up)) return up as Meal;
  return null;
}

/** Accept ISO dates, DD/MM/YYYY, DD-MM-YYYY, and Excel serial day numbers. Null when unparseable. */
export function parseDateCell(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Excel serial: days since 1899-12-30
    const base = Date.UTC(1899, 11, 30);
    const d = new Date(base + Math.round(v) * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  const iso = new Date(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(iso.getTime())) return iso;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, c] = m;
    let year = Number(c);
    if (c.length === 2) year += year >= 70 ? 1900 : 2000;
    // Assume DD/MM/YYYY (institutional locale); fall back to MM/DD if day invalid
    let day = Number(a);
    let month = Number(b);
    if (day > 31 || month > 12) return null;
    let d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCDate() !== day && day <= 12) {
      d = new Date(Date.UTC(year, Number(a) - 1, Number(b)));
    }
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export type ExpectedField =
  | 'date'
  | 'food'
  | 'target'
  | 'produced'
  | 'sold'
  | 'waste'
  | 'surplus'
  | 'meal'
  | 'unit'
  | 'kitchen';

export const EXPECTED_FIELDS: ExpectedField[] = [
  'date',
  'food',
  'target',
  'produced',
  'sold',
  'waste',
  'surplus',
  'meal',
  'unit',
];

const HEADER_ALIASES: Record<ExpectedField, string[]> = {
  date: ['date'],
  food: ['fooditem', 'food', 'item', 'dish', 'foodname'],
  target: ['target', 'targetqty', 'targetquantity', 'targetkg'],
  produced: ['produced', 'prepared', 'production', 'producedqty', 'producedkg', 'preparedkg'],
  sold: ['sold', 'served', 'sale', 'soldqty', 'soldkg', 'servedkg'],
  waste: ['waste', 'wastage', 'wasted', 'wastekg'],
  surplus: ['surplus', 'remaining', 'leftover', 'balance', 'surplusremaining', 'remainingkg', 'surpluskg'],
  meal: ['meal', 'mealtype', 'session'],
  unit: ['unit', 'uom', 'units'],
  kitchen: ['kitchen', 'kitchenunit', 'unit-name'],
};

function squash(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ColumnSuggestion {
  column: string | null;
  confidence: 'high' | 'medium' | 'none';
}

/** Map each expected field to the best-matching header column. */
export function suggestMapping(headers: string[]): { mapping: Record<ExpectedField, ColumnSuggestion>; needsMapping: boolean } {
  const mapping = {} as Record<ExpectedField, ColumnSuggestion>;
  let needsMapping = false;
  const all: ExpectedField[] = [...EXPECTED_FIELDS, 'kitchen'];
  for (const field of all) {
    const aliases = HEADER_ALIASES[field];
    let found: ColumnSuggestion = { column: null, confidence: 'none' };
    for (const h of headers) {
      const sq = squash(h);
      if (aliases.includes(sq)) {
        found = { column: h, confidence: 'high' };
        break;
      }
    }
    if (!found.column) {
      for (const h of headers) {
        const sq = squash(h);
        if (sq.length < 3) continue;
        // Length guards stop short tokens (e.g. "unit") matching longer aliases (e.g. "unitname").
        if (aliases.some((a) => (sq.includes(a) && a.length >= 4) || (a.includes(sq) && sq.length >= 6))) {
          found = { column: h, confidence: 'medium' };
          break;
        }
      }
    }
    mapping[field] = found;
    if (field !== 'kitchen' && field !== 'target' && field !== 'unit' && found.confidence !== 'high') {
      needsMapping = true;
    }
  }
  return { mapping, needsMapping };
}
