# AI Kitchen Digital Memory and Deterministic Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Learn each institution's operational history from persisted records and serve reproducible, explainable demand forecasts with data confidence.

**Architecture:** Pure-function engine in `server/src/lib/kitchen-memory.ts` (no new dependencies) consumed by a thin `server/src/routes/memory.ts` router; React page `client/src/pages/DigitalMemory.tsx` wired into App/Layout/guards. Refresh persists `ForecastSnapshot` + `Recommendation` rows and an `AuditLog` entry.

**Tech Stack:** Express + TypeScript + zod + Prisma (SQLite); React + react-router-dom + Tailwind; ad-hoc Node API acceptance script (repo has no test runner — matches `server/acceptance.js` precedent).

**Spec:** Prompt 3 text in conversation; design presented in chat (algorithm `memory-v1`).

## Global Constraints

- Persistent local SQLite via Prisma; every visible control performs a real action; no fake data presentation.
- No live external AI claim: label engine "deterministic learning refresh", algorithm version `memory-v1`; confidence labeled "data confidence", not a guarantee.
- No weather, maps, sensors, IoT, camera/OCR/computer vision, or route optimization.
- Quantities in kilograms; TypeScript strict, no ignored errors; role guards on API + UI; do not regress Prompts 1–2.

---

### Task 1: Deterministic engine (`kitchen-memory.ts`)

**Files:**
- Create: `server/src/lib/kitchen-memory.ts`
- Test: `server/accept-p3.js` (written in Task 4, run in Task 6)

**Interfaces:**
- Consumes: `DailyFoodRecord[]` (with `foodItem`, `kitchenUnit`), `Menu[]` (with `items`), both already scoped to one organization by callers.
- Produces (imported by Task 2):
  - `export const MEMORY_VERSION = 'memory-v1'`
  - `export interface MemoryPoint { date: Date; soldKg: number; producedKg: number; wasteKg: number; remainingKg: number; onMenu: boolean; isCorrection: boolean }`
  - `export function dedupeToLatest(records: DailyFoodRecord[]): DailyFoodRecord[]` — same (kitchen, food, meal, UTC day) keeps highest `createdAt`.
  - `export function buildSeries(records, menus, kitchenUnitId, foodItemId, mealType): MemoryPoint[]` — sorted ascending; `onMenu` true when a Menu exists for same kitchen+UTC day+mealType whose items include the food.
  - `export interface ForecastResult { predictedKg: number; lowerKg: number; upperKg: number; dataConfidence: 'high'|'medium'|'low'; baselineKg: number; recentTrendKg: number; menuMultiplier: number; comparableCount: number; fallbackUsed: boolean; fallbackReason: string | null; stdDevKg: number; sampleValues: number[]; insufficient: boolean; message: string | null }`
  - `export function forecastForDate(series: MemoryPoint[], targetDate: Date): ForecastResult`
  - `export interface PatternSummary { totals: {...}; perWeekday: {weekday, count, meanSold, meanProduced, meanWaste, meanRemaining}[]; perMeal: ...; perFood: ...; overproductionDays: number; underproductionDays: number; quality: { sampleSize, spanDays, correctionCount, status: 'OK'|'SPARSE'|'INSUFFICIENT' } }`
  - `export function summarize(records: DailyFoodRecord[]): PatternSummary` — overproduction = remainingKg > 15% of preparedKg; underproduction = adjustmentReason present OR preparedKg < 0.9 * (targetKg ?? preparedKg).

**Algorithm (exact, implement verbatim):**

```typescript
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function forecastForDate(series: MemoryPoint[], targetDate: Date): ForecastResult {
  const dow = targetDate.getUTCDay();
  const soldOf = (p: MemoryPoint) => p.soldKg;
  let pool = series.filter((p) => new Date(p.date).getUTCDay() === dow);
  let fallbackUsed = false;
  let fallbackReason: string | null = null;
  if (pool.length < 3) {
    fallbackUsed = true;
    fallbackReason = `Only ${pool.length} same-weekday record(s) found; using all ${series.length} comparable record(s) for this food and meal. Confidence is lower because weekday patterns cannot be isolated.`;
    pool = series;
  }
  if (pool.length < 2) {
    return { predictedKg: 0, lowerKg: 0, upperKg: 0, dataConfidence: 'low', baselineKg: 0, recentTrendKg: 0, menuMultiplier: 1, comparableCount: pool.length, fallbackUsed, fallbackReason, stdDevKg: 0, sampleValues: pool.map(soldOf), insufficient: true, message: 'Insufficient history: at least 2 comparable records are needed for an estimate.' };
  }
  // Baseline: age-decayed weighted mean, weight = 1 / (1 + weeksAgo)
  const msPerWeek = 7 * 86400000;
  const nowMs = targetDate.getTime();
  let wSum = 0, bSum = 0;
  for (const p of pool) {
    const weeksAgo = Math.max(0, (nowMs - new Date(p.date).getTime()) / msPerWeek);
    const w = 1 / (1 + weeksAgo);
    wSum += w; bSum += w * p.soldKg;
  }
  const baseline = bSum / wSum;
  // Recent trend: linear-weighted moving average of last ≤6 pool points (most recent weight 6)
  const recent = pool.slice(-6);
  let rwSum = 0, rSum = 0;
  recent.forEach((p, i) => { const w = i + 1; rwSum += w; rSum += w * p.soldKg; });
  const recentWma = rSum / rwSum;
  // Menu multiplier from comparable menu history only, capped [0.7, 1.3]
  const on = pool.filter((p) => p.onMenu).map(soldOf);
  const off = pool.filter((p) => !p.onMenu).map(soldOf);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  let menuMultiplier = 1;
  if (on.length >= 2 && off.length >= 2 && mean(off) > 0) {
    menuMultiplier = Math.min(1.3, Math.max(0.7, mean(on) / mean(off)));
  }
  const predicted = r3((0.6 * baseline + 0.4 * recentWma) * menuMultiplier);
  // Range from residual spread of comparable sold values
  const m = mean(pool.map(soldOf));
  const variance = mean(pool.map((p) => (p.soldKg - m) ** 2));
  const std = Math.sqrt(variance);
  const lower = r3(Math.max(0, predicted - std));
  const upper = r3(predicted + std);
  const cv = m > 0 ? std / m : 1;
  const dataConfidence = pool.length >= 8 && cv <= 0.25 ? 'high' : pool.length >= 4 ? 'medium' : 'low';
  return { predictedKg: predicted, lowerKg: lower, upperKg: upper, dataConfidence, baselineKg: r3(baseline), recentTrendKg: r3(recentWma), menuMultiplier: r3(menuMultiplier), comparableCount: pool.length, fallbackUsed, fallbackReason, stdDevKg: r3(std), sampleValues: pool.map(soldOf), insufficient: false, message: null };
}
```

- [ ] **Step 1: Create the file** with the interfaces + functions above plus `summarize` (verbatim thresholds: overproduction remainingKg > 0.15 * preparedKg; underproduction adjustmentReason present OR preparedKg < 0.9 * targetKg when targetKg present).
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` in `server/`. Expected: no output (pass).

### Task 2: Memory API routes

**Files:**
- Create: `server/src/routes/memory.ts`
- Modify: `server/src/app.ts` (mount `/api/memory`)
- Test: `server/accept-p3.js` steps M1–M8

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, `requireRole`, `audit` (existing); `buildSeries`, `forecastForDate`, `summarize`, `dedupeToLatest`, `MEMORY_VERSION` from Task 1.
- Produces (consumed by Task 3):
  - `GET /api/memory/summary?kitchenUnitId=&foodItemId=&mealType=&from=&to=` (roles: SUPER_ADMIN, INSTITUTION_ADMIN, KITCHEN_MANAGER, STAFF) → `{ patterns: PatternSummary, records: NormalizedRecord[], filters: {kitchens, foods} }` where `NormalizedRecord = {id, date, kitchen, food, meal, producedKg, soldKg, wasteKg, remainingKg, onMenu, isCorrection}` scoped to caller's org + filters; records are the deduped set the model actually uses.
  - `GET /api/memory/forecast?kitchenUnitId=&foodItemId=&mealType=&date=` (same roles) → `{ forecast: ForecastResult, version: 'memory-v1', inputs: {kitchen, food, meal, targetDate, weekday} }`; 400 when kitchen/food/meal/date missing or unknown ids; date defaults to tomorrow.
  - `POST /api/memory/refresh` (roles: SUPER_ADMIN, INSTITUTION_ADMIN, KITCHEN_MANAGER) body `{daysAhead?: 1..14 default 7}` → for each kitchen × active food × meal with ≥2 records, forecast next `daysAhead` days; persist `ForecastSnapshot{organizationId, kitchenUnitId, date, predictedDemandKg, method:'memory-v1', inputsJson}`; replace PENDING `Recommendation`s of type `FORECAST_WASTE_RISK`/`FORECAST_SHORTFALL_WATCH` with fresh ones (overproduction-prone: top 10 by overproductionDays with suggested cut ≈ mean remaining; shortfall watch: underproductionDays ≥2); `audit('memory.refresh', ...)`; → `{ snapshotsCreated, recommendationsCreated, message }`.
  - `GET /api/memory/snapshots` (same read roles) → `{ snapshots: latest 50, recommendations: PENDING 20, lastRefresh: AuditLog|null }`.

- [ ] **Step 1: Write the router** following `food-records.ts` patterns (`orgIdFor` helper, zod validation, `res.status(...).json({error})`).
- [ ] **Step 2: Mount in `app.ts`, typecheck** — Run `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 3: Digital Memory UI page

**Files:**
- Create: `client/src/pages/DigitalMemory.tsx`
- Modify: `client/src/App.tsx` (route `/memory`), `client/src/components/Layout.tsx` (nav link "Digital Memory" for MENU_ROLES + STAFF — reuse `FLOW_ROLES`), `client/src/components/guards.tsx` (add `RequireMemoryAccess` = FLOW_ROLES).
- Test: manual UI pass + API evidence from Task 6

**Interfaces:**
- Consumes: Task 2 endpoints via `api<T>` helper; `useAuth()` for kitchens + role (hide Refresh button unless role in `['SUPER_ADMIN','INSTITUTION_ADMIN','KITCHEN_MANAGER']`).
- Produces: page with (all controls real):
  - Filters: kitchen select, food select, meal select, from/to date inputs, target forecast date input → refetch summary + forecast.
  - Pattern cards: totals (produced/sold/waste/surplus sums + means), weekday table (also rendered as SVG bars with `<title>` tooltips AND the same numbers in the table — table is the alternative), meal + food pattern tables, over/underproduction counts, quality status chip.
  - Records table: normalized rows actually used by the model (date, kitchen, food, meal, produced/sold/waste/remaining, on-menu ✓/—, correction flag).
  - "How this learned" panel: version, baseline, recent WMA, menu multiplier (with on/off means + cap note), comparable count, sample values list, σ, fallback reason or insufficient message, data-confidence chip labeled "data confidence — not a guarantee".
  - Forecast card: predicted kg + lower–upper range + confidence + target date.
  - "Refresh kitchen memory" button (privileged roles only): POST refresh, shows success/failure message + counts; last-refresh info from snapshots endpoint; snapshots + recommendations lists.
  - Empty states: no records → "No history yet — add Food Data or import a file."; insufficient → message from engine.

- [ ] **Step 1: Add guard + route + nav link.**
- [ ] **Step 2: Build the page** (filters → summary → forecast → records → snapshots sections).
- [ ] **Step 3: Typecheck + build** — Run `npx tsc --noEmit` and `npm run build` in `client/`. Expected: pass.

### Task 4: API test suite (`server/accept-p3.js`)

**Files:**
- Create: `server/accept-p3.js` (delete after green run; precedent: Prompt 2 suite pattern — plain Node `fetch`, login as seed users, unique `stamp` fixtures)
- Test: run with `node accept-p3.js` against live API

**Interfaces:**
- Consumes: seed logins (`admin@mealguard.local`, `staff@mealguard.local`), Task 2 endpoints, `food-records` POST (to prove record-change sensitivity).
- Produces: PASS/FAIL lines + exit code; must cover:
  - M1 isolation: create org-B admin + records for food X; org-A forecast for X unchanged before/after (predictedKg equal).
  - M2 same-weekday: forecast `sampleValues` all share target weekday; changing selection to another weekday changes comparable set.
  - M3 fallback: brand-new food with 2 records on different weekdays → `fallbackUsed === true`, confidence `low`, message explains why.
  - M4 range: `lowerKg <= predictedKg <= upperKg`, `lowerKg >= 0`.
  - M5 stability: two `forecast` calls + two `refresh`es → identical predictedKg.
  - M6 sensitivity: POST a new food-record for the series → next forecast predictedKg differs.
  - M7 refresh persists: snapshots count increases, audit entry exists, recommendations array present.
  - M8 roles: STAFF refresh → 403; STAFF summary/forecast → 200.

```javascript
// skeleton (fill per Prompt-2 precedent):
const BASE = 'http://localhost:4000/api';
async function login(email, password) { /* POST /auth/login → token */ }
async function authed(path, token, opts) { /* fetch with Bearer */ }
// each check: check('M1 isolation', before === after, `${before} vs ${after}`);
```

- [ ] **Step 1: Write the script** (all 8 checks, real assertions, no mocks).
- [ ] **Step 2: Run pre-implementation** — Run: `node accept-p3.js`. Expected: FAIL (routes 404) — proves the suite detects absence.

### Task 5: Seed coverage check (no changes expected)

**Files:** none (read-only verification).

- [ ] **Step 1: Confirm seed history suffices** — seed org has 12 weeks of DailyFoodRecords across foods/meals/weekdays (Prompt 2 seeded ~640 rows). If a food needed by tests is missing, create fixtures inside `accept-p3.js` instead of touching `seed.ts`.

### Task 6: Verify + docs, then STOP

**Files:**
- Modify: `README.md` (append Prompt 3 section: algorithm, endpoints, confidence meaning, refresh semantics)
- Delete: `server/accept-p3.js` after green

- [ ] **Step 1: Backend typecheck + build** — `npx tsc --noEmit` and `npm run build` in `server/`. Expected: pass.
- [ ] **Step 2: Frontend typecheck + build** — same in `client/`. Expected: pass.
- [ ] **Step 3: Full suite green** — `node accept-p3.js` all PASS; rerun Prompt 1–2 regression spot-checks (login/me, food-items list, imports job list) — no regressions.
- [ ] **Step 4: Docs + cleanup** — README section; delete suite script; `git status` review. STOP.

## Self-Review

- Spec coverage: per-kitchen/food/meal stats + weekday + meal/menu-item patterns + WMA trend + over/under patterns + sample size/quality → Task 1 `summarize` + Task 3 cards; deterministic algorithm with baseline/trend/multiplier/range/confidence/version/inputs → Task 1 + Task 2 forecast; fallback → Task 1 + UI message; Digital Memory UI with filters/cards/table/How-learned/no-decorative-charts → Task 3; refresh + audit + feedback + no-NN wording → Task 2/3; API suite (isolation/weekday/fallback/range/stability) → Task 4; acceptance (record-change sensitivity, isolation, why-panel, empty handling, working controls) → Tasks 4–6.
- Placeholders: none — exact file paths, signatures, thresholds, and commands throughout.
- Type consistency: `ForecastResult`, `PatternSummary`, `NormalizedRecord` field names identical across Tasks 1–3; endpoint paths match UI calls.
