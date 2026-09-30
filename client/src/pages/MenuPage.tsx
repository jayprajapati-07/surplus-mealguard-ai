import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import { api, API_BASE, getToken } from '../api';
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

interface ImportJob {
  id: string;
  fileName: string;
  status: string;
  totalRows: number | null;
  successRows: number | null;
  errorRows: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface DailyRecord {
  id: string;
  date: string;
  mealType: string;
  preparedKg: number;
  servedKg: number;
  soldKg: number | null;
  wasteKg: number;
  remainingKg: number | null;
  targetKg: number | null;
  foodItemId: string | null;
  foodItem?: { id: string; name: string; category: string; unit: string } | null;
  kitchenUnit?: { id: string; name: string } | null;
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
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [msg, setMsg] = useState('');

  // historical consumption & spreadsheet import state
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadKitchenId, setUploadKitchenId] = useState('');
  const [parseBusy, setParseBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [recSearch, setRecSearch] = useState('');
  const [recMealFilter, setRecMealFilter] = useState('ALL');

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
      const [fi, mn, ij, fr] = await Promise.all([
        api<{ items: FoodItem[] }>('/food-items'),
        api<{ menus: Menu[] }>('/menus'),
        api<{ jobs: ImportJob[] }>('/imports/jobs').catch(() => ({ jobs: [] })),
        api<{ records: DailyRecord[] }>('/food-records').catch(() => ({ records: [] })),
      ]);
      setItems(fi.items);
      setMenus(mn.menus);
      setImportJobs(ij.jobs ?? []);
      setRecords(fr.records ?? []);
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

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    setUploadFeedback(null);
    setPreviewRows([]);
    const f = e.target.files?.[0];
    if (!f) {
      setSelectedFile(null);
      return;
    }
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
      setUploadFeedback({ type: 'error', message: 'Please select a valid .xlsx, .xls, or .csv spreadsheet file.' });
      setSelectedFile(null);
      return;
    }
    setSelectedFile(f);
  }

  async function handleParsePreview() {
    if (!selectedFile) {
      setUploadFeedback({ type: 'error', message: 'Please select a spreadsheet file first.' });
      return;
    }
    setParseBusy(true);
    setUploadFeedback(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const kId = uploadKitchenId || (kitchens[0]?.id ?? '');
      if (kId) formData.append('kitchenUnitId', kId);

      const token = getToken() ?? '';
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let res = await fetch(`${API_BASE}/imports/parse`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (res.status === 404) {
        const retryFormData = new FormData();
        retryFormData.append('file', selectedFile);
        res = await fetch(`${API_BASE}/imports/preview`, {
          method: 'POST',
          headers,
          body: retryFormData,
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to parse file preview.');
      }
      const data = await res.json();
      const rows = (data.previewRows || data.preview || []) as Array<Record<string, unknown>>;
      setPreviewRows(rows);
      setUploadFeedback({
        type: 'success',
        message: `Parsed successfully: ${rows.length} preview rows generated from “${selectedFile.name}”.`,
      });
    } catch (e) {
      setUploadFeedback({ type: 'error', message: e instanceof Error ? e.message : 'Could not parse file.' });
    } finally {
      setParseBusy(false);
    }
  }

  async function handleConfirmImport() {
    if (!selectedFile) {
      setUploadFeedback({ type: 'error', message: 'Please select a spreadsheet file first.' });
      return;
    }
    const kitchenId = uploadKitchenId || (kitchens[0]?.id ?? '');
    if (!kitchenId) {
      setUploadFeedback({ type: 'error', message: 'Please select a kitchen unit to assign these consumption records.' });
      return;
    }
    setImportBusy(true);
    setUploadFeedback(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('kitchenUnitId', kitchenId);

      const token = getToken() ?? '';
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let impRes = await fetch(`${API_BASE}/imports/confirm`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (impRes.status === 404) {
        const retryFormData = new FormData();
        retryFormData.append('file', selectedFile);
        retryFormData.append('kitchenUnitId', kitchenId);
        impRes = await fetch(`${API_BASE}/imports/upload`, {
          method: 'POST',
          headers,
          body: retryFormData,
        });
      }

      if (!impRes.ok) {
        const err = await impRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to complete spreadsheet import.');
      }
      const data = await impRes.json();
      setUploadFeedback({
        type: 'success',
        message: data.message || `Successfully imported records from “${selectedFile.name}”!`,
      });
      setSelectedFile(null);
      setPreviewRows([]);
      if (window.showToast) window.showToast('Spreadsheet records imported successfully!');
      await load();
    } catch (e) {
      setUploadFeedback({ type: 'error', message: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      setImportBusy(false);
    }
  }

  // Analytics & Aggregations
  const totalPreparedKg = records.reduce((s, r) => s + (r.preparedKg || 0), 0);
  const totalConsumedKg = records.reduce((s, r) => s + (r.servedKg ?? r.soldKg ?? 0), 0);
  const totalWasteKg = records.reduce((s, r) => s + (r.wasteKg || 0), 0);
  const efficiencyPct = totalPreparedKg > 0 ? (totalConsumedKg / totalPreparedKg) * 100 : 0;
  const wastePct = totalPreparedKg > 0 ? (totalWasteKg / totalPreparedKg) * 100 : 0;

  // Item-wise aggregated analysis
  const itemMap = new Map<string, {
    name: string;
    category: string;
    unit: string;
    prepared: number;
    consumed: number;
    waste: number;
    count: number;
  }>();

  records.forEach((r) => {
    const name = r.foodItem?.name || 'Unassigned Food Item';
    const category = r.foodItem?.category || 'General';
    const unit = r.foodItem?.unit || 'kg';
    const cur = itemMap.get(name) || { name, category, unit, prepared: 0, consumed: 0, waste: 0, count: 0 };
    cur.prepared += (r.preparedKg || 0);
    cur.consumed += (r.servedKg ?? r.soldKg ?? 0);
    cur.waste += (r.wasteKg || 0);
    cur.count += 1;
    itemMap.set(name, cur);
  });

  const itemAggregates = Array.from(itemMap.values()).sort((a, b) => b.prepared - a.prepared);

  // Filtered recent log records
  const filteredRecords = records.filter((r) => {
    const matchesMeal = recMealFilter === 'ALL' || r.mealType === recMealFilter;
    const search = recSearch.toLowerCase().trim();
    const foodName = (r.foodItem?.name || '').toLowerCase();
    const kitchenName = (r.kitchenUnit?.name || '').toLowerCase();
    const matchesSearch = !search || foodName.includes(search) || kitchenName.includes(search);
    return matchesMeal && matchesSearch;
  });

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

      {/* Historical Consumption Data & File Analysis section (Linked to Setup Page .xlsx upload) */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3ECE6] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#006B48]/10 text-base">📊</span>
              <h2 className="text-base sm:text-lg font-bold text-[#0C2741]">Historical Consumption Data &amp; File Analysis</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Synchronized with your organization onboarding setup and spreadsheet uploads. View imported files, track consumption trends, and analyze production vs. waste efficiency.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`${API_BASE}/imports/templates/xlsx`}
              download
              className={ghostCls}
              title="Download Excel sample template"
            >
              📥 Download Sample (.xlsx)
            </a>
            <button
              type="button"
              onClick={() => {
                setShowUpload((v) => !v);
                setUploadFeedback(null);
              }}
              className={btnCls}
            >
              {showUpload ? 'Hide Uploader' : '+ Upload Spreadsheet (.xlsx / .csv)'}
            </button>
          </div>
        </div>

        {/* Upload / Import Drawer */}
        {showUpload && (
          <div className="mt-4 rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-4 text-xs sm:text-sm">
            <h3 className="font-bold text-[#0C2741] text-sm">Upload New Consumption Spreadsheet</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Upload historical canteen logs or prep sheets in Excel (.xlsx, .xls) or CSV format. New items will be automatically mapped to your food catalog.
            </p>

            {uploadFeedback && (
              <div
                className={`mt-3 rounded-xl p-3 text-xs font-semibold border ${
                  uploadFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : 'bg-red-50 text-red-800 border-red-200'
                }`}
                role="status"
              >
                {uploadFeedback.message}
              </div>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="file-input-menu" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  Spreadsheet File (.xlsx, .xls, .csv)
                </label>
                <input
                  id="file-input-menu"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  className="mt-1 block w-full text-xs text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#006B48] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white file:cursor-pointer hover:file:bg-[#004C35]"
                />
                {selectedFile && (
                  <p className="mt-1 text-xs font-semibold text-[#006B48]">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="upload-kitchen-select" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  Assign to Kitchen Unit
                </label>
                <select
                  id="upload-kitchen-select"
                  value={uploadKitchenId}
                  onChange={(e) => setUploadKitchenId(e.target.value)}
                  className={input}
                >
                  <option value="">— Primary Kitchen (Default) —</option>
                  {kitchens.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleParsePreview()}
                disabled={!selectedFile || parseBusy}
                className={ghostCls}
              >
                {parseBusy ? 'Parsing…' : '🔍 Preview File Data'}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmImport()}
                disabled={!selectedFile || importBusy}
                className={btnCls}
              >
                {importBusy ? 'Importing…' : '✓ Confirm & Import Records'}
              </button>
            </div>

            {/* Preview table if parsed */}
            {previewRows.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-xl border border-[#E3ECE6] bg-white">
                <div className="bg-[#F2F7F4] px-3 py-2 border-b border-[#E3ECE6] flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0C2741]">Parsed Sample Preview (First {previewRows.length} Rows)</span>
                  <span className="text-[11px] text-gray-500 font-medium">Auto-validated</span>
                </div>
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-left text-xs text-[#0C2741]">
                    <thead className="bg-[#FAFCFB] border-b border-[#E3ECE6] text-[11px] font-semibold text-gray-500">
                      <tr>
                        {Object.keys(previewRows[0] || {}).slice(0, 7).map((col) => (
                          <th key={col} className="px-3 py-1.5 whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3ECE6]">
                      {previewRows.slice(0, 5).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-gray-50">
                          {Object.keys(previewRows[0] || {}).slice(0, 7).map((col, cIdx) => (
                            <td key={cIdx} className="px-3 py-1.5 whitespace-nowrap text-gray-600">
                              {String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Uploaded Spreadsheet Files / Import Jobs */}
        <div className="mt-6">
          <h3 className="text-xs sm:text-sm font-bold text-[#0C2741] uppercase tracking-wider">
            Uploaded Files &amp; Import History ({importJobs.length})
          </h3>
          {importJobs.length === 0 ? (
            <div className="mt-2 rounded-xl border border-dashed border-[#E3ECE6] p-4 text-center text-xs text-gray-500">
              No spreadsheet files imported yet. Files uploaded during initial Organization Setup or via the uploader above will appear here with complete verification metrics.
            </div>
          ) : (
            <div className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {importJobs.map((j) => (
                <div key={j.id} className="rounded-xl border border-[#E3ECE6] bg-[#FAFCFB] p-3.5 hover:border-[#006B48]/30 transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <span className="text-emerald-700 text-sm">📄</span>
                        <p className="font-bold text-xs sm:text-sm text-[#0C2741] truncate" title={j.fileName}>
                          {j.fileName}
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        j.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {j.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Uploaded: {new Date(j.createdAt).toLocaleDateString()} at {new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2 text-xs">
                      <span className="rounded-md bg-white border border-[#E3ECE6] px-2 py-0.5 font-semibold text-gray-600 text-[11px]">
                        Total: {j.totalRows ?? '—'}
                      </span>
                      <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-semibold text-emerald-800 text-[11px]">
                        ✓ {j.successRows ?? '—'} accepted
                      </span>
                      {(j.errorRows ?? 0) > 0 && (
                        <span className="rounded-md bg-red-50 border border-red-200 px-2 py-0.5 font-semibold text-red-700 text-[11px]">
                          ⚠ {j.errorRows} errors
                        </span>
                      )}
                    </div>
                  </div>
                  {(j.errorRows ?? 0) > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#E3ECE6]">
                      <a
                        href={`${API_BASE}/imports/jobs/${j.id}/errors.csv`}
                        download
                        className="text-[11px] font-semibold text-red-600 hover:underline flex items-center gap-1"
                      >
                        📥 Download Error Report (.csv)
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Consumption KPI Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-3.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Total Prepared</p>
            <p className="mt-1 text-lg sm:text-xl font-bold text-[#0C2741]">{totalPreparedKg.toFixed(1)} <span className="text-xs font-normal text-gray-500">kg</span></p>
            <p className="text-[11px] text-gray-400 mt-0.5">{records.length} recorded entries</p>
          </div>
          <div className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-3.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Total Consumed</p>
            <p className="mt-1 text-lg sm:text-xl font-bold text-[#006B48]">{totalConsumedKg.toFixed(1)} <span className="text-xs font-normal text-gray-500">kg</span></p>
            <p className="text-[11px] text-emerald-700 font-medium mt-0.5">Efficiency: {efficiencyPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-3.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Total Waste</p>
            <p className="mt-1 text-lg sm:text-xl font-bold text-red-700">{totalWasteKg.toFixed(1)} <span className="text-xs font-normal text-gray-500">kg</span></p>
            <p className="text-[11px] text-red-600 font-medium mt-0.5">Waste ratio: {wastePct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-3.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Analyzed Items</p>
            <p className="mt-1 text-lg sm:text-xl font-bold text-[#0C2741]">{itemAggregates.length}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Across all meal services</p>
          </div>
        </div>

        {/* Item-Wise Consumption & Waste Analysis Table */}
        <div className="mt-6">
          <h3 className="text-xs sm:text-sm font-bold text-[#0C2741] uppercase tracking-wider">
            Item-Wise Consumption &amp; Waste Analysis
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Performance breakdown per dish based on historical spreadsheet records and continuous daily logs.
          </p>

          {itemAggregates.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No consumption logs recorded yet.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border border-[#E3ECE6]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[#0C2741]">
                  <thead className="bg-[#F2F7F4] border-b border-[#E3ECE6] text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-3.5 py-2.5">Food Item / Dish</th>
                      <th className="px-3.5 py-2.5">Category</th>
                      <th className="px-3.5 py-2.5 text-right">Prepared</th>
                      <th className="px-3.5 py-2.5 text-right">Consumed</th>
                      <th className="px-3.5 py-2.5 text-right">Waste</th>
                      <th className="px-3.5 py-2.5">Consumption Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3ECE6] bg-white">
                    {itemAggregates.map((item) => {
                      const rate = item.prepared > 0 ? (item.consumed / item.prepared) * 100 : 0;
                      return (
                        <tr key={item.name} className="hover:bg-[#F9FCFA]">
                          <td className="px-3.5 py-2.5 font-bold text-[#0C2741]">
                            {item.name}
                            <span className="block text-[10px] text-gray-400 font-normal">{item.count} log entries</span>
                          </td>
                          <td className="px-3.5 py-2.5 text-gray-500">{item.category}</td>
                          <td className="px-3.5 py-2.5 text-right font-medium text-gray-700">{item.prepared.toFixed(1)} {item.unit}</td>
                          <td className="px-3.5 py-2.5 text-right font-semibold text-[#006B48]">{item.consumed.toFixed(1)} {item.unit}</td>
                          <td className="px-3.5 py-2.5 text-right font-semibold text-red-600">{item.waste.toFixed(1)} {item.unit}</td>
                          <td className="px-3.5 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 rounded-full bg-gray-200 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${rate >= 85 ? 'bg-[#006B48]' : rate >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
                                />
                              </div>
                              <span className="font-semibold text-xs text-[#0C2741]">{rate.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Filterable Historical Consumption Records Log */}
        <div className="mt-6 border-t border-[#E3ECE6] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-[#0C2741] uppercase tracking-wider">
                Recent Historical Consumption Records ({filteredRecords.length})
              </h3>
              <p className="text-[11px] text-gray-400">Search and verify detailed entries parsed from spreadsheets or daily logs.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search food or kitchen…"
                value={recSearch}
                onChange={(e) => setRecSearch(e.target.value)}
                className="rounded-xl border border-[#E3ECE6] px-3 py-1.5 text-xs bg-white text-[#0C2741] focus:ring-1 focus:ring-[#006B48]"
                aria-label="Search consumption records"
              />
              <select
                value={recMealFilter}
                onChange={(e) => setRecMealFilter(e.target.value)}
                className="rounded-xl border border-[#E3ECE6] px-3 py-1.5 text-xs bg-white text-[#0C2741]"
                aria-label="Filter records by meal type"
              >
                <option value="ALL">All Meals</option>
                <option value="BREAKFAST">Breakfast</option>
                <option value="LUNCH">Lunch</option>
                <option value="DINNER">Dinner</option>
              </select>
            </div>
          </div>

          {filteredRecords.length === 0 ? (
            <p className="mt-3 text-xs text-gray-500">No matching historical consumption records found.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border border-[#E3ECE6]">
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs text-[#0C2741]">
                  <thead className="bg-[#F2F7F4] border-b border-[#E3ECE6] text-[11px] font-semibold text-gray-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Meal</th>
                      <th className="px-3 py-2">Food Item</th>
                      <th className="px-3 py-2">Kitchen</th>
                      <th className="px-3 py-2 text-right">Prepared</th>
                      <th className="px-3 py-2 text-right">Served/Sold</th>
                      <th className="px-3 py-2 text-right">Waste</th>
                      <th className="px-3 py-2 text-right">Surplus/Rem.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3ECE6] bg-white">
                    {filteredRecords.slice(0, 30).map((r) => (
                      <tr key={r.id} className="hover:bg-[#F9FCFA]">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600 font-medium">
                          {new Date(r.date).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-700">
                            {r.mealType}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-bold text-[#0C2741]">
                          {r.foodItem?.name ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {r.kitchenUnit?.name ?? 'Main'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-700">
                          {r.preparedKg} kg
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-[#006B48]">
                          {r.servedKg ?? r.soldKg ?? 0} kg
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-red-600">
                          {r.wasteKg} kg
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-700">
                          {r.remainingKg ?? 0} kg
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredRecords.length > 30 && (
                <div className="bg-[#FAFCFB] px-3 py-1.5 text-center text-[11px] text-gray-400 border-t border-[#E3ECE6]">
                  Showing first 30 of {filteredRecords.length} records. Use search above to narrow down.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
