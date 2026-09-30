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

const input = 'mt-1 w-full rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741] focus:ring-1 focus:ring-[#006B48]';
const card = 'rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm';
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
      if (window.showToast) window.showToast('Waste breakdown generated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run analysis.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5 animate-fadeInUpStagger">
      <div className={card}>
        <h1 className="text-xl font-bold text-[#0C2741]">Waste &amp; Excess Analysis</h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-500">
          Deterministic breakdown of recorded excess (waste + remaining) by contributor. Percentages appear only when normalized from quantified claims — otherwise the row says so.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="w-kitchen" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Kitchen</label>
            <select id="w-kitchen" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)} className="mt-1 rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741]">
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="w-date" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Date</label>
            <input id="w-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741]" />
          </div>
          <div>
            <label htmlFor="w-food" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Food (optional)</label>
            <select id="w-food" value={foodId} onChange={(e) => setFoodId(e.target.value)} className="mt-1 rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741]">
              <option value="">All items</option>
              {foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <button onClick={runAnalysis} disabled={loading || !kitchenId} className="rounded-xl bg-[#006B48] px-5 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-[#004C35] active:scale-95 disabled:opacity-60 transition-all cursor-pointer">
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
      </div>

      {label && (
        <div className={card}>
          {rows.length === 0 ? (
            <p className="text-xs sm:text-sm text-gray-500">No excess recorded for this kitchen/day — nothing to explain. {label}</p>
          ) : (<>
            <p className="text-xs sm:text-sm font-semibold text-[#0C2741] pb-3 border-b border-[#E3ECE6]">{label}</p>
            <ul className="mt-4 space-y-3">
              {rows.map((r) => (
                <li key={`${r.foodItemId}|${r.mealType}`} className="rounded-xl border border-[#E3ECE6] p-4 text-xs sm:text-sm hover:border-[#006B48]/30 transition-all">
                  <p className="font-bold text-[#0C2741]">
                    {r.food} · {r.mealType} — excess <span className="text-[#006B48]">{r.excessKg} kg</span>
                    <span className="ml-2 font-normal text-gray-500 text-xs">
                      (produced {r.producedKg} kg, sold {r.soldKg} kg, waste {r.wasteKg} kg, remaining {r.remainingKg} kg)
                    </span>
                  </p>
                  {r.claims.length > 0 ? (
                    <div className="mt-3 overflow-x-auto custom-scrollbar">
                      <table className="w-full text-xs min-w-[500px]">
                        <thead className="bg-[#F9FCFA] text-[#0C2741] font-semibold border-b border-[#E3ECE6]">
                          <tr className="text-left">
                            <th className="py-2 px-3">Contributor</th>
                            <th className="py-2 px-3">Attributable</th>
                            <th className="py-2 px-3">Share</th>
                            <th className="py-2 px-3">Evidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E3ECE6]">
                          {r.claims.map((c) => (
                            <tr key={c.contributor} className="hover:bg-[#F9FCFA] transition-colors">
                              <td className="py-2 px-3 font-medium text-[#0C2741]">{c.contributor}</td>
                              <td className="py-2 px-3">{c.attributableKg} kg</td>
                              <td className="py-2 px-3 font-bold text-[#006B48]">{c.sharePct === null ? '—' : `${c.sharePct}%`}</td>
                              <td className="py-2 px-3 text-gray-600">{c.evidence}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl bg-[#FFFDF7] border border-[#FDE8B5] p-3 text-xs text-[#B45309]">
                      Insufficient evidence — no quantified driver for this excess; percentages withheld rather than invented.
                    </p>
                  )}
                  {r.evidence.length > 0 && (
                    <div className="mt-3 text-xs">
                      <p className="font-bold text-[#0C2741]">Supporting evidence (listed, not percentage-weighted):</p>
                      <ul className="mt-1 list-disc pl-5 text-gray-600 space-y-0.5">
                        {r.evidence.map((e, i) => <li key={i}><span className="font-medium text-[#0C2741]">{e.contributor}:</span> {e.detail}</li>)}
                      </ul>
                    </div>
                  )}
                  <p className="mt-3 rounded-xl bg-[#ECFDF5] border border-emerald-200 p-3 text-xs text-[#006B48]">
                    <span className="font-bold">Recommended action:</span> {r.recommendedAction}
                  </p>
                </li>
              ))}
            </ul>
          </>)}
        </div>
      )}
    </div>
  );
}
