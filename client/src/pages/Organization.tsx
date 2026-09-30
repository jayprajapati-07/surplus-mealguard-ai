import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';

export function OrganizationPage() {
  const { user, refresh } = useAuth();
  const org = user?.organization;
  const canEdit = user && ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'].includes(user.role);

  const [isEditingOrg, setIsEditingOrg] = useState(false);
  const [isAddingKitchen, setIsAddingKitchen] = useState(false);

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
      setIsEditingOrg(false);
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
      setIsAddingKitchen(false);
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
      {/* SECTION 1: Organization Details Card with Top-Right Edit Button */}
      <div className={card}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#006B48]">
              {org.sector} · {org.institutionType.split('_').join(' ')}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-[#0C2741]">{org.name}</h1>
          </div>
          {canEdit && (
            <button
              type="button"
              id="editOrgBtn"
              onClick={() => {
                if (!isEditingOrg) {
                  setForm({
                    address: org.address || '',
                    city: org.city || '',
                    operatingHours: org.operatingHours || '',
                    peopleServedDaily: org.peopleServedDaily ? String(org.peopleServedDaily) : '',
                    kitchenCapacityKg: org.kitchenCapacityKg ? String(org.kitchenCapacityKg) : '',
                  });
                  setError('');
                  setMsg('');
                }
                setIsEditingOrg(!isEditingOrg);
              }}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl border border-[#006B48]/30 bg-emerald-50 text-[#006B48] hover:bg-[#006B48] hover:text-white font-semibold text-xs sm:text-sm transition-all duration-200 active:scale-95 shadow-xs"
              aria-expanded={isEditingOrg}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{isEditingOrg ? 'Close Edit' : 'Edit'}</span>
            </button>
          )}
        </div>

        {/* View Mode: Data Grid */}
        {!isEditingOrg && (
          <dl className="mt-4 grid gap-3 text-xs sm:text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="text-gray-500 font-medium">Address</dt>
              <dd className="text-[#0C2741] font-semibold mt-0.5">{org.address}</dd>
            </div>
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="text-gray-500 font-medium">City / Service Area</dt>
              <dd className="text-[#0C2741] font-semibold mt-0.5">{org.city}</dd>
            </div>
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="text-gray-500 font-medium">Contact</dt>
              <dd className="text-[#0C2741] font-semibold mt-0.5">{org.contactName} · {org.contactPhone} · {org.contactEmail}</dd>
            </div>
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="text-gray-500 font-medium">Operating Hours</dt>
              <dd className="text-[#0C2741] font-semibold mt-0.5">{org.operatingHours}</dd>
            </div>
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="text-gray-500 font-medium">People Served Daily (approx.)</dt>
              <dd className="text-[#0C2741] font-semibold mt-0.5">{org.peopleServedDaily.toLocaleString()}</dd>
            </div>
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="text-gray-500 font-medium">Kitchen Capacity</dt>
              <dd className="text-[#006B48] font-bold mt-0.5">{org.kitchenCapacityKg} kg</dd>
            </div>
          </dl>
        )}

        {/* Edit Mode: In-Place Editing Tool from 2nd Image */}
        {isEditingOrg && (
          <div className="mt-4 pt-4 border-t border-[#E3ECE6] animate-fadeInUpStagger">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm sm:text-base font-bold text-[#0C2741]">Update Organization Settings</h2>
              <span className="text-xs text-gray-500">Edit fields below and save changes</span>
            </div>
            {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
            {msg && <p className="mb-3 rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{msg}</p>}
            <form onSubmit={onUpdate} className="grid gap-3 sm:grid-cols-2 text-xs sm:text-sm" noValidate>
              <div>
                <label htmlFor="org-addr" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Address</label>
                <input id="org-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={input} placeholder="e.g. 123 Campus Way" />
              </div>
              <div>
                <label htmlFor="org-city" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">City / Service area</label>
                <input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={input} placeholder="e.g. Ahmedabad" />
              </div>
              <div>
                <label htmlFor="org-hours" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Operating hours</label>
                <input id="org-hours" value={form.operatingHours} onChange={(e) => setForm({ ...form, operatingHours: e.target.value })} className={input} placeholder="e.g. 8:00 AM - 8:00 PM" />
              </div>
              <div>
                <label htmlFor="org-ppl" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">People served daily</label>
                <input id="org-ppl" type="number" min={1} step={1} value={form.peopleServedDaily} onChange={(e) => setForm({ ...form, peopleServedDaily: e.target.value })} className={input} placeholder="e.g. 500" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="org-cap" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Kitchen capacity (kg)</label>
                <input id="org-cap" type="number" min={0.1} step={0.1} value={form.kitchenCapacityKg} onChange={(e) => setForm({ ...form, kitchenCapacityKg: e.target.value })} className={input} placeholder="e.g. 350" />
              </div>
              <div className="sm:col-span-2 flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingOrg(false);
                    setError('');
                  }}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-xs sm:text-sm transition-all"
                >
                  Cancel
                </button>
                <button type="submit" disabled={busy} className={btnCls}>
                  {busy ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* SECTION 2: Kitchen Units Card with Top-Right Edit / Add Unit Button */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-bold text-[#0C2741]">Kitchen Units ({org.kitchens.length})</h2>
          {canEdit && (
            <button
              type="button"
              id="editKitchenBtn"
              onClick={() => {
                setIsAddingKitchen(!isAddingKitchen);
                setKError('');
                setKMsg('');
              }}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl border border-[#006B48]/30 bg-emerald-50 text-[#006B48] hover:bg-[#006B48] hover:text-white font-semibold text-xs sm:text-sm transition-all duration-200 active:scale-95 shadow-xs"
              aria-expanded={isAddingKitchen}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                {isAddingKitchen ? (
                  <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
              <span>{isAddingKitchen ? 'Close Form' : 'Edit / Add Unit'}</span>
            </button>
          )}
        </div>

        {/* Adding Mode: In-Place Kitchen Unit Tool from 2nd Image */}
        {isAddingKitchen && (
          <div className="mt-4 p-4 rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] animate-fadeInUpStagger">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-bold text-[#0C2741]">Add Kitchen Unit</h3>
              <span className="text-xs text-gray-500">Configure new unit specifications</span>
            </div>
            {kError && <p className="mb-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{kError}</p>}
            {kMsg && <p className="mb-3 rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{kMsg}</p>}
            <form onSubmit={onAddKitchen} className="grid gap-3 sm:grid-cols-2 text-xs sm:text-sm" noValidate>
              <div>
                <label htmlFor="nk-name" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Unit name</label>
                <input id="nk-name" value={kName} onChange={(e) => setKName(e.target.value)} className={input} placeholder="e.g. Unit 32" required />
              </div>
              <div>
                <label htmlFor="nk-cap" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Production capacity (kg)</label>
                <input id="nk-cap" type="number" min={0.1} step={0.1} value={kCap} onChange={(e) => setKCap(e.target.value)} className={input} placeholder="e.g. 50" required />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="nk-meal" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Meal timings</label>
                <input id="nk-meal" value={kMeal} onChange={(e) => setKMeal(e.target.value)} className={input} placeholder="e.g. Breakfast 8–10am, Lunch 12–2pm" required />
              </div>
              <div>
                <label htmlFor="nk-store" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Storage areas</label>
                <input id="nk-store" value={kStore} onChange={(e) => setKStore(e.target.value)} className={input} placeholder="e.g. Dry store, Cold room" required />
              </div>
              <div>
                <label htmlFor="nk-cat" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Food categories</label>
                <input id="nk-cat" value={kCat} onChange={(e) => setKCat(e.target.value)} className={input} placeholder="e.g. Grains, Vegetables, Dairy" required />
              </div>
              <div className="sm:col-span-2 flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingKitchen(false);
                    setKError('');
                  }}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-xs sm:text-sm transition-all"
                >
                  Cancel
                </button>
                <button type="submit" disabled={kBusy} className={btnCls}>
                  {kBusy ? 'Adding…' : 'Add Kitchen Unit'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Existing Units List */}
        <div className={isAddingKitchen ? 'mt-4' : 'mt-3'}>
          {org.kitchens.length === 0 ? (
            <p className="text-xs sm:text-sm text-gray-500">No kitchen units registered yet.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {org.kitchens.map((k) => (
                <li key={k.id} className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-3.5 text-xs sm:text-sm transition-all hover:shadow-xs">
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
      </div>

      {!canEdit && (
        <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 text-xs sm:text-sm text-gray-500" role="note">
          <p>Your role ({user?.role}) can view but not edit the organization. Editing is limited to Super Admin, Institution Admin, and Kitchen Manager — an intentional role guard.</p>
        </div>
      )}
    </div>
  );
}
