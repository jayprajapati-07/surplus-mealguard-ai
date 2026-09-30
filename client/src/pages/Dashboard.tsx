import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
  activeNgosCount?: number;
}

interface FoodItemOption {
  id: string;
  name: string;
  category: string;
  mealType?: string | null;
}

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'];
const inputStyle = 'mt-1 w-full rounded-xl border border-stone-300 px-3.5 py-2 text-sm bg-white focus:border-[#1565C0] focus:ring-1 focus:ring-[#1565C0]';
const cardStyle = 'rounded-3xl border border-stone-200 bg-white p-6 shadow-xs';
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function confChip(level: string): string {
  if (level === 'high') return 'bg-emerald-100 text-emerald-900 border border-emerald-200';
  if (level === 'medium') return 'bg-amber-100 text-amber-900 border border-amber-200';
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

  // Buffer settings
  const [bufMode, setBufMode] = useState('PERCENT');
  const [bufValue, setBufValue] = useState('10');
  const [bufMsg, setBufMsg] = useState('');
  const [bufError, setBufError] = useState('');
  const [bufBusy, setBufBusy] = useState(false);

  // Explainability drawer
  const [why, setWhy] = useState<TargetRow | null>(null);
  const [live, setLive] = useState<{ produced: number; sold: number; wasted: number; entryCount: number } | null>(null);

  // Inline adjustment state
  const [adjId, setAdjId] = useState<string | null>(null);
  const [adjKg, setAdjKg] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjError, setAdjError] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  // Foods catalog for dropdowns
  const [foods, setFoods] = useState<FoodItemOption[]>([]);

  // Card 1: Today's Production modal
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [targetFoodId, setTargetFoodId] = useState('');
  const [targetCustomFood, setTargetCustomFood] = useState('');
  const [targetMeal, setTargetMeal] = useState<'BREAKFAST' | 'LUNCH' | 'DINNER'>('LUNCH');
  const [targetVal, setTargetVal] = useState('40');
  const [targetDemand, setTargetDemand] = useState('36');
  const [targetModalBusy, setTargetModalBusy] = useState(false);
  const [targetModalError, setTargetModalError] = useState('');

  // Card 2: Today's Record modal
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordFoodId, setRecordFoodId] = useState('');
  const [recordMeal, setRecordMeal] = useState<'BREAKFAST' | 'LUNCH' | 'DINNER'>('LUNCH');
  const [recordProduced, setRecordProduced] = useState('40');
  const [recordServed, setRecordServed] = useState('36');
  const [recordWaste, setRecordWaste] = useState('2');
  const [recordModalBusy, setRecordModalBusy] = useState(false);
  const [recordModalError, setRecordModalError] = useState('');

  useEffect(() => {
    if (!kitchenId && kitchens.length > 0) setKitchenId(kitchens[0].id);
  }, [kitchens, kitchenId]);

  // Load foods catalog
  useEffect(() => {
    if (org?.id) {
      api<{ items: FoodItemOption[] }>('/food-items')
        .then((d) => setFoods(d.items || []))
        .catch(() => setFoods([]));
    }
  }, [org?.id]);

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
        const liveRes = await api<{ dayTotals: { produced: number; sold: number; wasted: number }; entryCount: number }>(
          `/flow/today?kitchenUnitId=${kitchenId}&date=${date}`
        );
        setLive({ ...liveRes.dayTotals, entryCount: liveRes.entryCount });
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

  // Handle Card 1 target submission
  async function handleTargetSubmit(e: FormEvent) {
    e.preventDefault();
    setTargetModalError('');
    let finalFoodId = targetFoodId;

    if (!finalFoodId && targetCustomFood.trim()) {
      try {
        const created = await api<{ item: { id: string } }>('/food-items', {
          method: 'POST',
          body: JSON.stringify({
            name: targetCustomFood.trim(),
            category: 'Main Dish',
            mealType: targetMeal,
            standardPortionKg: 0.25,
            unit: 'kg',
          }),
        });
        finalFoodId = created.item.id;
      } catch (err) {
        setTargetModalError(err instanceof Error ? err.message : 'Failed to create food item.');
        return;
      }
    }

    if (!finalFoodId) {
      setTargetModalError('Please choose or enter a food item.');
      return;
    }

    const tKg = Number(targetVal);
    if (!Number.isFinite(tKg) || tKg <= 0) {
      setTargetModalError('Target quantity must be a positive number.');
      return;
    }

    setTargetModalBusy(true);
    try {
      await api('/targets/quick-target', {
        method: 'POST',
        body: JSON.stringify({
          kitchenUnitId: kitchenId,
          foodItemId: finalFoodId,
          date,
          mealType: targetMeal,
          targetKg: tKg,
          demandKg: Number(targetDemand) || tKg,
          reason: 'Set from Today’s Production card',
        }),
      });
      setTargetModalOpen(false);
      setTargetCustomFood('');
      await load();
    } catch (err) {
      setTargetModalError(err instanceof Error ? err.message : 'Failed to save target.');
    } finally {
      setTargetModalBusy(false);
    }
  }

  // Handle Card 2 record submission
  async function handleRecordSubmit(e: FormEvent) {
    e.preventDefault();
    setRecordModalError('');

    let finalFoodId = recordFoodId;
    if (!finalFoodId && foods.length > 0) finalFoodId = foods[0].id;
    if (!finalFoodId) {
      setRecordModalError('Please create a food item first.');
      return;
    }

    const p = Number(recordProduced);
    const s = Number(recordServed);
    const w = Number(recordWaste);

    if (p < 0 || s < 0 || w < 0) {
      setRecordModalError('Quantities cannot be negative.');
      return;
    }
    if (s + w > p + 0.001) {
      setRecordModalError(`Coherence issue: Served (${s}) + Waste (${w}) exceeds Produced (${p}).`);
      return;
    }

    setRecordModalBusy(true);
    try {
      await api('/food-records', {
        method: 'POST',
        body: JSON.stringify({
          date,
          kitchenUnitId: kitchenId,
          foodItemId: finalFoodId,
          mealType: recordMeal,
          producedKg: p,
          soldKg: s,
          wasteKg: w,
          remainingKg: Math.max(0, p - s - w),
          notes: 'Recorded from Today’s Record card',
        }),
      });
      setRecordModalOpen(false);
      await load();
    } catch (err) {
      setRecordModalError(err instanceof Error ? err.message : 'Failed to save food record.');
    } finally {
      setRecordModalBusy(false);
    }
  }

  if (!org) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center">
        <h2 className="text-xl font-bold text-amber-900">Setup Required</h2>
        <p className="mt-2 text-sm text-stone-600">Your organization setup has not been completed yet.</p>
        <Link
          to="/setup"
          className="mt-4 inline-block rounded-xl bg-[#0B1F33] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
        >
          Go to Organization Setup →
        </Link>
      </div>
    );
  }

  const rows = ov?.targets ?? [];
  const effTotal = r3(rows.reduce((x, t) => x + t.effectiveKg, 0));
  const recTotal = r3(rows.reduce((x, t) => x + t.recommendedKg, 0));
  const demandTotal = r3(rows.reduce((x, t) => x + t.predictedKg, 0));
  const prodTotal = ov?.flowSummary.producedKg ?? 0;
  const servedTotal = ov?.flowSummary.soldKg ?? 0;
  const overall = effTotal > 0 && ov && ov.flowSummary.recordsCount > 0 ? Math.min(1, prodTotal / effTotal) : null;
  const activeNgos = ov?.activeNgosCount ?? 0;

  return (
    <div className="space-y-6">
      {/* Kitchen Selector & Date Controls Header */}
      <div className={`${cardStyle} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#1565C0]">
            {org.name} · {org.city}
          </span>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-[#0B1F33] sm:text-2xl">
            Kitchen Dashboard Overview
          </h1>
          <p className="mt-0.5 text-xs text-stone-500">
            Real-time food flow coordination, AI target tuning, and surplus redistribution
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="db-kitchen" className="block text-[11px] font-bold text-stone-500 uppercase">
              Kitchen Unit
            </label>
            <select
              id="db-kitchen"
              value={kitchenId}
              onChange={(e) => setKitchenId(e.target.value)}
              className="mt-1 rounded-xl border border-stone-300 px-3 py-1.5 text-xs bg-white font-medium"
            >
              {kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="db-date" className="block text-[11px] font-bold text-stone-500 uppercase">
              Service Date
            </label>
            <input
              id="db-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 rounded-xl border border-stone-300 px-3 py-1.5 text-xs bg-white font-medium"
            />
          </div>

          {canManage && (
            <button
              onClick={onGenerate}
              disabled={genBusy || !kitchenId}
              className="mt-4 sm:mt-5 rounded-xl bg-[#1565C0] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {genBusy ? 'Generating…' : '⚡ Generate AI Targets'}
            </button>
          )}
        </div>
      </div>

      {genMsg && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-900" role="status">
          ✓ {genMsg}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-800" role="alert">
          {error}
        </div>
      )}

      {/* ======================================================== */}
      {/* 2 MAIN ACTION CARDS (Today's Production & Today's Record) */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* CARD 1 — TODAY'S PRODUCTION */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-2xl">🍲</span>
              <h2 className="mt-2 text-lg font-bold tracking-tight text-[#0B1F33]">
                Today's Production
              </h2>
              <p className="text-xs text-stone-500">Today's Production Target</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTargetModalError('');
                setTargetModalOpen(true);
              }}
              className="rounded-xl bg-[#0B1F33] px-5 py-2 text-xs font-bold text-white shadow hover:bg-navy-800 transition-colors"
            >
              ENTER
            </button>
          </div>

          <div className="mt-6 border-t border-stone-100 pt-4">
            <p className="text-3xl font-extrabold tracking-tight text-[#1565C0]">
              {effTotal > 0 ? effTotal : recTotal > 0 ? recTotal : '0'}{' '}
              <span className="text-sm font-semibold text-stone-500">kg / servings</span>
            </p>
            <p className="mt-1 text-xs text-stone-500">
              {rows.length > 0 ? `${rows.length} menu items scheduled for today` : 'No targets generated yet'}
            </p>
          </div>
        </div>

        {/* CARD 2 — TODAY'S RECORD */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-2xl">📊</span>
              <h2 className="mt-2 text-lg font-bold tracking-tight text-[#0B1F33]">
                Today's Record
              </h2>
              <p className="text-xs text-stone-500">Today's Record (Produced / Served)</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setRecordModalError('');
                setRecordModalOpen(true);
              }}
              className="rounded-xl bg-[#2E7D32] px-5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-800 transition-colors"
            >
              ENTER
            </button>
          </div>

          <div className="mt-6 border-t border-stone-100 pt-4">
            <p className="text-3xl font-extrabold tracking-tight text-[#2E7D32]">
              {prodTotal} <span className="text-stone-400">/</span> {servedTotal}{' '}
              <span className="text-sm font-semibold text-stone-500">kg (Produced / Served)</span>
            </p>
            <p className="mt-1 text-xs text-stone-500">
              Waste logged today: <strong>{ov?.flowSummary.wasteKg ?? 0} kg</strong> · Remaining surplus:{' '}
              <strong>{ov?.flowSummary.remainingKg ?? 0} kg</strong>
            </p>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* KEY INFORMATION (TODAY) SECTION (3 Major Metrics)        */}
      {/* ======================================================== */}
      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="border-b border-stone-100 pb-4">
          <h2 className="text-base font-bold tracking-tight text-[#0B1F33]">
            Key Information (Today)
          </h2>
          <p className="text-xs text-stone-500">
            Real-time algorithmic metrics grounded in operational kitchen data
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* 1. TODAY'S DEMAND */}
          <div className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4 transition-all">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
              1. Today's Demand
            </span>
            <p className="mt-2 text-2xl font-black text-[#0B1F33]">
              {demandTotal > 0 ? `${demandTotal} kg` : '0 kg'}
            </p>
            <p className="mt-1 text-xs text-stone-500 leading-snug">
              Explainable AI demand forecast computed from weekday baseline and recent trend.
            </p>
          </div>

          {/* 2. TODAY'S TARGET */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 transition-all">
            <span className="text-xs font-bold uppercase tracking-wider text-[#1565C0]">
              2. Today's Target
            </span>
            <p className="mt-2 text-2xl font-black text-[#1565C0]">
              {effTotal > 0 ? `${effTotal} kg` : '0 kg'}
            </p>
            <p className="mt-1 text-xs text-stone-500 leading-snug">
              Operational production target including safety buffer and manager adjustments.
            </p>
          </div>

          {/* 3. ACTIVE NGOS */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 transition-all">
            <span className="text-xs font-bold uppercase tracking-wider text-[#2E7D32]">
              3. Active NGO's
            </span>
            <p className="mt-2 text-2xl font-black text-[#2E7D32]">
              {activeNgos}
            </p>
            <p className="mt-1 text-xs text-stone-500 leading-snug">
              Active verified redistribution partners in your service area ready for pickup.
            </p>
          </div>
        </div>
      </div>

      {/* Target Table & Detailed Breakdown */}
      {loading ? (
        <div className={`${cardStyle} text-center py-10`} role="status">
          <span className="text-xl animate-spin inline-block">⏳</span>
          <p className="mt-2 text-sm text-stone-600 font-medium">Loading kitchen analytics and targets…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className={`${cardStyle} text-center py-10`}>
          <p className="text-base font-bold text-stone-800">
            No targets generated for {ov?.kitchen.name ?? 'this kitchen'} on {ov?.date ?? date}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-stone-500">
            {canManage
              ? 'Click "Generate AI Targets" above or use "ENTER" on Today’s Production card to specify individual meal targets.'
              : 'Ask a kitchen manager to generate targets for this date.'}
          </p>
        </div>
      ) : (
        <div className={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-stone-900">Per-Food Production Targets vs Actuals</h2>
              <p className="text-xs text-stone-500">Live operational targets with explainable formulas and feedback loops</p>
            </div>
            {ov && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confChip(ov.confidence.level)}`}>
                Data Confidence: {ov.confidence.level.toUpperCase()} ({ov.confidence.basedOn}/{ov.confidence.targets})
              </span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200">
                <tr>
                  <th className="px-3 py-2.5">Food · Meal</th>
                  <th className="px-3 py-2.5">Predicted</th>
                  <th className="px-3 py-2.5">Buffer</th>
                  <th className="px-3 py-2.5">Target</th>
                  <th className="px-3 py-2.5">Adjusted</th>
                  <th className="px-3 py-2.5">Produced</th>
                  <th className="px-3 py-2.5">Sold/Served</th>
                  <th className="px-3 py-2.5">Waste</th>
                  <th className="px-3 py-2.5">Remaining</th>
                  <th className="px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-stone-50/70 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-stone-900">
                      {t.food}
                      <span className="block text-[11px] text-stone-500 font-normal">
                        {t.mealType} {t.status === 'ADJUSTED' && '· (Manager Adjusted)'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700">{t.predictedKg} kg</td>
                    <td className="px-3 py-2.5 text-stone-700">+{t.bufferKg} kg</td>
                    <td className="px-3 py-2.5 font-bold text-stone-900">{t.recommendedKg} kg</td>
                    <td className="px-3 py-2.5 text-stone-700">{t.adjustedKg !== null ? `${t.adjustedKg} kg` : '—'}</td>
                    <td className="px-3 py-2.5 font-semibold text-emerald-800">{t.actual?.producedKg ?? '—'}</td>
                    <td className="px-3 py-2.5 text-stone-700">{t.actual?.soldKg ?? '—'}</td>
                    <td className="px-3 py-2.5 text-stone-700">{t.actual?.wasteKg ?? '—'}</td>
                    <td className="px-3 py-2.5 text-stone-700">{t.actual?.remainingKg ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      {t.progressProduced !== null ? (
                        <div className="w-20">
                          <div className="flex justify-between text-[10px] text-stone-500 font-medium">
                            <span>{Math.round(t.progressProduced * 100)}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
                            <div
                              className="h-full bg-[#1565C0]"
                              style={{ width: `${Math.min(100, Math.round(t.progressProduced * 100))}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setWhy(t)}
                          className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100 shadow-2xs"
                        >
                          Explain
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => {
                              setAdjId(adjId === t.id ? null : t.id);
                              setAdjKg(t.adjustedKg !== null ? String(t.adjustedKg) : '');
                              setAdjReason('');
                              setAdjError('');
                            }}
                            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#1565C0] hover:bg-blue-50 shadow-2xs"
                          >
                            {adjId === t.id ? 'Cancel' : 'Adjust'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inline Target Adjustment form */}
          {adjId && canManage && (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/50 p-4 text-xs" role="form">
              <p className="font-bold text-stone-900">
                Manager Target Adjustment (Original algorithm value is preserved for audit trail)
              </p>
              {adjError && <p className="mt-1 text-red-600 font-medium">{adjError}</p>}
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-stone-700 font-semibold mb-1">Adjusted Target (kg)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={adjKg}
                    onChange={(e) => setAdjKg(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 px-3 py-1.5 text-xs bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-stone-700 font-semibold mb-1">Reason for adjustment (min 5 chars)</label>
                  <input
                    type="text"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="e.g. Campus holiday or special lunch event"
                    className="w-full rounded-xl border border-stone-300 px-3 py-1.5 text-xs bg-white"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onAdjust(adjId)}
                disabled={adjBusy}
                className="mt-3 rounded-xl bg-[#1565C0] px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-blue-700 disabled:opacity-50"
              >
                {adjBusy ? 'Saving…' : 'Save Adjustment'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Safety Buffer & Recommendations */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className={cardStyle}>
          <h2 className="text-base font-bold text-[#0B1F33]">Production Safety Buffer</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Configures extra buffer margin added to AI demand prediction to prevent unexpected stockouts.
          </p>

          {canManage ? (
            <div className="mt-4 space-y-3">
              {bufError && <p className="text-xs text-red-600 font-medium">{bufError}</p>}
              {bufMsg && <p className="text-xs text-emerald-700 font-medium">{bufMsg}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700">Mode</label>
                  <select
                    value={bufMode}
                    onChange={(e) => setBufMode(e.target.value)}
                    className={inputStyle}
                  >
                    <option value="PERCENT">Percent of demand (%)</option>
                    <option value="FIXED_KG">Fixed kilograms (kg)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700">Value</label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={bufValue}
                    onChange={(e) => setBufValue(e.target.value)}
                    className={inputStyle}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={onSaveBuffer}
                disabled={bufBusy}
                className="rounded-xl bg-[#0B1F33] px-4 py-2 text-xs font-bold text-white shadow hover:bg-navy-800 disabled:opacity-50"
              >
                {bufBusy ? 'Saving…' : 'Save Buffer Settings'}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-stone-600">
              Active buffer: {ov?.buffer ? `${ov.buffer.value} (${ov.buffer.mode})` : '10% default'}.
            </p>
          )}
        </div>

        <div className={cardStyle}>
          <h2 className="text-base font-bold text-[#0B1F33]">
            Active Recommendations ({ov?.recommendations.length ?? 0})
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Real-time algorithmic suggestions generated from recent kitchen variances.
          </p>

          <div className="mt-4 space-y-2">
            {!ov || ov.recommendations.length === 0 ? (
              <p className="text-xs text-stone-500 italic">No pending recommendations. System is in steady state.</p>
            ) : (
              ov.recommendations.slice(0, 3).map((rec) => (
                <div key={rec.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
                  <p className="font-semibold text-stone-900">{rec.title}</p>
                  {rec.detail && <p className="mt-1 text-stone-600 text-[11px]">{rec.detail}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: ENTER TODAY'S PRODUCTION TARGET                 */}
      {/* ======================================================== */}
      {targetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1F33]">Enter Today's Production Target</h3>
                <p className="text-xs text-stone-500">Service Date: {date}</p>
              </div>
              <button
                type="button"
                onClick={() => setTargetModalOpen(false)}
                className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-bold text-stone-500 hover:bg-stone-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleTargetSubmit} className="mt-4 space-y-4">
              {targetModalError && (
                <p className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                  {targetModalError}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700">Food Item</label>
                <select
                  value={targetFoodId}
                  onChange={(e) => setTargetFoodId(e.target.value)}
                  className={inputStyle}
                >
                  <option value="">-- Choose Existing Menu Food Item --</option>
                  {foods.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.category})
                    </option>
                  ))}
                </select>
              </div>

              {!targetFoodId && (
                <div>
                  <label className="block text-xs font-semibold text-stone-700">Or Enter New Food Item</label>
                  <input
                    type="text"
                    placeholder="e.g. Paneer Butter Masala"
                    value={targetCustomFood}
                    onChange={(e) => setTargetCustomFood(e.target.value)}
                    className={inputStyle}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700">Meal Shift</label>
                  <select
                    value={targetMeal}
                    onChange={(e) => setTargetMeal(e.target.value as 'BREAKFAST' | 'LUNCH' | 'DINNER')}
                    className={inputStyle}
                  >
                    <option value="BREAKFAST">Breakfast</option>
                    <option value="LUNCH">Lunch</option>
                    <option value="DINNER">Dinner</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700">Production Target (kg)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    required
                    value={targetVal}
                    onChange={(e) => setTargetVal(e.target.value)}
                    className={inputStyle}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700">Estimated Demand Base (kg)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={targetDemand}
                  onChange={(e) => setTargetDemand(e.target.value)}
                  className={inputStyle}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setTargetModalOpen(false)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={targetModalBusy}
                  className="rounded-xl bg-[#0B1F33] px-5 py-2 text-xs font-bold text-white shadow hover:bg-navy-800 disabled:opacity-50"
                >
                  {targetModalBusy ? 'Saving Target…' : 'Save Production Target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: ENTER TODAY'S RECORD (Produced / Served / Waste) */}
      {/* ======================================================== */}
      {recordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1F33]">Enter Today's Record</h3>
                <p className="text-xs text-stone-500">Record actual produced, served, and waste quantities</p>
              </div>
              <button
                type="button"
                onClick={() => setRecordModalOpen(false)}
                className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-bold text-stone-500 hover:bg-stone-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordSubmit} className="mt-4 space-y-4">
              {recordModalError && (
                <p className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                  {recordModalError}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700">Food Item</label>
                  <select
                    value={recordFoodId}
                    onChange={(e) => setRecordFoodId(e.target.value)}
                    className={inputStyle}
                  >
                    {foods.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700">Meal Shift</label>
                  <select
                    value={recordMeal}
                    onChange={(e) => setRecordMeal(e.target.value as 'BREAKFAST' | 'LUNCH' | 'DINNER')}
                    className={inputStyle}
                  >
                    <option value="BREAKFAST">Breakfast</option>
                    <option value="LUNCH">Lunch</option>
                    <option value="DINNER">Dinner</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700">Produced (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={recordProduced}
                    onChange={(e) => setRecordProduced(e.target.value)}
                    className={inputStyle}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700">Served (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={recordServed}
                    onChange={(e) => setRecordServed(e.target.value)}
                    className={inputStyle}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700">Waste (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={recordWaste}
                    onChange={(e) => setRecordWaste(e.target.value)}
                    className={inputStyle}
                  />
                </div>
              </div>

              <p className="text-[11px] text-stone-500 bg-stone-50 p-2.5 rounded-xl">
                Surplus Remaining will be computed server-side:{' '}
                <strong>
                  {Math.max(0, Number(recordProduced) - Number(recordServed) - Number(recordWaste))} kg
                </strong>
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setRecordModalOpen(false)}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recordModalBusy}
                  className="rounded-xl bg-[#2E7D32] px-5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-800 disabled:opacity-50"
                >
                  {recordModalBusy ? 'Saving Record…' : 'Save Today’s Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Explainability Drawer ("Why this target?") */}
      {why && <WhyDrawer row={why} onClose={() => setWhy(null)} />}
    </div>
  );
}

function WhyDrawer({ row, onClose }: { row: TargetRow; onClose: () => void }) {
  const i = row.inputs;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Why this target for ${row.food}`}>
      <div className="mt-8 w-full max-w-2xl rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-2 border-b border-stone-100 pb-3">
          <div>
            <h2 className="text-lg font-bold text-[#0B1F33]">Why this target? · {row.food} · {row.mealType}</h2>
            <p className="text-xs text-stone-500">Explainable deterministic algorithm formula and historical samples</p>
          </div>
          <button onClick={onClose} autoFocus className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold hover:bg-stone-100">
            Close (Esc)
          </button>
        </div>
        {!i ? (
          <p className="mt-4 text-xs text-stone-600">No explanation snapshot stored for this row.</p>
        ) : (
          <dl className="mt-4 space-y-2 text-xs">
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="font-semibold text-stone-700">Formula</dt>
              <dd className="mt-0.5 text-stone-900">
                recommended = predicted + buffer = {row.predictedKg} + {row.bufferKg} = <strong>{row.recommendedKg} kg</strong> (buffer {i.bufferMode === 'PERCENT' ? `${i.bufferValue}%` : `${i.bufferValue} kg`})
              </dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="font-semibold text-stone-700">Predicted Demand ({row.memoryVersion})</dt>
              <dd className="mt-0.5 text-stone-900">
                (0.6 × baseline {i.baselineKg} + 0.4 × recent trend {i.recentTrendKg}) × menu multiplier {i.menuMultiplier} = <strong>{row.predictedKg} kg</strong>, range {i.lowerKg}–{i.upperKg} kg
              </dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="font-semibold text-stone-700">Data Confidence: {i.dataConfidence}</dt>
              <dd className="mt-0.5 text-stone-900">
                {i.comparableCount} comparable weekday records; variance ±{i.stdDevKg} kg.
              </dd>
            </div>
            {row.adjustedKg !== null && (
              <div className="rounded-xl bg-blue-50 p-3">
                <dt className="font-semibold text-[#1565C0]">Manager Adjustment</dt>
                <dd className="mt-0.5 text-stone-900">
                  Original {row.recommendedKg} kg → adjusted {row.adjustedKg} kg. Reason: {row.adjustReason ?? '—'}
                </dd>
              </div>
            )}
            {row.feedback?.hasActuals && (
              <div className="rounded-xl bg-emerald-50 p-3">
                <dt className="font-semibold text-[#2E7D32]">Feedback from Actuals</dt>
                <dd className="mt-0.5 text-stone-900">
                  Produced {row.feedback.producedKg} kg, Sold {row.feedback.soldKg} kg → Target error {row.feedback.targetErrorKg} kg. Feeds future memory trend automatically.
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
