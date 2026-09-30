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
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6" role="status">
        <p className="text-sm font-semibold text-amber-900">No organization found. Please complete onboarding first.</p>
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
      if (window.showToast) window.showToast('Organization settings updated successfully');
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
      if (window.showToast) window.showToast('Kitchen unit added successfully');
      await refresh();
    } catch (err) {
      setKError(err instanceof Error ? err.message : 'Could not add kitchen.');
    } finally {
      setKBusy(false);
    }
  }

  const input = 'mt-1 w-full rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741] focus:ring-1 focus:ring-[#006B48]';
  const card = 'rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm';
  const btnCls = 'rounded-xl bg-[#006B48] px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-[#004C35] active:scale-95 disabled:opacity-60 transition-all cursor-pointer';

  return (
    <div className="space-y-5 animate-fadeInUpStagger">
      <div className={card}>
        <p className="text-xs font-bold uppercase tracking-wider text-[#006B48]">{org.sector} · {org.institutionType.split('_').join(' ')}</p>
        <h1 className="mt-1 text-2xl font-bold text-[#0C2741]">{org.name}</h1>
        <dl className="mt-4 grid gap-3 text-xs sm:text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3"><dt className="text-gray-500 font-medium">Address</dt><dd className="text-[#0C2741] font-semibold mt-0.5">{org.address}</dd></div>
          <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3"><dt className="text-gray-500 font-medium">City / Service Area</dt><dd className="text-[#0C2741] font-semibold mt-0.5">{org.city}</dd></div>
          <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3"><dt className="text-gray-500 font-medium">Contact</dt><dd className="text-[#0C2741] font-semibold mt-0.5">{org.contactName} · {org.contactPhone} · {org.contactEmail}</dd></div>
          <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3"><dt className="text-gray-500 font-medium">Operating Hours</dt><dd className="text-[#0C2741] font-semibold mt-0.5">{org.operatingHours}</dd></div>
          <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3"><dt className="text-gray-500 font-medium">People Served Daily (approx.)</dt><dd className="text-[#0C2741] font-semibold mt-0.5">{org.peopleServedDaily.toLocaleString()}</dd></div>
          <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3"><dt className="text-gray-500 font-medium">Kitchen Capacity</dt><dd className="text-[#006B48] font-bold mt-0.5">{org.kitchenCapacityKg} kg</dd></div>
        </dl>
      </div>

      <div className={card}>
        <h2 className="text-base font-bold text-[#0C2741]">Kitchen Units ({org.kitchens.length})</h2>
        {org.kitchens.length === 0 ? (
          <p className="mt-2 text-xs sm:text-sm text-gray-500">No kitchen units registered yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {org.kitchens.map((k) => (
              <li key={k.id} className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-3.5 text-xs sm:text-sm">
                <p className="font-bold text-[#0C2741]">{k.name}</p>
                <p className="mt-1 text-gray-600">Meals: {k.mealTimings}</p>
                <p className="text-gray-600">Storage: {k.storageAreas}</p>
                <p className="text-gray-600">Categories: {k.foodCategories}</p>
                <p className="text-[#006B48] font-semibold mt-1">Capacity: {k.productionCapacityKg} kg</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit ? (
        <>
          <div className={card}>
            <h2 className="text-base font-bold text-[#0C2741]">Update Organization Settings</h2>
            {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
            {msg && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{msg}</p>}
            <form onSubmit={onUpdate} className="mt-4 grid gap-3 sm:grid-cols-2 text-xs sm:text-sm" noValidate>
              <div><label htmlFor="org-addr" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Address</label><input id="org-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-city" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">City / Service area</label><input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-hours" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Operating hours</label><input id="org-hours" value={form.operatingHours} onChange={(e) => setForm({ ...form, operatingHours: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-ppl" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">People served daily</label><input id="org-ppl" type="number" min={1} step={1} value={form.peopleServedDaily} onChange={(e) => setForm({ ...form, peopleServedDaily: e.target.value })} className={input} /></div>
              <div><label htmlFor="org-cap" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Kitchen capacity (kg)</label><input id="org-cap" type="number" min={0.1} step={0.1} value={form.kitchenCapacityKg} onChange={(e) => setForm({ ...form, kitchenCapacityKg: e.target.value })} className={input} /></div>
              <div className="flex items-end"><button type="submit" disabled={busy} className={btnCls}>{busy ? 'Saving…' : 'Save Changes'}</button></div>
            </form>
          </div>

          <div className={card}>
            <h2 className="text-base font-bold text-[#0C2741]">Add Kitchen Unit</h2>
            {kError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{kError}</p>}
            {kMsg && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{kMsg}</p>}
            <form onSubmit={onAddKitchen} className="mt-4 grid gap-3 sm:grid-cols-2 text-xs sm:text-sm" noValidate>
              <div><label htmlFor="nk-name" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Unit name</label><input id="nk-name" value={kName} onChange={(e) => setKName(e.target.value)} className={input} required /></div>
              <div><label htmlFor="nk-cap" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Production capacity (kg)</label><input id="nk-cap" type="number" min={0.1} step={0.1} value={kCap} onChange={(e) => setKCap(e.target.value)} className={input} required /></div>
              <div className="sm:col-span-2"><label htmlFor="nk-meal" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Meal timings</label><input id="nk-meal" value={kMeal} onChange={(e) => setKMeal(e.target.value)} className={input} required /></div>
              <div><label htmlFor="nk-store" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Storage areas</label><input id="nk-store" value={kStore} onChange={(e) => setKStore(e.target.value)} className={input} required /></div>
              <div><label htmlFor="nk-cat" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Food categories</label><input id="nk-cat" value={kCat} onChange={(e) => setKCat(e.target.value)} className={input} required /></div>
              <div className="sm:col-span-2"><button type="submit" disabled={kBusy} className={btnCls}>{kBusy ? 'Adding…' : 'Add Kitchen Unit'}</button></div>
            </form>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 text-xs sm:text-sm text-gray-500" role="note">
          <p>Your role ({user?.role}) can view but not edit the organization. Editing is limited to Super Admin, Institution Admin, and Kitchen Manager — an intentional role guard.</p>
        </div>
      )}
    </div>
  );
}
