import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface FoodItem {
  id: string;
  name: string;
  category: string;
  sellingPrice: number | null;
  standardPortionKg: number | null;
  isActive: boolean;
  unit: string;
}

interface FlowRecord {
  id: string;
  date: string;
  mealType: string;
  targetKg: number | null;
  preparedKg: number;
  servedKg: number;
  soldKg: number | null;
  wasteKg: number;
  remainingKg: number | null;
  adjustmentReason: string | null;
  isCorrection: boolean;
  correctionReason: string | null;
  notes: string | null;
  foodItem?: FoodItem | null;
  kitchenUnit?: { name: string } | null;
}

const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';

export function FoodData() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [records, setRecords] = useState<FlowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [fDate, setFDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fKitchen, setFKitchen] = useState('');
  const [fFood, setFFood] = useState('');
  const [fMeal, setFMeal] = useState('LUNCH');
  const [fTarget, setFTarget] = useState('');
  const [fProduced, setFProduced] = useState('');
  const [fSold, setFSold] = useState('');
  const [fWaste, setFWaste] = useState('');
  const [fRemain, setFRemain] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fAdjust, setFAdjust] = useState('');
  const [fCorrection, setFCorrection] = useState(false);
  const [fCorrReason, setFCorrReason] = useState('');
  const [fError, setFError] = useState('');
  const [fBusy, setFBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [qKitchen, setQKitchen] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fi, rc] = await Promise.all([
        api<{ items: FoodItem[] }>('/food-items'),
        api<{ records: FlowRecord[] }>(`/food-records${qKitchen ? `?kitchenUnitId=${qKitchen}` : ''}`),
      ]);
      setFoods(fi.items.filter((i) => i.isActive));
      setRecords(rc.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, [qKitchen]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedFood = useMemo(() => foods.find((f) => f.id === fFood) ?? null, [foods, fFood]);

  const liveHint = useMemo(() => {
    const p = Number(fProduced);
    const s = Number(fSold);
    const w = Number(fWaste);
    const r = Number(fRemain);
    if (![p, s, w, r].every(Number.isFinite)) return null;
    if (s + w + r <= p + 1e-9) return { ok: true, text: `Balanced: ${s}+${w}+${r} = ${s + w + r} ≤ produced ${p} kg.` };
    return { ok: false, text: `Out of balance: sold ${s} + waste ${w} + remaining ${r} = ${s + w + r} exceeds produced ${p} kg — add an adjustment reason or fix the numbers.` };
  }, [fProduced, fSold, fWaste, fRemain]);

  function resetForm() {
    setFKitchen('');
    setFFood('');
    setFMeal('LUNCH');
    setFTarget('');
    setFProduced('');
    setFSold('');
    setFWaste('');
    setFRemain('');
    setFNotes('');
    setFAdjust('');
    setFCorrection(false);
    setFCorrReason('');
    setFError('');
    setEditingId(null);
  }

  function startEdit(r: FlowRecord) {
    setEditingId(r.id);
    setFDate(new Date(r.date).toISOString().slice(0, 10));
    setFMeal(r.mealType);
    setFTarget(r.targetKg?.toString() ?? '');
    setFProduced(String(r.preparedKg));
    setFSold(String(r.soldKg ?? r.servedKg));
    setFWaste(String(r.wasteKg));
    setFRemain(r.remainingKg?.toString() ?? '');
    setFNotes(r.notes ?? '');
    setFAdjust(r.adjustmentReason ?? '');
    setFCorrection(r.isCorrection);
    setFCorrReason(r.correctionReason ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFError('');
    setMsg('');
    if (!fKitchen) return setFError('Please choose a kitchen/unit.');
    if (!fFood) return setFError('Please choose a saved food item.');
    const nums: Record<string, number> = {
      produced: Number(fProduced),
      sold: Number(fSold),
      waste: Number(fWaste),
      remaining: Number(fRemain),
    };
    for (const [k, v] of Object.entries(nums)) {
      if (!Number.isFinite(v) || v < 0) return setFError(`${k} must be a number ≥ 0 (kg).`);
    }
    if (fTarget.trim() !== '' && (!(Number(fTarget) >= 0))) return setFError('Target must be a number ≥ 0 (kg).');
    setFBusy(true);
    try {
      const body = {
        date: fDate,
        kitchenUnitId: fKitchen,
        foodItemId: fFood,
        mealType: fMeal,
        targetKg: fTarget.trim() === '' ? undefined : Number(fTarget),
        producedKg: nums.produced,
        soldKg: nums.sold,
        wasteKg: nums.waste,
        remainingKg: nums.remaining,
        notes: fNotes.trim() || undefined,
        adjustmentReason: fAdjust.trim() || undefined,
        isCorrection: editingId ? true : fCorrection,
        correctionReason: editingId ? fCorrReason.trim() || 'Corrected via Food Data form' : fCorrReason.trim() || undefined,
      };
      if (editingId) {
        const d = await api<{ message: string }>(`/food-records/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg(d.message);
      } else {
        const d = await api<{ message: string }>('/food-records', { method: 'POST', body: JSON.stringify(body) });
        setMsg(d.message);
      }
      resetForm();
      setFDate(new Date().toISOString().slice(0, 10));
      await load();
    } catch (err) {
      setFError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setFBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-leaf-900">Food Data (Food Flow)</h1>
        <p className="mt-1 text-sm text-stone-600">
          Operational quantities in kilograms: target → produced → sold + waste + remaining. Financial figures (prices) are shown separately below and never enter the kg math.
        </p>
        {msg && <p className="mt-2 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
        {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">{editingId ? 'Edit record (saved as correction)' : 'New Food Flow entry'}</h2>
        {foods.length === 0 && !loading && (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No active food items yet. An admin or manager must create them under Menu first.</p>
        )}
        <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-3" noValidate>
          {fError && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800 sm:col-span-3" role="alert">{fError}</p>}
          <div><label htmlFor="fd-date" className="text-sm font-medium">Date</label><input id="fd-date" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className={input} required /></div>
          <div><label htmlFor="fd-kit" className="text-sm font-medium">Kitchen/unit</label>
            <select id="fd-kit" value={fKitchen} onChange={(e) => setFKitchen(e.target.value)} className={input} required>
              <option value="">— Choose —</option>
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div><label htmlFor="fd-food" className="text-sm font-medium">Food item (saved)</label>
            <select id="fd-food" value={fFood} onChange={(e) => setFFood(e.target.value)} className={input} required>
              <option value="">— Choose —</option>
              {foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div><label htmlFor="fd-meal" className="text-sm font-medium">Meal</label>
            <select id="fd-meal" value={fMeal} onChange={(e) => setFMeal(e.target.value)} className={input}>
              <option value="BREAKFAST">Breakfast</option><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option>
            </select>
          </div>
          <div><label htmlFor="fd-target" className="text-sm font-medium">Target (kg, optional)</label><input id="fd-target" type="number" min={0} step={0.1} value={fTarget} onChange={(e) => setFTarget(e.target.value)} className={input} /></div>
          <div><label htmlFor="fd-prod" className="text-sm font-medium">Produced (kg)</label><input id="fd-prod" type="number" min={0} step={0.1} value={fProduced} onChange={(e) => setFProduced(e.target.value)} className={input} required /></div>
          <div><label htmlFor="fd-sold" className="text-sm font-medium">Sold (kg)</label><input id="fd-sold" type="number" min={0} step={0.1} value={fSold} onChange={(e) => setFSold(e.target.value)} className={input} required /></div>
          <div><label htmlFor="fd-waste" className="text-sm font-medium">Waste (kg)</label><input id="fd-waste" type="number" min={0} step={0.1} value={fWaste} onChange={(e) => setFWaste(e.target.value)} className={input} required /></div>
          <div><label htmlFor="fd-rem" className="text-sm font-medium">Remaining / surplus (kg)</label><input id="fd-rem" type="number" min={0} step={0.1} value={fRemain} onChange={(e) => setFRemain(e.target.value)} className={input} required /></div>
          <div className="sm:col-span-3"><label htmlFor="fd-notes" className="text-sm font-medium">Notes (optional)</label><input id="fd-notes" value={fNotes} onChange={(e) => setFNotes(e.target.value)} className={input} /></div>
          <div className="sm:col-span-3"><label htmlFor="fd-adj" className="text-sm font-medium">Adjustment reason (required only when produced &lt; sold + waste + remaining)</label><input id="fd-adj" value={fAdjust} onChange={(e) => setFAdjust(e.target.value)} className={input} placeholder="e.g. Spillage during service, verified by manager" /></div>
          {!editingId && (
            <div className="flex items-center gap-2 sm:col-span-3">
              <input id="fd-corr" type="checkbox" checked={fCorrection} onChange={(e) => setFCorrection(e.target.checked)} />
              <label htmlFor="fd-corr" className="text-sm">Record as correction (duplicate date/kitchen/food/meal allowed)</label>
            </div>
          )}
          {(fCorrection || editingId) && (
            <div className="sm:col-span-3"><label htmlFor="fd-creason" className="text-sm font-medium">Correction reason (min 5 characters)</label><input id="fd-creason" value={fCorrReason} onChange={(e) => setFCorrReason(e.target.value)} className={input} /></div>
          )}
          {liveHint && <p className={`rounded-lg p-2 text-sm sm:col-span-3 ${liveHint.ok ? 'bg-leaf-100 text-leaf-900' : 'bg-amber-50 text-amber-900'}`} role="status">{liveHint.text}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" disabled={fBusy} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{fBusy ? 'Saving…' : editingId ? 'Save correction' : 'Save entry'}</button>
            {editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100">Cancel edit</button>}
          </div>
        </form>
        {selectedFood?.sellingPrice != null && (
          <p className="mt-3 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
            Financial info (reference only): {selectedFood.name} sells at ₹{selectedFood.sellingPrice}
            {selectedFood.standardPortionKg ? ` per ~${selectedFood.standardPortionKg} kg portion` : ''}. Prices never affect Food Flow math.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Recent records ({records.length})</h2>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="fd-qkit">Kitchen</label>
            <select id="fd-qkit" value={qKitchen} onChange={(e) => setQKitchen(e.target.value)} className="rounded-lg border border-stone-300 px-2 py-1">
              <option value="">All</option>
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <button onClick={() => void load()} className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-100">Refresh</button>
          </div>
        </div>
        {loading ? <p className="mt-2 text-sm" role="status">Loading…</p> : records.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No records yet. Save the first entry above.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {records.slice(0, 60).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 p-3 text-sm">
                <div>
                  <p className="font-bold">{new Date(r.date).toLocaleDateString()} · {r.mealType} · {r.foodItem?.name ?? '—'}{r.isCorrection && <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-900">correction</span>}</p>
                  <p className="text-stone-600">
                    target {r.targetKg ?? '—'} → produced {r.preparedKg} → sold {r.soldKg ?? r.servedKg} + waste {r.wasteKg} + remaining {r.remainingKg ?? '—'} kg
                    {r.kitchenUnit ? ` · ${r.kitchenUnit.name}` : ''}
                  </p>
                  {r.adjustmentReason && <p className="text-xs text-amber-800">Adjustment: {r.adjustmentReason}</p>}
                  {r.notes && <p className="text-xs text-stone-500">{r.notes}</p>}
                </div>
                <button onClick={() => startEdit(r)} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">Edit</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
