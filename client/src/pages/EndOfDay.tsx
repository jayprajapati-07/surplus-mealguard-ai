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
const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';
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
      await runPreview();
      await loadReports(kitchenId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Closing failed.');
      // refresh preview so incoherent list (if any) is visible
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
      await runPreview();
      await loadReports(kitchenId);
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : 'Reopen failed.');
    } finally {
      setReopenBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <h1 className="text-xl font-bold text-leaf-900">End of day</h1>
        <p className="mt-1 text-sm text-stone-600">Review the day's records, reconcile problems with reasoned corrections, then finalize once per kitchen and date.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="eod-kitchen" className="text-sm font-medium">Kitchen</label>
            <select id="eod-kitchen" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)} className="mt-1 rounded-lg border border-stone-300 px-3 py-2">
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="eod-date" className="text-sm font-medium">Date</label>
            <input id="eod-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-lg border border-stone-300 px-3 py-2" />
          </div>
          <button onClick={runPreview} disabled={loading || !kitchenId} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
            {loading ? 'Loading…' : 'Review day'}
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {msg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      </div>

      {preview && (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Review · {preview.kitchen.name} · {preview.date}</h2>
            {preview.alreadyFinalized && <span className="rounded bg-leaf-100 px-2 py-0.5 text-xs font-medium text-leaf-900">finalized</span>}
          </div>
          {preview.rows.length === 0 ? (
            <p className="mt-2 text-sm text-stone-600">No food records for this kitchen/date — nothing to close.</p>
          ) : (<>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th>Food · Meal</th><th>Target</th><th>Produced</th><th>Sold</th><th>Waste</th><th>Remaining</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.recordId} className="border-t border-stone-100">
                    <td>{r.food} · {r.mealType}{r.isCorrection && <span className="ml-1 text-xs text-stone-500">(corrected)</span>}</td>
                    <td>{r.targetKg ?? '—'}</td><td>{r.preparedKg}</td><td>{r.soldKg}</td><td>{r.wasteKg}</td><td>{r.remainingKg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm font-medium">
              Totals: {preview.totals.preparedKg} prepared · {preview.totals.soldKg} sold · {preview.totals.wasteKg} waste · {preview.potentialSurplusKg} potential surplus kg
              ({preview.totals.records} records, {preview.totals.corrections} corrections)
            </p>
            <p className="mt-1 text-sm text-stone-600">
              Forecast accuracy: {preview.accuracyPreview.pairs > 0 && preview.accuracyPreview.meanAbsPctErr !== null
                ? `mean abs error ${preview.accuracyPreview.meanAbsPctErr}% over ${preview.accuracyPreview.pairs} target pair(s)`
                : 'no paired targets for this day'}
              {preview.accuracyPreview.targetsMissing > 0 && ` · ${preview.accuracyPreview.targetsMissing} line(s) without a target`}
            </p>
          </>)}
          {preview.incoherent.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm" role="alert">
              <p className="font-bold text-red-800">{preview.incoherent.length} incoherent record(s) — totals were NOT forced:</p>
              <ul className="mt-1 list-disc pl-5 text-red-800">
                {preview.incoherent.map((c) => (
                  <li key={c.recordId}>{c.food} · {c.mealType}: over by {c.shortfall} kg. {c.hint} <Link to="/food-data" className="underline">Open Food Data</Link></li>
                ))}
              </ul>
            </div>
          )}
          {canManage && preview.rows.length > 0 && !preview.alreadyFinalized && (
            <div className="mt-3">
              <label htmlFor="eod-notes" className="text-sm font-medium">Closing notes (optional)</label>
              <input id="eod-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="Anything the next shift should know" />
              <button onClick={runClose} disabled={busy} className="mt-2 rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
                {busy ? 'Closing…' : 'Close day (finalize once)'}
              </button>
            </div>
          )}
          {!canManage && <p className="mt-3 text-sm text-stone-500">Only admins / kitchen managers can finalize or reopen days.</p>}
          {canManage && preview.alreadyFinalized && !reopenFor && (
            <button onClick={() => { setReopenFor(true); setReopenReason(''); setReopenError(''); }} className="mt-3 rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-100">
              Reopen with audit reason
            </button>
          )}
          {canManage && preview.alreadyFinalized && reopenFor && (
            <div className="mt-3 rounded-xl bg-stone-50 p-3 text-sm">
              {reopenError && <p className="rounded-lg bg-red-50 p-2 text-red-800" role="alert">{reopenError}</p>}
              <label htmlFor="eod-reason" className="font-medium">Audit reason (min 5 characters, required)</label>
              <input id="eod-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className={input} />
              <div className="mt-2 flex gap-2">
                <button onClick={runReopen} disabled={reopenBusy} className="rounded-lg bg-leaf-700 px-4 py-2 text-white hover:bg-leaf-800 disabled:opacity-60">{reopenBusy ? 'Reopening…' : 'Confirm reopen'}</button>
                <button onClick={() => setReopenFor(false)} className="rounded-lg border border-stone-300 px-4 py-2 hover:bg-white">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={card}>
        <h2 className="font-bold">Reports ({reports.length})</h2>
        {reports.length === 0 ? <p className="mt-1 text-sm text-stone-600">No finalized days yet for this kitchen.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {reports.map((r) => (
              <li key={r.id} className="rounded-xl border border-stone-200 p-3">
                <p className="font-medium">{r.date.slice(0, 10)} · {r.kitchen}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${r.status === 'FINAL' ? 'bg-leaf-100 text-leaf-900' : 'bg-amber-100 text-amber-900'}`}>{r.status}</span></p>
                <p className="mt-1 text-stone-700">Prepared {r.totalPreparedKg} · served {r.totalServedKg} · waste {r.totalWasteKg} · surplus {r.totalSurplusKg} kg</p>
                {r.accuracy && r.accuracy.pairs > 0 && <p className="text-stone-600">Forecast accuracy: mean abs error {r.accuracy.meanAbsPctErr}% over {r.accuracy.pairs} pair(s).</p>}
                {r.qualityNotes && <p className="text-xs text-stone-500">{r.qualityNotes}</p>}
                {r.notes && <p className="text-xs text-stone-500">Notes: {r.notes}</p>}
                {r.status === 'REOPENED' && <p className="text-xs text-amber-800">Reopened: {r.reopenReason ?? ''}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
