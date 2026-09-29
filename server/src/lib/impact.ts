// Impact math — pure, deterministic, fully inspectable.
// Every environmental/cost output is an ESTIMATE derived from configured
// ImpactFactor rows (never hardcoded). No external calls, no randomness.

export const COST_KEY = 'COST_PER_KG_FOOD';
export const CO2_KEY = 'CO2_PER_KG_FOOD';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface FactorRow {
  key: string;
  value: number;
  unit: string;
  name: string;
  source: string | null;
  isActive: boolean;
  effectiveDate: Date | null;
  organizationId: string | null;
  category: string | null;
  foodItemId: string | null;
}

export interface ResolvedFactors {
  costPerKg: number;
  costSource: string;
  co2PerKg: number;
  co2Source: string;
}

function pick(
  factors: FactorRow[],
  key: string,
  scope: { foodItemId?: string | null; category?: string | null; organizationId?: string | null },
  now: Date
): { value: number; source: string } {
  const live = factors.filter(
    (f) => f.key === key && f.isActive && (f.effectiveDate === null || f.effectiveDate <= now)
  );
  const at = (pred: (f: FactorRow) => boolean) => live.find(pred);
  const hit =
    (scope.foodItemId && at((f) => f.foodItemId === scope.foodItemId)) ||
    (scope.category && at((f) => !f.foodItemId && f.category === scope.category)) ||
    (scope.organizationId && at((f) => !f.foodItemId && !f.category && f.organizationId === scope.organizationId)) ||
    at((f) => !f.foodItemId && !f.category && !f.organizationId);
  if (!hit) return { value: 0, source: 'No factor configured — treated as 0 (configure one).' };
  return { value: hit.value, source: `${hit.name || hit.key} = ${hit.value} ${hit.unit} (${hit.source || 'source unstated'})` };
}

/** Resolution order: food item → category → organization → global. Inactive or future-dated rows never apply. */
export function resolveFactors(
  factors: FactorRow[],
  opts: { foodItemId?: string | null; category?: string | null; organizationId?: string | null; now?: Date }
): ResolvedFactors {
  const now = opts.now ?? new Date();
  const scope = { foodItemId: opts.foodItemId ?? null, category: opts.category ?? null, organizationId: opts.organizationId ?? null };
  const cost = pick(factors, COST_KEY, scope, now);
  const co2 = pick(factors, CO2_KEY, scope, now);
  return { costPerKg: cost.value, costSource: cost.source, co2PerKg: co2.value, co2Source: co2.source };
}

export interface ImpactResult {
  foodSavedKg: number;
  wasteReducedKg: number;
  redistributedKg: number;
  costSavedEstimate: number;
  co2AvoidedKgEstimate: number;
  howCalculated: string[];
}

/**
 * foodSaved = redistributed (measured) + prevented waste (estimated vs baseline).
 * wasteReduced = the prevented component. Cost/CO2 apply to foodSaved.
 */
export function computeImpact(args: {
  completedQtyKg: number;
  baselineWasteKg: number;
  baselineDays: number;
  baselineLabel: string;
  actualWasteKg: number;
  reportDays: number;
  factors: ResolvedFactors;
}): ImpactResult {
  const baselineRate = args.baselineDays > 0 ? args.baselineWasteKg / args.baselineDays : 0;
  const expectedWaste = r3(baselineRate * args.reportDays);
  const hasBaseline = args.baselineDays > 0 && args.baselineWasteKg > 0;
  const prevented = hasBaseline ? r3(Math.max(0, expectedWaste - args.actualWasteKg)) : 0;
  const foodSavedKg = r3(args.completedQtyKg + prevented);
  const out: ImpactResult = {
    foodSavedKg,
    wasteReducedKg: prevented,
    redistributedKg: r3(args.completedQtyKg),
    costSavedEstimate: r3(foodSavedKg * args.factors.costPerKg),
    co2AvoidedKgEstimate: r3(foodSavedKg * args.factors.co2PerKg),
    howCalculated: [
      `Food saved = redistributed (${r3(args.completedQtyKg)} kg, measured) + prevented waste (${prevented} kg, estimated vs baseline).`,
      hasBaseline
        ? `Baseline: ${args.baselineLabel}; expected waste = ${r3(baselineRate)} kg/day × ${args.reportDays} days = ${expectedWaste} kg.`
        : 'No baseline waste data — prevented waste treated as 0; food saved counts redistribution only.',
      `Cost saved (estimate) = ${foodSavedKg} × ${args.factors.costPerKg} (${args.factors.costSource}).`,
      `CO2e avoided (estimate) = ${foodSavedKg} × ${args.factors.co2PerKg} (${args.factors.co2Source}).`,
    ],
  };
  return out;
}
