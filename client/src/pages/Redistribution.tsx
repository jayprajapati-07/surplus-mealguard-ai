import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface MatchReason { criterion: string; points: number; detail: string }
interface MatchRow {
  id: string; status: string; score: number; eligible: boolean; reasons: MatchReason[];
  ngo: { id: string; name: string; city: string | null; isActive: boolean; acceptedCategories: string[] };
}
interface Assessment { id: string; foodDescription: string; quantityKg: number; reason: string | null; createdAt: string }
interface TimelineEv { at: string; action: string; metadata: string | null }
interface RecordRow {
  id: string; status: string; quantityKg: number; pickupAt: string | null;
  notes: string | null; createdAt: string; ngoId: string | null; ngoName: string | null;
  assessmentFood: string | null; assessmentId: string | null;
  deliveryAttempts: { at: string; channel: string; ok: boolean; error?: string }[];
  timeline: TimelineEv[];
}
interface Opportunity {
  id: string; status: string; quantityKg: number; pickupAt: string | null; notes: string | null; createdAt: string;
  assessment: { id: string; food: string; quantityKg: number; reason: string | null } | null;
  institution: { name: string; city: string; address: string; contactName: string; contactPhone: string; contactEmail: string } | null;
  score: number; reasons: MatchReason[];
  deliveryAttempts: { at: string; channel: string; ok: boolean; error?: string }[];
}

const MANAGE = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
const inputCls = 'mt-1 block w-full rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-xs sm:text-sm bg-white text-[#0C2741] focus:ring-1 focus:ring-[#006B48]';
const btnCls = 'rounded-xl bg-[#006B48] px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-[#004C35] active:scale-95 disabled:opacity-60 transition-all cursor-pointer';
const ghostCls = 'rounded-xl border border-[#E3ECE6] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0C2741] hover:bg-[#F2F7F4] active:scale-95 disabled:opacity-60 transition-all cursor-pointer';

function statusChip(s: string) {
  const cls = s === 'COMPLETED' ? 'bg-[#DCFCE7] text-[#059669]'
    : s === 'DECLINED' || s === 'CANCELLED' ? 'bg-red-100 text-red-800'
    : s === 'DRAFT' ? 'bg-stone-200 text-stone-700' : 'bg-[#FEF3C7] text-[#D97706]';
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{s}</span>;
}

export function Redistribution() {
  const { user } = useAuth();
  const isNgo = user?.role === 'NGO';
  return (
    <div className="space-y-5 animate-fadeInUpStagger">
      <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm">
        <h1 className="text-xl font-bold text-[#0C2741]">Food Distribution &amp; Redistribution</h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-500">
          {isNgo
            ? 'Opportunities from institutions matched to your registered NGO. Accept, decline with a reason, or request a callback — every decision is recorded.'
            : 'Move eligible surplus from match to handover: match suitable registered NGOs, notify them truthfully, and track every state with an audit trail.'}
        </p>
      </div>
      {isNgo ? <NgoView /> : <InstitutionView canManage={!!user && MANAGE.includes(user.role)} />}
    </div>
  );
}

function useMsg() {
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  return { error, setError, msg, setMsg };
}

/* ---------------- Institution view ---------------- */

function InstitutionView({ canManage }: { canManage: boolean }) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [assessId, setAssessId] = useState('');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draftId, setDraftId] = useState('');
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notifyResult, setNotifyResult] = useState<{ ngoId: string; channel: string; ok: boolean; error?: string }[] | null>(null);
  const { error, setError, msg, setMsg } = useMsg();
  // per-record action inputs
  const [pickupAt, setPickupAt] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});

  const loadAssessments = useCallback(async () => {
    try {
      const d = await api<{ assessments: Assessment[] }>('/eligibility/assessments?verdict=ELIGIBLE');
      setAssessments(d.assessments);
    } catch { /* listed below via error */ }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const d = await api<{ records: RecordRow[] }>('/redistribution/records');
      setRecords(d.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load records.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    await Promise.all([loadAssessments(), loadRecords()]);
    setLoading(false);
  }, [loadAssessments, loadRecords]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runMatches(id: string) {
    setError('');
    setMsg('');
    setNotifyResult(null);
    try {
      const d = await api<{ matches: MatchRow[] }>(`/redistribution/matches?assessmentId=${id}`);
      setMatches(d.matches);
      setAssessId(id);
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compute matches.');
    }
  }

  async function runNotify() {
    if (selected.length === 0) { setError('Select at least one NGO first.'); return; }
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const d = await api<{ message: string; results: { ngoId: string; channel: string; ok: boolean; error?: string }[] }>(
        '/redistribution/notify',
        { method: 'POST', body: JSON.stringify({ assessmentId: assessId, ngoIds: selected, ...(draftId.trim() ? { draftId: draftId.trim() } : {}) }) });
      setMsg(d.message);
      setNotifyResult(d.results);
      setSelected([]);
      if (window.showToast) window.showToast('NGOs notified successfully!');
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Notify failed.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(id: string, action: 'schedule' | 'handover' | 'cancel', body: unknown) {
    setError('');
    setMsg('');
    try {
      const d = await api<{ record: RecordRow }>(`/redistribution/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      setMsg(`Record ${d.record.id.slice(-6)} is now ${d.record.status}.`);
      if (window.showToast) window.showToast(`Record updated to ${d.record.status}`);
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transition failed.');
    }
  }

  async function retry(matchId: string) {
    setError('');
    setMsg('');
    try {
      const d = await api<{ attempt: { channel: string; ok: boolean } }>(`/redistribution/notify/${matchId}/retry`, { method: 'POST' });
      setMsg(`Retried delivery (${d.attempt.channel}, ${d.attempt.ok ? 'ok' : 'failed'}). See match rows for the full attempt history.`);
      if (window.showToast) window.showToast('Retry attempt processed');
      if (assessId) await runMatches(assessId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    }
  }

  const matchedIds = new Set(records.filter((r) => !['COMPLETED', 'CANCELLED'].includes(r.status)).map((r) => r.assessmentId));
  const unmatched = assessments.filter((a) => !matchedIds.has(a.id));

  return (
    <>
      {error && <p className="rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
      {msg && <p className="rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{msg}</p>}

      <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-base font-bold text-[#0C2741]">1 · Eligible surplus → match suitable registered NGOs</h2>
        {loading ? <p className="mt-2 text-xs sm:text-sm text-gray-500" role="status">Loading assessments…</p> : assessments.length === 0 ? (
          <p className="mt-2 text-xs sm:text-sm text-stone-600">No ELIGIBLE assessments. Record one on the <Link to="/eligibility" className="text-[#006B48] font-semibold underline">Eligibility</Link> page first.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-3 text-xs sm:text-sm">
            <div>
              <label htmlFor="rd-assess" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Assessment</label>
              <select id="rd-assess" value={assessId} onChange={(e) => void runMatches(e.target.value)} className={inputCls}>
                <option value="">— choose —</option>
                {assessments.map((a) => <option key={a.id} value={a.id}>{a.foodDescription} · {a.quantityKg} kg</option>)}
              </select>
            </div>
          </div>
        )}
        {matches.length > 0 && (
          <div className="mt-4 overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs sm:text-sm min-w-[600px]">
              <thead className="bg-[#F9FCFA] text-[#0C2741] font-semibold border-b border-[#E3ECE6]">
                <tr className="text-left">
                  <th className="py-2.5 px-3">NGO</th>
                  <th className="py-2.5 px-3">Score</th>
                  <th className="py-2.5 px-3">Reasons</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Select</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3ECE6]">
                {matches.map((m) => (
                  <tr key={m.id} className="hover:bg-[#F9FCFA] transition-colors align-top">
                    <td className="py-2.5 px-3 font-medium text-[#0C2741]">{m.ngo.name}
                      <span className="ml-1 text-xs text-gray-500">{m.ngo.isActive ? '' : '(inactive)'}</span></td>
                    <td className="py-2.5 px-3"><strong className="text-[#006B48]">{m.score}</strong> / 100</td>
                    <td className="py-2.5 px-3"><ul className="list-disc pl-4 text-stone-600 text-xs">
                      {m.reasons.map((x, i) => <li key={i}>+{x.points} {x.criterion}: {x.detail}</li>)}
                    </ul></td>
                    <td className="py-2.5 px-3">{m.status}</td>
                    <td className="py-2.5 px-3">
                      {m.eligible && m.score > 0 ? (
                        <input type="checkbox" aria-label={`Select ${m.ngo.name}`}
                          className="rounded text-[#006B48] focus:ring-[#006B48] h-4 w-4 cursor-pointer"
                          checked={selected.includes(m.ngo.id)}
                          onChange={(e) => setSelected((s) => e.target.checked ? [...s, m.ngo.id] : s.filter((x) => x !== m.ngo.id))} />
                      ) : <span className="text-xs text-gray-400">not selectable</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage && (
              <div className="mt-4 flex flex-wrap items-end gap-3 text-xs sm:text-sm">
                <div>
                  <label htmlFor="rd-draft" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">Link prep draft (optional id)</label>
                  <input id="rd-draft" value={draftId} onChange={(e) => setDraftId(e.target.value)} placeholder="Draft id from Food Flow" className={inputCls} />
                </div>
                <button onClick={() => void runNotify()} disabled={busy || selected.length === 0} className={btnCls}>
                  {busy ? 'Notifying…' : `Notify selected (${selected.length})`}
                </button>
              </div>
            )}
            {notifyResult && (
              <ul className="mt-3 space-y-1.5 text-xs">
                {notifyResult.map((x) => (
                  <li key={x.ngoId} className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-2.5">
                    {x.ngoId.slice(-6)}: {x.channel !== 'smtp' ? 'simulated local delivery (no email was sent)' : `SMTP attempt ${x.ok ? 'delivered' : 'failed'}`}
                    {x.error && <span className="text-red-700 font-bold"> — {x.error}</span>}
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => { const m = matches[0]; if (m) void retry(m.id); }} className="mt-3 text-xs text-[#006B48] font-semibold hover:underline">
              Retry delivery for top match
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-base font-bold text-[#0C2741]">2 · Tracked records ({records.length})</h2>
        {records.length === 0 ? <p className="mt-2 text-xs sm:text-sm text-gray-500">No redistribution records yet.</p> : (
          <ul className="mt-3 space-y-3">
            {records.map((r) => (
              <li key={r.id} className="rounded-xl border border-[#E3ECE6] p-4 text-xs sm:text-sm hover:border-[#006B48]/30 transition-all">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-[#0C2741]">{r.assessmentFood ?? 'Surplus'} · {r.quantityKg} kg → {r.ngoName ?? '—'}</p>
                  {statusChip(r.status)}
                </div>
                {r.notes && <p className="mt-1 text-gray-600">{r.notes}</p>}
                {r.pickupAt && <p className="text-gray-600">Pickup: {new Date(r.pickupAt).toLocaleString()}</p>}
                {r.deliveryAttempts.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">Delivery: {r.deliveryAttempts.map((a) => `${a.channel} ${a.ok ? 'ok' : 'failed'}@${new Date(a.at).toLocaleTimeString()}`).join(' · ')}</p>
                )}
                <details className="mt-2 text-xs"><summary className="cursor-pointer text-[#006B48] font-semibold hover:underline">Audit timeline ({r.timeline.length})</summary>
                  <ul className="mt-1 list-disc pl-5 text-gray-600">
                    {r.timeline.map((t, i) => <li key={i}>{new Date(t.at).toLocaleString()} — {t.action}</li>)}
                  </ul>
                </details>
                {canManage && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 pt-2 border-t border-[#E3ECE6]">
                    {r.status === 'ACCEPTED' && (
                      <span className="flex items-end gap-1.5">
                        <input type="datetime-local" aria-label="Pickup time" id={`pk-${r.id}`}
                          defaultValue={r.pickupAt ? new Date(r.pickupAt).toISOString().slice(0, 16) : ''}
                          onChange={(e) => setPickupAt((s) => ({ ...s, [r.id]: e.target.value }))} className="rounded-xl border border-[#E3ECE6] px-2.5 py-1.5 text-xs text-[#0C2741]" />
                        <button onClick={() => void transition(r.id, 'schedule', { pickupAt: pickupAt[r.id] ? new Date(pickupAt[r.id]).toISOString() : new Date().toISOString() })} className={ghostCls}>Confirm schedule</button>
                      </span>
                    )}
                    {r.status === 'PICKUP_SCHEDULED' && <button onClick={() => void transition(r.id, 'handover', {})} className={ghostCls}>Confirm handover</button>}
                    {!['COMPLETED', 'CANCELLED'].includes(r.status) && (
                      <span className="flex items-end gap-1.5">
                        <input aria-label="Cancel reason" placeholder="Cancel reason (min 5)" value={cancelReason[r.id] ?? ''}
                          onChange={(e) => setCancelReason((s) => ({ ...s, [r.id]: e.target.value }))} className="rounded-xl border border-[#E3ECE6] px-2.5 py-1.5 text-xs text-[#0C2741]" />
                        <button onClick={() => void transition(r.id, 'cancel', { reason: cancelReason[r.id] ?? '' })} className={ghostCls}>Cancel</button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-base font-bold text-[#0C2741]">Follow-up: eligible but not yet moving ({unmatched.length})</h2>
        {unmatched.length === 0 ? <p className="mt-2 text-xs sm:text-sm text-gray-500">Nothing waiting — every eligible assessment has an active record, or none exist.</p> : (
          <ul className="mt-3 space-y-1.5 text-xs sm:text-sm">
            {unmatched.map((a) => (
              <li key={a.id} className="rounded-xl bg-[#FFFDF7] border border-[#FDE8B5] p-3 text-[#B45309]">
                {a.foodDescription} · {a.quantityKg} kg — no active redistribution. Match above, or record disposal on the <Link to="/eligibility" className="text-[#006B48] font-bold underline">Eligibility</Link> page. Nothing disappears silently.
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/* ---------------- NGO view ---------------- */

function NgoView() {
  const [records, setRecords] = useState<Opportunity[]>([]);
  const [history, setHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { pickupAt: string; reason: string; message: string; phone: string }>>({});

  const load = useCallback(async (hist: boolean) => {
    setLoading(true);
    setError('');
    try {
      const d = await api<{ records: Opportunity[] }>(`/redistribution/opportunities${hist ? '?history=true' : ''}`);
      setRecords(d.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load opportunities.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(history); }, [load, history]);

  const f = (id: string) => forms[id] ?? { pickupAt: '', reason: '', message: '', phone: '' };
  const setF = (id: string, patch: Partial<{ pickupAt: string; reason: string; message: string; phone: string }>) =>
    setForms((s) => ({ ...s, [id]: { ...f(id), ...patch } }));

  async function act(id: string, action: 'accept' | 'decline' | 'callback' | 'confirm-receipt', body: unknown) {
    setError('');
    setMsg('');
    setBusyId(id);
    try {
      const d = await api<{ record?: { status: string }; message: string }>(`/redistribution/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      setMsg(d.message ?? `Done (now ${d.record?.status ?? 'updated'}).`);
      if (window.showToast) window.showToast('Opportunity updated successfully');
      await load(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error && <p className="rounded-xl bg-red-50 p-3 text-xs sm:text-sm font-semibold text-red-800 border border-red-200" role="alert">{error}</p>}
      {msg && <p className="rounded-xl bg-emerald-50 p-3 text-xs sm:text-sm font-semibold text-emerald-900 border border-emerald-200" role="status">{msg}</p>}
      <div className="rounded-2xl border border-[#E3ECE6] bg-white p-5 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-[#0C2741]">Opportunities for your NGO ({records.length})</h2>
          <button onClick={() => setHistory((h) => !h)} className={ghostCls} aria-pressed={history}>
            {history ? 'Hide history' : 'Show history'}
          </button>
        </div>
        {loading ? <p className="mt-2 text-xs sm:text-sm text-gray-500" role="status">Loading…</p> : records.length === 0 ? (
          <p className="mt-2 text-xs sm:text-sm text-stone-600">No open opportunities right now. New matches arrive here with an inbox notification.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {records.map((o) => (
              <li key={o.id} className="rounded-xl border border-[#E3ECE6] p-4 text-xs sm:text-sm hover:border-[#006B48]/30 transition-all">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-[#0C2741]">{o.assessment?.food ?? 'Surplus'} · {o.quantityKg} kg</p>
                  {statusChip(o.status)}
                  <span className="text-xs text-gray-500 font-medium">match score {o.score}/100</span>
                </div>
                <p className="mt-1 text-gray-600">{o.institution?.name} ({o.institution?.city}) — {o.institution?.address}</p>
                <p className="text-gray-600">Contact: {o.institution?.contactName}, {o.institution?.contactPhone}, {o.institution?.contactEmail}</p>
                {o.assessment?.reason && <p className="mt-1 text-gray-600">Eligibility notes: {o.assessment.reason}</p>}
                {o.pickupAt && <p className="text-gray-600">Pickup: {new Date(o.pickupAt).toLocaleString()}</p>}
                {o.reasons.length > 0 && (
                  <details className="mt-2 text-xs"><summary className="cursor-pointer text-[#006B48] font-semibold hover:underline">Why matched to us</summary>
                    <ul className="mt-1 list-disc pl-5 text-gray-600">
                      {o.reasons.map((x, i) => <li key={i}>+{x.points} {x.criterion}: {x.detail}</li>)}
                    </ul>
                  </details>
                )}
                {o.deliveryAttempts.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">Delivery: {o.deliveryAttempts.map((a) => `${a.channel} ${a.ok ? 'ok' : 'failed'}`).join(' · ')}</p>
                )}
                {o.status === 'NOTIFIED' && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 pt-2 border-t border-[#E3ECE6]">
                    <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
                      <label htmlFor={`pa-${o.id}`} className="block text-xs font-semibold text-[#0C2741]">Intended pickup (accept)</label>
                      <input id={`pa-${o.id}`} type="datetime-local" value={f(o.id).pickupAt} onChange={(e) => setF(o.id, { pickupAt: e.target.value })} className={inputCls} />
                      <button disabled={busyId === o.id} onClick={() => void act(o.id, 'accept', { intendedPickupAt: f(o.id).pickupAt ? new Date(f(o.id).pickupAt).toISOString() : '' })} className={`${btnCls} mt-2`}>Accept</button>
                    </div>
                    <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
                      <label htmlFor={`dr-${o.id}`} className="block text-xs font-semibold text-[#0C2741]">Decline reason (min 5 chars)</label>
                      <input id={`dr-${o.id}`} value={f(o.id).reason} onChange={(e) => setF(o.id, { reason: e.target.value })} className={inputCls} />
                      <div className="mt-2 flex gap-2">
                        <button disabled={busyId === o.id} onClick={() => void act(o.id, 'decline', { reason: f(o.id).reason })} className={ghostCls}>Decline</button>
                      </div>
                      <label htmlFor={`cb-${o.id}`} className="mt-3 block text-xs font-semibold text-[#0C2741]">Callback message / phone (optional)</label>
                      <input id={`cb-${o.id}`} value={f(o.id).message} onChange={(e) => setF(o.id, { message: e.target.value })} placeholder="Message" className={inputCls} />
                      <input aria-label="Callback phone" value={f(o.id).phone} onChange={(e) => setF(o.id, { phone: e.target.value })} placeholder="Phone" className={`${inputCls} mt-1.5`} />
                      <button disabled={busyId === o.id} onClick={() => void act(o.id, 'callback', { message: f(o.id).message || undefined, phone: f(o.id).phone || undefined })} className={`${ghostCls} mt-2`}>Request callback</button>
                    </div>
                  </div>
                )}
                {o.status === 'HANDED_OVER' && (
                  <button disabled={busyId === o.id} onClick={() => void act(o.id, 'confirm-receipt', {})} className={`${btnCls} mt-3`}>
                    Confirm receipt (complete)
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
