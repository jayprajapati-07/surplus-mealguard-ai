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
const inputCls = 'mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm';
const btnCls = 'rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60';
const ghostCls = 'rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-60';

function statusChip(s: string) {
  const cls = s === 'COMPLETED' ? 'bg-leaf-100 text-leaf-900'
    : s === 'DECLINED' || s === 'CANCELLED' ? 'bg-red-100 text-red-800'
    : s === 'DRAFT' ? 'bg-stone-200 text-stone-700' : 'bg-amber-100 text-amber-900';
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{s}</span>;
}

export function Redistribution() {
  const { user } = useAuth();
  const isNgo = user?.role === 'NGO';
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-leaf-900">Redistribution</h1>
        <p className="mt-1 text-sm text-stone-600">
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
      if (assessId) await runMatches(assessId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    }
  }

  const matchedIds = new Set(records.filter((r) => !['COMPLETED', 'CANCELLED'].includes(r.status)).map((r) => r.assessmentId));
  const unmatched = assessments.filter((a) => !matchedIds.has(a.id));

  return (
    <>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {msg && <p className="rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">1 · Eligible surplus → match suitable registered NGOs</h2>
        {loading ? <p className="mt-2 text-sm" role="status">Loading…</p> : assessments.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No ELIGIBLE assessments. Record one on the <Link to="/eligibility" className="underline">Eligibility</Link> page first.</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-end gap-2 text-sm">
            <div>
              <label htmlFor="rd-assess" className="font-medium">Assessment</label>
              <select id="rd-assess" value={assessId} onChange={(e) => void runMatches(e.target.value)} className={inputCls}>
                <option value="">— choose —</option>
                {assessments.map((a) => <option key={a.id} value={a.id}>{a.foodDescription} · {a.quantityKg} kg</option>)}
              </select>
            </div>
          </div>
        )}
        {matches.length > 0 && (
          <div className="mt-3">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th>NGO</th><th>Score</th><th>Reasons</th><th>Status</th><th>Select</th></tr></thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.id} className="border-t border-stone-100 align-top">
                    <td className="py-2 pr-2 font-medium">{m.ngo.name}
                      <span className="ml-1 text-xs text-stone-500">{m.ngo.isActive ? '' : '(inactive)'}</span></td>
                    <td><strong>{m.score}</strong> / 100</td>
                    <td><ul className="list-disc pl-4 text-stone-600">
                      {m.reasons.map((x, i) => <li key={i}>+{x.points} {x.criterion}: {x.detail}</li>)}
                    </ul></td>
                    <td>{m.status}</td>
                    <td>
                      {m.eligible && m.score > 0 ? (
                        <input type="checkbox" aria-label={`Select ${m.ngo.name}`}
                          checked={selected.includes(m.ngo.id)}
                          onChange={(e) => setSelected((s) => e.target.checked ? [...s, m.ngo.id] : s.filter((x) => x !== m.ngo.id))} />
                      ) : <span className="text-xs text-stone-500">not selectable</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage && (
              <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
                <div>
                  <label htmlFor="rd-draft" className="font-medium">Link prep draft (optional id)</label>
                  <input id="rd-draft" value={draftId} onChange={(e) => setDraftId(e.target.value)} placeholder="Draft id from Food Flow" className={inputCls} />
                </div>
                <button onClick={() => void runNotify()} disabled={busy || selected.length === 0} className="rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
                  {busy ? 'Notifying…' : `Notify selected (${selected.length})`}
                </button>
              </div>
            )}
            {notifyResult && (
              <ul className="mt-2 space-y-1 text-sm">
                {notifyResult.map((x) => (
                  <li key={x.ngoId} className="rounded-lg bg-stone-50 p-2">
                    {x.ngoId.slice(-6)}: {x.channel !== 'smtp' ? 'simulated local delivery (no email was sent)' : `SMTP attempt ${x.ok ? 'delivered' : 'failed'}`}
                    {x.error && <span className="text-red-700"> — {x.error}</span>}
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => { const m = matches[0]; if (m) void retry(m.id); }} className="mt-2 text-sm text-stone-500 underline">Retry delivery for top match</button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">2 · Tracked records ({records.length})</h2>
        {records.length === 0 ? <p className="mt-2 text-sm text-stone-600">No redistribution records yet.</p> : (
          <ul className="mt-2 space-y-3">
            {records.map((r) => (
              <li key={r.id} className="rounded-xl border border-stone-200 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{r.assessmentFood ?? 'Surplus'} · {r.quantityKg} kg → {r.ngoName ?? '—'}</p>
                  {statusChip(r.status)}
                </div>
                {r.notes && <p className="mt-1 text-stone-600">{r.notes}</p>}
                {r.pickupAt && <p className="text-stone-600">Pickup: {new Date(r.pickupAt).toLocaleString()}</p>}
                {r.deliveryAttempts.length > 0 && (
                  <p className="mt-1 text-xs text-stone-500">Delivery: {r.deliveryAttempts.map((a) => `${a.channel} ${a.ok ? 'ok' : 'failed'}@${new Date(a.at).toLocaleTimeString()}`).join(' · ')}</p>
                )}
                <details className="mt-1"><summary className="cursor-pointer text-leaf-800 underline">Audit timeline ({r.timeline.length})</summary>
                  <ul className="mt-1 list-disc pl-5 text-stone-600">
                    {r.timeline.map((t, i) => <li key={i}>{new Date(t.at).toLocaleString()} — {t.action}</li>)}
                  </ul>
                </details>
                {canManage && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {r.status === 'ACCEPTED' && (
                      <span className="flex items-end gap-1">
                        <input type="datetime-local" aria-label="Pickup time" id={`pk-${r.id}`}
                          defaultValue={r.pickupAt ? new Date(r.pickupAt).toISOString().slice(0, 16) : ''}
                          onChange={(e) => setPickupAt((s) => ({ ...s, [r.id]: e.target.value }))} className="rounded-lg border border-stone-300 px-2 py-1" />
                        <button onClick={() => void transition(r.id, 'schedule', { pickupAt: pickupAt[r.id] ? new Date(pickupAt[r.id]).toISOString() : new Date().toISOString() })} className={ghostCls}>Confirm schedule</button>
                      </span>
                    )}
                    {r.status === 'PICKUP_SCHEDULED' && <button onClick={() => void transition(r.id, 'handover', {})} className={ghostCls}>Confirm handover</button>}
                    {!['COMPLETED', 'CANCELLED'].includes(r.status) && (
                      <span className="flex items-end gap-1">
                        <input aria-label="Cancel reason" placeholder="Cancel reason (min 5)" value={cancelReason[r.id] ?? ''}
                          onChange={(e) => setCancelReason((s) => ({ ...s, [r.id]: e.target.value }))} className="rounded-lg border border-stone-300 px-2 py-1" />
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

      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Follow-up: eligible but not yet moving ({unmatched.length})</h2>
        {unmatched.length === 0 ? <p className="mt-2 text-sm text-stone-600">Nothing waiting — every eligible assessment has an active record, or none exist.</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {unmatched.map((a) => (
              <li key={a.id} className="rounded-lg bg-amber-50 p-2 text-amber-900">
                {a.foodDescription} · {a.quantityKg} kg — no active redistribution. Match above, or record disposal on the <Link to="/eligibility" className="underline">Eligibility</Link> page. Nothing disappears silently.
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
      await load(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {msg && <p className="rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{msg}</p>}
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Opportunities for your NGO ({records.length})</h2>
          <button onClick={() => setHistory((h) => !h)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100" aria-pressed={history}>
            {history ? 'Hide history' : 'Show history'}
          </button>
        </div>
        {loading ? <p className="mt-2 text-sm" role="status">Loading…</p> : records.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No open opportunities right now. New matches arrive here with an inbox notification.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {records.map((o) => (
              <li key={o.id} className="rounded-xl border border-stone-200 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{o.assessment?.food ?? 'Surplus'} · {o.quantityKg} kg</p>
                  {statusChip(o.status)}
                  <span className="text-xs text-stone-500">match score {o.score}/100</span>
                </div>
                <p className="mt-1 text-stone-600">{o.institution?.name} ({o.institution?.city}) — {o.institution?.address}</p>
                <p className="text-stone-600">Contact: {o.institution?.contactName}, {o.institution?.contactPhone}, {o.institution?.contactEmail}</p>
                {o.assessment?.reason && <p className="mt-1 text-stone-600">Eligibility notes: {o.assessment.reason}</p>}
                {o.pickupAt && <p className="text-stone-600">Pickup: {new Date(o.pickupAt).toLocaleString()}</p>}
                {o.reasons.length > 0 && (
                  <details className="mt-1"><summary className="cursor-pointer text-leaf-800 underline">Why matched to us</summary>
                    <ul className="mt-1 list-disc pl-5 text-stone-600">
                      {o.reasons.map((x, i) => <li key={i}>+{x.points} {x.criterion}: {x.detail}</li>)}
                    </ul>
                  </details>
                )}
                {o.deliveryAttempts.length > 0 && (
                  <p className="mt-1 text-xs text-stone-500">Delivery: {o.deliveryAttempts.map((a) => `${a.channel} ${a.ok ? 'ok' : 'failed'}`).join(' · ')}</p>
                )}
                {o.status === 'NOTIFIED' && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-stone-50 p-2">
                      <label htmlFor={`pa-${o.id}`} className="font-medium">Intended pickup (accept)</label>
                      <input id={`pa-${o.id}`} type="datetime-local" value={f(o.id).pickupAt} onChange={(e) => setF(o.id, { pickupAt: e.target.value })} className={inputCls} />
                      <button disabled={busyId === o.id} onClick={() => void act(o.id, 'accept', { intendedPickupAt: f(o.id).pickupAt ? new Date(f(o.id).pickupAt).toISOString() : '' })} className="mt-1 rounded-lg bg-leaf-700 px-3 py-1.5 text-white hover:bg-leaf-800 disabled:opacity-60">Accept</button>
                    </div>
                    <div className="rounded-lg bg-stone-50 p-2">
                      <label htmlFor={`dr-${o.id}`} className="font-medium">Decline reason (min 5 chars)</label>
                      <input id={`dr-${o.id}`} value={f(o.id).reason} onChange={(e) => setF(o.id, { reason: e.target.value })} className={inputCls} />
                      <div className="mt-1 flex gap-2">
                        <button disabled={busyId === o.id} onClick={() => void act(o.id, 'decline', { reason: f(o.id).reason })} className={ghostCls}>Decline</button>
                      </div>
                      <label htmlFor={`cb-${o.id}`} className="mt-2 block font-medium">Callback message / phone (optional)</label>
                      <input id={`cb-${o.id}`} value={f(o.id).message} onChange={(e) => setF(o.id, { message: e.target.value })} placeholder="Message" className={inputCls} />
                      <input aria-label="Callback phone" value={f(o.id).phone} onChange={(e) => setF(o.id, { phone: e.target.value })} placeholder="Phone" className={`${inputCls} mt-1`} />
                      <button disabled={busyId === o.id} onClick={() => void act(o.id, 'callback', { message: f(o.id).message || undefined, phone: f(o.id).phone || undefined })} className={`${ghostCls} mt-1`}>Request callback</button>
                    </div>
                  </div>
                )}
                {o.status === 'HANDED_OVER' && (
                  <button disabled={busyId === o.id} onClick={() => void act(o.id, 'confirm-receipt', {})} className="mt-2 rounded-lg bg-leaf-700 px-4 py-2 text-white hover:bg-leaf-800 disabled:opacity-60">
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
