import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface TargetInputs {
  baselineKg: number;
  recentTrendKg: number;
  menuMultiplier: number;
  menuOnMeanKg: number | null;
  menuOffMeanKg: number | null;
  lowerKg: number;
  upperKg: number;
  dataConfidence: 'high' | 'medium' | 'low';
  comparableCount: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  sampleValues: number[];
  sampleDates: string[];
  stdDevKg: number;
  bufferMode: string;
  bufferValue: number;
  foodName?: string;
  mealType?: string;
}

interface TargetRow {
  id: string;
  foodItemId: string;
  food: string;
  mealType: string;
  predictedKg: number;
  bufferKg: number;
  recommendedKg: number;
  adjustedKg: number | null;
  adjustReason: string | null;
  effectiveKg: number;
  status: string;
  memoryVersion: string;
  inputs: TargetInputs | null;
  feedback: {
    hasActuals: boolean;
    producedKg: number | null;
    soldKg: number | null;
    targetErrorKg: number | null;
    demandErrorKg: number | null;
    overKg: number | null;
    underKg: number | null;
  } | null;
  actual: { producedKg: number; soldKg: number; wasteKg: number; remainingKg: number } | null;
  progressProduced: number | null;
  progressSold: number | null;
  lastWeek: { soldKg: number; producedKg: number; wasteKg: number; remainingKg: number } | null;
  lastWeekDate: string;
  lastWeekMessage: string | null;
}

interface Overview {
  date: string;
  kitchen: { id: string; name: string };
  targets: TargetRow[];
  flowSummary: { producedKg: number; soldKg: number; wasteKg: number; remainingKg: number; recordsCount: number };
  confidence: { level: 'high' | 'medium' | 'low'; basedOn: number; targets: number };
  recommendations: { id: string; type: string; title: string; detail: string | null; status: string; kitchenUnitId?: string | null }[];
  buffer: { mode: string; value: number } | null;
}

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function confChip(level: string): string {
  if (level === 'high') return 'bg-leaf-100 text-leaf-900';
  if (level === 'medium') return 'bg-amber-100 text-amber-900';
  return 'bg-stone-200 text-stone-700';
}

export function Dashboard() {
  const { user } = useAuth();
  const org = user?.organization;
  const kitchens = org?.kitchens ?? [];
  const canManage = !!user && MANAGE_ROLES.includes(user.role);

  const [kitchenId, setKitchenId] = useState('');
  const [date, setDate] = useState(todayIso);
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [genMsg, setGenMsg] = useState('');
  const [genBusy, setGenBusy] = useState(false);

  const [bufMode, setBufMode] = useState('PERCENT');
  const [bufValue, setBufValue] = useState('10');
  const [bufMsg, setBufMsg] = useState('');
  const [bufError, setBufError] = useState('');
  const [bufBusy, setBufBusy] = useState(false);

  const [why, setWhy] = useState<TargetRow | null>(null);
  const [live, setLive] = useState<{ produced: number; sold: number; wasted: number; entryCount: number } | null>(null);  const [adjId, setAdjId] = useState<string | null>(null);
  const [adjKg, setAdjKg] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjError, setAdjError] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  useEffect(() => {
    if (!kitchenId && kitchens.length > 0) setKitchenId(kitchens[0].id);
  }, [kitchens, kitchenId]);

  const load = useCallback(async () => {
    if (!kitchenId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const d = await api<Overview>(`/dashboard/overview?kitchenUnitId=${kitchenId}&date=${date}`);
      setOv(d);
      try {
        const live = await api<{ dayTotals: { produced: number; sold: number; wasted: number }; entryCount: number }>(`/flow/today?kitchenUnitId=${kitchenId}&date=${date}`);
        setLive({ ...live.dayTotals, entryCount: live.entryCount });
      } catch {
        setLive(null);
      }
      if (d.buffer) {
        setBufMode(d.buffer.mode);
        setBufValue(String(d.buffer.value));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard.');
    } finally {
      setLoading(false);
    }
  }, [kitchenId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!why) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWhy(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [why]);

  async function onGenerate() {
    setGenMsg('');
    setError('');
    setGenBusy(true);
    try {
      const d = await api<{ message: string }>('/targets/generate', {
        method: 'POST',
        body: JSON.stringify({ kitchenUnitId: kitchenId, date }),
      });
      setGenMsg(d.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGenBusy(false);
    }
  }

  async function onSaveBuffer() {
    setBufMsg('');
    setBufError('');
    setBufBusy(true);
    try {
      const d = await api<{ message: string; buffer: { mode: string; value: number } }>('/targets/buffer', {
        method: 'PUT',
        body: JSON.stringify({ mode: bufMode, value: Number(bufValue) }),
      });
      setBufMsg(d.message);
      setBufMode(d.buffer.mode);
      setBufValue(String(d.buffer.value));
      await load();
    } catch (err) {
      setBufError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBufBusy(false);
    }
  }

  async function onAdjust(id: string) {
    setAdjError('');
    if (adjKg.trim() === '' || !(Number(adjKg) >= 0)) {
      setAdjError('Adjusted target must be a number ≥ 0 (kg).');
      return;
    }
    if (adjReason.trim().length < 5) {
      setAdjError('A reason of at least 5 characters is required — the original target stays on record.');
      return;
    }
    setAdjBusy(true);
    try {
      const d = await api<{ message: string }>(`/targets/${id}/adjust`, {
        method: 'PUT',
        body: JSON.stringify({ adjustedKg: Number(adjKg), reason: adjReason.trim() }),
      });
      setGenMsg(d.message);
      setAdjId(null);
      setAdjKg('');
      setAdjReason('');
      await load();
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : 'Adjustment failed.');
    } finally {
      setAdjBusy(false);
    }
  }

  if (!org) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <p className="font-medium">Onboarding not complete.</p>
      </div>
    );
  }

  const rows = ov?.targets ?? [];
  const effTotal = r3(rows.reduce((x, t) => x + t.effectiveKg, 0));
  const recTotal = r3(rows.reduce((x, t) => x + t.recommendedKg, 0));
  const prodTotal = ov?.flowSummary.producedKg ?? 0;
  const overall = effTotal > 0 && ov && ov.flowSummary.recordsCount > 0 ? Math.min(1, prodTotal / effTotal) : null;

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-leaf-700">Core dashboard · {org.name}</p>
            <h1 className="mt-1 text-2xl font-bold text-leaf-900">Today's production targets</h1>
            <p className="mt-1 text-sm text-stone-600">
              Recommended target = predicted demand + configured buffer. Targets are recommendations, not operational mandates.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="db-kitchen" className="text-sm font-medium">Kitchen</label>
              <select id="db-kitchen" value={kitchenId} onChange={(e) => setKitchenId(e.target.value)} className="mt-1 rounded-lg border border-stone-300 px-3 py-2">
                {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="db-date" className="text-sm font-medium">Date</label>
              <input id="db-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-lg border border-stone-300 px-3 py-2" />
            </div>
            {canManage ? (
              <button onClick={onGenerate} disabled={genBusy || !kitchenId} className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
                {genBusy ? 'Generating…' : 'Generate targets'}
              </button>
            ) : (
              <p className="pb-2 text-sm text-stone-500">Target generation is managed by admins / kitchen managers.</p>
            )}
          </div>
        </div>
        {genMsg && <p className="mt-3 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{genMsg}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Live Food Flow today</h2>
          <Link to={`/flow?kitchen=${kitchenId}&date=${date}`} className="text-sm text-leaf-800 underline">Open Food Flow</Link>
        </div>
        {!kitchenId ? (
          <p className="mt-1 text-sm text-stone-600">Choose a kitchen to see live entries.</p>
        ) : live === null ? (
          <p className="mt-1 text-sm text-stone-600">No live entries logged for this kitchen and date yet — log them on the Food Flow page.</p>
        ) : (
          <p className="mt-1 text-sm text-stone-700">
            {live.entryCount} {live.entryCount === 1 ? 'entry' : 'entries'}: {live.produced} produced · {live.sold} sold · {live.wasted} wasted kg (recomputed server-side after every entry).
          </p>
        )}
      </div>

      {loading ? (
        <p className={`${card} text-sm`} role="status">Loading dashboard…</p>
      ) : !ov || rows.length === 0 ? (
        <div className={`${card} text-center`}>
          <p className="font-medium">No targets for {ov?.kitchen.name ?? 'this kitchen'} on {ov?.date ?? date} yet</p>
          <p className="mt-1 text-sm text-stone-600">
            {canManage ? 'Generate them with the button above — targets persist per kitchen, food, meal, and date.' : 'Ask an admin or kitchen manager to generate targets for this date.'}
          </p>
          {!ov && kitchens.length === 0 && <p className="mt-1 text-sm text-stone-600">No kitchen/unit exists yet.</p>}
        </div>
      ) : (
        <>
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">Today's target · {ov.kitchen.name} · {ov.date}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${confChip(ov.confidence.level)}`} title="Worst data-confidence across shown targets. A description of the data, not a guarantee.">
                data confidence: {ov.confidence.level} (based on {ov.confidence.basedOn}/{ov.confidence.targets})
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-stone-50 p-3"><p className="text-xs uppercase text-stone-500">Recommended total</p><p className="text-xl font-bold">{recTotal} kg</p></div>
              <div className="rounded-xl bg-stone-50 p-3"><p className="text-xs uppercase text-stone-500">Effective total</p><p className="text-xl font-bold">{effTotal} kg</p></div>
              <div className="rounded-xl bg-stone-50 p-3"><p className="text-xs uppercase text-stone-500">Produced so far</p><p className="text-xl font-bold">{prodTotal} kg</p></div>
              <div className="rounded-xl bg-stone-50 p-3">
                <p className="text-xs uppercase text-stone-500">Completion</p>
                <p className="text-xl font-bold">{overall === null ? '—' : `${Math.round(overall * 100)}%`}</p>
                {overall !== null && (
                  <div className="mt-1 h-2 rounded bg-stone-200" role="progressbar" aria-valuenow={Math.round(overall * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Produced versus effective target">
                    <div className="h-2 rounded bg-leaf-700" style={{ width: `${Math.min(100, Math.round(overall * 100))}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={card}>
            <h2 className="font-bold">Per-food targets vs actuals</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead><tr className="text-left text-stone-500"><th>Food · Meal</th><th>Predicted</th><th>Buffer</th><th>Recommended</th><th>Adjusted</th><th>Produced</th><th>Sold</th><th>Waste</th><th>Rem.</th><th>Progress</th><th>Same day last week</th><th>Feedback</th><th>Actions</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="border-t border-stone-100 align-top">
                      <td className="py-2 pr-2"><p className="font-medium">{t.food}</p><p className="text-xs text-stone-500">{t.mealType}{t.status === 'ADJUSTED' ? ' · adjusted' : ''}</p></td>
                      <td>{t.predictedKg}</td>
                      <td>+{t.bufferKg}</td>
                      <td className="font-medium">{t.recommendedKg}</td>
                      <td>{t.adjustedKg ?? '—'}{t.adjustReason ? <p className="max-w-[140px] text-xs text-stone-500">{t.adjustReason}</p> : null}</td>
                      <td>{t.actual?.producedKg ?? '—'}</td>
                      <td>{t.actual?.soldKg ?? '—'}</td>
                      <td>{t.actual?.wasteKg ?? '—'}</td>
                      <td>{t.actual?.remainingKg ?? '—'}</td>
                      <td>{t.progressProduced === null ? '—' : `${Math.round(t.progressProduced * 100)}%`}{t.progressSold !== null && <p className="text-xs text-stone-500">sold {Math.round(t.progressSold * 100)}%</p>}</td>
                      <td>{t.lastWeek ? <p>sold {t.lastWeek.soldKg} kg</p> : <p className="max-w-[160px] text-xs text-stone-500">{t.lastWeekMessage}</p>}</td>
                      <td>{t.feedback?.hasActuals
                        ? <p className="max-w-[160px] text-xs">target err {t.feedback.targetErrorKg} · demand err {t.feedback.demandErrorKg} · over {t.feedback.overKg} · under {t.feedback.underKg}</p>
                        : <p className="max-w-[160px] text-xs text-stone-500">No actuals yet — feedback appears after service is recorded.</p>}</td>
                      <td>
                        <div className="flex flex-col gap-1">
                          <button onClick={() => setWhy(t)} className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100">Why this target?</button>
                          {canManage && (
                            <button onClick={() => { setAdjId(adjId === t.id ? null : t.id); setAdjKg(t.adjustedKg !== null ? String(t.adjustedKg) : ''); setAdjReason(''); setAdjError(''); }} className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100">
                              {adjId === t.id ? 'Close' : 'Adjust'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {adjId && canManage && (
              <div className="mt-3 rounded-xl bg-stone-50 p-4 text-sm" role="form" aria-label="Manager adjustment">
                <p className="font-bold">Manager adjustment (original target is retained for audit)</p>
                {adjError && <p className="mt-1 rounded-lg bg-red-50 p-2 text-red-800" role="alert">{adjError}</p>}
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div><label htmlFor="db-adjkg" className="font-medium">Adjusted target (kg)</label><input id="db-adjkg" type="number" min={0} step={0.1} value={adjKg} onChange={(e) => setAdjKg(e.target.value)} className={input} /></div>
                  <div className="sm:col-span-2"><label htmlFor="db-adjreason" className="font-medium">Reason (min 5 characters, required)</label><input id="db-adjreason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} className={input} placeholder="e.g. Expected guest influx" /></div>
                </div>
                <button onClick={() => void onAdjust(adjId)} disabled={adjBusy} className="mt-2 rounded-lg bg-leaf-700 px-4 py-2 font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
                  {adjBusy ? 'Saving…' : 'Save adjustment'}
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <h2 className="font-bold">Today's Food Flow summary</h2>
              {ov.flowSummary.recordsCount === 0 ? (
                <p className="mt-1 text-sm text-stone-600">No actuals recorded for this date yet. Add Food Data — totals appear here automatically.</p>
              ) : (
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded bg-stone-50 p-2"><dt>Produced</dt><dd className="font-bold">{ov.flowSummary.producedKg} kg</dd></div>
                  <div className="rounded bg-stone-50 p-2"><dt>Sold</dt><dd className="font-bold">{ov.flowSummary.soldKg} kg</dd></div>
                  <div className="rounded bg-stone-50 p-2"><dt>Waste</dt><dd className="font-bold">{ov.flowSummary.wasteKg} kg</dd></div>
                  <div className="rounded bg-stone-50 p-2"><dt>Remaining</dt><dd className="font-bold">{ov.flowSummary.remainingKg} kg</dd></div>
                </dl>
              )}
              <h2 className="mt-4 font-bold">Buffer setting</h2>
              {canManage ? (
                <div>
                  {bufError && <p className="mt-1 rounded-lg bg-red-50 p-2 text-sm text-red-800" role="alert">{bufError}</p>}
                  {bufMsg && <p className="mt-1 rounded-lg bg-leaf-100 p-2 text-sm text-leaf-900" role="status">{bufMsg}</p>}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div><label htmlFor="db-bufmode" className="text-sm font-medium">Mode</label>
                      <select id="db-bufmode" value={bufMode} onChange={(e) => setBufMode(e.target.value)} className={input}>
                        <option value="PERCENT">Percent of predicted (%)</option>
                        <option value="FIXED_KG">Fixed kilograms</option>
                      </select>
                    </div>
                    <div><label htmlFor="db-bufval" className="text-sm font-medium">Value ({bufMode === 'PERCENT' ? '0–100%' : '0–50 kg'})</label>
                      <input id="db-bufval" type="number" min={0} step={0.5} value={bufValue} onChange={(e) => setBufValue(e.target.value)} className={input} />
                    </div>
                  </div>
                  <button onClick={onSaveBuffer} disabled={bufBusy} className="mt-2 rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
                    {bufBusy ? 'Saving…' : 'Save buffer'}
                  </button>
                  <p className="mt-1 text-xs text-stone-500">Applies to targets generated afterwards; existing rows keep their stored buffer.</p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-stone-600">Buffer: {ov.buffer ? `${ov.buffer.mode === 'PERCENT' ? `${ov.buffer.value}%` : `${ov.buffer.value} kg`}` : 'default 10% (never set)'}. Only admins / kitchen managers can change it.</p>
              )}
            </div>
            <div className={card}>
              <h2 className="font-bold">Recommendations ({ov.recommendations.length})</h2>
              {ov.recommendations.length === 0 ? (
                <p className="mt-1 text-sm text-stone-600">No pending recommendations. Generate targets or refresh kitchen memory to produce them.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {ov.recommendations.map((rec) => (
                    <li key={rec.id} className="rounded-xl border border-stone-200 p-3">
                      <p className="font-medium">{rec.title} <span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs">{rec.type}</span></p>
                      {rec.detail && <p className="mt-1 text-stone-700">{rec.detail}</p>}
                      <RecLink rec={rec} kitchenId={kitchenId} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {why && <WhyDrawer row={why} onClose={() => setWhy(null)} />}
    </div>
  );
}

function RecLink({ rec, kitchenId }: { rec: { title: string; detail: string | null; kitchenUnitId?: string | null }; kitchenId: string }) {
  const targetKitchen = rec.kitchenUnitId ?? kitchenId;
  return (
    <Link
      to={`/memory?kitchen=${targetKitchen}`}
      className="mt-1 inline-block text-leaf-800 underline"
    >
      Open in Digital Memory for detail
    </Link>
  );
}

function WhyDrawer({ row, onClose }: { row: TargetRow; onClose: () => void }) {
  const i = row.inputs;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Why this target for ${row.food}`}>
      <div className="mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-leaf-900">Why this target? · {row.food} · {row.mealType}</h2>
            <p className="mt-1 text-sm text-stone-600">A recommendation from saved records — not an operational mandate. Confirm with kitchen staff before service.</p>
          </div>
          <button onClick={onClose} autoFocus className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100" aria-label="Close explanation">Close (Esc)</button>
        </div>
        {!i ? (
          <p className="mt-3 text-sm text-stone-600">No explanation snapshot stored for this row (generated before explanations were saved). Regenerate targets to attach one.</p>
        ) : (
          <dl className="mt-3 space-y-2 text-sm">
            <div className="rounded-xl bg-stone-50 p-3"><dt className="font-medium">Formula</dt><dd>recommended = predicted + buffer = {row.predictedKg} + {row.bufferKg} = <strong>{row.recommendedKg} kg</strong> (buffer {i.bufferMode === 'PERCENT' ? `${i.bufferValue}%` : `${i.bufferValue} kg`} at generation time)</dd></div>
            <div className="rounded-xl bg-stone-50 p-3"><dt className="font-medium">Predicted demand ({row.memoryVersion})</dt><dd>(0.6 × baseline {i.baselineKg} + 0.4 × recent trend {i.recentTrendKg}) × menu multiplier {i.menuMultiplier} = <strong>{row.predictedKg} kg</strong>, range {i.lowerKg}–{i.upperKg} kg</dd></div>
            <div className="rounded-xl bg-stone-50 p-3"><dt className="font-medium">Menu adjustment</dt><dd>on-menu mean {i.menuOnMeanKg ?? '—'} kg vs off-menu mean {i.menuOffMeanKg ?? '—'} kg (history only, capped 0.7–1.3)</dd></div>
            <div className="rounded-xl bg-stone-50 p-3"><dt className="font-medium">Data confidence: {i.dataConfidence}</dt><dd>{i.comparableCount} comparable records; spread ±{i.stdDevKg} kg. A description of the data, not a guarantee.{i.fallbackUsed && i.fallbackReason ? ` Fallback was used: ${i.fallbackReason}` : ''}</dd></div>
            <div className="rounded-xl bg-stone-50 p-3"><dt className="font-medium">Comparable dates ({i.sampleDates.length})</dt><dd>{i.sampleDates.length > 0 ? i.sampleDates.join(', ') : 'none'} — sold values [{i.sampleValues.join(', ')}] kg</dd></div>
            {row.adjustedKg !== null && (
              <div className="rounded-xl bg-amber-50 p-3"><dt className="font-medium">Manager adjustment</dt><dd>Original {row.recommendedKg} kg → adjusted {row.adjustedKg} kg. Reason: {row.adjustReason ?? '—'}</dd></div>
            )}
            {row.feedback?.hasActuals && (
              <div className="rounded-xl bg-stone-50 p-3"><dt className="font-medium">Feedback from actuals</dt><dd>produced {row.feedback.producedKg} kg, sold {row.feedback.soldKg} kg → target error {row.feedback.targetErrorKg} kg, demand error {row.feedback.demandErrorKg} kg. These actuals now feed future recent-trend inputs automatically.</dd></div>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
