import { useCallback, useEffect, useState } from 'react';
import { API_BASE, api, getToken } from '../api';
import { useAuth } from '../auth-context';

interface ReportData {
  type: string; from: string; to: string;
  filters: Record<string, string>;
  generatedAt: string;
  production: { targetTotal: number; actualTotal: number; daily: { date: string; target: number; actual: number }[]; byFood: { foodItemId: string; food: string; target: number; actual: number }[] };
  sales: { soldKg: number; remainingKg: number; producedKg: number; utilizationPct: number | null };
  waste: { totalKg: number; pctOfProduced: number | null };
  surplus: { predictedKg: number; actualRemainingKg: number; eligibleKg: number; redistributedKg: number; unredistributedKg: number; redistributionRatePct: number | null };
  ai: { meanAbsPctErr: number | null; accuracyDefinition: string };
  sustainability: { foodSavedKg: number; wasteReducedKg: number; costSavedEstimate: number; co2AvoidedKgEstimate: number; howCalculated: string[] };
}

interface Factor {
  id: string; key: string; name: string; value: number; unit: string;
  description: string | null; source: string | null; effectiveDate: string | null;
  isActive: boolean; organizationId: string | null; category: string | null; foodItemId: string | null;
}

interface Snapshot {
  id: string; date: string; foodSavedKg: number; wasteReducedKg: number;
  co2AvoidedKgEstimate: number; costSavedEstimate: number; createdAt: string;
  detail: { filters?: unknown; method?: string; howCalculated?: string[] } | null;
}

const MANAGE = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';
const todayIso = () => new Date().toISOString().slice(0, 10);

async function authedGet(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { headers });
}

export function Reports() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const canManage = !!user && MANAGE.includes(user.role);
  const [type, setType] = useState('daily');
  const [date, setDate] = useState(todayIso);
  const [kitchen, setKitchen] = useState('');
  const [meal, setMeal] = useState('');
  const [food, setFood] = useState('');
  const [foods, setFoods] = useState<{ id: string; name: string }[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dlBusy, setDlBusy] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [factors, setFactors] = useState<Factor[]>([]);
  const [fKey, setFKey] = useState('');
  const [fName, setFName] = useState('');
  const [fValue, setFValue] = useState('');
  const [fUnit, setFUnit] = useState('');
  const [fSource, setFSource] = useState('');
  const [fDate, setFDate] = useState(todayIso);
  const [fCategory, setFCategory] = useState('');
  const [fFood, setFFood] = useState('');
  const [fError, setFError] = useState('');
  const [fBusy, setFBusy] = useState(false);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [sBusy, setSBusy] = useState(false);

  const loadFoods = useCallback(async () => {
    try {
      const d = await api<{ items: { id: string; name: string }[] }>('/food-items');
      setFoods(d.items);
    } catch { /* convenience only */ }
  }, []);

  const loadFactors = useCallback(async () => {
    try {
      const d = await api<{ factors: Factor[] }>('/impact/factors');
      setFactors(d.factors);
    } catch { /* shown via error on action */ }
  }, []);

  const loadSnapshots = useCallback(async () => {
    try {
      const d = await api<{ snapshots: Snapshot[] }>('/impact/snapshots');
      setSnapshots(d.snapshots);
    } catch { /* supplementary */ }
  }, []);

  useEffect(() => { void loadFoods(); void loadFactors(); void loadSnapshots(); }, [loadFoods, loadFactors, loadSnapshots]);

  function params(): string {
    const p = new URLSearchParams({ type, date });
    if (kitchen) p.set('kitchenUnitId', kitchen);
    if (meal) p.set('mealType', meal);
    if (food) p.set('foodItemId', food);
    return p.toString();
  }

  async function loadReport() {
    setError('');
    setMsg('');
    setLoading(true);
    try {
      const d = await api<{ report: ReportData }>(`/reports/data?${params()}`);
      setReport(d.report);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Could not build report.');
    } finally {
      setLoading(false);
    }
  }

  async function download(ext: 'csv' | 'xlsx' | 'pdf') {
    setError('');
    setMsg('');
    setDlBusy(ext);
    try {
      const res = await authedGet(`/reports/export.${ext}?${params()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `Export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const r = report;
      a.download = r ? `report-${r.type}-${r.from}-to-${r.to}.${ext}` : `report.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`${ext.toUpperCase()} downloaded with the currently displayed data. The export was audited.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setDlBusy('');
    }
  }

  async function saveFactor(e: React.FormEvent) {
    e.preventDefault();
    setFError('');
    setMsg('');
    setFBusy(true);
    try {
      const d = await api<{ message: string }>('/impact/factors', { method: 'POST',
        body: JSON.stringify({ key: fKey.trim().toUpperCase(), name: fName.trim(), value: Number(fValue),
          unit: fUnit.trim(), source: fSource.trim(), effectiveDate: fDate,
          category: fCategory.trim() || undefined, foodItemId: fFood || undefined }) });
      setMsg(d.message);
      setFKey(''); setFName(''); setFValue(''); setFUnit(''); setFSource(''); setFCategory(''); setFFood('');
      await loadFactors();
    } catch (err) {
      setFError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setFBusy(false);
    }
  }

  async function saveSnapshot() {
    setError('');
    setMsg('');
    if (!report) {
      setError('Build a report first — snapshots persist the displayed numbers.');
      return;
    }
    setSBusy(true);
    try {
      const d = await api<{ message: string }>('/impact/snapshots', { method: 'POST',
        body: JSON.stringify({ from: report.from, to: report.to,
          ...(kitchen ? { kitchenUnitId: kitchen } : {}),
          ...(meal ? { mealType: meal } : {}), ...(food ? { foodItemId: food } : {}) }) });
      setMsg(d.message);
      await loadSnapshots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Snapshot failed.');
    } finally {
      setSBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-xl font-bold text-leaf-900">Reports</h1>
        <p className="mt-1 text-sm text-stone-600">Daily, weekly, monthly, and ESG/sustainability reports from live data. Exports contain exactly what is displayed — nothing placeholder.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div><label htmlFor="rp-type" className="text-sm font-medium">Type</label>
            <select id="rp-type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option><option value="esg">ESG / sustainability</option>
            </select></div>
          <div><label htmlFor="rp-date" className="text-sm font-medium">Anchor date</label>
            <input id="rp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></div>
          <div><label htmlFor="rp-kitchen" className="text-sm font-medium">Kitchen</label>
            <select id="rp-kitchen" value={kitchen} onChange={(e) => setKitchen(e.target.value)} className={input}>
              <option value="">All kitchens</option>{kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select></div>
          <div><label htmlFor="rp-meal" className="text-sm font-medium">Meal</label>
            <select id="rp-meal" value={meal} onChange={(e) => setMeal(e.target.value)} className={input}>
              <option value="">All meals</option><option value="BREAKFAST">Breakfast</option><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option>
            </select></div>
          <div><label htmlFor="rp-food" className="text-sm font-medium">Food</label>
            <select id="rp-food" value={food} onChange={(e) => setFood(e.target.value)} className={input}>
              <option value="">All items</option>{foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></div>
          <div className="flex items-end"><button onClick={() => void loadReport()} disabled={loading} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{loading ? 'Building…' : 'Build report'}</button></div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      </div>

      {report && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">{report.type.toUpperCase()} report · {report.from} to {report.to}</h2>
            <div className="flex gap-2 text-sm">
              {(['csv', 'xlsx', 'pdf'] as const).map((ext) => (
                <button key={ext} onClick={() => void download(ext)} disabled={dlBusy !== ''}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 font-medium hover:bg-stone-100 disabled:opacity-60">
                  {dlBusy === ext ? 'Preparing…' : `Download ${ext.toUpperCase()}`}
                </button>
              ))}
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded bg-stone-50 p-2"><dt>Target / actual</dt><dd className="font-bold">{report.production.targetTotal} / {report.production.actualTotal} kg</dd></div>
            <div className="rounded bg-stone-50 p-2"><dt>Sold (util.)</dt><dd className="font-bold">{report.sales.soldKg} kg ({report.sales.utilizationPct ?? 'n/a'}%)</dd></div>
            <div className="rounded bg-stone-50 p-2"><dt>Waste</dt><dd className="font-bold">{report.waste.totalKg} kg</dd></div>
            <div className="rounded bg-stone-50 p-2" title="Operational estimate: food saved from disposal via prevention and redistribution"><dt>Food saved</dt><dd className="font-bold">{report.sustainability.foodSavedKg} kg</dd></div>
            <div className="rounded bg-stone-50 p-2" title="Configured cost savings estimate (INR per kg food rescued)"><dt>Cost saved (est.)</dt><dd className="font-bold">INR {report.sustainability.costSavedEstimate}</dd></div>
            <div className="rounded bg-stone-50 p-2" title="Configured emissions estimate (kg CO2e avoided per kg food rescued)"><dt>CO2e avoided (est.)</dt><dd className="font-bold">{report.sustainability.co2AvoidedKgEstimate} kgCO2e</dd></div>
            <div className="rounded bg-stone-50 p-2"><dt>Redistributed</dt><dd className="font-bold">{report.surplus.redistributedKg} kg</dd></div>
            <div className="rounded bg-stone-50 p-2"><dt>Forecast error</dt><dd className="font-bold">{report.ai.meanAbsPctErr ?? 'n/a'}{report.ai.meanAbsPctErr !== null ? '%' : ''}</dd></div>
          </dl>
          <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium text-leaf-800">Methodology &amp; how calculated</summary>
            <ul className="mt-1 list-disc pl-5 text-stone-700">
              {report.sustainability.howCalculated.map((h, i) => <li key={i}>{h}</li>)}
              <li>{report.ai.accuracyDefinition}</li>
              <li>Cost and CO2e figures are estimates derived from configured factors, not measurements. No guaranteed reductions are claimed.</li>
            </ul>
          </details>
          {canManage && <button onClick={() => void saveSnapshot()} disabled={sBusy} className="mt-3 rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{sBusy ? 'Saving…' : 'Persist as impact snapshot'}</button>}
        </div>
      )}

      <div className={card}>
        <h2 className="font-bold">Impact factors</h2>
        <p className="mt-1 text-sm text-stone-600">Every factor needs a name, value, unit, source, effective date, and active status. Resolution: food item → category → organization → global. No unexplained hardcoded numbers.</p>
        {factors.length === 0 ? <p className="mt-2 text-sm text-stone-600">None configured.</p> : (
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-stone-500"><th>Key</th><th>Name</th><th>Value</th><th>Scope</th><th>Source</th><th>Active</th></tr></thead>
            <tbody>{factors.map((f) => (
              <tr key={f.id} className="border-t border-stone-100">
                <td className="font-mono text-xs">{f.key}</td><td>{f.name}</td><td>{f.value} {f.unit}</td>
                <td>{f.foodItemId ? `food:${f.foodItemId.slice(-6)}` : f.category ? `cat:${f.category}` : f.organizationId ? 'org' : 'global'}</td>
                <td>{f.source ?? '—'}</td><td>{f.isActive ? 'yes' : 'no'}</td>
              </tr>))}</tbody>
          </table>
        )}
        {canManage ? (
          <form onSubmit={saveFactor} className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div><label htmlFor="fx-key" className="font-medium">Key</label><input id="fx-key" value={fKey} onChange={(e) => setFKey(e.target.value)} required className={input} placeholder="COST_PER_KG_FOOD" /></div>
            <div><label htmlFor="fx-name" className="font-medium">Name</label><input id="fx-name" value={fName} onChange={(e) => setFName(e.target.value)} required className={input} /></div>
            <div><label htmlFor="fx-value" className="font-medium">Value</label><input id="fx-value" type="number" min={0} step="any" value={fValue} onChange={(e) => setFValue(e.target.value)} required className={input} /></div>
            <div><label htmlFor="fx-unit" className="font-medium">Unit</label><input id="fx-unit" value={fUnit} onChange={(e) => setFUnit(e.target.value)} required className={input} placeholder="INR/kg" /></div>
            <div><label htmlFor="fx-source" className="font-medium">Source (required)</label><input id="fx-source" value={fSource} onChange={(e) => setFSource(e.target.value)} required className={input} /></div>
            <div><label htmlFor="fx-date" className="font-medium">Effective date</label><input id="fx-date" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} required className={input} /></div>
            <div><label htmlFor="fx-cat" className="font-medium">Category scope (optional)</label><input id="fx-cat" value={fCategory} onChange={(e) => setFCategory(e.target.value)} className={input} /></div>
            <div><label htmlFor="fx-food" className="font-medium">Food item scope</label>
              <select id="fx-food" value={fFood} onChange={(e) => setFFood(e.target.value)} className={input}>
                <option value="">None (broader scope)</option>{foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select></div>
            <div className="flex items-end"><button type="submit" disabled={fBusy} className="rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{fBusy ? 'Saving…' : 'Save factor'}</button></div>
            {fError && <p className="rounded-lg bg-red-50 p-2 text-red-800 sm:col-span-3" role="alert">{fError}</p>}
          </form>
        ) : (
          <p className="mt-2 text-sm text-stone-600">Only admins / kitchen managers can manage factors.</p>
        )}
      </div>

      <div className={card}>
        <h2 className="font-bold">Persisted impact snapshots ({snapshots.length})</h2>
        <p className="mt-1 text-sm text-stone-600">Stored numbers make past reports reproducible — values plus the filters and method that produced them.</p>
        {snapshots.length === 0 ? <p className="mt-2 text-sm text-stone-600">None yet. Build a report above, then persist it as a snapshot.</p> : (
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-stone-500"><th>Date</th><th>Saved</th><th>Cost (est.)</th><th>CO2e (est.)</th><th>Detail</th></tr></thead>
            <tbody>{snapshots.map((s) => (
              <tr key={s.id} className="border-t border-stone-100">
                <td>{s.date.slice(0, 10)}</td><td>{s.foodSavedKg} kg</td><td>INR {s.costSavedEstimate}</td><td>{s.co2AvoidedKgEstimate} kgCO2e</td>
                <td className="max-w-xs truncate text-xs text-stone-500">{s.detail?.method ?? ''} {JSON.stringify(s.detail?.filters ?? {})}</td>
              </tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
