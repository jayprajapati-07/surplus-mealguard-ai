# Self-Correcting Production Targets + Core Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate explainable per-food daily production targets from Kitchen Memory predictions plus a configurable buffer, with manager adjustments, a real dashboard, and feedback-driven self-correction.

**Architecture:** New `ProductionTarget` + `BufferConfig` Prisma models; pure target/feedback math in `server/src/lib/targets.ts` reusing Prompt-3 `forecastForDate`; thin `server/src/routes/targets.ts` + `server/src/routes/dashboard.ts` routers; `Dashboard.tsx` rebuilt around real data with a Why-drawer; `accept-p4.js` API suite.

**Tech Stack:** Express + TypeScript + zod + Prisma (SQLite); React + react-router-dom + Tailwind; Node `fetch` acceptance script (repo has no test runner — matches `server/acceptance.js` precedent).

**Spec:** Prompt 4 text in conversation; design presented in chat (persisted targets, per-org buffer, lazy feedback, TARGET_TUNING recs).

## Global Constraints

- Persistent local SQLite via Prisma; every visible control performs a real action; no fake data presentation.
- No live external AI claim: "recommendation, not an operational mandate"; deterministic refresh wording; never claim guaranteed reduction or 90%+ accuracy — historical accuracy only if computed from data and labeled as such.
- No weather, maps, sensors, IoT, camera/OCR/computer vision, or route optimization.
- Quantities in kilograms; TypeScript strict, no ignored errors; role guards on API + UI; do not regress Prompts 1–3.

---

### Task 1: Schema + engine extension

**Files:**
- Modify: `server/prisma/schema.prisma` (add `BufferConfig`, `ProductionTarget`; add `bufferConfig?` + `productionTargets[]` to `Organization`)
- Modify: `server/src/lib/kitchen-memory.ts` (add `sampleDates: string[]` to `ForecastResult` + both return sites)
- Create: `server/src/lib/targets.ts`
- Test: `npx prisma validate`, `npx tsc --noEmit` in `server/`

**Interfaces:**
- Consumes: `ForecastResult`, `MemoryPoint` from `kitchen-memory.ts`.
- Produces (imported by Task 2):
  - `export interface BufferSetting { mode: 'FIXED_KG' | 'PERCENT'; value: number }`
  - `export function bufferKgFor(predictedKg: number, b: BufferSetting): number` — `FIXED_KG` → `b.value`; `PERCENT` → `predictedKg * b.value / 100`; result rounded to 3 decimals, never negative.
  - `export function validateBuffer(mode: string, value: unknown): string | null` — returns error string or null. Rules: mode must be `FIXED_KG` or `PERCENT`; value must be a finite number; `FIXED_KG` range 0–50; `PERCENT` range 0–100.
  - `export interface Feedback { hasActuals: boolean; producedKg: number | null; soldKg: number | null; targetErrorKg: number | null; demandErrorKg: number | null; overKg: number | null; underKg: number | null }`
  - `export function computeFeedback(effectiveTargetKg: number, predictedKg: number, actual: { producedKg: number; soldKg: number } | null): Feedback` — null actual → all-null with `hasActuals: false`; else `targetErrorKg = r3(produced - effectiveTarget)`, `demandErrorKg = r3(sold - predicted)`, `overKg = r3(max(0, produced - sold))`... correction: over/under-production relative to demand: `overKg = r3(max(0, producedKg - soldKg))`, `underKg = r3(max(0, soldKg - producedKg))`.

**Schema blocks (exact):**

```prisma
model BufferConfig {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  mode           String       @default("PERCENT")
  value          Float        @default(10)
  updatedById    String?
  updatedAt      DateTime     @updatedAt
}

model ProductionTarget {
  id               String       @id @default(cuid())
  organizationId   String
  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  kitchenUnitId    String
  kitchenUnit      KitchenUnit  @relation(fields: [kitchenUnitId], references: [id], onDelete: Cascade)
  foodItemId       String
  foodItem         FoodItem     @relation(fields: [foodItemId], references: [id], onDelete: Cascade)
  mealType         String
  date             DateTime
  predictedKg      Float
  bufferKg         Float
  recommendedKg    Float
  adjustedKg       Float?
  adjustReason     String?
  status           String       @default("PROPOSED")
  memoryVersion    String       @default("memory-v1")
  inputsJson       String?
  feedbackJson     String?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  @@unique([organizationId, kitchenUnitId, foodItemId, mealType, date])
  @@index([organizationId, date])
}
```

- [ ] **Step 1: Append models + Organization fields, migrate**

Run: `npx prisma validate`
Expected: `The schema ... is valid`

Run: `npx prisma migrate dev --name prompt4-production-targets`
Expected: migration applies on top of Prompt 3 migration.

- [ ] **Step 2: Add `sampleDates` to engine**

In `forecastForDate`, both return sites gain `sampleDates: pool.map((p) => utcDayKey(p.date))`; add field to interface + `empty` object. No other engine behavior changes.

- [ ] **Step 3: Create `targets.ts`** with the five exports above (verbatim formulas).
- [ ] **Step 4: Typecheck** — Run: `npx tsc --noEmit` in `server/`. Expected: no output (pass).

### Task 2: Targets + dashboard API

**Files:**
- Create: `server/src/routes/targets.ts`, `server/src/routes/dashboard.ts`
- Modify: `server/src/app.ts` (mount `/api/targets`, `/api/dashboard`)
- Test: `server/accept-p4.js` steps T1–T8 (written in Task 4, run in Task 5)

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, `requireRole`, `audit`; `buildSeries`, `forecastForDate`, `dedupeToLatest`, `MEMORY_VERSION`; `bufferKgFor`, `validateBuffer`, `computeFeedback`.
- Produces (consumed by Task 3 UI):
  - `GET /api/targets/buffer` (FLOW_ROLES) → `{ buffer: {mode, value} | null }` (null = never set; UI shows default PERCENT 10 as unset).
  - `PUT /api/targets/buffer` (REFRESH_ROLES = SUPER_ADMIN, INSTITUTION_ADMIN, KITCHEN_MANAGER) body `{mode, value}` → validated via `validateBuffer` (400 otherwise) → upsert → `{ buffer }` + `audit('targets.buffer', ...)`.
  - `POST /api/targets/generate` (REFRESH_ROLES) body `{kitchenUnitId, date, daysAhead?: 1..7 default 1}` → loads org records+menus+active foods; per food×meal with series ≥2 runs `forecastForDate`; skips insufficient; buffer = stored config or default `{PERCENT,10}`; upserts `ProductionTarget` keyed by unique tuple with `recommendedKg = r3(predicted + bufferKg)`, `status PROPOSED`, `inputsJson` = forecast breakdown + buffer + comparable dates; preserves existing `adjustedKg/adjustReason` on regeneration (never silently overwrites a manager decision); regenerates `TARGET_TUNING` recommendations (delete PENDING of that type, recreate ≤10, see below); `audit('targets.generate', ...)` → `{ targetsCreated, targetsUpdated, recommendationsCreated, message }`.
  - `PUT /api/targets/:id/adjust` (REFRESH_ROLES) body `{adjustedKg: number ≥ 0, reason: string ≥ 5 chars}` → 400 otherwise; verifies org ownership; sets `adjustedKg`, `adjustReason`, `status ADJUSTED`; keeps `recommendedKg`; `audit('targets.adjust', ...)` → `{ target }`.
  - `GET /api/targets?kitchenUnitId=&date=` (FLOW_ROLES) → `{ targets }` with food/kitchen names + parsed feedback.
  - `GET /api/dashboard/overview?kitchenUnitId=&date=` (FLOW_ROLES) → `{ date, kitchen, targets: Row[], flowSummary, confidence, recommendations, buffer }` where `Row = { target..., actual: record|null, feedback, lastWeek: record|null, lastWeekDate, progressProduced, progressSold }`; lazy-persists `feedbackJson` when actuals exist and stored JSON differs; `progressProduced = produced / effectiveTarget`, `progressSold = sold / effectiveTarget` (null when no actuals); `confidence` = worst dataConfidence across rows' inputsJson + `basedOn` count; `flowSummary` = summed produced/sold/waste/remaining over rows with actuals; `recommendations` = PENDING (TARGET_TUNING first, then FORECAST_*, cap 10).
  - `TARGET_TUNING` generation (inside generate): pair each target row having feedback actuals... simpler deterministic source: all org `ProductionTarget`s with non-null `feedbackJson` (parse), group by food+meal weekday: for groups with ≥3 pairs compute mean over% = mean((produced−sold)/sold·100); if |mean| ≥ 10% emit `Friday rice production exceeded observed demand by approximately X% across Y comparable records; consider reducing target by Z kg` (Z = mean over-kg, r3) or the under-side mirror. Cap 10, order by |X| desc. Historical accuracy (only if pairs ≥ 5): `100·(1 − mean(|sold−predicted|/max(sold,0.001)))`, r3, stored in response `historicalAccuracy: {pct, pairs} | null`, labeled "computed historical accuracy". Never emit 90%+ claims unless the arithmetic says so.

- [ ] **Step 1: Write `targets.ts`** following `memory.ts` patterns (`orgIdFor`, zod, scoped loads).
- [ ] **Step 2: Write `dashboard.ts`** (lazy feedback persist + last-week lookup via `date−7` deduped record + confidence rollup).
- [ ] **Step 3: Mount both in `app.ts`; typecheck** — Run `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 3: Dashboard UI + memory deep-links

**Files:**
- Modify: `client/src/pages/Dashboard.tsx` (rebuild around overview data; keep org welcome header minimal)
- Modify: `client/src/pages/DigitalMemory.tsx` (init kitchen/food/meal filters from `useSearchParams`)
- Modify: `client/src/components/Layout.tsx` (subtitle → Prompt 4)
- Test: manual UI pass + Task 5 suite

**Interfaces:**
- Consumes: Task 2 endpoints via `api<T>`; `useAuth()` kitchens + role (buffer card + Adjust buttons only when role in REFRESH_ROLES-equivalent list).
- Produces — `Dashboard.tsx` sections, every control real:
  - Kitchen select + date input (default today) → refetch overview.
  - "Generate today's targets" button (privileged only; others see note) → POST generate → message + refetch.
  - Today's Target card: totals (recommended sum, effective sum, produced sum, progress bar produced/effective).
  - Per-food table: food, meal, predicted, buffer, recommended, adjusted?, effective target, produced, sold, waste, remaining/surplus, progress %, last-week sold (or "No comparable record for {date−7}"), feedback errors (target err / demand err / over / under), "Why?" button per row.
  - Why-drawer (working open/close, focus-trapped-ish via autofocus + Esc handler): baseline, recent trend, menu multiplier, buffer, range, confidence chip, comparable dates list, manager adjustment block if present, "This is a recommendation, not an operational mandate." notice.
  - Adjust form (per row, privileged): adjustedKg + reason inputs → PUT adjust → refetch; validation messages; original retained on screen.
  - Buffer card (privileged form: mode select + value + Save → PUT buffer with feedback; others read-only view).
  - Flow summary + confidence indicator + recommendation cards with `<Link to={/memory?food=&meal=}>` detail links.
  - Empty states: no targets → "No targets for this date/kitchen yet — generate them."; targets but no actuals → "No actuals recorded yet — add Food Data; feedback appears after service."

- [ ] **Step 1: Rebuild `Dashboard.tsx`.**
- [ ] **Step 2: DigitalMemory `useSearchParams` preselect** (kitchen→kitchenUnitId? URL carries food *id* + meal + date; set matching filter states on mount).
- [ ] **Step 3: Layout subtitle → Prompt 4; typecheck + build** — Run `npx tsc --noEmit`, `npm run build` in `client/`. Expected: pass.

### Task 4: Test suite (`server/accept-p4.js`)

**Files:**
- Create: `server/accept-p4.js` (delete after green; plain Node fetch, seed logins, unique `stamp` fixtures — same skeleton as `accept-p3.js`)
- Test: `node accept-p4.js` vs live API

**Interfaces:** covers contract test areas:
- T1 buffer percent: PUT buffer `{PERCENT,10}` → generate → `recommendedKg === r3(predictedKg·1.10)` for a row.
- T2 buffer fixed: PUT `{FIXED_KG,2}` → regenerate → `recommendedKg === r3(predictedKg+2)`; invalid `{PERCENT,150}` → 400 and stored buffer unchanged.
- T3 manager adjustment: PUT adjust without reason → 400; with reason → 200, `recommendedKg` retained, `adjustedKg` set, status ADJUSTED; regenerate → adjustment survives (effective target still adjusted).
- T4 same-day-last-week: record on date−7 exists → overview row shows its sold; fresh food with no date−7 record → `lastWeek === null` and UI-testable flag/message present.
- T5 feedback: post actuals for target date → overview feedback `{targetErrorKg: produced−effective, demandErrorKg: sold−predicted}` exact; over/under split exact.
- T6 cross-org: second org (signup→verify→onboard via mailbox, per `acceptance.js` precedent) targets/buffer invisible to org A (A overview has zero rows for B food; B buffer PUT doesn't change A's).
- T7 roles: STAFF generate/adjust/buffer-PUT → 403; STAFF overview/targets GET → 200.
- T8 regression spot: memory forecast + food-items list + imports jobs + menus list all 200.

```javascript
const BASE = 'http://localhost:4000/api';
async function req(path, opts = {}) { /* fetch JSON, return {status, data} */ }
async function login(email, password) { /* → token or throw */ }
const check = (name, ok, info='') => results.push([name, !!ok, `${info}`]);
// fixtures: probe food `P4-Probe-${stamp}` + 5 same-weekday records via /food-records
// (reuse accept-p3.js weekday helpers pastWeekdays/nextWeekday)
```

- [ ] **Step 1: Write the script** (all 8 groups, real assertions, 404-tolerant so RED is meaningful).
- [ ] **Step 2: RED run pre-implementation** — Run: `node accept-p4.js`. Expected: FAILs on `/targets/*`, `/dashboard/*` 404.

### Task 5: Verify + docs, then STOP

**Files:**
- Modify: `README.md` (append Prompt 4 section: formula, buffer rules, adjustment/audit, feedback math, accuracy labeling)
- Delete: `server/accept-p4.js` after green

- [ ] **Step 1: Backend typecheck + migrate + build** — `npx prisma validate`, `npx prisma migrate dev`, `npx tsc --noEmit`, `npm run build` in `server/`. Expected: all pass.
- [ ] **Step 2: Suite green** — `node accept-p4.js` ALL PASS.
- [ ] **Step 3: Frontend typecheck + build** — `npx tsc --noEmit`, `npm run build` in `client/`. Expected: pass.
- [ ] **Step 4: Docs + cleanup** — README section; delete suite; `git status` review. STOP.

## Self-Review

- Spec coverage: per-food/meal/date/kitchen generation ✓ (T2 generate); memory prediction + configurable buffer + visible formula ✓ (T1/T2/T3); buffer fixed|% with validation ✓ (T1/T2); no silent overwrite + reasoned adjustment retaining original ✓ (T2 adjust); dashboard card/table/last-week/flow/confidence/rec-links/empty states/org-scoped ✓ (T2/T3); why-drawer with all listed inputs + mandate disclaimer ✓ (T3); feedback errors + trend-input update (records feed engine — stated in UI/refresh) + tuning rec with measured % ✓ (T1/T2); no fake-accuracy rule ✓ (T2 historicalAccuracy gating); buffer/adjust/last-week/feedback/isolation tests ✓ (T4); acceptance (generate→explain→adjust→refresh, real numbers, last-week honesty, working controls, prior features) ✓ (T4/T5).
- Placeholders: none — exact paths, schemas, formulas, thresholds, commands.
- Type consistency: `BufferSetting`, `Feedback`, target row shape, endpoint paths identical across Tasks 1–4.
