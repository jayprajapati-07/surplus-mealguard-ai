import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface FoodItem {
  id: string;
  name: string;
  category: string;
  mealType: string | null;
  standardPortionKg: number | null;
  sellingPrice: number | null;
  recipeText: string | null;
  isActive: boolean;
  unit: string;
}

interface MenuLine {
  id: string;
  foodItemId: string | null;
  name: string;
  quantityKg: number;
  foodItem?: FoodItem | null;
}

interface Menu {
  id: string;
  date: string;
  scope: string;
  mealType: string;
  title: string | null;
  isSpecial: boolean;
  specialLabel: string | null;
  kitchenUnitId: string | null;
  kitchenUnit?: { name: string } | null;
  items: MenuLine[];
}

const MEALS = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
const input = 'mt-1 w-full rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741] focus:ring-1 focus:ring-[#006B48]';
const card = 'rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm';
const btnCls = 'rounded-xl bg-[#006B48] px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-[#004C35] active:scale-95 disabled:opacity-60 transition-all cursor-pointer';
const ghostCls = 'rounded-xl border border-[#E3ECE6] bg-white px-3 py-1.5 text-xs font-semibold text-[#0C2741] hover:bg-[#F2F7F4] active:scale-95 disabled:opacity-60 transition-all cursor-pointer';

export function MenuPage() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const [items, setItems] = useState<FoodItem[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [msg, setMsg] = useState('');

  // food form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fName, setFName] = useState('');
  const [fCat, setFCat] = useState('');
  const [fMeal, setFMeal] = useState('ANY');
  const [fPortion, setFPortion] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fUnit, setFUnit] = useState('kg');
  const [fRecipe, setFRecipe] = useState('');
  const [fError, setFError] = useState('');
  const [fBusy, setFBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // two-step confirm for archive/restore/delete
  const [confirm, setConfirm] = useState<{ action: 'archive' | 'restore' | 'delete' | 'deleteMenu'; id: string; label: string } | null>(null);
  const [cBusy, setCBusy] = useState(false);

  // menu builder
  const [mEditing, setMEditing] = useState<string | null>(null);
  const [mScope, setMScope] = useState<'DAILY' | 'WEEKLY'>('DAILY');
  const [mDate, setMDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mMeal, setMMeal] = useState<(typeof MEALS)[number]>('LUNCH');
  const [mKitchen, setMKitchen] = useState('');
  const [mTitle, setMTitle] = useState('');
  const [mSpecial, setMSpecial] = useState(false);
  const [mLabel, setMLabel] = useState('');
  const [mLines, setMLines] = useState<{ foodItemId: string; quantityKg: string }[]>([{ foodItemId: '', quantityKg: '' }]);
  const [mError, setMError] = useState('');
  const [mBusy, setMBusy] = useState(false);
  const [showMenuForm, setShowMenuForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fi, mn] = await Promise.all([api<{ items: FoodItem[] }>('/food-items'), api<{ menus: Menu[] }>('/menus')]);
      setItems(fi.items);
      setMenus(mn.menus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeItems = items.filter((i) => i.isActive);
  const shown = items.filter((i) => (filter === 'all' ? true : filter === 'active' ? i.isActive : !i.isActive));

  function resetFoodForm() {
    setEditingId(null);
    setFName('');
    setFCat('');
    setFMeal('ANY');
    setFPortion('');
    setFPrice('');
    setFUnit('kg');
    setFRecipe('');
    setFError('');
  }

  function startEdit(item: FoodItem) {
    setEditingId(item.id);
    setFName(item.name);
    setFCat(item.category);
    setFMeal(item.mealType ?? 'ANY');
    setFPortion(item.standardPortionKg?.toString() ?? '');
    setFPrice(item.sellingPrice?.toString() ?? '');
    setFUnit(item.unit);
    setFRecipe(item.recipeText ?? '');
    setFError('');
    setShowForm(true);
  }

  async function submitFood(e: FormEvent) {
    e.preventDefault();
    setFError('');
    if (fName.trim().length < 2) return setFError('Food name must be at least 2 characters.');
    if (fCat.trim().length < 2) return setFError('Category is required.');
    setFBusy(true);
    try {
      const body = {
        name: fName.trim(),
        category: fCat.trim(),
        mealType: fMeal === 'ANY' ? undefined : fMeal,
        standardPortionKg: fPortion.trim() === '' ? undefined : Number(fPortion),
        sellingPrice: fPrice.trim() === '' ? undefined : Number(fPrice),
        unit: fUnit.trim() || 'kg',
        recipeText: fRecipe.trim() === '' ? undefined : fRecipe.trim(),
      };
      if (editingId) {
        const d = await api<{ message: string }>(`/food-items/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg(d.message);
      } else {
        const d = await api<{ message: string }>('/food-items', { method: 'POST', body: JSON.stringify(body) });
        setMsg(d.message);
      }
      resetFoodForm();
      setShowForm(false);
      if (window.showToast) window.showToast('Food item saved successfully');
      await load();
    } catch (err) {
      setFError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setFBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setCBusy(true);
    try {
      if (confirm.action === 'deleteMenu') {
        const d = await api<{ message: string }>(`/menus/${confirm.id}`, { method: 'DELETE' });
        setMsg(d.message);
      } else if (confirm.action === 'delete') {
        const d = await api<{ message: string }>(`/food-items/${confirm.id}`, { method: 'DELETE' });
        setMsg(d.message);
      } else {
        const d = await api<{ message: string }>(`/food-items/${confirm.id}/${confirm.action}`, { method: 'POST' });
        setMsg(d.message);
      }
      setConfirm(null);
      if (window.showToast) window.showToast('Action processed successfully');
      await load();
    } catch (err) {
      setMsg('');
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setCBusy(false);
    }
  }

  function resetMenuForm() {
    setMEditing(null);
    setMScope('DAILY');
    setMMeal('LUNCH');
    setMKitchen('');
    setMTitle('');
    setMSpecial(false);
    setMLabel('');
    setMLines([{ foodItemId: '', quantityKg: '' }]);
    setMError('');
  }

  function startMenuEdit(m: Menu) {
    setMEditing(m.id);
    setMScope(m.scope === 'WEEKLY' ? 'WEEKLY' : 'DAILY');
    setMDate(new Date(m.date).toISOString().slice(0, 10));
    setMMeal(m.mealType as (typeof MEALS)[number]);
    setMKitchen(m.kitchenUnitId ?? '');
    setMTitle(m.title ?? '');
    setMSpecial(m.isSpecial);
    setMLabel(m.specialLabel ?? '');
    setMLines(m.items.map((l) => ({ foodItemId: l.foodItemId ?? '', quantityKg: String(l.quantityKg) })));
    setMError('');
    setShowMenuForm(true);
  }

  async function submitMenu(e: FormEvent) {
    e.preventDefault();
    setMError('');
    const lines = mLines.filter((l) => l.foodItemId && l.quantityKg.trim() !== '');
    if (lines.length === 0) return setMError('Add at least one food item line (choose a saved food item + quantity in kg).');
    for (const l of lines) {
      if (!(Number(l.quantityKg) > 0)) return setMError('Each line quantity must be positive (kg).');
    }
    if (mSpecial && mLabel.trim() === '') return setMError('Special menus need a label.');
    setMBusy(true);
    try {
      const body = {
        kitchenUnitId: mKitchen || undefined,
        date: mScope === 'DAILY' ? mDate : undefined,
        weekStart: mScope === 'WEEKLY' ? mDate : undefined,
        scope: mScope,
        mealType: mMeal,
        title: mTitle.trim() || undefined,
        isSpecial: mSpecial,
        specialLabel: mLabel.trim() || undefined,
        items: lines.map((l) => ({ foodItemId: l.foodItemId, quantityKg: Number(l.quantityKg) })),
      };
      if (mEditing) {
        const d = await api<{ message: string }>(`/menus/${mEditing}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg(d.message);
      } else {
        const d = await api<{ message: string }>('/menus', { method: 'POST', body: JSON.stringify(body) });
        setMsg(d.message);
      }
      resetMenuForm();
      setShowMenuForm(false);
      if (window.showToast) window.showToast('Menu saved successfully');
      await load();
    } catch (err) {
      setMError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setMBusy(false);
    }
  }

  return (
    <div className="space-y-5 animate-fadeInUpStagger">
      <div className={card}>
        <h1 className="text-xl font-bold text-[#0C2741]">Menu &amp; Food Catalog Management</h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-500">
          Saved food items are reused in operational menus, target formulas, and daily records. All quantities standard in kg.
        </p>
        {msg && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{msg}</p>}
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
      </div>

      {confirm && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="Confirm action">
          <p className="text-xs sm:text-sm font-bold text-amber-900">
            {confirm.action === 'archive' && `Archive “${confirm.label}”? Past menus and records keep their history.`}
            {confirm.action === 'restore' && `Restore “${confirm.label}” to active items?`}
            {confirm.action === 'delete' && `Delete “${confirm.label}”? Only possible when unused; otherwise archive.`}
            {confirm.action === 'deleteMenu' && `Delete menu “${confirm.label}”? Its lines are removed too.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={runConfirm} disabled={cBusy} className="rounded-xl bg-red-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-800 active:scale-95 disabled:opacity-60 transition-all cursor-pointer">
              {cBusy ? 'Working…' : 'Confirm'}
            </button>
            <button onClick={() => setConfirm(null)} disabled={cBusy} className="rounded-xl border border-stone-300 bg-white px-4 py-1.5 text-xs font-semibold hover:bg-stone-50 transition-all cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Food items section */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3ECE6] pb-3">
          <h2 className="text-base font-bold text-[#0C2741]">Food Items Catalog ({shown.length})</h2>
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <label htmlFor="fi-filter" className="text-gray-500 font-medium">Show</label>
            <select id="fi-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded-xl border border-[#E3ECE6] px-3 py-1.5 bg-white text-[#0C2741]">
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
            <button
              onClick={() => { resetFoodForm(); setShowForm((v) => !v); }}
              className={btnCls}
            >
              {showForm ? 'Hide form' : '+ New Food Item'}
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={submitFood} className="mt-4 grid gap-3 rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-4 sm:grid-cols-2 text-xs sm:text-sm" noValidate>
            <div className="sm:col-span-2"><p className="font-bold text-[#0C2741]">{editingId ? 'Edit Food Item' : 'New Food Item'}</p></div>
            {fError && <p className="rounded-xl bg-red-50 p-2 text-xs text-red-800 sm:col-span-2 font-bold" role="alert">{fError}</p>}
            <div><label htmlFor="fi-name" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Name (unique among active)</label><input id="fi-name" value={fName} onChange={(e) => setFName(e.target.value)} className={input} required /></div>
            <div><label htmlFor="fi-cat" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Category</label><input id="fi-cat" value={fCat} onChange={(e) => setFCat(e.target.value)} className={input} placeholder="Grains, Pulses, Vegetables…" required /></div>
            <div><label htmlFor="fi-meal" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Meal type</label>
              <select id="fi-meal" value={fMeal} onChange={(e) => setFMeal(e.target.value)} className={input}>
                <option value="ANY">Any</option><option value="BREAKFAST">Breakfast</option><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option>
              </select>
            </div>
            <div><label htmlFor="fi-unit" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Unit</label><input id="fi-unit" value={fUnit} onChange={(e) => setFUnit(e.target.value)} className={input} /></div>
            <div><label htmlFor="fi-portion" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Standard portion (kg, optional)</label><input id="fi-portion" type="number" min={0.001} step={0.01} value={fPortion} onChange={(e) => setFPortion(e.target.value)} className={input} /></div>
            <div><label htmlFor="fi-price" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Selling price (reference only, optional)</label><input id="fi-price" type="number" min={0} step={0.5} value={fPrice} onChange={(e) => setFPrice(e.target.value)} className={input} /></div>
            <div className="sm:col-span-2"><label htmlFor="fi-recipe" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Recipe / ingredients (optional)</label><textarea id="fi-recipe" value={fRecipe} onChange={(e) => setFRecipe(e.target.value)} className={input} rows={2} /></div>
            <div className="sm:col-span-2"><button type="submit" disabled={fBusy} className={btnCls}>{fBusy ? 'Saving…' : editingId ? 'Save Changes' : 'Create Item'}</button></div>
          </form>
        )}

        {loading ? <p className="mt-4 text-xs sm:text-sm text-gray-500" role="status">Loading catalog…</p> : shown.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-[#E3ECE6] p-6 text-center text-xs sm:text-sm text-gray-500">No food items here yet. Create the first one above.</div>
        ) : (
          <ul className="mt-4 space-y-2">
            {shown.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E3ECE6] p-3 text-xs sm:text-sm hover:border-[#006B48]/30 transition-all">
                <div>
                  <p className="font-bold text-[#0C2741]">{i.name} {!i.isActive && <span className="ml-1 rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">archived</span>}</p>
                  <p className="text-gray-500 mt-0.5">{i.category} · {i.mealType ?? 'Any'} · {i.unit}{i.standardPortionKg ? ` · portion ${i.standardPortionKg} kg` : ''}{i.sellingPrice != null ? ` · ₹${i.sellingPrice}` : ''}</p>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(i)} className={ghostCls}>Edit</button>
                  {i.isActive
                    ? <button onClick={() => setConfirm({ action: 'archive', id: i.id, label: i.name })} className={ghostCls}>Archive</button>
                    : <button onClick={() => setConfirm({ action: 'restore', id: i.id, label: i.name })} className={ghostCls}>Restore</button>}
                  <button onClick={() => setConfirm({ action: 'delete', id: i.id, label: i.name })} className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 active:scale-95 transition-all cursor-pointer">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Menus section */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3ECE6] pb-3">
          <h2 className="text-base font-bold text-[#0C2741]">Menus ({menus.length})</h2>
          <button onClick={() => { resetMenuForm(); setShowMenuForm((v) => !v); }} className={btnCls}>
            {showMenuForm ? 'Hide builder' : '+ New Menu'}
          </button>
        </div>

        {showMenuForm && (
          <form onSubmit={submitMenu} className="mt-4 space-y-3 rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-4 text-xs sm:text-sm" noValidate>
            <p className="font-bold text-[#0C2741]">{mEditing ? 'Edit Menu' : 'New Menu'}</p>
            {mError && <p className="rounded-xl bg-red-50 p-2 text-xs text-red-800 font-bold" role="alert">{mError}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="mn-scope" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Scope</label>
                <select id="mn-scope" value={mScope} onChange={(e) => setMScope(e.target.value as typeof mScope)} className={input}>
                  <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option>
                </select>
              </div>
              <div><label htmlFor="mn-date" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">{mScope === 'WEEKLY' ? 'Week start' : 'Date'}</label><input id="mn-date" type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className={input} required /></div>
              <div><label htmlFor="mn-meal" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Meal</label>
                <select id="mn-meal" value={mMeal} onChange={(e) => setMMeal(e.target.value as typeof mMeal)} className={input}>
                  {MEALS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div><label htmlFor="mn-kit" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Kitchen (optional)</label>
                <select id="mn-kit" value={mKitchen} onChange={(e) => setMKitchen(e.target.value)} className={input}>
                  <option value="">— Whole organization —</option>
                  {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
              <div><label htmlFor="mn-title" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Title (optional)</label><input id="mn-title" value={mTitle} onChange={(e) => setMTitle(e.target.value)} className={input} /></div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 text-xs font-semibold text-[#0C2741] cursor-pointer"><input type="checkbox" className="rounded text-[#006B48] focus:ring-[#006B48]" checked={mSpecial} onChange={(e) => setMSpecial(e.target.checked)} /> Special menu</label>
                {mSpecial && <div className="flex-1"><label htmlFor="mn-label" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Special label</label><input id="mn-label" value={mLabel} onChange={(e) => setMLabel(e.target.value)} className={input} placeholder="Festival special" /></div>}
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-[#0C2741] uppercase tracking-wider mt-2">Lines (reuse saved food items)</p>
              {activeItems.length === 0 && <p className="mt-1 text-xs text-amber-800">No active food items yet — create one above first.</p>}
              <div className="mt-2 space-y-2">
                {mLines.map((l, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select value={l.foodItemId} onChange={(e) => setMLines((ls) => ls.map((x, i) => (i === idx ? { ...x, foodItemId: e.target.value } : x)))} className={`${input} flex-1`} aria-label={`Menu line ${idx + 1} food item`}>
                      <option value="">— Choose food item —</option>
                      {activeItems.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <input type="number" min={0.1} step={0.1} placeholder="kg" value={l.quantityKg} onChange={(e) => setMLines((ls) => ls.map((x, i) => (i === idx ? { ...x, quantityKg: e.target.value } : x)))} className={`${input} w-28`} aria-label={`Menu line ${idx + 1} quantity kg`} />
                    {mLines.length > 1 && <button type="button" onClick={() => setMLines((ls) => ls.filter((_, i) => i !== idx))} className="text-xs text-red-700 font-bold hover:underline" aria-label={`Remove line ${idx + 1}`}>Remove</button>}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setMLines((ls) => [...ls, { foodItemId: '', quantityKg: '' }])} className={`${ghostCls} mt-2`}>+ Add line</button>
            </div>
            <button type="submit" disabled={mBusy} className={btnCls}>{mBusy ? 'Saving…' : mEditing ? 'Save Menu' : 'Create Menu'}</button>
          </form>
        )}

        {menus.length === 0 && !loading ? <p className="mt-4 text-xs sm:text-sm text-gray-500">No menus yet.</p> : (
          <ul className="mt-4 space-y-2.5">
            {menus.map((m) => (
              <li key={m.id} className="rounded-xl border border-[#E3ECE6] p-3.5 text-xs sm:text-sm hover:border-[#006B48]/30 transition-all">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-[#0C2741]">
                    {new Date(m.date).toLocaleDateString()} · {m.mealType} · {m.scope}
                    {m.isSpecial && <span className="ml-2 rounded-full bg-[#FEF3C7] px-2.5 py-0.5 text-xs font-bold text-[#D97706]">★ {m.specialLabel ?? 'Special'}</span>}
                  </p>
                  <div className="flex gap-1.5">
                    <button onClick={() => startMenuEdit(m)} className={ghostCls}>Edit</button>
                    <button onClick={() => setConfirm({ action: 'deleteMenu', id: m.id, label: m.title ?? `${m.mealType} ${new Date(m.date).toLocaleDateString()}` })} className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 active:scale-95 transition-all cursor-pointer">Delete</button>
                  </div>
                </div>
                {m.title && <p className="text-gray-500 mt-1">{m.title}{m.kitchenUnit ? ` · ${m.kitchenUnit.name}` : ''}</p>}
                <ul className="mt-2 list-disc pl-5 text-gray-600 space-y-0.5">
                  {m.items.map((l) => <li key={l.id}>{l.foodItem?.name ?? l.name} — <span className="font-semibold text-[#006B48]">{l.quantityKg} kg</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
