import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface PreviewRow {
  recordId: string; foodItemId: string | null; food: string; mealType: string;
  targetKg: number | null; preparedKg: number; servedKg: number; soldKg: number;
  wasteKg: number; remainingKg: number; notes: string | null; isCorrection: boolean;
}
interface Preview {
  date: string; kitchen: { id: string; name: string };
  rows: PreviewRow[];
  totals: { preparedKg: number; servedKg: number; soldKg: number; wasteKg: number; remainingKg: number; records: number; corrections: number };
  potentialSurplusKg: number;
  incoherent: { recordId: string; food: string; mealType: string; shortfall: number; hint: string }[];
  accuracyPreview: { pairs: number; meanAbsPctErr: number | null; targetsPresent: number; targetsMissing: number };
  alreadyFinalized: boolean;
}
interface Report {
  id: string; date: string; kitchen: string;
  totalPreparedKg: number; totalServedKg: number; totalWasteKg: number; totalSurplusKg: number;
  notes: string | null; status: string;
  accuracy: { pairs: number; meanAbsPctErr: number | null; targetsPresent: number; targetsMissing: number } | null;
  qualityNotes: string | null; reopenedAt: string | null; reopenReason: string | null;
}

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
const input = 'mt-1 w-full rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741] focus:ring-1 focus:ring-[#006B48]';
const card = 'rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm';
const todayIso = () => new Date().toISOString().slice(0, 10);

export function EndOfDay() {
  const { user } = useAuth();
  const kitchens = user?.organization?.kitchens ?? [];
  const canManage = !!user && MANAGE_ROLES.includes(user.role);
  const [kitchenId, setKitchenId] = useState('');
  const [date, setDate] = useState(todayIso);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [reopenFor, setReopenFor] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);

  useEffect(() => {
    if (!kitchenId && kitchens.length > 0) setKitchenId(kitchens[0].id);
  }, [kitchens, kitchenId]);

  const loadReports = useCallback(async (kid: string) => {
    if (!kid) return;
    try {
      const d = await api<{ reports: Report[] }>(`/eod/reports?kitchenUnitId=${kid}`);
      setReports(d.reports);
    } catch {
      // reports list is supplementary; preview errors surface separately
    }
  }, []);

  useEffect(() => { void loadReports(kitchenId); }, [loadReports, kitchenId]);

  async function runPreview() {
    setError(''); setMsg(''); setPreview(null);
    setLoading(true);
    try {
      const d = await api<Preview>(`/eod/preview?kitchenUnitId=${kitchenId}&date=${date}`);
      setPreview(d);
      if (window.showToast) window.showToast('Day records review loaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load preview.');
    } finally {
      setLoading(false);
    }
  }

  async function runClose() {
    setError(''); setMsg(''); setBusy(true);
    try {
      const d = await api<{ message: string }>(`/eod/close`, {
        method: 'POST', body: JSON.stringify({ kitchenUnitId: kitchenId, date, notes: notes.trim() || undefined }),
      });
      setMsg(d.message);
      if (window.showToast) window.showToast('Day finalized and closed successfully!');
      await runPreview();
      await loadReports(kitchenId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Closing failed.');
      try {
        const d = await api<Preview>(`/eod/preview?kitchenUnitId=${kitchenId}&date=${date}`);
        setPreview(d);
      } catch { /* keep original error */ }
    } finally {
      setBusy(false);
    }
  }

  async function runReopen() {
    setReopenError('');
    setMsg('');
    setReopenBusy(true);
    try {
      const d = await api<{ message: string }>(`/eod/reopen`, {
        method: 'POST', body: JSON.stringify({ kitchenUnitId: kitchenId, date, reason: reopenReason.trim() }),
      });
      setMsg(d.message);
      setReopenFor(false);
      setReopenReason('');
      if (window.showToast) window.showToast('Day reopened with audit record');
      await runPreview();
      await loadReports(kitchenId);
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : 'Reopen failed.');
    } finally {
      setReopenBusy(false);
    }
  }

  return (
    <div className="space-y-5 animate-fadeInUpStagger">
      <div className={card}>
        <h1 className="text-xl font-bold text-[#0C2741]">End of Day Reconciliation</h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-500">
          Review the day's records, reconcile problems with reasoned corrections, then finalize once per kitchen and date.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="eod-kitchen" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Kitchen</label>
            <select id="eod-kitchen" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)} className="mt-1 rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741]">
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="eod-date" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Date</label>
            <input id="eod-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741]" />
          </div>
          <button onClick={runPreview} disabled={loading || !kitchenId} className="rounded-xl bg-[#006B48] px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-[#004C35] active:scale-95 disabled:opacity-60 transition-all cursor-pointer">
            {loading ? 'Loading…' : 'Review Day'}
          </button>
        </div>
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
        {msg && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{msg}</p>}
      </div>

      {preview && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3ECE6] pb-3">
            <h2 className="text-base font-bold text-[#0C2741]">Review · {preview.kitchen.name} · {preview.date}</h2>
            {preview.alreadyFinalized && <span className="rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-semibold text-[#059669]">finalized</span>}
          </div>
          {preview.rows.length === 0 ? (
            <p className="mt-3 text-xs sm:text-sm text-gray-500">No food records for this kitchen/date — nothing to close.</p>
          ) : (<>
            <div className="mt-3 overflow-x-auto custom-scrollbar">
              <table className="w-full text-xs sm:text-sm min-w-[650px]">
                <thead className="bg-[#F9FCFA] text-[#0C2741] font-semibold border-b border-[#E3ECE6]">
                  <tr className="text-left">
                    <th className="py-2.5 px-3">Food · Meal</th>
                    <th className="py-2.5 px-3">Target</th>
                    <th className="py-2.5 px-3">Produced</th>
                    <th className="py-2.5 px-3">Sold</th>
                    <th className="py-2.5 px-3">Waste</th>
                    <th className="py-2.5 px-3">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3ECE6]">
                  {preview.rows.map((r) => (
                    <tr key={r.recordId} className="hover:bg-[#F9FCFA] transition-colors">
                      <td className="py-2 px-3 font-medium text-[#0C2741]">
                        {r.food} · {r.mealType}
                        {r.isCorrection && <span className="ml-1 text-xs text-gray-500 font-normal">(corrected)</span>}
                      </td>
                      <td className="py-2 px-3 text-stone-700">{r.targetKg !== null ? `${r.targetKg} kg` : '—'}</td>
                      <td className="py-2 px-3 font-semibold text-[#006B48]">{r.preparedKg} kg</td>
                      <td className="py-2 px-3 text-stone-700">{r.soldKg} kg</td>
                      <td className="py-2 px-3 text-stone-700">{r.wasteKg} kg</td>
                      <td className="py-2 px-3 text-stone-700">{r.remainingKg} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 bg-[#F9FCFA] p-3 rounded-xl border border-[#E3ECE6] text-xs sm:text-sm">
              <p className="font-bold text-[#0C2741]">
                Totals: {preview.totals.preparedKg} kg prepared · {preview.totals.soldKg} kg sold · {preview.totals.wasteKg} kg waste · {preview.potentialSurplusKg} kg potential surplus
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                ({preview.totals.records} records, {preview.totals.corrections} corrections)
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Forecast accuracy: {preview.accuracyPreview.pairs > 0 && preview.accuracyPreview.meanAbsPctErr !== null
                  ? `mean abs error ${preview.accuracyPreview.meanAbsPctErr}% over ${preview.accuracyPreview.pairs} target pair(s)`
                  : 'no paired targets for this day'}
                {preview.accuracyPreview.targetsMissing > 0 && ` · ${preview.accuracyPreview.targetsMissing} line(s) without a target`}
              </p>
            </div>
          </>)}

          {preview.incoherent.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm" role="alert">
              <p className="font-bold text-red-800">{preview.incoherent.length} incoherent record(s) — totals were NOT forced:</p>
              <ul className="mt-1 list-disc pl-5 text-red-800 text-xs">
                {preview.incoherent.map((c) => (
                  <li key={c.recordId}>{c.food} · {c.mealType}: over by {c.shortfall} kg. {c.hint}</li>
                ))}
              </ul>
            </div>
          )}

          {canManage && preview.rows.length > 0 && !preview.alreadyFinalized && (
            <div className="mt-4 pt-3 border-t border-[#E3ECE6]">
              <label htmlFor="eod-notes" className="block text-xs font-semibold text-[#0C2741]">Closing notes (optional)</label>
              <input id="eod-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="Anything the next shift should know" />
              <button onClick={runClose} disabled={busy} className="mt-3 rounded-xl bg-[#006B48] px-5 py-2 text-xs sm:text-sm font-bold text-white shadow hover:bg-[#004C35] active:scale-95 disabled:opacity-60 transition-all cursor-pointer">
                {busy ? 'Closing…' : 'Close Day (Finalize Once)'}
              </button>
            </div>
          )}

          {!canManage && <p className="mt-3 text-xs text-gray-500">Only admins / kitchen managers can finalize or reopen days.</p>}

          {canManage && preview.alreadyFinalized && !reopenFor && (
            <button onClick={() => { setReopenFor(true); setReopenReason(''); setReopenError(''); }} className="mt-4 rounded-xl border border-[#E3ECE6] bg-white px-4 py-2 text-xs font-bold text-[#0C2741] hover:bg-[#F2F7F4] active:scale-95 transition-all">
              Reopen with audit reason
            </button>
          )}

          {canManage && preview.alreadyFinalized && reopenFor && (
            <div className="mt-4 rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-4 text-xs sm:text-sm">
              {reopenError && <p className="rounded-xl bg-red-50 p-2 text-red-800 font-bold mb-2" role="alert">{reopenError}</p>}
              <label htmlFor="eod-reason" className="block font-semibold text-[#0C2741]">Audit reason (min 5 characters, required)</label>
              <input id="eod-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className={input} />
              <div className="mt-3 flex gap-2">
                <button onClick={runReopen} disabled={reopenBusy} className="rounded-xl bg-[#006B48] px-4 py-2 text-xs font-bold text-white hover:bg-[#004C35] disabled:opacity-60 transition-all">
                  {reopenBusy ? 'Reopening…' : 'Confirm reopen'}
                </button>
                <button onClick={() => setReopenFor(false)} className="rounded-xl border border-[#E3ECE6] bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={card}>
        <h2 className="text-base font-bold text-[#0C2741]">Finalized Reports ({reports.length})</h2>
        {reports.length === 0 ? <p className="mt-2 text-xs sm:text-sm text-gray-500">No finalized days yet for this kitchen.</p> : (
          <ul className="mt-3 space-y-2.5 text-xs sm:text-sm">
            {reports.map((r) => (
              <li key={r.id} className="rounded-xl border border-[#E3ECE6] p-3.5 hover:border-[#006B48]/30 transition-all">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-[#0C2741]">
                    {r.date.slice(0, 10)} · {r.kitchen}
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.status === 'FINAL' ? 'bg-[#DCFCE7] text-[#059669]' : 'bg-[#FEF3C7] text-[#D97706]'}`}>
                    {r.status}
                  </span>
                </div>
                <p className="mt-1 text-gray-600">
                  Prepared {r.totalPreparedKg} kg · served {r.totalServedKg} kg · waste {r.totalWasteKg} kg · surplus {r.totalSurplusKg} kg
                </p>
                {r.accuracy && r.accuracy.pairs > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">Forecast accuracy: mean abs error {r.accuracy.meanAbsPctErr}% over {r.accuracy.pairs} pair(s).</p>
                )}
                {r.notes && <p className="text-xs text-gray-500 mt-0.5">Notes: {r.notes}</p>}
                {r.status === 'REOPENED' && <p className="text-xs text-amber-800 font-semibold mt-0.5">Reopened: {r.reopenReason ?? ''}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
