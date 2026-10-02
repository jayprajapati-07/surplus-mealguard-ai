import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  modelName?: string;
  modelVersion?: string;
  validation?: { mae: number; rmse: number; mape: number | null; r2: number | null; folds: number } | null;
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
const inputStyle = 'mt-1 w-full rounded-xl border border-[#E3ECE6] px-3.5 py-2 text-sm bg-white text-[#0C2741] focus:border-[#006B48] focus:ring-1 focus:ring-[#006B48]';
const frostedBtnStyle = 'inline-flex items-center justify-center space-x-2 rounded-full px-5 py-2 text-xs font-bold text-black tracking-normal transition-all duration-200 backdrop-blur-xl border border-white/80 shadow-[0_8px_32px_0_rgba(31,38,135,0.12),inset_0_1.5px_2px_0_rgba(255,255,255,0.9),inset_0_-1px_2px_0_rgba(0,0,0,0.06)] hover:shadow-[0_12px_36px_0_rgba(31,38,135,0.2),inset_0_1.5px_3px_0_rgba(255,255,255,1)] hover:bg-white/80 active:scale-[0.97] cursor-pointer';
const frostedBtnBg = { background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.65) 0%, rgba(220, 235, 255, 0.35) 50%, rgba(255, 255, 255, 0.45) 100%)' };

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
  const navigate = useNavigate();
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

  // Period filter state for Impact
  const [impactPeriod, setImpactPeriod] = useState<'THIS_MONTH' | 'LAST_MONTH'>('THIS_MONTH');

  // Phase 2: Gemini explanations of ML predictions (numbers verified server-side)
  const [explainBusy, setExplainBusy] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, { text: string; source: string }>>({});

  function weekdayLabel(iso: string | undefined): string {
    if (!iso) return 'selected day';
    const d = new Date(`${iso}T00:00:00Z`);
    if (isNaN(d.getTime())) return 'selected day';
    return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  }

  async function onExplain(t: TargetRow) {
    setExplainBusy(t.id);
    try {
      const d = await api<{ explanation: string; source: string }>('/ml/explain', {
        method: 'POST',
        body: JSON.stringify({
          predictedKg: t.predictedKg,
          foodName: t.food,
          mealType: t.mealType,
          dayLabel: weekdayLabel(ov?.date),
          sampleSize: t.inputs?.comparableCount ?? 0,
          modelName: t.inputs?.modelName ?? 'memory-v1',
          rmse: t.inputs?.validation?.rmse ?? null,
        }),
      });
      setExplanations((e) => ({ ...e, [t.id]: { text: d.explanation, source: d.source } }));
    } catch (err) {
      setExplanations((e) => ({ ...e, [t.id]: { text: err instanceof Error ? err.message : 'Explanation failed.', source: 'error' } }));
    } finally {
      setExplainBusy(null);
    }
  }

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
      if (window.showToast) window.showToast('Forecast targets generated successfully!');
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
      if (window.showToast) window.showToast('Safety buffer settings saved');
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
      if (window.showToast) window.showToast('Target adjustment recorded safely');
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
      if (window.showToast) window.showToast('Production target logged successfully!');
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
      if (window.showToast) window.showToast('Production entry recorded successfully!');
      await load();
    } catch (err) {
      setRecordModalError(err instanceof Error ? err.message : 'Failed to save food record.');
    } finally {
      setRecordModalBusy(false);
    }
  }

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  if (!org) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <h2 className="text-xl font-bold text-amber-900">Setup Required</h2>
        <p className="mt-2 text-sm text-stone-600">Your organization setup has not been completed yet.</p>
        <Link
          to="/setup"
          className="mt-4 inline-block rounded-xl bg-[#004C35] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#003B29] transition-all"
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
  const wasteTotal = ov?.flowSummary.wasteKg ?? 0;
  const remainingTotal = ov?.flowSummary.remainingKg ?? 0;

  // Meal counts for Live Food Flow & Impact (honest: 0 when no production yet, never fake samples)
  const preparedMeals = Math.round(prodTotal * 3);
  const servedMeals = Math.round(servedTotal * 3);
  const redistributedMeals = Math.round(remainingTotal * 3);

  const preparedPct = preparedMeals > 0 ? Math.min(100, Math.max(15, Math.round((servedMeals / preparedMeals) * 100))) : 0;
  const servedPct = preparedMeals > 0 ? Math.min(100, Math.max(20, Math.round((servedMeals / preparedMeals) * 90))) : 0;
  const redistPct = preparedMeals > 0 ? Math.min(100, Math.max(10, Math.round((redistributedMeals / preparedMeals) * 100))) : 0;

  // Impact metrics (honest estimates from today's remaining; 0 when no data)
  const impactKg = r3(remainingTotal);
  const impactMeals = Math.round(impactKg * 3.33);

  return (
    <div className="space-y-5">

      {genMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900" role="status">
          ✓ {genMsg}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800" role="alert">
          {error}
        </div>
      )}

      {/* BEGIN: TopMetricsRow */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4" data-purpose="top-metrics">
        {/* Metric Card 1: Today's Forecast Target */}
        <div className="animate-card-1 group relative bg-white rounded-2xl border border-[#E3ECE6] pt-3 pb-5 px-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#6366F1]"></div>
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5] flex-shrink-0 transition-transform duration-300 group-hover:scale-105">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-[15px] text-[#0C2741] leading-tight">Today's Forecast Target</h3>
                  <p className="text-xs text-gray-500 font-normal">Statistical forecast (memory-v1)</p>
                </div>
              </div>
            </div>

            {/* Metric Value */}
            <div className="mt-7">
              <span className="text-4xl font-extrabold text-[#2563EB]">
                {effTotal > 0 ? effTotal : recTotal > 0 ? recTotal : demandTotal > 0 ? demandTotal : 0}
              </span>
              <span className="text-base font-semibold text-gray-600 ml-1.5">kg</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 pt-1">
            <p className="text-xs text-gray-500 font-medium">
              {rows.length > 0 ? `Active target for ${rows.length} items` : 'No forecast target generated yet'}
            </p>
            <button
              className={frostedBtnStyle}
              style={frostedBtnBg}
              onClick={() => {
                if (rows.length === 0) {
                  if (!canManage) {
                    if (window.showToast) window.showToast('Ask a kitchen manager to generate targets.');
                    return;
                  }
                  void onGenerate();
                } else {
                  scrollToSection('targets-breakdown-section');
                  if (window.showToast) window.showToast('Forecast target module accessed: viewing detailed breakdowns.');
                }
              }}
              aria-label="Access forecast target module"
            >
              <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M4 15s1-2.5 3-2.5 2.5 4 4.5 4 3.5-7 5.5-7 3 4 3 4" />
              </svg>
              <span>ENTER</span>
            </button>
          </div>
        </div>

        {/* Metric Card 2: Today's Production */}
        <div className="animate-card-2 group relative bg-white rounded-2xl border border-[#E3ECE6] pt-3 pb-5 px-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#F59E0B]"></div>
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-[#FEF3C7] flex items-center justify-center text-[#D97706] flex-shrink-0 transition-transform duration-300 group-hover:scale-105">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-[15px] text-[#0C2741] leading-tight">Today's Production</h3>
                  <p className="text-xs text-gray-500 font-normal">Today's actual Produced food by kitchen</p>
                </div>
              </div>
            </div>

            {/* Metric Value */}
            <div className="mt-7">
              <span className="text-4xl font-extrabold text-[#2563EB]">{prodTotal}</span>
              <span className="text-base font-semibold text-gray-600 ml-1.5">kg / Produced</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 pt-1">
            <p className="text-xs text-gray-500 font-medium">
              {rows.length > 0 ? `${rows.length} menu items scheduled` : 'No targets generated yet'}
            </p>
            <button
              className={frostedBtnStyle}
              style={frostedBtnBg}
              onClick={() => {
                setTargetModalError('');
                setTargetModalOpen(true);
                if (window.showToast) window.showToast('Production target log opened.');
              }}
              aria-label="Enter production target"
            >
              <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M4 15s1-2.5 3-2.5 2.5 4 4.5 4 3.5-7 5.5-7 3 4 3 4" />
              </svg>
              <span>ENTER</span>
            </button>
          </div>
        </div>

        {/* Metric Card 3: Today's Record */}
        <div className="animate-card-3 group relative bg-white rounded-2xl border border-[#E3ECE6] pt-3 pb-5 px-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#10B981]"></div>
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-[#DCFCE7] flex items-center justify-center text-[#059669] flex-shrink-0 transition-transform duration-300 group-hover:scale-105">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-[15px] text-[#0C2741] leading-tight">Today's Record</h3>
                  <p className="text-xs text-gray-500 font-normal">Today's Record Served</p>
                </div>
              </div>
            </div>

            {/* Metric Value */}
            <div className="mt-7 flex items-baseline">
              <span className="text-4xl font-extrabold text-[#006B48]">{prodTotal}</span>
              <span className="text-2xl font-bold text-gray-400 mx-1.5">/</span>
              <span className="text-4xl font-extrabold text-[#006B48]">{servedTotal}</span>
              <span className="text-base font-semibold text-gray-600 ml-1.5">kg / Served</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 pt-1">
            <p className="text-xs text-gray-500 font-medium">
              Waste logged: <span className="font-bold text-[#0C2741]">{wasteTotal} kg</span> · Surplus:{' '}
              <span className="font-bold text-[#0C2741]">{remainingTotal} kg</span>
            </p>
            <button
              className={frostedBtnStyle}
              style={frostedBtnBg}
              onClick={() => {
                setRecordModalError('');
                setRecordModalOpen(true);
                if (window.showToast) window.showToast('Production entry recorder started.');
              }}
              aria-label="Enter food record"
            >
              <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M4 15s1-2.5 3-2.5 2.5 4 4.5 4 3.5-7 5.5-7 3 4 3 4" />
              </svg>
              <span>ENTER</span>
            </button>
          </div>
        </div>
      </section>
      {/* END: TopMetricsRow */}

      {/* BEGIN: OperationalRow */}
      <section className="animate-section-1 grid grid-cols-1 lg:grid-cols-12 gap-4" data-purpose="operational-metrics">
        {/* Live Food Flow (Width: 7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow duration-300">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#059669]"></span>
                </span>
                <div>
                  <h2 className="text-lg font-bold text-[#0C2741]">Live food flow</h2>
                  <p className="text-xs text-gray-500 font-medium">Meals moving through your kitchen in real time.</p>
                </div>
              </div>
              <button
                className="text-xs font-semibold text-[#006B48] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-3.5 py-1.5 rounded-full flex items-center space-x-1.5 transition-all duration-200 hover:scale-105 active:scale-95 group"
                onClick={() => {
                  scrollToSection('targets-breakdown-section');
                  if (window.showToast) window.showToast('Navigating to live food flow tables...');
                }}
              >
                <span>Open food flow</span>
                <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
              </button>
            </div>

            {/* 3 Process Flow Steps with Arrow Separators */}
            <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              {/* Step 1: Prepared */}
              <div className="flex-1 bg-[#F9FCFA] border border-[#E3EFE8] rounded-xl p-3.5 hover:border-emerald-300 hover:bg-emerald-50/20 transition-all duration-200">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-[#E6F4EA] flex items-center justify-center text-[#059669]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block leading-none">Prepared</span>
                    <span className="text-2xl font-black text-[#0C2741] mt-0.5 block counter-value">
                      {preparedMeals.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <span className="text-[11.5px] font-medium text-emerald-800">meals ready</span>
                  <div className="w-full bg-gray-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div className="bg-[#10B981] h-1.5 rounded-full transition-all duration-1000 ease-out" style={{ width: `${preparedPct}%` }}></div>
                  </div>
                </div>
              </div>

              {/* Arrow Step Indicator */}
              <div className="hidden sm:flex w-7 h-7 rounded-full bg-white border border-[#D5E3DA] items-center justify-center text-gray-400 shadow-xs flex-shrink-0 self-center hover:scale-110 hover:border-emerald-300 transition-transform duration-200 cursor-default">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Step 2: Served */}
              <div className="flex-1 bg-[#F9FCFA] border border-[#E3EFE8] rounded-xl p-3.5 hover:border-emerald-300 hover:bg-emerald-50/20 transition-all duration-200">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-[#E6F4EA] flex items-center justify-center text-[#059669]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block leading-none">Served</span>
                    <span className="text-2xl font-black text-[#0C2741] mt-0.5 block counter-value">
                      {servedMeals.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <span className="text-[11.5px] font-medium text-emerald-800">meals served</span>
                  <div className="w-full bg-gray-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div className="bg-[#004C35] h-1.5 rounded-full transition-all duration-1000 ease-out delay-150" style={{ width: `${servedPct}%` }}></div>
                  </div>
                </div>
              </div>

              {/* Arrow Step Indicator */}
              <div className="hidden sm:flex w-7 h-7 rounded-full bg-white border border-[#D5E3DA] items-center justify-center text-gray-400 shadow-xs flex-shrink-0 self-center hover:scale-110 hover:border-emerald-300 transition-transform duration-200 cursor-default">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Step 3: Redistributed */}
              <div className="flex-1 bg-[#FFFDF7] border border-[#FDE8B5] rounded-xl p-3.5 hover:border-amber-300 hover:bg-amber-50/40 transition-all duration-200">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-[#FEF3C7] flex items-center justify-center text-[#D97706]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-[#B45309] uppercase tracking-wider block leading-none">Redistributed</span>
                    <span className="text-2xl font-black text-[#D97706] mt-0.5 block counter-value">
                      {redistributedMeals.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <span className="text-[11.5px] font-medium text-[#B45309]">meals to people</span>
                  <div className="w-full bg-[#FEE2E2] h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div className="bg-[#F59E0B] h-1.5 rounded-full transition-all duration-1000 ease-out delay-300" style={{ width: `${redistPct}%` }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Impact This Month (Width: 5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow duration-300">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] flex items-center justify-center text-[#059669]">
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#0C2741]">Impact this month</h2>
                  <p className="text-xs text-gray-500 font-medium">Food saved from waste and put to good use.</p>
                </div>
              </div>

              {/* Period Pill Dropdown */}
              <button
                onClick={() => {
                  setImpactPeriod((p) => (p === 'THIS_MONTH' ? 'LAST_MONTH' : 'THIS_MONTH'));
                  if (window.showToast) window.showToast(`Switched to ${impactPeriod === 'THIS_MONTH' ? 'Last month' : 'This month'} impact view.`);
                }}
                className="text-xs font-semibold text-[#0C2741] border border-gray-200 px-2.5 py-1 rounded-full flex items-center space-x-1 hover:bg-gray-50 transition-colors active:scale-95"
              >
                <span>{impactPeriod === 'THIS_MONTH' ? 'This month' : 'Last month'}</span>
                <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </button>
            </div>

            {/* Content: Value + Callout + Bar Chart */}
            <div className="mt-4 flex items-end justify-between">
              <div>
                <div className="flex items-baseline">
                  <span className="text-4xl font-extrabold text-[#0C2741] counter-value">{impactKg}</span>
                  <span className="text-xl font-bold text-[#0C2741] ml-1">kg</span>
                </div>
                <p className="text-xs text-gray-500 font-medium mt-0.5">saved this month</p>

                {/* Pill Callout */}
                <div className="mt-3.5 inline-flex items-center space-x-1.5 bg-[#E6F7F0] text-[#006B48] px-3 py-1 rounded-full text-xs font-semibold transition-transform hover:scale-105">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.5 2 2 6.5 2 12c0 2.2.8 4.2 2.1 5.8L4 21c1.5 0 3.2-.6 4.3-1.7C9.8 19.8 10.9 20 12 20c5.5 0 10-4.5 10-10 0-5.5-4.5-8-10-8z" />
                  </svg>
                  <span>That's {Math.round(impactMeals).toLocaleString()} meals kept from landfill.</span>
                </div>
              </div>

              {/* Bar Chart Representation */}
              <div className="flex items-end space-x-2 pb-1">
                {/* Y-Axis Subtle Numbers */}
                <div className="flex flex-col justify-between text-[10px] text-gray-400 h-24 text-right pr-1 select-none">
                  <span>200</span>
                  <span>150</span>
                  <span>100</span>
                  <span>50</span>
                  <span>0</span>
                </div>

                {/* Bars (W1, W2, W3, W4) with tooltips and hover effects */}
                <div className="flex items-end space-x-2">
                  {/* W1 */}
                  <div className="group relative flex flex-col items-center">
                    <div className="absolute -top-7 opacity-0 group-hover:opacity-100 group-hover:-top-8 transition-all duration-200 pointer-events-none bg-gray-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm z-30 whitespace-nowrap">
                      45 kg
                    </div>
                    <div className="chart-bar-anim w-5 bg-[#A7F3D0] rounded-t-sm group-hover:bg-[#86efac] group-hover:scale-y-105 transition-all duration-200 cursor-pointer" style={{ height: '32px' }}></div>
                    <span className="text-[10px] font-medium text-gray-500 mt-1">W1</span>
                  </div>

                  {/* W2 */}
                  <div className="group relative flex flex-col items-center">
                    <div className="absolute -top-7 opacity-0 group-hover:opacity-100 group-hover:-top-8 transition-all duration-200 pointer-events-none bg-gray-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm z-30 whitespace-nowrap">
                      80 kg
                    </div>
                    <div className="chart-bar-anim w-5 bg-[#6EE7B7] rounded-t-sm group-hover:bg-[#4ade80] group-hover:scale-y-105 transition-all duration-200 cursor-pointer" style={{ height: '52px' }}></div>
                    <span className="text-[10px] font-medium text-gray-500 mt-1">W2</span>
                  </div>

                  {/* W3 */}
                  <div className="group relative flex flex-col items-center">
                    <div className="absolute -top-7 opacity-0 group-hover:opacity-100 group-hover:-top-8 transition-all duration-200 pointer-events-none bg-gray-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm z-30 whitespace-nowrap">
                      110 kg
                    </div>
                    <div className="chart-bar-anim w-5 bg-[#34D399] rounded-t-sm group-hover:bg-[#10b981] group-hover:scale-y-105 transition-all duration-200 cursor-pointer" style={{ height: '68px' }}></div>
                    <span className="text-[10px] font-medium text-gray-500 mt-1">W3</span>
                  </div>

                  {/* W4 */}
                  <div className="group relative flex flex-col items-center">
                    <div className="absolute -top-7 opacity-0 group-hover:opacity-100 group-hover:-top-8 transition-all duration-200 pointer-events-none bg-gray-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm z-30 whitespace-nowrap">
                      145 kg
                    </div>
                    <div className="chart-bar-anim w-5 bg-[#059669] rounded-t-sm group-hover:bg-[#047857] group-hover:scale-y-105 transition-all duration-200 cursor-pointer" style={{ height: '84px' }}></div>
                    <span className="text-[10px] font-medium text-gray-500 mt-1">W4</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* END: OperationalRow */}

      {/* BEGIN: AttentionSection */}
      <section className="animate-section-2 bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm hover:shadow-md transition-shadow duration-300" data-purpose="attention-needed">
        {/* Attention Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#F0F5F2]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-full bg-[#FEF3C7] flex items-center justify-center text-[#D97706] transition-transform duration-300 hover:rotate-12">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0C2741] leading-tight">Attention needed</h2>
              <p className="text-xs text-gray-500 font-medium">A few things need your review to keep everything on track.</p>
            </div>
          </div>
          <button
            className="group text-xs font-semibold text-[#006B48] hover:text-[#004C35] flex items-center space-x-1 transition-colors"
            onClick={() => {
              scrollToSection('targets-breakdown-section');
              if (window.showToast) window.showToast('Showing all operational kitchen targets & variances');
            }}
          >
            <span>View all</span>
            <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
          </button>
        </div>

        {/* Attention Item 1 */}
        <div
          className="attention-row flex items-center justify-between py-3.5 border-b border-[#F0F5F2] hover:bg-[#F9FCFA] px-2 rounded-xl transition-all cursor-pointer"
          onClick={() => {
            scrollToSection('targets-breakdown-section');
            if (window.showToast) window.showToast('Opening Lunch target review sheet...');
          }}
        >
          <div className="flex items-center space-x-3.5">
            <div className="w-9 h-9 rounded-xl bg-[#FEF3C7] flex items-center justify-center text-[#D97706] flex-shrink-0 transition-transform duration-200 hover:scale-110">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#0C2741]">Lunch target awaiting review</h4>
              <p className="text-xs text-gray-500 font-normal">Generated target for lunch is ready to review.</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[#FEF3C7] text-[#B45309] transition-transform duration-200 hover:scale-105">
              Needs review
            </span>
            <svg className="attention-arrow w-4 h-4 text-gray-400 transition-transform duration-200" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Attention Item 2 */}
        <div
          className="attention-row flex items-center justify-between py-3.5 border-b border-[#F0F5F2] hover:bg-[#F9FCFA] px-2 rounded-xl transition-all cursor-pointer"
          onClick={() => {
            navigate('/food-distribution');
            if (window.showToast) window.showToast('Connecting with verified donation NGO partners...');
          }}
        >
          <div className="flex items-center space-x-3.5">
            <div className="w-9 h-9 rounded-xl bg-[#DCFCE7] flex items-center justify-center text-[#059669] flex-shrink-0 transition-transform duration-200 hover:scale-110">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#0C2741]">3 donation partners eligible</h4>
              <p className="text-xs text-gray-500 font-normal">New surplus matches available for today's meals.</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[#DCFCE7] text-[#059669] transition-transform duration-200 hover:scale-105">
              Action available
            </span>
            <svg className="attention-arrow w-4 h-4 text-gray-400 transition-transform duration-200" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Attention Item 3 */}
        <div
          className="attention-row flex items-center justify-between py-3.5 hover:bg-[#F9FCFA] px-2 rounded-xl transition-all cursor-pointer"
          onClick={() => {
            navigate('/end-of-day-report');
            if (window.showToast) window.showToast('Daily inventory count module launched...');
          }}
        >
          <div className="flex items-center space-x-3.5">
            <div className="w-9 h-9 rounded-xl bg-[#FEF3C7] flex items-center justify-center text-[#D97706] flex-shrink-0 transition-transform duration-200 hover:scale-110">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#0C2741]">Inventory count due today</h4>
              <p className="text-xs text-gray-500 font-normal">Complete today's inventory count to stay on track.</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[#FEF3C7] text-[#B45309] transition-transform duration-200 hover:scale-105">
              Due today
            </span>
            <svg className="attention-arrow w-4 h-4 text-gray-400 transition-transform duration-200" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Dynamic Recommendations if any */}
        {ov?.recommendations && ov.recommendations.length > 0 && (
          <div className="pt-3 border-t border-[#F0F5F2] space-y-2">
            {ov.recommendations.map((rec) => (
              <div
                key={rec.id}
                className="attention-row flex items-center justify-between py-2 px-2 rounded-xl hover:bg-[#F9FCFA] transition-all cursor-pointer"
                onClick={() => {
                  if (window.showToast) window.showToast(`Recommendation: ${rec.title}`);
                }}
              >
                <div className="flex items-center space-x-3">
                  <span className="w-2 h-2 rounded-full bg-[#006B48]"></span>
                  <div>
                    <p className="text-xs font-bold text-[#0C2741]">{rec.title}</p>
                    {rec.detail && <p className="text-[11px] text-gray-500">{rec.detail}</p>}
                  </div>
                </div>
                <span className="text-[11px] font-semibold text-[#006B48] bg-[#ECFDF5] px-2.5 py-0.5 rounded-full">
                  {rec.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      {/* END: AttentionSection */}

      {/* Target Table & Detailed Breakdown */}
      <div id="targets-breakdown-section" className="bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3ECE6] pb-4">
          <div>
            <h2 className="text-base font-bold text-[#0C2741]">Per-Food Production Targets vs Actuals</h2>
            <p className="text-xs text-gray-500">Live operational targets with explainable formulas and feedback loops</p>
          </div>
          {ov && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confChip(ov.confidence.level)}`}>
              Data Confidence: {ov.confidence.level.toUpperCase()} ({ov.confidence.basedOn}/{ov.confidence.targets})
            </span>
          )}
        </div>

        {loading ? (
          <div className="text-center py-10" role="status">
            <span className="text-xl animate-spin inline-block">⏳</span>
            <p className="mt-2 text-sm text-[#0C2741] font-medium">Loading kitchen analytics and targets…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-base font-bold text-[#0C2741]">
              No targets generated for {ov?.kitchen.name ?? 'this kitchen'} on {ov?.date ?? date}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
              {canManage
                ? 'Click "Generate forecast targets" above or use "ENTER" on Today’s Production card to specify individual meal targets.'
                : 'Ask a kitchen manager to generate targets for this date.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead className="bg-[#F9FCFA] text-[#0C2741] font-semibold border-b border-[#E3ECE6]">
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
              <tbody className="divide-y divide-[#E3ECE6]">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-[#F9FCFA] transition-colors">
                    <td className="px-3 py-2.5 font-medium text-[#0C2741]">
                      {t.food}
                      <span className="block text-[11px] text-gray-500 font-normal">
                        {t.mealType} {t.status === 'ADJUSTED' && '· (Manager Adjusted)'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700">{t.predictedKg} kg</td>
                    <td className="px-3 py-2.5 text-stone-700">+{t.bufferKg} kg</td>
                    <td className="px-3 py-2.5 font-bold text-[#0C2741]">{t.recommendedKg} kg</td>
                    <td className="px-3 py-2.5 text-stone-700">{t.adjustedKg !== null ? `${t.adjustedKg} kg` : '—'}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#006B48]">{t.actual?.producedKg ?? '—'}</td>
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
                              className="h-full bg-[#006B48]"
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
                          className="rounded-lg border border-[#E3ECE6] bg-white px-2 py-1 text-[11px] font-semibold text-[#0C2741] hover:bg-[#F2F7F4] shadow-2xs transition-colors"
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
                            className="rounded-lg border border-[#E3ECE6] bg-white px-2 py-1 text-[11px] font-semibold text-[#006B48] hover:bg-emerald-50 shadow-2xs transition-colors"
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
        )}

        {/* Inline Target Adjustment form */}
        {adjId && canManage && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-[#ECFDF5]/60 p-4 text-xs" role="form">
            <p className="font-bold text-[#0C2741]">
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
                  className="w-full rounded-xl border border-[#E3ECE6] px-3 py-1.5 text-xs bg-white text-[#0C2741]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-stone-700 font-semibold mb-1">Reason for adjustment (min 5 chars)</label>
                <input
                  type="text"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g. Campus holiday or special lunch event"
                  className="w-full rounded-xl border border-[#E3ECE6] px-3 py-1.5 text-xs bg-white text-[#0C2741]"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onAdjust(adjId)}
              disabled={adjBusy}
              className="mt-3 rounded-xl bg-[#006B48] px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-[#004C35] disabled:opacity-50 transition-colors"
            >
              {adjBusy ? 'Saving…' : 'Save Adjustment'}
            </button>
          </div>
        )}
      </div>

      {/* BEGIN: UpcomingPrediction (Phase 2) */}
      <div className="bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm" data-purpose="ml-prediction">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E3ECE6] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#0C2741]">
              Upcoming Prediction{' '}
              <span className="ml-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800 border border-indigo-200">
                ML Prediction
              </span>
            </h2>
            <p className="text-xs text-gray-500">
              Predicted demand from validated ML models trained only on your actual history. Actuals below come
              solely from recorded data — predictions never appear as actuals.
            </p>
          </div>
          <span className="text-[11px] font-semibold text-stone-500">
            {ov ? `${ov.kitchen.name} · ${ov.date} (${weekdayLabel(ov.date)})` : ''}
          </span>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-stone-500" role="status">Loading predictions…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-stone-500">
            No predictions yet. Generate forecast targets to see ML predictions here.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((t) => (
              <div key={t.id} className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-[#0C2741]">
                    {t.food} <span className="font-normal text-gray-500">· {t.mealType}</span>
                  </p>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 border border-indigo-200">
                    ML Prediction
                  </span>
                </div>
                <p className="mt-2">
                  <span className="text-3xl font-extrabold text-[#2563EB]">{t.predictedKg}</span>
                  <span className="ml-1 text-xs font-semibold text-gray-500">kg predicted target</span>
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  Model {t.inputs?.modelName ?? 'memory-v1'} ({t.memoryVersion}) · confidence{' '}
                  <span className={`rounded px-1.5 py-0.5 font-bold ${confChip(t.inputs?.dataConfidence ?? 'low')}`}>
                    {(t.inputs?.dataConfidence ?? 'low').toUpperCase()}
                  </span>{' '}
                  · {t.inputs?.comparableCount ?? 0} records
                </p>
                <div className="mt-2 rounded-lg border border-emerald-200 bg-white p-2 text-[11px]">
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-900">Actual</span>{' '}
                  {t.actual ? (
                    <span className="text-stone-700">
                      Produced {t.actual.producedKg} kg · Sold {t.actual.soldKg} kg · Waste {t.actual.wasteKg} kg
                    </span>
                  ) : (
                    <span className="italic text-stone-500">No actual recorded yet — predictions never fill this in.</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void onExplain(t)}
                  disabled={explainBusy === t.id}
                  className="mt-2 rounded-lg border border-[#E3ECE6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0C2741] hover:bg-[#F2F7F4] disabled:opacity-50"
                >
                  {explainBusy === t.id ? 'Explaining…' : '✨ Explain prediction'}
                </button>
                {explanations[t.id] && (
                  <p className={`mt-1.5 rounded-lg p-2 text-[11px] ${explanations[t.id].source === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-indigo-50 text-indigo-900 border border-indigo-100'}`}>
                    {explanations[t.id].text}
                    {explanations[t.id].source === 'gemini' && <span className="ml-1 font-semibold">(Gemini)</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* END: UpcomingPrediction */}

      {/* BEGIN: ModelPerformance (Phase 2) */}
      <div className="bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm" data-purpose="ml-performance">
        <div className="border-b border-[#E3ECE6] pb-3">
          <h2 className="text-base font-bold text-[#0C2741]">Model Performance</h2>
          <p className="text-xs text-gray-500">
            Genuine rolling-origin validation metrics per food — trained on past, tested on future. Small histories
            honestly report insufficiency instead of fake confidence.
          </p>
        </div>
        {loading ? (
          <p className="py-6 text-center text-xs text-stone-500" role="status">Loading model performance…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-stone-500">No validated models yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-[#F9FCFA] text-[#0C2741] font-semibold border-b border-[#E3ECE6]">
                <tr>
                  <th className="px-3 py-2">Food · Meal</th>
                  <th className="px-3 py-2">Best model</th>
                  <th className="px-3 py-2">RMSE</th>
                  <th className="px-3 py-2">MAE</th>
                  <th className="px-3 py-2">MAPE</th>
                  <th className="px-3 py-2">R²</th>
                  <th className="px-3 py-2">Folds</th>
                  <th className="px-3 py-2">Sample</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3ECE6]">
                {rows.map((t) => {
                  const v = t.inputs?.validation;
                  return (
                    <tr key={t.id} className="hover:bg-[#F9FCFA]">
                      <td className="px-3 py-2 font-medium text-[#0C2741]">{t.food} · {t.mealType}</td>
                      <td className="px-3 py-2 text-stone-700">
                        {v ? t.inputs?.modelName : 'memory-v1 (baseline — no validation yet)'}
                      </td>
                      <td className="px-3 py-2 text-stone-700">{v ? `${v.rmse} kg` : '—'}</td>
                      <td className="px-3 py-2 text-stone-700">{v ? `${v.mae} kg` : '—'}</td>
                      <td className="px-3 py-2 text-stone-700">{v?.mape !== null && v?.mape !== undefined ? `${v.mape}%` : '—'}</td>
                      <td className="px-3 py-2 text-stone-700">{v?.r2 !== null && v?.r2 !== undefined ? v.r2 : '—'}</td>
                      <td className="px-3 py-2 text-stone-700">{v ? v.folds : '—'}</td>
                      <td className="px-3 py-2 text-stone-700">{t.inputs?.comparableCount ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* END: ModelPerformance */}

      {/* Safety Buffer & Recommendations */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm">
          <h2 className="text-base font-bold text-[#0C2741]">Production Safety Buffer</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configures extra buffer margin added to statistical demand forecast to prevent unexpected stockouts.
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
                className="rounded-xl bg-[#004C35] px-4 py-2 text-xs font-bold text-white shadow hover:bg-[#003B29] disabled:opacity-50 transition-colors"
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

        <div className="bg-white rounded-2xl border border-[#E3ECE6] p-5 shadow-sm">
          <h2 className="text-base font-bold text-[#0C2741]">
            Active Recommendations ({ov?.recommendations.length ?? 0})
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time algorithmic suggestions generated from recent kitchen variances.
          </p>

          <div className="mt-4 space-y-2">
            {!ov || ov.recommendations.length === 0 ? (
              <p className="text-xs text-stone-500 italic">No pending recommendations. System is in steady state.</p>
            ) : (
              ov.recommendations.slice(0, 3).map((rec) => (
                <div key={rec.id} className="rounded-xl border border-[#E3ECE6] bg-[#F9FCFA] p-3 text-xs">
                  <p className="font-semibold text-[#0C2741]">{rec.title}</p>
                  {rec.detail && <p className="mt-1 text-gray-600 text-[11px]">{rec.detail}</p>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-[#E3ECE6] animate-fadeInUpStagger">
            <div className="flex items-center justify-between border-b border-[#E3ECE6] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0C2741]">Enter Today's Production Target</h3>
                <p className="text-xs text-gray-500">Service Date: {date}</p>
              </div>
              <button
                type="button"
                onClick={() => setTargetModalOpen(false)}
                className="rounded-lg border border-[#E3ECE6] px-2.5 py-1 text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors"
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

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E3ECE6]">
                <button
                  type="button"
                  onClick={() => setTargetModalOpen(false)}
                  className="rounded-xl border border-[#E3ECE6] px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={targetModalBusy}
                  className="rounded-xl bg-[#006B48] px-5 py-2 text-xs font-bold text-white shadow hover:bg-[#004C35] disabled:opacity-50 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-[#E3ECE6] animate-fadeInUpStagger">
            <div className="flex items-center justify-between border-b border-[#E3ECE6] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0C2741]">Enter Today's Record</h3>
                <p className="text-xs text-gray-500">Record actual produced, served, and waste quantities</p>
              </div>
              <button
                type="button"
                onClick={() => setRecordModalOpen(false)}
                className="rounded-lg border border-[#E3ECE6] px-2.5 py-1 text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors"
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

              <p className="text-[11px] text-stone-500 bg-[#F9FCFA] p-2.5 rounded-xl border border-[#E3ECE6]">
                Surplus Remaining will be computed server-side:{' '}
                <strong className="text-[#0C2741]">
                  {Math.max(0, Number(recordProduced) - Number(recordServed) - Number(recordWaste))} kg
                </strong>
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E3ECE6]">
                <button
                  type="button"
                  onClick={() => setRecordModalOpen(false)}
                  className="rounded-xl border border-[#E3ECE6] px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recordModalBusy}
                  className="rounded-xl bg-[#006B48] px-5 py-2 text-xs font-bold text-white shadow hover:bg-[#004C35] disabled:opacity-50 transition-colors"
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label={`Why this target for ${row.food}`}>
      <div className="mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-[#E3ECE6] animate-fadeInUpStagger">
        <div className="flex items-start justify-between gap-2 border-b border-[#E3ECE6] pb-3">
          <div>
            <h2 className="text-lg font-bold text-[#0C2741]">Why this target? · {row.food} · {row.mealType}</h2>
            <p className="text-xs text-gray-500">Explainable deterministic algorithm formula and historical samples</p>
          </div>
          <button onClick={onClose} autoFocus className="rounded-lg border border-[#E3ECE6] px-3 py-1.5 text-xs font-semibold hover:bg-stone-100">
            Close (Esc)
          </button>
        </div>
        {!i ? (
          <p className="mt-4 text-xs text-stone-600">No explanation snapshot stored for this row.</p>
        ) : (
          <dl className="mt-4 space-y-2 text-xs">
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="font-semibold text-stone-700">Formula</dt>
              <dd className="mt-0.5 text-[#0C2741]">
                recommended = predicted + buffer = {row.predictedKg} + {row.bufferKg} = <strong>{row.recommendedKg} kg</strong> (buffer {i.bufferMode === 'PERCENT' ? `${i.bufferValue}%` : `${i.bufferValue} kg`})
              </dd>
            </div>
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="font-semibold text-stone-700">Predicted Demand ({row.memoryVersion})</dt>
              <dd className="mt-0.5 text-[#0C2741]">
                {i.modelVersion === 'ml-v1' && i.modelName
                  ? <>ML model {i.modelName}: validated demand forecast × menu multiplier {i.menuMultiplier} = <strong>{row.predictedKg} kg</strong>, range {i.lowerKg}–{i.upperKg} kg</>
                  : <>(0.6 × baseline {i.baselineKg} + 0.4 × recent trend {i.recentTrendKg}) × menu multiplier {i.menuMultiplier} = <strong>{row.predictedKg} kg</strong>, range {i.lowerKg}–{i.upperKg} kg</>}
              </dd>
            </div>
            {i.modelVersion === 'ml-v1' && i.validation && (
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3">
                <dt className="font-semibold text-indigo-900">ML Validation (rolling-origin, no future leakage)</dt>
                <dd className="mt-0.5 text-[#0C2741]">
                  Best of 4 candidates by RMSE over {i.validation.folds} time-ordered folds: RMSE {i.validation.rmse} kg ·
                  MAE {i.validation.mae} kg · MAPE {i.validation.mape ?? '—'}{i.validation.mape !== null && i.validation.mape !== undefined ? '%' : ''} ·
                  R² {i.validation.r2 ?? '—'} · trained on {i.comparableCount} actual records.
                </dd>
              </div>
            )}
            <div className="rounded-xl bg-[#F9FCFA] border border-[#E3ECE6] p-3">
              <dt className="font-semibold text-stone-700">Data Confidence: {i.dataConfidence}</dt>
              <dd className="mt-0.5 text-[#0C2741]">
                {i.comparableCount} comparable weekday records; variance ±{i.stdDevKg} kg.
              </dd>
            </div>
            {row.adjustedKg !== null && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                <dt className="font-semibold text-[#2563EB]">Manager Adjustment</dt>
                <dd className="mt-0.5 text-[#0C2741]">
                  Original {row.recommendedKg} kg → adjusted {row.adjustedKg} kg. Reason: {row.adjustReason ?? '—'}
                </dd>
              </div>
            )}
            {row.feedback?.hasActuals && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <dt className="font-semibold text-[#006B48]">Feedback from Actuals</dt>
                <dd className="mt-0.5 text-[#0C2741]">
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
