import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface Overview {
  filters: { from: string; to: string };
  production: {
    targetTotal: number; actualTotal: number;
    daily: { date: string; target: number; actual: number }[];
    byFood: { foodItemId: string; food: string; target: number; actual: number }[];
    sameDay: { foodItemId: string; food: string; mealType: string; currentSold: number; priorSold: number | null; priorDate: string | null; note: string | null }[];
  };
  sales: {
    soldKg: number; remainingKg: number; producedKg: number; utilizationPct: number | null;
    byFood: { foodItemId: string; food: string; sold: number; remaining: number }[];
    daily: { date: string; sold: number; remaining: number }[];
  };
  waste: {
    totalKg: number; pctOfProduced: number | null;
    byFood: { foodItemId: string; food: string; waste: number }[];
    daily: { date: string; waste: number }[];
    contributors: { contributor: string; attributableKg: number; days: number }[];
  };
  surplus: {
    predictedKg: number; actualRemainingKg: number; eligibleKg: number;
    redistributedKg: number; unredistributedKg: number; redistributionRatePct: number | null;
  };
  ai: {
    pairs: { date: string; food: string; mealType: string; predictedKg: number; actualSoldKg: number; absPctErr: number | null }[];
    meanAbsPctErr: number | null; accuracyDefinition: string;
    recommendations: { id: string; type: string; title: string; status: string }[];
  };
  sustainability: {
    foodSavedKg: number; wasteReducedKg: number; redistributedKg: number;
    costSavedEstimate: number; co2AvoidedKgEstimate: number; howCalculated: string[];
    baseline: { periodLabel: string; days: number; wasteKg: number };
    factorsUsed: { key: string; value: number; unit: string; source: string }[];
  };
  generatedAt: string;
}

const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';
const todayIso = () => new Date().toISOString().slice(0, 10);
const weekAgoIso = () => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

function Bars({ values, labels, ariaLabel, unit }: { values: number[]; labels: string[]; ariaLabel: string; unit: string }) {
  const max = Math.max(0.001, ...values);
  return (
    <svg viewBox="0 0 560 180" className="mt-3 w-full" role="img" aria-label={ariaLabel}>
      {values.map((v, i) => {
        const w = Math.max(1, Math.floor(520 / Math.max(1, values.length)) - 8);
        const h = Math.round((v / max) * 120);
        const x = 20 + i * Math.floor(520 / Math.max(1, values.length));
        return (
          <g key={i}>
            <title>{labels[i]}: {v} {unit}</title>
            <rect x={x} y={140 - h} width={w} height={h} rx={4} className="fill-leaf-700" />
            <text x={x + w / 2} y={156} textAnchor="middle" fontSize={10} className="fill-stone-700">{labels[i]}</text>
            <text x={x + w / 2} y={130 - h} textAnchor="middle" fontSize={10} className="fill-stone-900">{v}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Analytics() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const [from, setFrom] = useState(weekAgoIso);
  const [to, setTo] = useState(todayIso);
  const [kitchen, setKitchen] = useState('');
  const [meal, setMeal] = useState('');
  const [food, setFood] = useState('');
  const [foods, setFoods] = useState<{ id: string; name: string }[]>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadFoods = useCallback(async () => {
    try {
      const d = await api<{ items: { id: string; name: string }[] }>('/food-items');
      setFoods(d.items);
    } catch { /* filter list is convenience only */ }
  }, []);

  useEffect(() => { void loadFoods(); }, [loadFoods]);

  async function load() {
    setError('');
    setLoading(true);
    try {
      const p = new URLSearchParams({ from, to });
      if (kitchen) p.set('kitchenUnitId', kitchen);
      if (meal) p.set('mealType', meal);
      if (food) p.set('foodItemId', food);
      const d = await api<Overview>(`/analytics/overview?${p.toString()}`);
      setOv(d);
    } catch (err) {
      setOv(null);
      setError(err instanceof Error ? err.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-xl font-bold text-leaf-900">Analytics</h1>
        <p className="mt-1 text-sm text-stone-600">Computed live from filtered database records. Every chart repeats its values in the table below it.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div><label htmlFor="an-from" className="text-sm font-medium">From</label><input id="an-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></div>
          <div><label htmlFor="an-to" className="text-sm font-medium">To</label><input id="an-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></div>
          <div><label htmlFor="an-kitchen" className="text-sm font-medium">Kitchen</label>
            <select id="an-kitchen" value={kitchen} onChange={(e) => setKitchen(e.target.value)} className={input}>
              <option value="">All kitchens</option>{kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select></div>
          <div><label htmlFor="an-meal" className="text-sm font-medium">Meal</label>
            <select id="an-meal" value={meal} onChange={(e) => setMeal(e.target.value)} className={input}>
              <option value="">All meals</option><option value="BREAKFAST">Breakfast</option><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option>
            </select></div>
          <div><label htmlFor="an-food" className="text-sm font-medium">Food</label>
            <select id="an-food" value={food} onChange={(e) => setFood(e.target.value)} className={input}>
              <option value="">All items</option>{foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></div>
          <div className="flex items-end"><button onClick={() => void load()} disabled={loading} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{loading ? 'Loading…' : 'Apply'}</button></div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      {ov && (<>
        <div className={card}>
          <h2 className="font-bold">Production: target vs actual ({ov.filters.from} to {ov.filters.to})</h2>
          <p className="mt-1 text-sm text-stone-700">Target {ov.production.targetTotal} kg · actual {ov.production.actualTotal} kg</p>
          {ov.production.daily.length === 0 ? <p className="mt-2 text-sm text-stone-600">No data for selected filters.</p> : (<>
            <Bars values={ov.production.daily.map((d) => d.actual)} labels={ov.production.daily.map((d) => d.date.slice(5))} ariaLabel="Bar chart of daily actual production in kilograms. Identical values are listed in the table below." unit="kg" />
            <table className="mt-2 w-full text-sm">
              <caption className="text-left font-medium">Same values as the chart, in tabular form.</caption>
              <thead><tr className="text-left text-stone-500"><th>Date</th><th>Target kg</th><th>Actual kg</th></tr></thead>
              <tbody>{ov.production.daily.map((d) => <tr key={d.date} className="border-t border-stone-100"><td>{d.date}</td><td>{d.target}</td><td>{d.actual}</td></tr>)}</tbody>
            </table>
          </>)}
          <h3 className="mt-3 font-bold">Food-wise view</h3>
          {ov.production.byFood.length === 0 ? <p className="mt-1 text-sm text-stone-600">None.</p> : (
            <table className="mt-1 w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th>Food</th><th>Target kg</th><th>Actual kg</th></tr></thead>
              <tbody>{ov.production.byFood.map((f) => <tr key={f.foodItemId} className="border-t border-stone-100"><td>{f.food}</td><td>{f.target}</td><td>{f.actual}</td></tr>)}</tbody>
            </table>
          )}
          <h3 className="mt-3 font-bold">Same-day comparison (latest day vs 7 days earlier, sold kg)</h3>
          {ov.production.sameDay.length === 0 ? <p className="mt-1 text-sm text-stone-600">None.</p> : (
            <table className="mt-1 w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th>Food · Meal</th><th>Current sold</th><th>Prior sold</th></tr></thead>
              <tbody>{ov.production.sameDay.map((s) => (
                <tr key={`${s.foodItemId}|${s.mealType}`} className="border-t border-stone-100">
                  <td>{s.food} · {s.mealType}</td><td>{s.currentSold}</td>
                  <td>{s.priorSold === null ? (s.note ?? 'No comparable record.') : `${s.priorSold} (${s.priorDate})`}</td>
                </tr>))}</tbody>
            </table>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={card}>
            <h2 className="font-bold">Sales / Food Flow</h2>
            <p className="mt-1 text-sm text-stone-700">Sold {ov.sales.soldKg} kg · remaining {ov.sales.remainingKg} kg · utilization {ov.sales.utilizationPct === null ? 'n/a' : `${ov.sales.utilizationPct}%`} (sold ÷ produced)</p>
            {ov.sales.byFood.length === 0 ? <p className="mt-1 text-sm text-stone-600">None.</p> : (
              <table className="mt-2 w-full text-sm">
                <thead><tr className="text-left text-stone-500"><th>Food</th><th>Sold</th><th>Remaining</th></tr></thead>
                <tbody>{ov.sales.byFood.map((f) => <tr key={f.foodItemId} className="border-t border-stone-100"><td>{f.food}</td><td>{f.sold} kg</td><td>{f.remaining} kg</td></tr>)}</tbody>
              </table>
            )}
          </div>
          <div className={card}>
            <h2 className="font-bold">Waste</h2>
            <p className="mt-1 text-sm text-stone-700">Total {ov.waste.totalKg} kg ({ov.waste.pctOfProduced === null ? 'n/a' : `${ov.waste.pctOfProduced}% of produced`})</p>
            {ov.waste.daily.length === 0 ? <p className="mt-1 text-sm text-stone-600">None.</p> : (<>
              <Bars values={ov.waste.daily.map((d) => d.waste)} labels={ov.waste.daily.map((d) => d.date.slice(5))} ariaLabel="Bar chart of daily waste in kilograms. Identical values are listed in the table below." unit="kg" />
              <table className="mt-2 w-full text-sm">
                <caption className="text-left font-medium">Same values as the chart, in tabular form.</caption>
                <thead><tr className="text-left text-stone-500"><th>Date</th><th>Waste kg</th></tr></thead>
                <tbody>{ov.waste.daily.map((d) => <tr key={d.date} className="border-t border-stone-100"><td>{d.date}</td><td>{d.waste}</td></tr>)}</tbody>
              </table>
            </>)}
            <h3 className="mt-3 font-bold">Explainability contributors</h3>
            {ov.waste.contributors.length === 0 ? <p className="mt-1 text-sm text-stone-600">None.</p> : (
              <table className="mt-1 w-full text-sm">
                <thead><tr className="text-left text-stone-500"><th>Contributor</th><th>Attributable kg</th><th>Days</th></tr></thead>
                <tbody>{ov.waste.contributors.map((c) => <tr key={c.contributor} className="border-t border-stone-100"><td>{c.contributor}</td><td>{c.attributableKg}</td><td>{c.days}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={card}>
            <h2 className="font-bold">Surplus</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded bg-stone-50 p-2"><dt>Predicted</dt><dd className="font-bold">{ov.surplus.predictedKg} kg</dd></div>
              <div className="rounded bg-stone-50 p-2"><dt>Actual remaining</dt><dd className="font-bold">{ov.surplus.actualRemainingKg} kg</dd></div>
              <div className="rounded bg-stone-50 p-2"><dt>Eligible</dt><dd className="font-bold">{ov.surplus.eligibleKg} kg</dd></div>
              <div className="rounded bg-stone-50 p-2"><dt>Redistributed</dt><dd className="font-bold">{ov.surplus.redistributedKg} kg</dd></div>
              <div className="rounded bg-stone-50 p-2"><dt>Unredistributed</dt><dd className="font-bold">{ov.surplus.unredistributedKg} kg</dd></div>
              <div className="rounded bg-stone-50 p-2"><dt>Redistribution rate</dt><dd className="font-bold">{ov.surplus.redistributionRatePct === null ? 'n/a' : `${ov.surplus.redistributionRatePct}%`}</dd></div>
            </dl>
          </div>
          <div className={card}>
            <h2 className="font-bold">AI: forecast vs actual</h2>
            <p className="mt-1 text-sm text-stone-600">{ov.ai.accuracyDefinition}</p>
            <p className="mt-1 text-sm font-medium">Mean error: {ov.ai.meanAbsPctErr === null ? 'n/a (no paired records)' : `${ov.ai.meanAbsPctErr}%`}</p>
            {ov.ai.pairs.length === 0 ? <p className="mt-1 text-sm text-stone-600">No paired forecast/actual records in range.</p> : (
              <table className="mt-2 w-full text-sm">
                <thead><tr className="text-left text-stone-500"><th>Date</th><th>Food</th><th>Predicted</th><th>Sold</th><th>Err%</th></tr></thead>
                <tbody>{ov.ai.pairs.slice(0, 20).map((p, i) => <tr key={i} className="border-t border-stone-100"><td>{p.date}</td><td>{p.food}</td><td>{p.predictedKg}</td><td>{p.actualSoldKg}</td><td>{p.absPctErr ?? 'n/a'}</td></tr>)}</tbody>
              </table>
            )}
            {ov.ai.recommendations.length > 0 && (<>
              <h3 className="mt-3 font-bold">Recommendations ({ov.ai.recommendations.length})</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {ov.ai.recommendations.slice(0, 10).map((x) => <li key={x.id}>{x.title} <span className="text-stone-500">({x.type}, {x.status})</span></li>)}
              </ul>
            </>)}
          </div>
        </div>

        <div className={card}>
          <h2 className="font-bold">Sustainability (estimates)</h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div className="rounded bg-stone-50 p-2" title="Total kg food rescued from waste via prevention and redistribution"><dt>Food saved</dt><dd className="font-bold">{ov.sustainability.foodSavedKg} kg</dd></div>
            <div className="rounded bg-stone-50 p-2" title="Reduction in kitchen waste compared to baseline period"><dt>Waste reduced</dt><dd className="font-bold">{ov.sustainability.wasteReducedKg} kg</dd></div>
            <div className="rounded bg-stone-50 p-2" title="Verified food successfully transferred to matched NGOs"><dt>Redistributed</dt><dd className="font-bold">{ov.sustainability.redistributedKg} kg</dd></div>
            <div className="rounded bg-stone-50 p-2" title="Estimated financial value of rescued food based on configured unit factors"><dt>Cost saved (est.)</dt><dd className="font-bold">INR {ov.sustainability.costSavedEstimate}</dd></div>
            <div className="rounded bg-stone-50 p-2" title="Estimated greenhouse gas emissions prevented using standard lifecycle factor"><dt>CO2e avoided (est.)</dt><dd className="font-bold">{ov.sustainability.co2AvoidedKgEstimate} kgCO2e</dd></div>
          </dl>
          <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium text-leaf-800">How calculated?</summary>
            <ul className="mt-1 list-disc pl-5 text-stone-700">
              {ov.sustainability.howCalculated.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
            <p className="mt-1 text-stone-600">Baseline: {ov.sustainability.baseline.periodLabel} ({ov.sustainability.baseline.days} days, {ov.sustainability.baseline.wasteKg} kg waste).</p>
            <table className="mt-1 w-full">
              <thead><tr className="text-left text-stone-500"><th>Factor</th><th>Value</th><th>Source</th></tr></thead>
              <tbody>{ov.sustainability.factorsUsed.map((f) => <tr key={f.key} className="border-t border-stone-100"><td>{f.key}</td><td>{f.value} {f.unit}</td><td>{f.source}</td></tr>)}</tbody>
            </table>
          </details>
        </div>
      </>)}
    </div>
  );
}
