import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface Ngo {
  id: string; name: string; address: string | null; city: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  acceptedCategories: string[]; pickupCapable: boolean; operatingHours: string | null;
  capacityKg: number | null; isActive: boolean;
}

const empty = {
  name: '', contactName: '', email: '', phone: '', city: '', address: '',
  acceptedCategories: '', pickupCapable: true, operatingHours: '', capacityKg: '', isActive: true,
};

export function NgoRegistry() {
  const [ngos, setNgos] = useState<Ngo[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api<{ ngos: Ngo[] }>('/ngos');
      setNgos(d.ngos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load NGO registry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function startEdit(n: Ngo) {
    setEditingId(n.id);
    setForm({
      name: n.name, contactName: n.contactName ?? '', email: n.contactEmail ?? '',
      phone: n.contactPhone ?? '', city: n.city ?? '', address: n.address ?? '',
      acceptedCategories: n.acceptedCategories.join(', '), pickupCapable: n.pickupCapable,
      operatingHours: n.operatingHours ?? '', capacityKg: n.capacityKg !== null ? String(n.capacityKg) : '',
      isActive: n.isActive,
    });
    setError('');
    setMsg('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        contactName: form.contactName.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        acceptedCategories: form.acceptedCategories.trim() || undefined,
        pickupCapable: form.pickupCapable,
        operatingHours: form.operatingHours.trim() || undefined,
        capacityKg: form.capacityKg.trim() === '' ? undefined : Number(form.capacityKg),
        isActive: form.isActive,
      };
      if (editingId) {
        await api(`/ngos/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg('NGO updated.');
      } else {
        await api('/ngos', { method: 'POST', body: JSON.stringify(body) });
        setMsg('NGO registered.');
      }
      setForm(empty);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save NGO.');
    } finally {
      setBusy(false);
    }
  }

  async function setActive(id: string, active: boolean) {
    setError('');
    setMsg('');
    try {
      await api(`/ngos/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' });
      setMsg(active ? 'NGO reactivated.' : 'NGO deactivated. History is preserved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update NGO.');
    }
  }

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };
  const inputCls = 'mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-leaf-900">NGO Registry</h1>
        <p className="mt-1 text-sm text-stone-600">Super Admin manages registered NGOs. Deactivation preserves history — records are never deleted.</p>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">{editingId ? 'Edit NGO' : 'Register NGO'}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="ngo-name" className="text-sm font-medium">Organization name</label>
            <input id="ngo-name" value={form.name} onChange={set('name')} required className={inputCls} /></div>
          <div><label htmlFor="ngo-contact" className="text-sm font-medium">Contact name</label>
            <input id="ngo-contact" value={form.contactName} onChange={set('contactName')} className={inputCls} /></div>
          <div><label htmlFor="ngo-email" className="text-sm font-medium">Contact email</label>
            <input id="ngo-email" type="email" value={form.email} onChange={set('email')} className={inputCls} /></div>
          <div><label htmlFor="ngo-phone" className="text-sm font-medium">Contact phone</label>
            <input id="ngo-phone" value={form.phone} onChange={set('phone')} className={inputCls} /></div>
          <div><label htmlFor="ngo-city" className="text-sm font-medium">City / service area (text)</label>
            <input id="ngo-city" value={form.city} onChange={set('city')} className={inputCls} /></div>
          <div><label htmlFor="ngo-address" className="text-sm font-medium">Address (text only)</label>
            <input id="ngo-address" value={form.address} onChange={set('address')} className={inputCls} /></div>
          <div><label htmlFor="ngo-cats" className="text-sm font-medium">Accepted food categories (comma-separated)</label>
            <input id="ngo-cats" value={form.acceptedCategories} onChange={set('acceptedCategories')} placeholder="Cooked Veg, Grains" className={inputCls} /></div>
          <div><label htmlFor="ngo-hours" className="text-sm font-medium">Operating hours (text, e.g. 08:00-20:00)</label>
            <input id="ngo-hours" value={form.operatingHours} onChange={set('operatingHours')} className={inputCls} /></div>
          <div><label htmlFor="ngo-cap" className="text-sm font-medium">Capacity kg per pickup (blank = unstated)</label>
            <input id="ngo-cap" type="number" min="0.01" step="0.1" value={form.capacityKg} onChange={set('capacityKg')} className={inputCls} /></div>
          <div className="flex items-end gap-4 pb-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.pickupCapable} onChange={set('pickupCapable')} /> Pickup capable</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={set('isActive')} /> Active</label>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Register NGO'}
          </button>
          {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100">Cancel</button>}
        </div>
      </form>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Registered NGOs ({ngos.length})</h2>
        {loading ? <p className="mt-2 text-sm" role="status">Loading…</p> : ngos.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No NGOs registered yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {ngos.map((n) => (
              <li key={n.id} className={`rounded-xl border p-4 ${n.isActive ? 'border-stone-200' : 'border-stone-300 bg-stone-50'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{n.name}</p>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${n.isActive ? 'bg-leaf-100 text-leaf-900' : 'bg-stone-200 text-stone-700'}`}>
                    {n.isActive ? 'active' : 'inactive'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  {[n.contactName, n.contactEmail, n.contactPhone].filter(Boolean).join(' · ') || 'No contact recorded'}
                </p>
                <p className="text-sm text-stone-600">
                  {[n.city, n.address].filter(Boolean).join(', ') || 'No service area recorded'} ·
                  accepts {n.acceptedCategories.join(', ') || 'nothing listed'} ·
                  {n.pickupCapable ? ' pickup capable' : ' no pickup'} ·
                  {n.operatingHours ? ` hours ${n.operatingHours}` : ' hours unstated'} ·
                  {n.capacityKg !== null ? ` capacity ${n.capacityKg} kg` : ' capacity unstated'}
                </p>
                <div className="mt-2 flex gap-2 text-sm">
                  <button onClick={() => startEdit(n)} className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-100">Edit</button>
                  {n.isActive
                    ? <button onClick={() => void setActive(n.id, false)} className="rounded-lg border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50">Deactivate</button>
                    : <button onClick={() => void setActive(n.id, true)} className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-100">Reactivate</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
