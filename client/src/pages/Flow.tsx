import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface FoodItem { id: string; name: string; isActive: boolean }
interface FlowEntry {
  id: string; recordedAt: string; entryKind: string; direction: string;
  signedKg: number; quantityKg: number; refKind: string | null; reason: string | null;
  author: string; foodItemId: string | null; food: string; mealType: string | null;
  kitchen: string; kitchenUnitId: string | null;
}
interface TotalsRow {
  foodItemId: string; food: string; mealType: string;
  produced: number; sold: number; wasted: number;
  adjustments: { id: string; refKind: string | null; signedKg: number; reason: string | null; author: string; recordedAt: string }[];
}
interface RiskRow {
  foodItemId: string; food: string; mealType: string;
  producedToDate: number; soldToDate: number; wasteToDate: number; saleEntries: number;
  targetKg: number | null; memoryPredictedKg: number | null; dataConfidence: string;
  memoryLimitation: string | null; estimable: boolean; reason: string | null;
  paceKgPerHour: number | null; elapsedHours: number | null; remainingHours: number | null;
  windowEnd: string | null; projectedEodSoldKg: number | null; predictedUnsoldKg: number | null;
  risk: 'low' | 'medium' | 'high' | null; medKg: number; highKg: number; explanation: string;
}
interface Thresholds { medKg: number; highKg: number; minSales: number; minSpanMin: number; windows: Record<string, { start: string; end: string }> }

const todayKey = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
const inputCls = 'mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm';
const btnCls = 'rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60';

function riskBadge(risk: RiskRow['risk'], estimable: boolean) {
  if (!estimable || !risk) return <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-700">not estimable</span>;
  const cls = risk === 'high' ? 'bg-red-100 text-red-800' : risk === 'medium' ? 'bg-amber-100 text-amber-900' : 'bg-leaf-100 text-leaf-900';
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{risk} risk</span>;
}

export function Flow() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const canManage = !!user && ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'].includes(user.role);
  const [searchParams] = useSearchParams();
  const [kitchenId, setKitchenId] = useState(searchParams.get('kitchen') ?? '');
  const [date, setDate] = useState(searchParams.get('date') ?? todayKey());
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [entries, setEntries] = useState<FlowEntry[]>([]);
  const [totals, setTotals] = useState<TotalsRow[]>([]);
  const [dayTotals, setDayTotals] = useState({ produced: 0, sold: 0, wasted: 0 });
  const [risks, setRisks] = useState<RiskRow[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // entry form
  const [fFood, setFFood] = useState('');
  const [fMeal, setFMeal] = useState('LUNCH');
  const [fKind, setFKind] = useState('PRODUCTION');
  const [fQty, setFQty] = useState('');
  const [fDir, setFDir] = useState('ADD');
  const [fRef, setFRef] = useState('PRODUCTION');
  const [fReason, setFReason] = useState('');
  const [fTime, setFTime] = useState('');
  const [saving, setSaving] = useState(false);

  // action forms: key `${food}|${meal}` -> open action
  const [openAction, setOpenAction] = useState<{ key: string; action: 'adjust' | 'offer' | 'redist' } | null>(null);
  const [aDelta, setADelta] = useState('');
  const [aRationale, setARationale] = useState('');
  const [aTitle, setATitle] = useState('');
  const [aNote, setANote] = useState('');
  const [aQty, setAQty] = useState('');
  const [aBusy, setABusy] = useState(false);

  // thresholds form (managers)
  const [tMed, setTMed] = useState('');
  const [tHigh, setTHigh] = useState('');
  const [tBusy, setTBusy] = useState(false);

  const load = useCallback(async (kid: string, d: string) => {
    if (!kid) return;
    setLoading(true);
    setError('');
    try {
      const [fi, en, td, rk, th] = await Promise.all([
        api<{ items: FoodItem[] }>('/food-items'),
        api<{ entries: FlowEntry[] }>(`/flow/entries?kitchenUnitId=${kid}&date=${d}`),
        api<{ totals: TotalsRow[]; dayTotals: { produced: number; sold: number; wasted: number } }>(`/flow/today?kitchenUnitId=${kid}&date=${d}`),
        api<{ risks: RiskRow[] }>(`/flow/risk?kitchenUnitId=${kid}&date=${d}`),
        api<{ thresholds: Thresholds | null }>(`/risk-thresholds`),
      ]);
      setFoods(fi.items.filter((f) => f.isActive));
      setEntries(en.entries);
      setTotals(td.totals);
      setDayTotals(td.dayTotals);
      setRisks(rk.risks);
      setThresholds(th.thresholds);
      if (th.thresholds) { setTMed(String(th.thresholds.medKg)); setTHigh(String(th.thresholds.highKg)); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Food Flow.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!kitchenId && kitchens.length > 0) setKitchenId(kitchens[0].id);
  }, [kitchens, kitchenId]);
  useEffect(() => { void load(kitchenId, date); }, [load, kitchenId, date]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        kitchenUnitId: kitchenId, foodItemId: fFood, mealType: fMeal,
        entryKind: fKind, quantityKg: Number(fQty),
      };
      if (fKind === 'ADJUSTMENT') { body.direction = fDir; body.refKind = fRef; body.reason = fReason.trim(); }
      if (fTime) body.recordedAt = new Date(fTime).toISOString();
      const d = await api<{ entry: FlowEntry; triggered: string[] }>('/flow/entries', { method: 'POST', body: JSON.stringify(body) });
      setMsg(`Saved ${d.entry.entryKind.toLowerCase()} entry of ${d.entry.signedKg} kg${d.triggered.length > 0 ? ` — notifications: ${d.triggered.join(', ')}` : ''}.`);
      setFQty(''); setFReason(''); setFTime('');
      await load(kitchenId, date);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save entry.');
    } finally {
      setSaving(false);
    }
  }

  async function submitAction(risk: RiskRow) {
    if (!openAction) return;
    setError('');
    setMsg('');
    setABusy(true);
    try {
      if (openAction.action === 'adjust') {
        const d = await api<{ recommendation: { id: string; title: string } }>('/flow/actions/adjust-production', { method: 'POST',
          body: JSON.stringify({ kitchenUnitId: kitchenId, foodItemId: risk.foodItemId, mealType: risk.mealType, date, suggestedDeltaKg: Number(aDelta), rationale: aRationale.trim() }) });
        setMsg(`Suggestion saved (${d.recommendation.title}). Recorded production is unchanged.`);
      } else if (openAction.action === 'offer') {
        const d = await api<{ recommendation: { id: string } }>('/flow/actions/special-offer', { method: 'POST',
          body: JSON.stringify({ kitchenUnitId: kitchenId, foodItemId: risk.foodItemId, mealType: risk.mealType, date, title: aTitle.trim(), note: aNote.trim() }) });
        setMsg(`Promotion note saved (${d.recommendation.id}). Internal only — no payment integration.`);
      } else {
        const d = await api<{ draft: { id: string; quantityKg: number } }>('/flow/actions/prepare-redistribution', { method: 'POST',
          body: JSON.stringify({ kitchenUnitId: kitchenId, foodItemId: risk.foodItemId, mealType: risk.mealType, date, quantityKg: Number(aQty) }) });
        setMsg(`Redistribution draft ${d.draft.id} for ${d.draft.quantityKg} kg saved. Eligibility NOT assessed; no NGO notified.`);
      }
      setOpenAction(null); setADelta(''); setARationale(''); setATitle(''); setANote(''); setAQty('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setABusy(false);
    }
  }

  async function saveThresholds(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    setTBusy(true);
    try {
      const d = await api<{ message: string; thresholds: Thresholds }>('/risk-thresholds', { method: 'PUT',
        body: JSON.stringify({ medKg: Number(tMed), highKg: Number(tHigh), minSales: thresholds?.minSales ?? 2, minSpanMin: thresholds?.minSpanMin ?? 30 }) });
      setThresholds(d.thresholds);
      setMsg(d.message);
      await load(kitchenId, date);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save thresholds.');
    } finally {
      setTBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-leaf-900">Live Food Flow</h1>
        <p className="mt-1 text-sm text-stone-600">Log production, sales, waste, and corrective adjustments as the day unfolds. Totals are recomputed server-side after every entry.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <div><label htmlFor="fl-kitchen" className="text-sm font-medium">Kitchen</label>
            <select id="fl-kitchen" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)} className={inputCls}>
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select></div>
          <div><label htmlFor="fl-date" className="text-sm font-medium">Date</label>
            <input id="fl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold">Log entry</h2>
          <form onSubmit={submitEntry} className="mt-2 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="fe-food" className="text-sm font-medium">Food item</label>
                <select id="fe-food" value={fFood} onChange={(e) => setFFood(e.target.value)} required className={inputCls}>
                  <option value="">— choose —</option>{foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select></div>
              <div><label htmlFor="fe-meal" className="text-sm font-medium">Meal</label>
                <select id="fe-meal" value={fMeal} onChange={(e) => setFMeal(e.target.value)} className={inputCls}>
                  <option>BREAKFAST</option><option>LUNCH</option><option>DINNER</option>
                </select></div>
              <div><label htmlFor="fe-kind" className="text-sm font-medium">Entry kind</label>
                <select id="fe-kind" value={fKind} onChange={(e) => setFKind(e.target.value)} className={inputCls}>
                  <option value="PRODUCTION">Production</option><option value="SALE">Sale / service</option>
                  <option value="WASTE">Waste</option><option value="ADJUSTMENT">Corrective adjustment</option>
                </select></div>
              <div><label htmlFor="fe-qty" className="text-sm font-medium">Quantity (kg, &gt; 0)</label>
                <input id="fe-qty" type="number" min="0.01" step="0.01" value={fQty} onChange={(e) => setFQty(e.target.value)} required className={inputCls} /></div>
              {fKind === 'ADJUSTMENT' && (<>
                <div><label htmlFor="fe-dir" className="text-sm font-medium">Direction</label>
                  <select id="fe-dir" value={fDir} onChange={(e) => setFDir(e.target.value)} className={inputCls}>
                    <option value="ADD">Add to total</option><option value="SUBTRACT">Subtract from total</option>
                  </select></div>
                <div><label htmlFor="fe-ref" className="text-sm font-medium">Corrects</label>
                  <select id="fe-ref" value={fRef} onChange={(e) => setFRef(e.target.value)} className={inputCls}>
                    <option value="PRODUCTION">Production total</option><option value="SALE">Sales total</option><option value="WASTE">Waste total</option>
                  </select></div>
              </>)}
              <div className={fKind === 'ADJUSTMENT' ? '' : 'col-span-2'}>
                <label htmlFor="fe-reason" className="text-sm font-medium">Reason{fKind === 'ADJUSTMENT' ? ' (required, min 5 chars)' : ' (optional)'}</label>
                <input id="fe-reason" value={fReason} onChange={(e) => setFReason(e.target.value)} className={inputCls} placeholder="e.g. Spilled batch, verified" /></div>
              <div><label htmlFor="fe-time" className="text-sm font-medium">Recorded at (empty = now)</label>
                <input id="fe-time" type="datetime-local" value={fTime} onChange={(e) => setFTime(e.target.value)} className={inputCls} /></div>
            </div>
            <button type="submit" disabled={saving || !kitchenId || !fFood} className={btnCls}>{saving ? 'Saving…' : 'Save entry'}</button>
          </form>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold">Day totals (server-computed)</h2>
          {loading ? <p className="mt-2 text-sm" role="status">Loading…</p> : totals.length === 0 ? (
            <p className="mt-2 text-sm text-stone-600">No entries yet for this kitchen and date.</p>
          ) : (<>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th>Food · Meal</th><th>Produced</th><th>Sold</th><th>Wasted</th></tr></thead>
              <tbody>{totals.map((t) => (
                <tr key={`${t.foodItemId}|${t.mealType}`} className="border-t border-stone-100">
                  <td>{t.food} · {t.mealType}{t.adjustments.length > 0 && <span className="ml-1 text-xs text-stone-500">({t.adjustments.length} adj.)</span>}</td>
                  <td>{t.produced} kg</td><td>{t.sold} kg</td><td>{t.wasted} kg</td>
                </tr>))}</tbody>
            </table>
            <p className="mt-2 text-sm font-medium">Day: {dayTotals.produced} produced · {dayTotals.sold} sold · {dayTotals.wasted} wasted kg</p>
          </>)}
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Surplus-before-surplus risk</h2>
        <p className="mt-1 text-sm text-stone-600">Deterministic pace projection per food and meal. Bands: low &lt; {thresholds?.medKg ?? 2}, medium ≥ {thresholds?.medKg ?? 2}, high ≥ {thresholds?.highKg ?? 5} kg.</p>
        {risks.length === 0 && !loading && <p className="mt-2 text-sm text-stone-600">No Food Flow entries yet — log production and sales above to unlock estimates.</p>}
        <ul className="mt-2 space-y-3">
          {risks.map((rk) => {
            const key = `${rk.foodItemId}|${rk.mealType}`;
            return (
              <li key={key} className="rounded-xl border border-stone-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{rk.food} · {rk.mealType}</p>
                  {riskBadge(rk.risk, rk.estimable)}
                  {rk.estimable && rk.predictedUnsoldKg !== null && <span className="text-sm">predicted unsold <strong>{rk.predictedUnsoldKg} kg</strong></span>}
                </div>
                {!rk.estimable ? (
                  <p className="mt-1 text-sm text-stone-600">{rk.reason}</p>
                ) : (<>
                  <p className="mt-1 text-sm text-stone-600">
                    Produced {rk.producedToDate} · sold {rk.soldToDate} · waste {rk.wasteToDate} kg · {rk.saleEntries} sale events ·
                    target {rk.targetKg ?? '—'} kg · memory demand {rk.memoryPredictedKg ?? '—'} kg ({rk.dataConfidence})
                    {rk.memoryLimitation && <span className="text-amber-800"> · {rk.memoryLimitation}</span>}
                  </p>
                  <details className="mt-1 text-sm"><summary className="cursor-pointer text-leaf-800 underline">Exact calculation</summary>
                    <p className="mt-1 text-stone-700">{rk.explanation}</p></details>
                  {(rk.risk === 'high' || rk.risk === 'medium') && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(['adjust', 'offer', 'redist'] as const).map((a) => (
                        <button key={a} onClick={() => setOpenAction(openAction?.key === key && openAction?.action === a ? null : { key, action: a })}
                          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100">
                          {a === 'adjust' ? 'Adjust ongoing production' : a === 'offer' ? 'Run special offer' : 'Prepare redistribution'}
                        </button>
                      ))}
                    </div>
                  )}
                  {openAction?.key === key && (
                    <div className="mt-2 rounded-xl bg-stone-50 p-3 text-sm">
                      {openAction.action === 'adjust' && (<>
                        <label htmlFor={`ad-${key}`} className="font-medium">Suggested change in kg (negative reduces, e.g. {-1 * (rk.predictedUnsoldKg ?? 0)})</label>
                        <input id={`ad-${key}`} type="number" step="0.1" value={aDelta} onChange={(e) => setADelta(e.target.value)} className={inputCls} />
                        <label htmlFor={`ar-${key}`} className="mt-2 block font-medium">Rationale (min 5 chars)</label>
                        <input id={`ar-${key}`} value={aRationale} onChange={(e) => setARationale(e.target.value)} className={inputCls} />
                        <p className="mt-1 text-xs text-stone-500">Creates a suggestion only — recorded production stays unchanged.</p>
                      </>)}
                      {openAction.action === 'offer' && (<>
                        <label htmlFor={`ot-${key}`} className="font-medium">Offer title</label>
                        <input id={`ot-${key}`} value={aTitle} onChange={(e) => setATitle(e.target.value)} className={inputCls} placeholder="Extra servings at counter 2" />
                        <label htmlFor={`on-${key}`} className="mt-2 block font-medium">Internal note (min 5 chars)</label>
                        <input id={`on-${key}`} value={aNote} onChange={(e) => setANote(e.target.value)} className={inputCls} />
                        <p className="mt-1 text-xs text-stone-500">Internal note only — no payment-system integration.</p>
                      </>)}
                      {openAction.action === 'redist' && (<>
                        <label htmlFor={`rq-${key}`} className="font-medium">Quantity to prepare (kg)</label>
                        <input id={`rq-${key}`} type="number" min="0.01" step="0.1" value={aQty} onChange={(e) => setAQty(e.target.value)} className={inputCls} />
                        <p className="mt-1 text-xs text-stone-500">Creates a DRAFT preparation record — eligibility is NOT assessed and no NGO is notified.</p>
                      </>)}
                      <button onClick={() => void submitAction(rk)} disabled={aBusy} className={`${btnCls} mt-2`}>{aBusy ? 'Saving…' : 'Save'}</button>
                    </div>
                  )}
                </>)}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Activity timeline</h2>
        {entries.length === 0 && !loading ? <p className="mt-2 text-sm text-stone-600">Nothing logged yet.</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-stone-100 py-1.5">
                <span className="text-stone-500">{new Date(e.recordedAt).toLocaleString()}</span>
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium">{e.entryKind}</span>
                <span className="font-medium">{e.direction === 'SUBTRACT' ? '−' : '+'}{e.quantityKg} kg</span>
                <span>{e.food} · {e.mealType}</span>
                <span className="text-stone-500">by {e.author}</span>
                {e.refKind && <span className="text-stone-500">corrects {e.refKind}</span>}
                {e.reason && <span className="text-stone-600">“{e.reason}”</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Risk bands</h2>
        {canManage ? (
          <form onSubmit={saveThresholds} className="mt-2 flex flex-wrap items-end gap-3 text-sm">
            <div><label htmlFor="th-med" className="font-medium">Medium at ≥ (kg)</label>
              <input id="th-med" type="number" min="0.5" step="0.5" value={tMed} onChange={(e) => setTMed(e.target.value)} required className={inputCls} /></div>
            <div><label htmlFor="th-high" className="font-medium">High at ≥ (kg)</label>
              <input id="th-high" type="number" min="0.5" step="0.5" value={tHigh} onChange={(e) => setTHigh(e.target.value)} required className={inputCls} /></div>
            <button type="submit" disabled={tBusy} className={btnCls}>{tBusy ? 'Saving…' : 'Save bands'}</button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-stone-600">Bands: medium ≥ {thresholds?.medKg ?? 2} kg, high ≥ {thresholds?.highKg ?? 5} kg. Only admins / kitchen managers can change them.</p>
        )}
        <p className="mt-1 text-xs text-stone-500">Service windows: Breakfast 07:00–10:30 · Lunch 11:30–15:00 · Dinner 18:00–21:30 (local server time, shown in each estimate).</p>
      </div>
    </div>
  );
}
