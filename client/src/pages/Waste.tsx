import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface Claim { contributor: string; attributableKg: number; sharePct: number | null; evidence: string }
interface Evidence { contributor: string; detail: string }
interface WasteRow {
  foodItemId: string; food: string; mealType: string;
  producedKg: number; soldKg: number; wasteKg: number; remainingKg: number; excessKg: number;
  claims: Claim[]; evidence: Evidence[]; percentagesWithheld: boolean; recommendedAction: string;
}
interface FoodItem { id: string; name: string; isActive: boolean }

const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';
const todayIso = () => new Date().toISOString().slice(0, 10);

export function Waste() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const [kitchenId, setKitchenId] = useState('');
  const [date, setDate] = useState(todayIso);
  const [foodId, setFoodId] = useState('');
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [rows, setRows] = useState<WasteRow[]>([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!kitchenId && kitchens.length > 0) setKitchenId(kitchens[0].id);
  }, [kitchens, kitchenId]);

  const loadFoods = useCallback(async () => {
    try {
      const d = await api<{ items: FoodItem[] }>('/food-items');
      setFoods(d.items.filter((i) => i.isActive));
    } catch { /* list is a convenience filter; analysis works without it */ }
  }, []);

  useEffect(() => { void loadFoods(); }, [loadFoods]);

  async function runAnalysis() {
    setError('');
    setRows([]);
    setLabel('');
    setLoading(true);
    try {
      const q = `/waste/analysis?kitchenUnitId=${kitchenId}&date=${date}${foodId ? `&foodItemId=${foodId}` : ''}`;
      const d = await api<{ rows: WasteRow[]; label: string }>(q);
      setRows(d.rows);
      setLabel(d.label);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run analysis.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-xl font-bold text-leaf-900">Waste analysis</h1>
        <p className="mt-1 text-sm text-stone-600">Deterministic breakdown of recorded excess (waste + remaining) by contributor. Percentages appear only when normalized from quantified claims — otherwise the row says so.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="w-kitchen" className="text-sm font-medium">Kitchen</label>
            <select id="w-kitchen" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)} className="mt-1 rounded-lg border border-stone-300 px-3 py-2">
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="w-date" className="text-sm font-medium">Date</label>
            <input id="w-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-lg border border-stone-300 px-3 py-2" />
          </div>
          <div>
            <label htmlFor="w-food" className="text-sm font-medium">Food (optional)</label>
            <select id="w-food" value={foodId} onChange={(e) => setFoodId(e.target.value)} className="mt-1 rounded-lg border border-stone-300 px-3 py-2">
              <option value="">All items</option>
              {foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button onClick={runAnalysis} disabled={loading || !kitchenId} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      {label && (
        <div className={card}>
          {rows.length === 0 ? (
            <p className="text-sm text-stone-600">No excess recorded for this kitchen/day — nothing to explain. {label}</p>
          ) : (<>
            <p className="text-sm text-stone-600">{label}</p>
            <ul className="mt-3 space-y-3">
              {rows.map((r) => (
                <li key={`${r.foodItemId}|${r.mealType}`} className="rounded-xl border border-stone-200 p-4 text-sm">
                  <p className="font-bold">{r.food} · {r.mealType} — excess {r.excessKg} kg
                    <span className="ml-2 font-normal text-stone-500">(produced {r.producedKg}, sold {r.soldKg}, waste {r.wasteKg}, remaining {r.remainingKg})</span></p>
                  {r.claims.length > 0 ? (
                    <table className="mt-2 w-full">
                      <thead><tr className="text-left text-stone-500"><th>Contributor</th><th>Attributable</th><th>Share</th><th>Evidence</th></tr></thead>
                      <tbody>
                        {r.claims.map((c) => (
                          <tr key={c.contributor} className="border-t border-stone-100">
                            <td className="font-medium">{c.contributor}</td>
                            <td>{c.attributableKg} kg</td>
                            <td>{c.sharePct === null ? '—' : `${c.sharePct}%`}</td>
                            <td className="text-stone-600">{c.evidence}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900">Insufficient evidence — no quantified driver for this excess; percentages withheld rather than invented.</p>
                  )}
                  {r.evidence.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium">Supporting evidence (listed, not percentage-weighted):</p>
                      <ul className="list-disc pl-5 text-stone-700">
                        {r.evidence.map((e, i) => <li key={i}><span className="font-medium">{e.contributor}:</span> {e.detail}</li>)}
                      </ul>
                    </div>
                  )}
                  <p className="mt-2 rounded-lg bg-leaf-50 p-2"><span className="font-medium">Recommended action:</span> {r.recommendedAction}</p>
                </li>
              ))}
            </ul>
          </>)}
        </div>
      )}
    </div>
  );
}
