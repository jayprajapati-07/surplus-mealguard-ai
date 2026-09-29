import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface Lot {
  id: string; foodItemId: string | null; food: string;
  quantityKg: number; unit: string; supplier: string | null;
  purchaseDate: string | null; expiryDate: string | null; daysToExpiry: number | null;
  storageArea: string | null; batchCode: string | null; status: string;
}
interface FoodItem { id: string; name: string; isActive: boolean }
interface Thresholds { lowStockKg: number; nearExpiryDays: number; excessKg: number }

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';

export function Inventory() {
  const { user } = useAuth();
  const canManage = !!user && MANAGE_ROLES.includes(user.role);
  const [items, setItems] = useState<Lot[]>([]);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [alerts, setAlerts] = useState<{ lowStock: Lot[]; nearExpiry: Lot[]; expired: Lot[]; excess: Lot[] } | null>(null);
  const [thresholds, setThresholds] = useState<(Thresholds & { customized?: boolean }) | null>(null);
  const [filter, setFilter] = useState('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [fFood, setFFood] = useState('');
  const [fQty, setFQty] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fPurchase, setFPurchase] = useState('');
  const [fExpiry, setFExpiry] = useState('');
  const [fStorage, setFStorage] = useState('');
  const [fBatch, setFBatch] = useState('');
  const [fError, setFError] = useState('');
  const [fBusy, setFBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Lot | null>(null);

  const [adjId, setAdjId] = useState<string | null>(null);
  const [adjDelta, setAdjDelta] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjError, setAdjError] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  const [confirm, setConfirm] = useState<{ action: 'archive' | 'restore'; id: string; label: string } | null>(null);
  const [cBusy, setCBusy] = useState(false);

  const [tLow, setTLow] = useState('5');
  const [tNear, setTNear] = useState('3');
  const [tExcess, setTExcess] = useState('100');
  const [tMsg, setTMsg] = useState('');
  const [tError, setTError] = useState('');
  const [tBusy, setTBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [inv, fi, al] = await Promise.all([
        api<{ items: Lot[] }>(`/inventory?status=${filter}`),
        api<{ items: FoodItem[] }>('/food-items'),
        api<{ thresholds: Thresholds; alerts: { lowStock: Lot[]; nearExpiry: Lot[]; expired: Lot[]; excess: Lot[] } }>('/inventory/alerts'),
      ]);
      setItems(inv.items);
      setFoods(fi.items.filter((i) => i.isActive));
      setAlerts(al.alerts);
      setThresholds(al.thresholds);
      setTLow(String(al.thresholds.lowStockKg));
      setTNear(String(al.thresholds.nearExpiryDays));
      setTExcess(String(al.thresholds.excessKg));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load inventory.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setFFood(''); setFQty(''); setFSupplier(''); setFPurchase(''); setFExpiry('');
    setFStorage(''); setFBatch(''); setFError(''); setEditing(null);
  }

  async function submitLot(e: React.FormEvent) {
    e.preventDefault();
    setFError('');
    setMsg('');
    setFBusy(true);
    try {
      const body = {
        foodItemId: fFood, quantityKg: Number(fQty),
        supplier: fSupplier.trim() || undefined,
        purchaseDate: fPurchase || undefined, expiryDate: fExpiry || undefined,
        storageArea: fStorage.trim() || undefined, batchCode: fBatch.trim() || undefined,
      };
      if (editing) {
        const d = await api<{ message: string }>(`/inventory/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg(d.message);
      } else {
        const d = await api<{ message: string }>('/inventory', { method: 'POST', body: JSON.stringify(body) });
        setMsg(d.message);
      }
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setFError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setFBusy(false);
    }
  }

  function startEdit(lot: Lot) {
    setEditing(lot);
    setFFood(lot.foodItemId ?? '');
    setFQty(String(lot.quantityKg));
    setFSupplier('');
    setFPurchase('');
    setFExpiry(lot.expiryDate ? lot.expiryDate.slice(0, 10) : '');
    setFStorage('');
    setFBatch('');
    setFError('');
    setShowForm(true);
  }

  async function runAdjust(id: string) {
    setAdjError('');
    setMsg('');
    setAdjBusy(true);
    try {
      const d = await api<{ message: string }>(`/inventory/${id}/adjust`, {
        method: 'PUT', body: JSON.stringify({ deltaKg: Number(adjDelta), reason: adjReason.trim() }),
      });
      setMsg(d.message);
      setAdjId(null); setAdjDelta(''); setAdjReason('');
      await load();
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : 'Adjustment failed.');
    } finally {
      setAdjBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setCBusy(true);
    try {
      const d = await api<{ message: string }>(`/inventory/${confirm.id}/${confirm.action}`, { method: 'POST' });
      setMsg(d.message);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setCBusy(false);
    }
  }

  async function saveThresholds(e: React.FormEvent) {
    e.preventDefault();
    setTMsg(''); setTError(''); setTBusy(true);
    try {
      const d = await api<{ message: string }>('/inventory/thresholds', {
        method: 'PUT', body: JSON.stringify({ lowStockKg: Number(tLow), nearExpiryDays: Number(tNear), excessKg: Number(tExcess) }),
      });
      setTMsg(d.message);
      await load();
    } catch (err) {
      setTError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setTBusy(false);
    }
  }

  const groups: { key: keyof NonNullable<typeof alerts>; title: string; hint: string }[] = [
    { key: 'lowStock', title: 'Low stock', hint: `at or below ${thresholds?.lowStockKg ?? 5} kg` },
    { key: 'nearExpiry', title: 'Near expiry', hint: `expires within ${thresholds?.nearExpiryDays ?? 3} days` },
    { key: 'expired', title: 'Expired', hint: 'expiry date has passed' },
    { key: 'excess', title: 'Excess inventory', hint: `at or above ${thresholds?.excessKg ?? 100} kg` },
  ];

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-leaf-900">Inventory</h1>
            <p className="mt-1 text-sm text-stone-600">Stock lots with supplier, dates, and storage-area text. No hardware or sensor readings — quantities come from recorded entries.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="inv-filter">Show</label>
            <select id="inv-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-stone-300 px-2 py-1">
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
              <option value="">All</option>
            </select>
            <button onClick={() => { resetForm(); setShowForm((v) => !v); }} className="rounded-lg bg-leaf-700 px-3 py-1.5 font-medium text-white hover:bg-leaf-800">
              {showForm ? 'Hide form' : '+ New lot'}
            </button>
          </div>
        </div>
        {msg && <p className="mt-2 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
        {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      {confirm && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="Confirm action">
          <p className="text-sm font-bold">{confirm.action === 'archive' ? `Archive lot “${confirm.label}”? It leaves alerts and stays restorable.` : `Restore lot “${confirm.label}” to active?`}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={runConfirm} disabled={cBusy} className="rounded-lg bg-leaf-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{cBusy ? 'Working…' : 'Confirm'}</button>
            <button onClick={() => setConfirm(null)} disabled={cBusy} className="rounded-lg border border-stone-300 px-4 py-1.5 text-sm hover:bg-white">Cancel</button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submitLot} className={`${card} grid gap-3 sm:grid-cols-3`} noValidate>
          <p className="text-sm font-bold sm:col-span-3">{editing ? 'Edit lot' : 'New stock lot'}</p>
          {fError && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800 sm:col-span-3" role="alert">{fError}</p>}
          <div><label htmlFor="in-food" className="text-sm font-medium">Food item</label>
            <select id="in-food" value={fFood} onChange={(e) => setFFood(e.target.value)} required className={input}>
              <option value="">— Choose —</option>{foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></div>
          <div><label htmlFor="in-qty" className="text-sm font-medium">Quantity (kg)</label><input id="in-qty" type="number" min={0} step={0.1} value={fQty} onChange={(e) => setFQty(e.target.value)} required className={input} /></div>
          <div><label htmlFor="in-sup" className="text-sm font-medium">Supplier (optional)</label><input id="in-sup" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} className={input} /></div>
          <div><label htmlFor="in-pur" className="text-sm font-medium">Purchase date (optional)</label><input id="in-pur" type="date" value={fPurchase} onChange={(e) => setFPurchase(e.target.value)} className={input} /></div>
          <div><label htmlFor="in-exp" className="text-sm font-medium">Expiry date (optional)</label><input id="in-exp" type="date" value={fExpiry} onChange={(e) => setFExpiry(e.target.value)} className={input} /></div>
          <div><label htmlFor="in-store" className="text-sm font-medium">Storage area (text only)</label><input id="in-store" value={fStorage} onChange={(e) => setFStorage(e.target.value)} className={input} placeholder="Dry store, shelf A" /></div>
          <div><label htmlFor="in-batch" className="text-sm font-medium">Batch code (optional)</label><input id="in-batch" value={fBatch} onChange={(e) => setFBatch(e.target.value)} className={input} /></div>
          <div className="flex items-end"><button type="submit" disabled={fBusy} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{fBusy ? 'Saving…' : editing ? 'Save changes' : 'Record lot'}</button></div>
        </form>
      )}

      <div className={card}>
        <h2 className="font-bold">Stock alerts (from recorded dates &amp; quantities)</h2>
        {!alerts ? <p className="mt-2 text-sm" role="status">Loading…</p> : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.key} className="rounded-xl border border-stone-200 p-3">
                <p className="text-sm font-bold">{g.title} ({alerts[g.key].length}) <span className="font-normal text-stone-500">— {g.hint}</span></p>
                {alerts[g.key].length === 0 ? <p className="mt-1 text-sm text-stone-500">None.</p> : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {alerts[g.key].map((a) => (
                      <li key={a.id}>• {a.food} — {a.quantityKg} {a.unit}{a.daysToExpiry !== undefined && a.daysToExpiry !== null ? `, ${a.daysToExpiry} day(s) to expiry` : ''}{a.storageArea ? `, ${a.storageArea}` : ''}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <h2 className="font-bold">Lots ({items.length})</h2>
        {loading ? <p className="mt-2 text-sm" role="status">Loading…</p> : items.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No lots here yet. Record the first one above.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((l) => (
              <li key={l.id} className="rounded-xl border border-stone-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{l.food} — {l.quantityKg} {l.unit}
                      {l.status !== 'ACTIVE' && <span className="ml-1 rounded bg-stone-200 px-1.5 py-0.5 text-xs">archived</span>}
                      {l.daysToExpiry !== null && l.daysToExpiry !== undefined && l.status === 'ACTIVE' && (
                        <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${l.daysToExpiry < 0 ? 'bg-red-100 text-red-800' : l.daysToExpiry <= (thresholds?.nearExpiryDays ?? 3) ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-600'}`}>
                          {l.daysToExpiry < 0 ? `expired ${-l.daysToExpiry}d ago` : `${l.daysToExpiry}d to expiry`}
                        </span>
                      )}</p>
                    <p className="text-stone-600">
                      {[l.supplier && `supplier ${l.supplier}`, l.purchaseDate && `bought ${new Date(l.purchaseDate).toLocaleDateString()}`, l.expiryDate && `expires ${new Date(l.expiryDate).toLocaleDateString()}`, l.storageArea, l.batchCode && `batch ${l.batchCode}`].filter(Boolean).join(' · ') || 'No extra details recorded.'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(l)} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">Edit</button>
                    <button onClick={() => { setAdjId(adjId === l.id ? null : l.id); setAdjDelta(''); setAdjReason(''); setAdjError(''); }} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">Adjust</button>
                    {l.status === 'ACTIVE'
                      ? <button onClick={() => setConfirm({ action: 'archive', id: l.id, label: `${l.food} ${l.quantityKg}${l.unit}` })} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">Archive</button>
                      : <button onClick={() => setConfirm({ action: 'restore', id: l.id, label: l.food })} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">Restore</button>}
                  </div>
                </div>
                {adjId === l.id && (
                  <div className="mt-2 rounded-lg bg-stone-50 p-3">
                    {adjError && <p className="rounded-lg bg-red-50 p-2 text-red-800" role="alert">{adjError}</p>}
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div><label htmlFor={`adj-kg-${l.id}`} className="font-medium">Change (kg, negative removes)</label><input id={`adj-kg-${l.id}`} type="number" step={0.1} value={adjDelta} onChange={(e) => setAdjDelta(e.target.value)} className={input} /></div>
                      <div className="sm:col-span-2"><label htmlFor={`adj-why-${l.id}`} className="font-medium">Reason (min 5 chars, required)</label><input id={`adj-why-${l.id}`} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} className={input} /></div>
                    </div>
                    <button onClick={() => void runAdjust(l.id)} disabled={adjBusy} className="mt-2 rounded-lg bg-leaf-700 px-4 py-1.5 text-white hover:bg-leaf-800 disabled:opacity-60">{adjBusy ? 'Saving…' : 'Apply adjustment'}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <h2 className="font-bold">Alert thresholds</h2>
        {canManage ? (
          <form onSubmit={saveThresholds} className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
            {tError && <p className="rounded-lg bg-red-50 p-2 text-red-800 sm:col-span-4" role="alert">{tError}</p>}
            {tMsg && <p className="rounded-lg bg-leaf-100 p-2 text-leaf-900 sm:col-span-4" role="status">{tMsg}</p>}
            <div><label htmlFor="th-low" className="font-medium">Low stock (kg)</label><input id="th-low" type="number" min={0} step={0.5} value={tLow} onChange={(e) => setTLow(e.target.value)} className={input} /></div>
            <div><label htmlFor="th-near" className="font-medium">Near expiry (days)</label><input id="th-near" type="number" min={0} step={1} value={tNear} onChange={(e) => setTNear(e.target.value)} className={input} /></div>
            <div><label htmlFor="th-exc" className="font-medium">Excess (kg)</label><input id="th-exc" type="number" min={1} step={1} value={tExcess} onChange={(e) => setTExcess(e.target.value)} className={input} /></div>
            <div className="flex items-end"><button type="submit" disabled={tBusy} className="rounded-lg bg-leaf-700 px-4 py-2 text-white hover:bg-leaf-800 disabled:opacity-60">{tBusy ? 'Saving…' : 'Save'}</button></div>
          </form>
        ) : (
          <p className="mt-2 text-sm text-stone-600">Low stock ≤ {thresholds?.lowStockKg ?? 5} kg · near expiry ≤ {thresholds?.nearExpiryDays ?? 3} days · excess ≥ {thresholds?.excessKg ?? 100} kg. Only admins / kitchen managers can change them.</p>
        )}
      </div>
    </div>
  );
}
