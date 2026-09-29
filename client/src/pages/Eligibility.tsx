import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface Assessment {
  id: string; foodDescription: string; quantityKg: number;
  kitchenUnit?: { name: string } | null;
  humanConfirmed: boolean; eligible: boolean; reason: string | null;
  recordedInfoJson: string | null; assessedById: string | null; createdAt: string;
  verdict: 'ELIGIBLE' | 'REVIEW_REQUIRED' | 'INELIGIBLE';
}
interface FoodItem { id: string; name: string; isActive: boolean }

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';

function verdictChip(v: string) {
  const cls = v === 'ELIGIBLE' ? 'bg-leaf-100 text-leaf-900' : v === 'REVIEW_REQUIRED' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800';
  const tooltip = v === 'ELIGIBLE' ? 'Operational criteria met. Mandatory human confirmation recorded.' : v === 'REVIEW_REQUIRED' ? 'Requires manual review of pickup timing or marginal quantity.' : 'Operational cutoff or expiration criteria not met.';
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`} title={tooltip}>{v}</span>;
}

export function Eligibility() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const canManage = !!user && MANAGE_ROLES.includes(user.role);
  const [items, setItems] = useState<Assessment[]>([]);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ assessment: Assessment; disposalEntry: { id: string; quantityKg: number } | null } | null>(null);

  const [fKitchen, setFKitchen] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fFood, setFFood] = useState('');
  const [fQty, setFQty] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fPrepared, setFPrepared] = useState('');
  const [fHolding, setFHolding] = useState('');
  const [fStorage, setFStorage] = useState('');
  const [fDeadline, setFDeadline] = useState('');
  const [fExpiry, setFExpiry] = useState('');
  const [fConfirm, setFConfirm] = useState(false);
  const [fNote, setFNote] = useState('');
  const [fError, setFError] = useState('');
  const [fBusy, setFBusy] = useState(false);

  const [minQty, setMinQty] = useState('10');
  const [cMsg, setCMsg] = useState('');
  const [cError, setCError] = useState('');
  const [cBusy, setCBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [as, fi, cfg] = await Promise.all([
        api<{ assessments: Assessment[] }>(`/eligibility/assessments${filter ? `?verdict=${filter}` : ''}`),
        api<{ items: FoodItem[] }>('/food-items'),
        api<{ config: { minQuantityKg: number } | null }>('/eligibility/config'),
      ]);
      setItems(as.assessments);
      setFoods(fi.items.filter((i) => i.isActive));
      if (cfg.config) setMinQty(String(cfg.config.minQuantityKg));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load assessments.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setFKitchen(''); setFDesc(''); setFFood(''); setFQty(''); setFCategory('');
    setFPrepared(''); setFHolding(''); setFStorage(''); setFDeadline('');
    setFExpiry(''); setFConfirm(false); setFNote(''); setFError('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFError('');
    setResult(null);
    if (!fConfirm) {
      setFError('Manual quality confirmation is required — an assessment can never become eligible without it.');
      return;
    }
    setFBusy(true);
    try {
      const d = await api<{ message: string; assessment: Assessment; disposalEntry: { id: string; quantityKg: number } | null }>('/eligibility/assess', {
        method: 'POST',
        body: JSON.stringify({
          kitchenUnitId: fKitchen || undefined, foodDescription: fDesc.trim(),
          foodItemId: fFood || undefined, quantityKg: Number(fQty),
          foodCategory: fCategory.trim(), preparedAt: fPrepared ? new Date(fPrepared).toISOString() : '',
          holdingInfo: fHolding.trim(), storageArea: fStorage.trim(),
          availableUntil: fDeadline ? new Date(fDeadline).toISOString() : '',
          expiryDate: fExpiry || undefined, qualityConfirmed: true,
          qualityNote: fNote.trim() || undefined,
        }),
      });
      setResult({ assessment: d.assessment, disposalEntry: d.disposalEntry });
      resetForm();
      await load();
    } catch (err) {
      setFError(err instanceof Error ? err.message : 'Assessment failed.');
    } finally {
      setFBusy(false);
    }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setCMsg(''); setCError(''); setCBusy(true);
    try {
      const d = await api<{ message: string }>('/eligibility/config', {
        method: 'PUT', body: JSON.stringify({ minQuantityKg: Number(minQty) }),
      });
      setCMsg(d.message);
    } catch (err) {
      setCError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setCBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-xl font-bold text-leaf-900">Surplus eligibility</h1>
        <p className="mt-1 text-sm text-stone-600">
          Operational assessment from recorded details plus mandatory human quality confirmation.
          The quantity minimum is an operational cutoff, not a universal food-safety rule — nothing here certifies food as safe.
        </p>
        {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      <form onSubmit={submit} className={`${card} grid gap-3 sm:grid-cols-3`} noValidate>
        <p className="text-sm font-bold sm:col-span-3">New assessment (all fields required except where noted)</p>
        {fError && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800 sm:col-span-3" role="alert">{fError}</p>}
        <div><label htmlFor="el-kitchen" className="text-sm font-medium">Kitchen (optional)</label>
          <select id="el-kitchen" value={fKitchen} onChange={(e) => setFKitchen(e.target.value)} className={input}>
            <option value="">—</option>{kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select></div>
        <div><label htmlFor="el-desc" className="text-sm font-medium">Food description</label><input id="el-desc" value={fDesc} onChange={(e) => setFDesc(e.target.value)} required className={input} /></div>
        <div><label htmlFor="el-food" className="text-sm font-medium">Food item link (optional)</label>
          <select id="el-food" value={fFood} onChange={(e) => setFFood(e.target.value)} className={input}>
            <option value="">—</option>{foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></div>
        <div><label htmlFor="el-qty" className="text-sm font-medium">Quantity (kg)</label><input id="el-qty" type="number" min={0.01} step={0.1} value={fQty} onChange={(e) => setFQty(e.target.value)} required className={input} /></div>
        <div><label htmlFor="el-cat" className="text-sm font-medium">Food category</label><input id="el-cat" value={fCategory} onChange={(e) => setFCategory(e.target.value)} required className={input} placeholder="Cooked grains" /></div>
        <div><label htmlFor="el-prep" className="text-sm font-medium">Preparation time</label><input id="el-prep" type="datetime-local" value={fPrepared} onChange={(e) => setFPrepared(e.target.value)} required className={input} /></div>
        <div><label htmlFor="el-hold" className="text-sm font-medium">Holding / storage info</label><input id="el-hold" value={fHolding} onChange={(e) => setFHolding(e.target.value)} required className={input} placeholder="Covered vessels, cold room" /></div>
        <div><label htmlFor="el-store" className="text-sm font-medium">Storage area (text)</label><input id="el-store" value={fStorage} onChange={(e) => setFStorage(e.target.value)} required className={input} /></div>
        <div><label htmlFor="el-deadline" className="text-sm font-medium">Availability deadline</label><input id="el-deadline" type="datetime-local" value={fDeadline} onChange={(e) => setFDeadline(e.target.value)} required className={input} /></div>
        <div><label htmlFor="el-exp" className="text-sm font-medium">Expiry date (optional)</label><input id="el-exp" type="date" value={fExpiry} onChange={(e) => setFExpiry(e.target.value)} className={input} /></div>
        <div className="sm:col-span-2"><label htmlFor="el-note" className="text-sm font-medium">Quality note (optional)</label><input id="el-note" value={fNote} onChange={(e) => setFNote(e.target.value)} className={input} placeholder="Smell, look, texture checked" /></div>
        <div className="flex items-start gap-2 sm:col-span-3">
          <input id="el-confirm" type="checkbox" checked={fConfirm} onChange={(e) => setFConfirm(e.target.checked)} className="mt-1" />
          <label htmlFor="el-confirm" className="text-sm font-medium">I manually confirm the quality details above are accurate (required — without this the assessment is rejected).</label>
        </div>
        <div className="sm:col-span-3"><button type="submit" disabled={fBusy} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{fBusy ? 'Assessing…' : 'Submit assessment'}</button></div>
      </form>

      {result && (
        <div className="rounded-2xl border border-leaf-600 bg-white p-6 shadow-sm" role="status">
          <p className="font-bold">Verdict: {verdictChip(result.assessment.verdict)}</p>
          <p className="mt-1 text-sm text-stone-700">{result.assessment.reason}</p>
          {result.disposalEntry && <p className="mt-1 text-sm text-stone-700">Recorded disposal workflow entry {result.disposalEntry.id} for {result.disposalEntry.quantityKg} kg (see Food Flow timeline).</p>}
          {result.assessment.verdict === 'ELIGIBLE' && <p className="mt-1 text-sm text-stone-700">Eligible items can move to redistribution in the next phase — nothing is automatic or certified.</p>}
        </div>
      )}

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Past assessments ({items.length})</h2>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="el-filter">Verdict</label>
            <select id="el-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-stone-300 px-2 py-1">
              <option value="">All</option><option value="ELIGIBLE">Eligible</option><option value="REVIEW_REQUIRED">Review required</option><option value="INELIGIBLE">Ineligible</option>
            </select>
          </div>
        </div>
        {loading ? <p className="mt-2 text-sm" role="status">Loading…</p> : items.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No assessments yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {items.map((a) => (
              <li key={a.id} className="rounded-xl border border-stone-200 p-3">
                <p className="font-medium">{a.foodDescription} — {a.quantityKg} kg {verdictChip(a.verdict)}</p>
                <p className="mt-1 text-stone-700">{a.reason}</p>
                <p className="mt-1 text-xs text-stone-500">{new Date(a.createdAt).toLocaleString()} · confirmed by staff account {a.assessedById?.slice(-6) ?? '—'}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <h2 className="font-bold">Operational minimum quantity</h2>
        {canManage ? (
          <form onSubmit={saveConfig} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
            {cError && <p className="w-full rounded-lg bg-red-50 p-2 text-red-800" role="alert">{cError}</p>}
            {cMsg && <p className="w-full rounded-lg bg-leaf-100 p-2 text-leaf-900" role="status">{cMsg}</p>}
            <div><label htmlFor="el-min" className="font-medium">Minimum (kg, 1–1000)</label><input id="el-min" type="number" min={1} step={0.5} value={minQty} onChange={(e) => setMinQty(e.target.value)} className={input} /></div>
            <button type="submit" disabled={cBusy} className="rounded-lg bg-leaf-700 px-4 py-2 text-white hover:bg-leaf-800 disabled:opacity-60">{cBusy ? 'Saving…' : 'Save'}</button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-stone-600">Minimum currently in force is shown on each assessment's reasons. Only admins / kitchen managers can change it.</p>
        )}
        <p className="mt-1 text-xs text-stone-500">Operational cutoff, not a universal food-safety rule.</p>
      </div>
    </div>
  );
}
