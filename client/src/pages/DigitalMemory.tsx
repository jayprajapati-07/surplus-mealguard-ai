import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

interface NormalizedRecord {
  id: string;
  date: string;
  kitchen: string;
  food: string;
  meal: string;
  producedKg: number;
  soldKg: number;
  wasteKg: number;
  remainingKg: number;
  onMenu: boolean;
  isCorrection: boolean;
}

interface WeekdayStat {
  weekday: number;
  count: number;
  meanSold: number;
  meanProduced: number;
  meanWaste: number;
  meanRemaining: number;
}

interface GroupStat {
  key: string;
  label: string;
  count: number;
  meanSold: number;
}

interface PatternSummary {
  totals: { records: number; producedKg: number; soldKg: number; wasteKg: number; remainingKg: number };
  means: { producedKg: number; soldKg: number; wasteKg: number; remainingKg: number };
  perWeekday: WeekdayStat[];
  perMeal: GroupStat[];
  perFood: GroupStat[];
  overproductionDays: number;
  underproductionDays: number;
  quality: { sampleSize: number; spanDays: number; correctionCount: number; status: 'OK' | 'SPARSE' | 'INSUFFICIENT' };
}

interface Forecast {
  predictedKg: number;
  lowerKg: number;
  upperKg: number;
  dataConfidence: 'high' | 'medium' | 'low';
  baselineKg: number;
  recentTrendKg: number;
  menuMultiplier: number;
  menuOnMeanKg: number | null;
  menuOffMeanKg: number | null;
  comparableCount: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  stdDevKg: number;
  sampleValues: number[];
  insufficient: boolean;
  message: string | null;
}

interface Snapshot {
  id: string;
  date: string;
  kitchen: string;
  predictedKg: number;
  method: string;
  inputs: { foodName?: string; mealType?: string; dataConfidence?: string } | null;
  createdAt: string;
}

interface Recommendation {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  status: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const input = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
const card = 'rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';

function tomorrow(): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

function confChip(c: string): string {
  if (c === 'high') return 'bg-leaf-100 text-leaf-900';
  if (c === 'medium') return 'bg-amber-100 text-amber-900';
  return 'bg-stone-200 text-stone-700';
}

export function DigitalMemory() {
  const { user } = useAuth();
  const canRefresh = !!user && ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'].includes(user.role);
  const [searchParams] = useSearchParams();

  const [kitchen, setKitchen] = useState(searchParams.get('kitchen') ?? '');
  const [food, setFood] = useState(searchParams.get('food') ?? '');
  const [meal, setMeal] = useState(searchParams.get('meal') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [targetDate, setTargetDate] = useState(searchParams.get('date') ?? tomorrow);

  const [patterns, setPatterns] = useState<PatternSummary | null>(null);
  const [records, setRecords] = useState<NormalizedRecord[]>([]);
  const [kitchens, setKitchens] = useState<{ id: string; name: string }[]>([]);
  const [foods, setFoods] = useState<{ id: string; name: string }[]>([]);
  const [version, setVersion] = useState('');
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastMeta, setForecastMeta] = useState<{ kitchen: string; food: string; meal: string; targetDate: string; weekday: number } | null>(null);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [lastRefresh, setLastRefresh] = useState<{ createdAt: string } | null>(null);

  const [loading, setLoading] = useState(true);
  const [fLoading, setFLoading] = useState(false);
  const [rBusy, setRBusy] = useState(false);
  const [error, setError] = useState('');
  const [fError, setFError] = useState('');
  const [rMsg, setRMsg] = useState('');
  const [rError, setRError] = useState('');

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (kitchen) p.set('kitchenUnitId', kitchen);
    if (food) p.set('foodItemId', food);
    if (meal) p.set('mealType', meal);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [kitchen, food, meal, from, to]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api<{ patterns: PatternSummary; records: NormalizedRecord[]; filters: { kitchens: { id: string; name: string }[]; foods: { id: string; name: string }[] }; version: string }>(`/memory/summary${qs()}`);
      setPatterns(d.patterns);
      setRecords(d.records);
      setKitchens(d.filters.kitchens);
      setFoods(d.filters.foods);
      setVersion(d.version);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load kitchen memory.');
    } finally {
      setLoading(false);
    }
  }, [qs]);

  const loadForecast = useCallback(async () => {
    if (!kitchen || !food || !meal) {
      setForecast(null);
      setForecastMeta(null);
      setFError('');
      return;
    }
    setFLoading(true);
    setFError('');
    try {
      const d = await api<{ forecast: Forecast; version: string; inputs: { kitchen: string; food: string; meal: string; targetDate: string; weekday: number } }>(
        `/memory/forecast?kitchenUnitId=${kitchen}&foodItemId=${food}&mealType=${meal}&date=${targetDate}`
      );
      setForecast(d.forecast);
      setForecastMeta(d.inputs);
      setVersion(d.version);
    } catch (err) {
      setForecast(null);
      setFError(err instanceof Error ? err.message : 'Could not compute forecast.');
    } finally {
      setFLoading(false);
    }
  }, [kitchen, food, meal, targetDate]);

  const loadSnapshots = useCallback(async () => {
    try {
      const d = await api<{ snapshots: Snapshot[]; recommendations: Recommendation[]; lastRefresh: { createdAt: string } | null }>('/memory/snapshots');
      setSnapshots(d.snapshots);
      setRecommendations(d.recommendations);
      setLastRefresh(d.lastRefresh);
    } catch {
      // snapshots are supplementary; summary errors are surfaced separately
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadForecast();
  }, [loadForecast]);

  useEffect(() => {
    void loadSnapshots();
  }, []);

  async function onRefresh() {
    setRBusy(true);
    setRMsg('');
    setRError('');
    try {
      const d = await api<{ message: string; snapshotsCreated: number; recommendationsCreated: number }>('/memory/refresh', {
        method: 'POST',
        body: JSON.stringify({ daysAhead: 7 }),
      });
      setRMsg(d.message);
      await loadSnapshots();
    } catch (err) {
      setRError(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      setRBusy(false);
    }
  }

  const maxBar = Math.max(0.001, ...(patterns?.perWeekday.map((w) => w.meanSold) ?? [0]));

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-leaf-900">Digital Memory</h1>
            <p className="mt-1 text-sm text-stone-600">
              Learns only from this institution's saved records using deterministic arithmetic (algorithm {version || '…'}).
              No external AI, no neural-network training — every estimate below shows its inputs.
            </p>
          </div>
          {patterns && (
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${patterns.quality.status === 'OK' ? 'bg-leaf-100 text-leaf-900' : patterns.quality.status === 'SPARSE' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`} title={`Sample size ${patterns.quality.sampleSize}, span ${patterns.quality.spanDays} days, corrections ${patterns.quality.correctionCount}`}>
              Data quality: {patterns.quality.status} ({patterns.quality.sampleSize} records)
            </span>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label htmlFor="dm-kitchen" className="text-sm font-medium">Kitchen</label>
            <select id="dm-kitchen" value={kitchen} onChange={(e) => setKitchen(e.target.value)} className={input}>
              <option value="">All kitchens</option>
              {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dm-food" className="text-sm font-medium">Food item</label>
            <select id="dm-food" value={food} onChange={(e) => setFood(e.target.value)} className={input}>
              <option value="">All items</option>
              {foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dm-meal" className="text-sm font-medium">Meal</label>
            <select id="dm-meal" value={meal} onChange={(e) => setMeal(e.target.value)} className={input}>
              <option value="">All meals</option>
              <option value="BREAKFAST">Breakfast</option>
              <option value="LUNCH">Lunch</option>
              <option value="DINNER">Dinner</option>
            </select>
          </div>
          <div>
            <label htmlFor="dm-from" className="text-sm font-medium">From</label>
            <input id="dm-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="dm-to" className="text-sm font-medium">To</label>
            <input id="dm-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="dm-target" className="text-sm font-medium">Forecast date</label>
            <input id="dm-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={input} />
          </div>
        </div>
        {(kitchen || food || meal || from || to) && (
          <button
            onClick={() => { setKitchen(''); setFood(''); setMeal(''); setFrom(''); setTo(''); }}
            className="mt-3 rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
          >
            Clear filters
          </button>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      {/* Forecast + how-this-learned */}
      <div className={card}>
        <h2 className="font-bold text-leaf-900">Demand estimate</h2>
        {!kitchen || !food || !meal ? (
          <p className="mt-2 text-sm text-stone-600">Select a kitchen, food item, and meal above to get a deterministic estimate for the forecast date.</p>
        ) : fLoading ? (
          <p className="mt-2 text-sm" role="status">Computing estimate…</p>
        ) : fError ? (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{fError}</p>
        ) : forecast ? (
          <div className="mt-2 space-y-3">
            {forecast.insufficient ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
                {forecast.message} {forecast.fallbackReason ?? ''} Add more Food Data records (at least 2 comparable) to unlock estimates.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-3xl font-bold text-leaf-900">{forecast.predictedKg} <span className="text-base font-medium">kg</span></p>
                  <p className="text-sm text-stone-600">
                    Range {forecast.lowerKg}–{forecast.upperKg} kg · {forecastMeta?.food} · {forecastMeta?.meal} · {forecastMeta?.targetDate} ({forecastMeta ? WEEKDAYS[forecastMeta.weekday] : ''})
                  </p>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${confChip(forecast.dataConfidence)}`} title="Derived from comparable-record count and spread. A description of the data, not a guarantee.">
                    data confidence: {forecast.dataConfidence} — not a guarantee
                  </span>
                </div>
                {forecast.fallbackUsed && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">Fallback estimate: {forecast.fallbackReason}</p>
                )}
                <div className="rounded-xl bg-stone-50 p-4 text-sm">
                  <h3 className="font-bold">How this learned (algorithm {version})</h3>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    <div><dt className="inline font-medium">Baseline (age-decayed mean of same-weekday sold): </dt><dd className="inline">{forecast.baselineKg} kg</dd></div>
                    <div><dt className="inline font-medium">Recent trend (weighted avg of last ≤6): </dt><dd className="inline">{forecast.recentTrendKg} kg</dd></div>
                    <div><dt className="inline font-medium">Menu multiplier (menu history only, capped 0.7–1.3): </dt><dd className="inline">{forecast.menuMultiplier}× (on-menu mean {forecast.menuOnMeanKg ?? '—'} kg, off-menu mean {forecast.menuOffMeanKg ?? '—'} kg)</dd></div>
                    <div><dt className="inline font-medium">Formula: </dt><dd className="inline">(0.6 × {forecast.baselineKg} + 0.4 × {forecast.recentTrendKg}) × {forecast.menuMultiplier} = {forecast.predictedKg} kg</dd></div>
                    <div><dt className="inline font-medium">Comparable records: </dt><dd className="inline">{forecast.comparableCount} — sold values [{forecast.sampleValues.join(', ')}] kg</dd></div>
                    <div><dt className="inline font-medium">Spread (std dev): </dt><dd className="inline">±{forecast.stdDevKg} kg → range {forecast.lowerKg}–{forecast.upperKg} kg</dd></div>
                  </dl>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Pattern cards */}
      {loading && (
        <p className={`${card} text-sm`} role="status">Loading patterns…</p>
      )}
      {!loading && patterns && patterns.totals.records === 0 && (
        <div className={`${card} text-center`}>
          <p className="font-medium">No history matches these filters</p>
          <p className="mt-1 text-sm text-stone-600">Add Food Data records or import a file — the memory learns only from saved records.</p>
        </div>
      )}
      {!loading && patterns && patterns.totals.records > 0 && (
        <div className="contents">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: 'Production', total: patterns.totals.producedKg, mean: patterns.means.producedKg },
                  { label: 'Sales', total: patterns.totals.soldKg, mean: patterns.means.soldKg },
                  { label: 'Waste', total: patterns.totals.wasteKg, mean: patterns.means.wasteKg },
                  { label: 'Remaining / surplus', total: patterns.totals.remainingKg, mean: patterns.means.remainingKg },
                ].map((c) => (
                  <div key={c.label} className={card}>
                    <p className="text-xs font-semibold uppercase text-stone-500">{c.label} (kg)</p>
                    <p className="mt-1 text-2xl font-bold">{c.total}</p>
                    <p className="text-sm text-stone-600">mean {c.mean} / record · {patterns.totals.records} records</p>
                  </div>
                ))}
              </div>

              <div className={card}>
                <h2 className="font-bold">Day-of-week pattern (mean sold, kg)</h2>
                <svg viewBox="0 0 560 180" className="mt-3 w-full" role="img" aria-label="Bar chart of mean sold kilograms by weekday. Identical values are listed in the table below.">
                  {patterns.perWeekday.map((w, i) => {
                    const h = Math.round((w.meanSold / maxBar) * 120);
                    const x = 20 + i * 76;
                    return (
                      <g key={w.weekday}>
                        <title>{WEEKDAYS[w.weekday]}: mean sold {w.meanSold} kg over {w.count} record(s)</title>
                        <rect x={x} y={140 - h} width={48} height={h} rx={4} className="fill-leaf-700" />
                        <text x={x + 24} y={156} textAnchor="middle" fontSize={11} className="fill-stone-700">{WEEKDAYS[w.weekday]}</text>
                        <text x={x + 24} y={130 - h} textAnchor="middle" fontSize={11} className="fill-stone-900">{w.meanSold}</text>
                      </g>
                    );
                  })}
                </svg>
                <table className="mt-2 w-full text-sm">
                  <caption className="text-left font-medium">Same values as the chart, in tabular form.</caption>
                  <thead><tr className="text-left text-stone-500"><th>Day</th><th>Records</th><th>Mean sold</th><th>Mean produced</th><th>Mean waste</th><th>Mean remaining</th></tr></thead>
                  <tbody>
                    {patterns.perWeekday.map((w) => (
                      <tr key={w.weekday} className="border-t border-stone-100">
                        <td>{WEEKDAYS[w.weekday]}</td><td>{w.count}</td><td>{w.meanSold} kg</td><td>{w.meanProduced} kg</td><td>{w.meanWaste} kg</td><td>{w.meanRemaining} kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className={card}>
                  <h2 className="font-bold">Meal pattern (mean sold, kg)</h2>
                  {patterns.perMeal.length === 0 ? <p className="mt-1 text-sm text-stone-600">None.</p> : (
                    <table className="mt-2 w-full text-sm">
                      <thead><tr className="text-left text-stone-500"><th>Meal</th><th>Records</th><th>Mean sold</th></tr></thead>
                      <tbody>
                        {patterns.perMeal.map((g) => <tr key={g.key} className="border-t border-stone-100"><td>{g.label}</td><td>{g.count}</td><td>{g.meanSold} kg</td></tr>)}
                      </tbody>
                    </table>
                  )}
                  <h2 className="mt-4 font-bold">Repeated over/under-production</h2>
                  <p className="mt-1 text-sm text-stone-700">
                    Overproduction days (remaining &gt; 15% of produced): <strong>{patterns.overproductionDays}</strong>.
                    Underproduction days (adjustment note or produced &lt; 90% of target): <strong>{patterns.underproductionDays}</strong>.
                  </p>
                </div>
                <div className={card}>
                  <h2 className="font-bold">Menu-item pattern (mean sold, kg)</h2>
                  {patterns.perFood.length === 0 ? <p className="mt-1 text-sm text-stone-600">None.</p> : (
                    <table className="mt-2 w-full text-sm">
                      <thead><tr className="text-left text-stone-500"><th>Food</th><th>Records</th><th>Mean sold</th></tr></thead>
                      <tbody>
                        {patterns.perFood.slice(0, 15).map((g) => <tr key={g.key} className="border-t border-stone-100"><td>{g.label}</td><td>{g.count}</td><td>{g.meanSold} kg</td></tr>)}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className={card}>
                <h2 className="font-bold">Historical records used by the model ({records.length})</h2>
                <p className="mt-1 text-sm text-stone-600">Deduplicated to the latest record per kitchen, food, meal, and day — exactly the set the estimates above learn from.</p>
                <div className="mt-2 max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white"><tr className="text-left text-stone-500"><th>Date</th><th>Kitchen</th><th>Food</th><th>Meal</th><th>Prod.</th><th>Sold</th><th>Waste</th><th>Rem.</th><th>Menu</th><th>Corr.</th></tr></thead>
                    <tbody>
                      {records.slice(0, 200).map((r) => (
                        <tr key={r.id} className="border-t border-stone-100">
                          <td>{new Date(r.date).toLocaleDateString()}</td><td>{r.kitchen}</td><td>{r.food}</td><td>{r.meal}</td>
                          <td>{r.producedKg}</td><td>{r.soldKg}</td><td>{r.wasteKg}</td><td>{r.remainingKg}</td>
                          <td>{r.onMenu ? '✓' : '—'}</td><td>{r.isCorrection ? 'yes' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {records.length > 200 && <p className="mt-1 text-xs text-stone-500">Showing first 200 of {records.length}.</p>}
              </div>
        </div>
      )}

      {/* Refresh */}
      <div className={card}>
        <h2 className="font-bold">Deterministic learning refresh</h2>
        <p className="mt-1 text-sm text-stone-600">
          Recomputes forecast snapshots and recommendations from current saved records and replaces the previous set.
          This is arithmetic over the database — not neural-network training.
          {lastRefresh && <> Last refresh: {new Date(lastRefresh.createdAt).toLocaleString()}.</>}
        </p>
        {canRefresh ? (
          <button onClick={onRefresh} disabled={rBusy} className="mt-3 rounded-lg bg-leaf-700 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-800 disabled:opacity-60">
            {rBusy ? 'Refreshing…' : 'Refresh kitchen memory'}
          </button>
        ) : (
          <p className="mt-3 text-sm text-stone-600">Your role can view the memory; only admins and kitchen managers can run a refresh.</p>
        )}
        {rMsg && <p className="mt-2 rounded-lg bg-leaf-100 p-3 text-sm text-leaf-900" role="status">{rMsg}</p>}
        {rError && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{rError}</p>}
        {recommendations.length > 0 && (
          <div className="mt-3">
            <h3 className="font-bold">Current recommendations ({recommendations.length})</h3>
            <ul className="mt-1 space-y-2 text-sm">
              {recommendations.map((r) => (
                <li key={r.id} className="rounded-xl border border-stone-200 p-3">
                  <p className="font-medium">{r.title} <span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs">{r.type}</span></p>
                  {r.detail && <p className="mt-1 text-stone-700">{r.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {snapshots.length > 0 && (
          <div className="mt-3">
            <h3 className="font-bold">Latest forecast snapshots ({snapshots.length})</h3>
            <table className="mt-1 w-full text-sm">
              <thead><tr className="text-left text-stone-500"><th>Date</th><th>Kitchen</th><th>Food</th><th>Meal</th><th>Predicted</th><th>Confidence</th></tr></thead>
              <tbody>
                {snapshots.slice(0, 20).map((s) => (
                  <tr key={s.id} className="border-t border-stone-100">
                    <td>{new Date(s.date).toLocaleDateString()}</td><td>{s.kitchen}</td>
                    <td>{s.inputs?.foodName ?? '—'}</td><td>{s.inputs?.mealType ?? '—'}</td>
                    <td>{s.predictedKg} kg</td><td>{s.inputs?.dataConfidence ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {snapshots.length > 20 && <p className="mt-1 text-xs text-stone-500">Showing 20 of {snapshots.length}.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
