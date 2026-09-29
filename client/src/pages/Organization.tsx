import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

export function OrganizationPage() {
  const { user, refresh } = useAuth();
  const org = user?.organization;
  const canEdit = user && ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'].includes(user.role);

  const [form, setForm] = useState({ address: '', city: '', operatingHours: '', peopleServedDaily: '', kitchenCapacityKg: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [kName, setKName] = useState('');
  const [kMeal, setKMeal] = useState('');
  const [kStore, setKStore] = useState('');
  const [kCat, setKCat] = useState('');
  const [kCap, setKCap] = useState('');
  const [kMsg, setKMsg] = useState('');
  const [kError, setKError] = useState('');
  const [kBusy, setKBusy] = useState(false);

  if (!org) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6" role="status">
        <p>No organization found. Please complete onboarding first.</p>
      </div>
    );
  }

  async function onUpdate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    const payload: Record<string, unknown> = {};
    if (form.address.trim()) payload.address = form.address.trim();
    if (form.city.trim()) payload.city = form.city.trim();
    if (form.operatingHours.trim()) payload.operatingHours = form.operatingHours.trim();
    if (form.peopleServedDaily.trim()) {
      const n = Number(form.peopleServedDaily);
      if (!Number.isInteger(n) || n < 1) return setError('People served must be a whole number ≥ 1.');
      payload.peopleServedDaily = n;
    }
    if (form.kitchenCapacityKg.trim()) {
      const n = Number(form.kitchenCapacityKg);
      if (!Number.isFinite(n) || n <= 0) return setError('Kitchen capacity must be positive (kg).');
      payload.kitchenCapacityKg = n;
    }
    if (Object.keys(payload).length === 0) return setError('Enter at least one field to update.');
    setBusy(true);
    try {
      const data = await api<{ message: string }>('/organizations/mine', { method: 'PUT', body: JSON.stringify(payload) });
      setMsg(data.message);
      setForm({ address: '', city: '', operatingHours: '', peopleServedDaily: '', kitchenCapacityKg: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onAddKitchen(e: FormEvent) {
    e.preventDefault();
    setKError('');
    setKMsg('');
    if (kName.trim().length < 2) return setKError('Unit name must be at least 2 characters.');
    if (kMeal.trim().length < 3) return setKError('Please describe meal timings.');
    if (kStore.trim().length < 2) return setKError('Please describe storage areas.');
    if (kCat.trim().length < 2) return setKError('Please list food categories.');
    const cap = Number(kCap);
    if (!Number.isFinite(cap) || cap <= 0) return setKError('Production capacity must be positive (kg).');
    setKBusy(true);
    try {
      const data = await api<{ message: string }>('/organizations/kitchens', {
        method: 'POST',
        body: JSON.stringify({
          name: kName.trim(),
          mealTimings: kMeal.trim(),
          storageAreas: kStore.trim(),
          foodCategories: kCat.trim(),
          productionCapacityKg: cap,
        }),
      });
      setKMsg(data.message);
      setKName('');
      setKMeal('');
      setKStore('');
      setKCat('');
      setKCap('');
      await refresh();
    } catch (err) {
      setKError(err instanceof Error ? err.message : 'Could not add kitchen.');
    } finally {
      setKBusy(false);
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">{org.sector} · {org.institutionType.split('_').join(' ')}</p>
        <h1 className="mt-1 text-2xl font-bold text-leaf-900">{org.name}</h1>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="font-medium">Address</dt><dd className="text-stone-700">{org.address}</dd></div>
          <div><dt className="font-medium">City / service area</dt><dd className="text-stone-700">{org.city}</dd></div>
          <div><dt className="font-medium">Contact</dt><dd className="text-stone-700">{org.contactName} · {org.contactPhone} · {org.contactEmail}</dd></div>
          <div><dt className="font-medium">Operating hours</dt><dd className="text-stone-700">{org.operatingHours}</dd></div>
          <div><dt className="font-medium">People served daily (approx.)</dt><dd className="text-stone-700">{org.peopleServedDaily}</dd></div>
          <div><dt className="font-medium">Kitchen capacity</dt><dd className="text-stone-700">{org.kitchenCapacityKg} kg</dd></div>
        </dl>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Kitchen / units ({org.kitchens.length})</h2>
        {org.kitchens.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No kitchen units yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {org.kitchens.map((k) => (
              <li key={k.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
                <p className="font-bold">{k.name}</p>
                <p className="mt-1 text-stone-700">Meals: {k.mealTimings}</p>
                <p className="text-stone-700">Storage: {k.storageAreas}</p>
                <p className="text-stone-700">Categories: {k.foodCategories}</p>
                <p className="text-stone-700">Capacity: {k.productionCapacityKg} kg</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit ? (
        <>
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="font-bold">Update organization</h2>
            {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
            {msg && <p className="mt-2 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
            <form onSubmit={onUpdate} className="mt-3 grid gap-3 sm:grid-cols-2" noValidate>
              <div><label htmlFor="org-addr" className="text-sm font-medium">Address</label><input id="org-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-city" className="text-sm font-medium">City / service area</label><input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-hours" className="text-sm font-medium">Operating hours</label><input id="org-hours" value={form.operatingHours} onChange={(e) => setForm({ ...form, operatingHours: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-ppl" className="text-sm font-medium">People served daily</label><input id="org-ppl" type="number" min={1} step={1} value={form.peopleServedDaily} onChange={(e) => setForm({ ...form, peopleServedDaily: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-cap" className="text-sm font-medium">Kitchen capacity (kg)</label><input id="org-cap" type="number" min={0.1} step={0.1} value={form.kitchenCapacityKg} onChange={(e) => setForm({ ...form, kitchenCapacityKg: e.target.value })} className={input} /></div>
              <div className="flex items-end"><button type="submit" disabled={busy} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{busy ? 'Saving…' : 'Save changes'}</button></div>
            </form>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="font-bold">Add kitchen / unit</h2>
            {kError && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{kError}</p>}
            {kMsg && <p className="mt-2 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{kMsg}</p>}
            <form onSubmit={onAddKitchen} className="mt-3 grid gap-3 sm:grid-cols-2" noValidate>
              <div><label htmlFor="nk-name" className="text-sm font-medium">Unit name</label><input id="nk-name" value={kName} onChange={(e) => setKName(e.target.value)} className={input} required /></div>
              <div><label htmlFor="nk-cap" className="text-sm font-medium">Production capacity (kg)</label><input id="nk-cap" type="number" min={0.1} step={0.1} value={kCap} onChange={(e) => setKCap(e.target.value)} className={input} required /></div>
              <div className="sm:col-span-2"><label htmlFor="nk-meal" className="text-sm font-medium">Meal timings</label><input id="nk-meal" value={kMeal} onChange={(e) => setKMeal(e.target.value)} className={input} required /></div>
              <div><label htmlFor="nk-store" className="text-sm font-medium">Storage areas</label><input id="nk-store" value={kStore} onChange={(e) => setKStore(e.target.value)} className={input} required /></div>
              <div><label htmlFor="nk-cat" className="text-sm font-medium">Food categories</label><input id="nk-cat" value={kCat} onChange={(e) => setKCat(e.target.value)} className={input} required /></div>
              <div className="sm:col-span-2"><button type="submit" disabled={kBusy} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">{kBusy ? 'Adding…' : 'Add unit'}</button></div>
            </form>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-sm" role="note">
          <p>Your role ({user?.role}) can view but not edit the organization. Editing is limited to Super Admin, Institution Admin, and Kitchen Manager — an intentional role guard.</p>
        </div>
      )}
    </div>
  );
}
