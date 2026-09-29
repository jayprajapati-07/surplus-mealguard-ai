// Explainable Waste Analysis — deterministic contribution rules over recorded data only.
// No sensors, no cameras, no scientific claims: every number cites the persisted rows it
// came from. Percentages appear only when normalized from quantified claims; otherwise
// the row says so explicitly ("insufficient evidence").

import { utcDayKey } from './kitchen-memory';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type QuantifiedContributor = 'demand-overestimate' | 'overproduction' | 'day-pattern' | 'menu-combination';
export type EvidenceContributor = 'expiry-pressure' | 'manual-reason';

export interface WasteClaim {
  contributor: QuantifiedContributor;
  attributableKg: number;
  sharePct: number | null;
  evidence: string;
}

export interface WasteEvidence {
  contributor: EvidenceContributor;
  detail: string;
}

export interface DayRecord {
  id: string;
  foodItemId: string | null;
  foodName: string;
  mealType: string;
  date: Date;
  preparedKg: number;
  soldKg: number;
  wasteKg: number;
  remainingKg: number;
  targetKg: number | null;
  adjustmentReason: string | null;
  correctionReason: string | null;
  notes: string | null;
}

export interface HistoryPoint {
  foodItemId: string | null;
  mealType: string;
  date: Date;
  excessKg: number;
}

export interface InventoryFlag {
  foodItemId: string | null;
  lot: string;
  expiryDate: string | null;
  quantityKg: number;
  flag: 'near-expiry' | 'expired';
}

export interface WasteRow {
  foodItemId: string;
  food: string;
  mealType: string;
  producedKg: number;
  soldKg: number;
  wasteKg: number;
  remainingKg: number;
  excessKg: number;
  claims: WasteClaim[];
  evidence: WasteEvidence[];
  percentagesWithheld: boolean;
  recommendedAction: string;
}

export const WASTE_LABEL =
  'Operational decision support from recorded data — not causal proof. Shares are indicative; contributors may overlap.';

const ACTIONS: Record<QuantifiedContributor, string> = {
  'demand-overestimate': 'Lower the next target toward observed sold quantities and re-check the forecast inputs.',
  overproduction: 'Reduce batch size toward target/sold levels for this meal.',
  'day-pattern': 'Plan smaller batches on this weekday; the pattern repeats across comparable records.',
  'menu-combination': 'Rebalance this food+meal combination (portion size or pairing) — it repeatedly leaves excess.',
};

export function analyzeWasteDay(args: {
  dayRecords: DayRecord[];
  history: HistoryPoint[];
  weekday: number;
  inventoryFlags: InventoryFlag[];
}): { rows: WasteRow[]; label: string } {
  void args.weekday;
  const rows: WasteRow[] = [];
  for (const r of args.dayRecords) {
    const excess = r3(r.wasteKg + r.remainingKg);
    if (excess <= 0) continue;
    const claims: { contributor: QuantifiedContributor; attributableKg: number; evidence: string }[] = [];
    // 1. Demand overestimate: target materially above what sold.
    if (r.targetKg !== null) {
      const claim = r3(Math.max(0, Math.min(r.targetKg, r.preparedKg) - r.soldKg));
      if (claim > 0) {
        claims.push({
          contributor: 'demand-overestimate',
          attributableKg: Math.min(claim, excess),
          evidence: `Target ${r.targetKg} kg vs sold ${r.soldKg} kg on record ${r.id}.`,
        });
      }
    }
    // 2. Overproduction: produced materially above target (or sold when no target).
    const ref = r.targetKg ?? r.soldKg;
    const over = r3(Math.max(0, r.preparedKg - Math.max(ref, r.soldKg)));
    if (over > 0) {
      claims.push({
        contributor: 'overproduction',
        attributableKg: Math.min(over, excess),
        evidence: r.targetKg !== null
          ? `Produced ${r.preparedKg} kg vs target ${r.targetKg} kg on record ${r.id}.`
          : `Produced ${r.preparedKg} kg vs sold ${r.soldKg} kg on record ${r.id} (no target recorded).`,
      });
    }
    // 3. Day pattern: this weekday's mean excess exceeds the overall mean (n≥3).
    const dayKey = utcDayKey(new Date(r.date));
    const sameDow = args.history.filter(
      (h) => new Date(h.date).getUTCDay() === new Date(r.date).getUTCDay() && utcDayKey(new Date(h.date)) !== dayKey
    );
    const overallMean = args.history.length > 0
      ? args.history.reduce((x, h) => x + h.excessKg, 0) / args.history.length : 0;
    if (sameDow.length >= 3) {
      const dowMean = sameDow.reduce((x, h) => x + h.excessKg, 0) / sameDow.length;
      if (dowMean > overallMean) {
        claims.push({
          contributor: 'day-pattern',
          attributableKg: r3(Math.min(excess, dowMean - overallMean)),
          evidence: `Weekday mean excess ${r3(dowMean)} kg over ${sameDow.length} records vs overall ${r3(overallMean)} kg.`,
        });
      }
    }
    // 4. Menu combination: same food+meal mean excess exceeds overall (n≥3).
    const combo = args.history.filter(
      (h) => h.foodItemId === r.foodItemId && h.mealType === r.mealType && utcDayKey(new Date(h.date)) !== dayKey
    );
    if (combo.length >= 3) {
      const comboMean = combo.reduce((x, h) => x + h.excessKg, 0) / combo.length;
      if (comboMean > overallMean) {
        claims.push({
          contributor: 'menu-combination',
          attributableKg: r3(Math.min(excess, comboMean - overallMean)),
          evidence: `${r.foodName} + ${r.mealType} mean excess ${r3(comboMean)} kg over ${combo.length} records vs overall ${r3(overallMean)} kg.`,
        });
      }
    }
    const total = claims.reduce((x, c) => x + c.attributableKg, 0);
    const withShares: WasteClaim[] = total > 0
      ? claims.map((c) => ({ ...c, sharePct: r3((c.attributableKg / total) * 100) }))
      : [];
    // Unquantified supporting evidence — listed, never given a percentage.
    const evidence: WasteEvidence[] = [];
    for (const f of args.inventoryFlags) {
      if (f.foodItemId !== null && r.foodItemId !== null && f.foodItemId !== r.foodItemId) continue;
      evidence.push({
        contributor: 'expiry-pressure',
        detail: `Lot ${f.lot} (${f.quantityKg} kg) ${f.flag}${f.expiryDate ? `, expiry ${f.expiryDate}` : ', no expiry date recorded'}.`,
      });
    }
    for (const txt of [r.adjustmentReason, r.correctionReason, r.notes]) {
      if (txt && txt.trim().length > 0) {
        evidence.push({ contributor: 'manual-reason', detail: `Record ${r.id}: "${txt.trim()}".` });
      }
    }
    const percentagesWithheld = withShares.length === 0;
    const top = [...withShares].sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0))[0];
    const recommendedAction = top
      ? ACTIONS[top.contributor]
      : evidence.length > 0
        ? `Follow up on recorded evidence: ${evidence[0].detail}`
        : 'Insufficient evidence — no quantified driver and no supporting records for this excess.';
    rows.push({
      foodItemId: r.foodItemId ?? '', food: r.foodName, mealType: r.mealType,
      producedKg: r.preparedKg, soldKg: r.soldKg, wasteKg: r.wasteKg, remainingKg: r.remainingKg,
      excessKg: excess, claims: withShares, evidence, percentagesWithheld, recommendedAction,
    });
  }
  return { rows, label: WASTE_LABEL };
}
