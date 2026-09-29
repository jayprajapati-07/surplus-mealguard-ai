import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

const INSTITUTION_TYPES = [
  'COLLEGE_CANTEEN',
  'HOTEL_RESTAURANT',
  'HOSTEL_MESS',
  'HOSPITAL_CAFETERIA',
  'CATERING',
  'FOOD_PROCESSING_UNIT',
  'OTHER',
] as const;

interface KitchenForm {
  name: string;
  mealTimings: string;
  storageAreas: string;
  foodCategories: string;
  productionCapacityKg: string;
}

const emptyKitchen: KitchenForm = { name: '', mealTimings: '', storageAreas: '', foodCategories: '', productionCapacityKg: '' };

export function Onboarding() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [sector, setSector] = useState<'GOVERNMENT' | 'PRIVATE'>('PRIVATE');
  const [institutionType, setInstitutionType] = useState<(typeof INSTITUTION_TYPES)[number]>('COLLEGE_CANTEEN');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [operatingHours, setOperatingHours] = useState('');
  const [peopleServed, setPeopleServed] = useState('');
  const [capacity, setCapacity] = useState('');
  const [kitchens, setKitchens] = useState<KitchenForm[]>([{ ...emptyKitchen }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { orgName: string; kitchens: number }>(null);

  function setKitchen(i: number, patch: Partial<KitchenForm>) {
    setKitchens((ks) => ks.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));
  }

  function validate(): string | null {
    if (name.trim().length < 2) return 'Organization name must be at least 2 characters.';
    if (address.trim().length < 5) return 'Please enter the full street address (min 5 characters). Text only — no maps or coordinates.';
    if (city.trim().length < 2) return 'Please enter city / service area.';
    if (contactName.trim().length < 2) return 'Please enter a contact person name.';
    if (contactPhone.trim().length < 7) return 'Please enter a valid contact phone.';
    if (!/^\S+@\S+\.\S+$/.test(contactEmail.trim())) return 'Please enter a valid contact email.';
    if (operatingHours.trim().length < 3) return 'Please enter operating hours (e.g. 8am–8pm).';
    const ps = Number(peopleServed);
    if (!Number.isInteger(ps) || ps < 1) return 'People served daily must be a whole number of at least 1.';
    const cap = Number(capacity);
    if (!Number.isFinite(cap) || cap <= 0) return 'Kitchen capacity must be a positive number in kg.';
    if (kitchens.length < 1) return 'Add at least one kitchen / unit.';
    const seen = new Set<string>();
    for (const [i, k] of kitchens.entries()) {
      if (k.name.trim().length < 2) return `Kitchen ${i + 1}: unit name must be at least 2 characters.`;
      if (k.mealTimings.trim().length < 3) return `Kitchen ${i + 1}: describe meal timings.`;
      if (k.storageAreas.trim().length < 2) return `Kitchen ${i + 1}: describe storage areas.`;
      if (k.foodCategories.trim().length < 2) return `Kitchen ${i + 1}: list food categories.`;
      const kc = Number(k.productionCapacityKg);
      if (!Number.isFinite(kc) || kc <= 0) return `Kitchen ${i + 1}: production capacity must be positive (kg).`;
      const key = k.name.trim().toLowerCase();
      if (seen.has(key)) return 'Kitchen/unit names must be unique within the organization.';
      seen.add(key);
    }
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        sector,
        institutionType,
        name: name.trim(),
        address: address.trim(),
        city: city.trim(),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim().toLowerCase(),
        operatingHours: operatingHours.trim(),
        peopleServedDaily: Number(peopleServed),
        kitchenCapacityKg: Number(capacity),
        kitchens: kitchens.map((k) => ({
          name: k.name.trim(),
          mealTimings: k.mealTimings.trim(),
          storageAreas: k.storageAreas.trim(),
          foodCategories: k.foodCategories.trim(),
          productionCapacityKg: Number(k.productionCapacityKg),
        })),
      };
      const data = await api<{ organization: { name: string } }>('/organizations/onboarding', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await refresh();
      setDone({ orgName: data.organization.name, kitchens: kitchens.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save onboarding.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-leaf-200 bg-white p-8 text-center shadow-sm" role="status">
        <p className="text-3xl" aria-hidden="true">🎉</p>
        <h1 className="mt-2 text-xl font-bold text-leaf-900">Onboarding complete</h1>
        <p className="mt-2 text-sm text-stone-700">
          <strong>{done.orgName}</strong> saved with {done.kitchens} kitchen/unit{done.kitchens === 1 ? '' : 's'}.
          Quantities are stored in kilograms (kg).
        </p>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="mt-4 rounded-lg bg-leaf-700 px-5 py-2 font-medium text-white hover:bg-leaf-800"
        >
          Go to dashboard
        </button>
      </div>
    );
  }

  const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-leaf-900">Organization onboarding</h1>
      <p className="mt-1 text-sm text-stone-600">
        Address and service-area text only. No maps, coordinates, weather, or navigation are used. Quantities in kilograms (kg).
      </p>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <form onSubmit={onSubmit} className="mt-4 space-y-5" noValidate>
        <fieldset>
          <legend className="text-sm font-bold">Sector</legend>
          <div className="mt-2 flex gap-4" role="radiogroup" aria-label="Sector">
            {(['GOVERNMENT', 'PRIVATE'] as const).map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="radio" name="sector" checked={sector === s} onChange={() => setSector(s)} />
                {s === 'GOVERNMENT' ? 'Government' : 'Private'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ob-type" className="text-sm font-medium">Institution type</label>
            <select id="ob-type" value={institutionType} onChange={(e) => setInstitutionType(e.target.value as typeof institutionType)} className={input}>
              {INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{t.split('_').join(' ')}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ob-name" className="text-sm font-medium">Organization name</label>
            <input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} className={input} required />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ob-addr" className="text-sm font-medium">Address (text only)</label>
            <input id="ob-addr" value={address} onChange={(e) => setAddress(e.target.value)} className={input} placeholder="Street, block, landmark" required />
          </div>
          <div>
            <label htmlFor="ob-city" className="text-sm font-medium">City / service area (text only)</label>
            <input id="ob-city" value={city} onChange={(e) => setCity(e.target.value)} className={input} required />
          </div>
          <div>
            <label htmlFor="ob-hours" className="text-sm font-medium">Operating hours</label>
            <input id="ob-hours" value={operatingHours} onChange={(e) => setOperatingHours(e.target.value)} className={input} placeholder="8am–8pm" required />
          </div>
          <div>
            <label htmlFor="ob-cname" className="text-sm font-medium">Contact person</label>
            <input id="ob-cname" value={contactName} onChange={(e) => setContactName(e.target.value)} className={input} required />
          </div>
          <div>
            <label htmlFor="ob-cphone" className="text-sm font-medium">Contact phone</label>
            <input id="ob-cphone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={input} required />
          </div>
          <div>
            <label htmlFor="ob-cemail" className="text-sm font-medium">Contact email</label>
            <input id="ob-cemail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={input} required />
          </div>
          <div>
            <label htmlFor="ob-ppl" className="text-sm font-medium">People served daily (approx.)</label>
            <input id="ob-ppl" type="number" min={1} step={1} value={peopleServed} onChange={(e) => setPeopleServed(e.target.value)} className={input} required />
          </div>
          <div>
            <label htmlFor="ob-cap" className="text-sm font-medium">Kitchen capacity (kg)</label>
            <input id="ob-cap" type="number" min={0.1} step={0.1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={input} required />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Kitchen / units (at least one)</h2>
            <button type="button" onClick={() => setKitchens((ks) => [...ks, { ...emptyKitchen }])} className="rounded-lg border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100">
              + Add unit
            </button>
          </div>
          <div className="mt-2 space-y-3">
            {kitchens.map((k, i) => (
              <div key={i} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">Unit {i + 1}</p>
                  {kitchens.length > 1 && (
                    <button type="button" onClick={() => setKitchens((ks) => ks.filter((_, idx) => idx !== i))} className="text-sm text-red-700 underline" aria-label={`Remove unit ${i + 1}`}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`k-name-${i}`} className="text-xs font-medium">Unit name</label>
                    <input id={`k-name-${i}`} value={k.name} onChange={(e) => setKitchen(i, { name: e.target.value })} className={input} required />
                  </div>
                  <div>
                    <label htmlFor={`k-cap-${i}`} className="text-xs font-medium">Production capacity (kg)</label>
                    <input id={`k-cap-${i}`} type="number" min={0.1} step={0.1} value={k.productionCapacityKg} onChange={(e) => setKitchen(i, { productionCapacityKg: e.target.value })} className={input} required />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor={`k-meal-${i}`} className="text-xs font-medium">Meal timings</label>
                    <input id={`k-meal-${i}`} value={k.mealTimings} onChange={(e) => setKitchen(i, { mealTimings: e.target.value })} className={input} placeholder="Breakfast 8–10am, Lunch 12–2pm" required />
                  </div>
                  <div>
                    <label htmlFor={`k-store-${i}`} className="text-xs font-medium">Storage areas</label>
                    <input id={`k-store-${i}`} value={k.storageAreas} onChange={(e) => setKitchen(i, { storageAreas: e.target.value })} className={input} placeholder="Dry store, Cold room" required />
                  </div>
                  <div>
                    <label htmlFor={`k-cat-${i}`} className="text-xs font-medium">Food categories</label>
                    <input id={`k-cat-${i}`} value={k.foodCategories} onChange={(e) => setKitchen(i, { foodCategories: e.target.value })} className={input} placeholder="Grains, Vegetables…" required />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button type="submit" disabled={busy} className="w-full rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
          {busy ? 'Saving…' : 'Complete onboarding'}
        </button>
      </form>
    </div>
  );
}
