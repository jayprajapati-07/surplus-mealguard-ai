# Surplus-Before-Surplus Prediction (Prompt 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn operations before day-close when live production and sales pace predict end-of-day excess, with transparent math, preventive actions, and an in-app notification center.

**Architecture:** Additive Prisma migration (FlowEntry columns + Notification.linkPath + new RiskThreshold model); pure risk math in `server/src/lib/surplus-risk.ts` reusing Prompt-3 `forecastForDate`; new `routes/flow.ts` + `routes/notifications.ts` + `routes/risk-thresholds.ts`; 3-line additive notification hook in `targets.ts` generate; new `Flow.tsx` + `Notifications.tsx` pages, Layout bell badge, additive live-flow card in `Dashboard.tsx`; `server/accept-p5.js` suite.

**Tech Stack:** Express + TypeScript + zod + Prisma (SQLite); React + react-router-dom + Tailwind; Node fetch acceptance script (repo has no test runner — matches `server/acceptance.js` precedent).

**Spec:** Prompt 5 text in conversation; design presented in chat (model reuse, pace math, dedupe keys, role matrix).

## Global Constraints

- Persistent local SQLite via Prisma; every visible control performs a real action; no fake data presentation.
- No live external AI claim: deterministic pace arithmetic, "estimate" language, assumptions displayed.
- No weather, maps, sensors, IoT, camera/OCR/computer vision, route optimization, payment integration claims, email sending, or NGO notification in this part.
- Quantities in kilograms; TypeScript strict, no ignored errors; role guards on API + UI; do not regress Prompts 1–4.
- Terminology: "Food Flow" everywhere in UI; never "incoming/outgoing food".

---

### Task 1: Schema migration + risk math lib

**Files:**
- Modify: `server/prisma/schema.prisma` — add to `FoodFlowEntry`: `mealType String?`, `entryKind String @default("PRODUCTION")`, `direction String @default("ADD")`, `refKind String?`, `reason String?`, `createdById String?`, `createdByName String?`; add to `Notification`: `linkPath String?`; add model `RiskThreshold` below `BufferConfig` (find it via `Select-String -Pattern "model BufferConfig"`):
```prisma
model RiskThreshold {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  medKg          Float        @default(2)
  highKg         Float        @default(5)
  minSales       Int          @default(2)
  minSpanMin     Int          @default(30)
  windowsJson    String?
  updatedById    String?
  updatedAt      DateTime     @updatedAt
}
```
plus `riskThreshold RiskThreshold?` on `Organization`.
- Create: `server/src/lib/surplus-risk.ts` (exact content below)
- Test: `npx prisma validate`, `npx prisma migrate dev --name prompt5-surplus-risk`, `npx tsc --noEmit` in `server/`

**Interfaces:**
- Consumes: `MemoryPoint`-shaped history via caller; Prompt-3 `forecastForDate` (import from `./kitchen-memory`) for demand context.
- Produces (imported by Task 2):
```typescript
export const MEAL_WINDOWS: Record<'BREAKFAST' | 'LUNCH' | 'DINNER', { start: string; end: string }> = {
  BREAKFAST: { start: '07:00', end: '10:30' },
  LUNCH: { start: '11:30', end: '15:00' },
  DINNER: { start: '18:00', end: '21:30' },
};
export interface RiskThresholds { medKg: number; highKg: number; minSales: number; minSpanMin: number; windows: typeof MEAL_WINDOWS; }
export interface PaceInputs { saleQtys: number[]; saleTimes: Date[]; producedToDate: number; wasteToDate: number; now: Date; mealType: string; }
export interface RiskResult {
  estimable: boolean; reason: string | null;
  paceKgPerHour: number | null; elapsedHours: number | null; remainingHours: number | null;
  windowEnd: string | null; projectedEodSoldKg: number | null; predictedUnsoldKg: number | null;
  risk: 'low' | 'medium' | 'high' | null; medKg: number; highKg: number;
  explanation: string;
}
export function assessSurplusRisk(t: RiskThresholds, p: PaceInputs): RiskResult;
```
Rules (implement verbatim): distinct sale timestamps required: `uniq = [...new Set(times.map(ms))]`; if `saleQtys.length < t.minSales` → `{estimable:false, reason:'Only N sale entr... (N, need M with distinct timestamps). Record more sales to unlock the estimate.'}`; spanMin = (max-min)/60000; if spanMin < t.minSpanMin → estimable:false with span reason; window = t.windows[mealType] (fallback LUNCH); parse windowEnd today-local; if now >= windowEnd → estimable:false, reason 'Service window (HH:MM) has ended; use end-of-day totals from Food Data.'; elapsedH = max(spanH, 1/60); pace = sold/ elapsedH; remainingH = max(0,(windowEnd-now)/3600); projected = sold + pace*remainingH; unsold = max(0, produced - projected - waste); risk = unsold>=highKg?'high':unsold>=medKg?'medium':'low'; explanation string must contain pace, window, projected, unsold, thresholds, e.g. `Pace 3.20 kg/h from 6.40 kg over 2.00 h; window ends 15:00 leaving 1.50 h; projected end-of-day sales 11.20 kg; predicted unsold = 20.00 - 11.20 - 1.00 = 7.80 kg; bands low<2, medium≥2, high≥5 kg.`
- `export function defaultThresholds(): RiskThresholds` returning `{medKg:2, highKg:5, minSales:2, minSpanMin:30, windows:MEAL_WINDOWS}`.
- `export const INAPP_TYPES = ['SURPLUS_RISK_HIGH','SURPLUS_RISK_MEDIUM','PRODUCTION_ABOVE_TARGET','PRODUCTION_BELOW_TARGET','TARGET_GENERATED','HIGH_WASTE']`.

- [ ] **Step 1: Edit schema, add model + Organization field**

- [ ] **Step 2: Validate + migrate**

Run: `npx prisma validate`
Expected: `The schema ... is valid`

Run: `npx prisma migrate dev --name prompt5-surplus-risk`
Expected: migration applies on top of Prompt 4 migration.

- [ ] **Step 3: Create `surplus-risk.ts`** with exact interfaces/rules above (no placeholder guard — write only the real map).

- [ ] **Step 4: Typecheck** — Run: `npx tsc --noEmit` in `server/`. Expected: no output (pass).

### Task 2: Flow + risk + notifications API

**Files:**
- Create: `server/src/routes/flow.ts`, `server/src/routes/notifications.ts`, `server/src/routes/risk-thresholds.ts`
- Modify: `server/src/app.ts` (mount `/api/flow`, `/api/notifications`, `/api/risk-thresholds` after memory/targets/dashboard lines)
- Modify: `server/src/routes/targets.ts` generate handler — after recommendations/audit success, before `return res.json`, insert notification creation (use existing `notifyOrg` helper from Task 2's shared module — define `export async function notifyOrg(orgId, type, title, body, linkPath)` in `notifications.ts` with unread (type,linkPath) dedupe; import it in targets.ts).
- Modify: `server/src/seed.ts` — append guarded block (only if `prisma.foodFlowEntry.count({where:{organizationId:seedOrg.id}})` is 0): today's entries for seed kitchen rice/LUNCH: PRODUCTION 40kg (recordedAt now-3h), SALE 3kg (now-2h), SALE 2kg (now-1h), SALE 1kg (now-20min) with createdByName 'Seed Data'. Keep all prior seed code untouched.
- Test: `server/accept-p5.js` steps F1–F9 (Task 4) + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, `requireRole`, `audit`; `assessSurplusRisk`, `defaultThresholds`, `INAPP_TYPES`; `buildSeries`, `forecastForDate`, `dedupeToLatest`, `utcDayKey`, `MEMORY_VERSION` from `kitchen-memory`; `FoodItem`/`KitchenUnit` scoping pattern from `food-records.ts` (`orgIdFor` helper — copy verbatim pattern).
- Produces (consumed by Task 3 UI + Task 4 suite):
  - `POST /flow/entries` (FLOW_ROLES) body `{kitchenUnitId, foodItemId, mealType: BREAKFAST|LUNCH|DINNER, entryKind: PRODUCTION|SALE|WASTE|ADJUSTMENT, quantityKg: number>0 ≤1000000, direction?: ADD|SUBTRACT (default ADD), refKind?: required iff ADJUSTMENT, one of PRODUCTION|SALE|WASTE, reason?: required iff ADJUSTMENT (trim ≥5), optional ≤500 otherwise, recordedAt?: ISO, valid, not future, within past 48h}` → 400 otherwise with message, nothing persisted → `{entry}` (with `signedKg` = direction==='SUBTRACT' ? -quantityKg : quantityKg, author name) + triggers `evaluateAndNotify` (see below) → response includes `triggered: string[]` (notification types created). `audit('flow.entry', ...)`.
  - `GET /flow/entries?kitchenUnitId=&date=&foodItemId=&mealType=` (FLOW_ROLES) → `{entries}` chronological asc (recordedAt, then createdAt), each `{id, recordedAt, entryKind, direction, signedKg, quantityKg, refKind, reason, author, food, meal, kitchen}`.
  - `GET /flow/today?kitchenUnitId=&date=` (FLOW_ROLES, date defaults today) → `{date, kitchen, totals: [{foodItemId, food, mealType, produced, sold, wasted, adjustments: [{id, refKind, signedKg, reason, author, recordedAt}]}], dayTotals: {produced, sold, wasted}}` computed purely from entries.
  - `GET /flow/risk?kitchenUnitId=&date=` (FLOW_ROLES) → `{date, risks: [{foodItemId, food, mealType, producedToDate, soldToDate, wasteToDate, saleEntries, targetKg: number|null, memoryPredictedKg: number|null, dataConfidence, ...RiskResult}]}`. Memory context: buildSeries over org records+menus (cap 5000/500 like memory.ts), forecastForDate(series, date) → predictedKg (if insufficient, null + limitation string appended). Target: ProductionTarget for (kitchen,food,meal,date) effectiveKg or null.
  - `POST /flow/actions/adjust-production` (FLOW_ROLES) body `{kitchenUnitId, foodItemId, mealType, date, suggestedDeltaKg: number ≠0, |.| ≤1000, rationale: trim ≥5}` → creates `Recommendation{type:'PRODUCTION_ADJUST_SUGGESTION', title:'Suggested production change: {food} ({meal}) {−X|＋X} kg', detail: rationale + ' Suggestion only — recorded production is unchanged...', status:'PENDING'}` → `{recommendation}` + `audit('flow.action.adjust-suggestion', ...)` + notification? No (avoid noise) — audit only.
  - `POST /flow/actions/special-offer` (FLOW_ROLES) body `{kitchenUnitId, foodItemId, mealType, date, title: 3..120, note: 5..1000}` → `Recommendation{type:'INTERNAL_PROMOTION', title, detail: note + ' Internal note only — no payment-system integration.'}` → `{recommendation}` + audit.
  - `POST /flow/actions/prepare-redistribution` (FLOW_ROLES) body `{kitchenUnitId, foodItemId, mealType, date, quantityKg: >0 ≤100000}` → `RedistributionRecord{status:'DRAFT', quantityKg, ngoId:null, assessmentId:null, notes:'Surplus preparation draft — eligibility NOT assessed; no NGO notified.'}` → `{draft}` + audit.
  - `GET /notifications` (FLOW_ROLES) → `{notifications}` order createdAt desc take 100, **where type in INAPP_TYPES**, include `{id,type,title,body,linkPath,isRead,createdAt}`, plus `{unreadCount}`.
  - `GET /notifications/unread-count` (FLOW_ROLES) → `{unreadCount}` (for Layout badge).
  - `PATCH /notifications/:id` (FLOW_ROLES) body `{isRead: boolean}` → verifies org ownership (via userId-in-org OR organizationId match — rule: notification belongs to caller if `n.organizationId===orgId` OR (`n.userId` set and that user is in orgId)) → `{notification}`; else 404 (never leak existence → 404 not 403).
  - `GET /risk-thresholds` (FLOW_ROLES) → `{thresholds: {medKg,highKg,minSales,minSpanMin,windows} | null}` (null = defaults in force; UI shows defaults as unset).
  - `PUT /risk-thresholds` (MANAGE_ROLES) body `{medKg: 0.5..1000, highKg: 0.5..1000, minSales: int 1..20, minSpanMin: int 5..480, windows?: {BREAKFAST/LUNCH/DINNER: {start,end} HH:MM}}` with `highKg > medKg` else 400 → upsert → `{thresholds}` + audit.
  - `evaluateAndNotify(orgId, {kitchenUnitId, date})` (internal, called after each entry POST): recompute risks via same code as GET /flow/risk; for each risk med/high → notifyOrg SURPLUS_RISK_* linkPath `/flow?kitchen={kid}&date={day}`; target compare (needs ProductionTarget effective): produced ≥1.1×target → PRODUCTION_ABOVE_TARGET; ≤0.9× → PRODUCTION_BELOW_TARGET (only when target exists); waste rule: wasteToDate ≥ medKg AND wasteToDate/producedToDate ≥ 0.15 (produced>0) → HIGH_WASTE. notifyOrg dedupes unread (type,linkPath).
  - targets.ts hook: after generate success, `notifyOrg(orgId,'TARGET_GENERATED',`Targets generated for ${kitchen.name} (${created} new, ${updated} refreshed)`,`Open the dashboard to review per-food targets.`,`/`)`.

- [ ] **Step 1: Write `surplus-risk.ts` consumers — `flow.ts`** (entries/today/risk/3 actions + internal evaluate; ~450 lines, follow food-records.ts validation/audit style).

- [ ] **Step 2: Write `notifications.ts`** (notifyOrg + 3 endpoints) **and `risk-thresholds.ts`** (2 endpoints).

- [ ] **Step 3: Mount + hook + seed** (app.ts lines, targets.ts insert, seed.ts guarded block).

- [ ] **Step 4: Typecheck** — Run: `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 3: Flow + Notifications UI, dashboard live card

**Files:**
- Create: `client/src/pages/Flow.tsx`, `client/src/pages/Notifications.tsx`
- Modify: `client/src/App.tsx` (routes `/flow`, `/notifications` wrapped `RequireAuth` + `RequireFoodDataAccess`-equivalent — reuse `RequireFoodDataAccess` for flow (staff enter data) and for notifications (all FLOW roles read own center))
- Modify: `client/src/components/Layout.tsx` (nav links "Food Flow" for FLOW_ROLES + "Notifications" for FLOW_ROLES; header bell button with live unread count from `/notifications/unread-count`, refresh on navigation — implement `useEffect` fetch in Layout, badge hidden when 0)
- Modify: `client/src/pages/Dashboard.tsx` (additive "Live Food Flow today" card: calls `GET /flow/today` for selected kitchen/date, shows produced/sold/wasted totals + entry count + link to /flow; empty state when no entries. No changes to existing dashboard logic.)
- Test: `npm run build` in `client/` + Task 5 suite (API) + manual click-path review

**Interfaces:**
- Consumes: Task 2 endpoints via `api<T>` helper (check `client/src/api.ts` exports `api` — it does per prior pages).
- Produces — `Flow.tsx` (all controls real):
  - Kitchen select + date input (default today) → refetch entries/today/risk.
  - Entry form: food select (from `/food-items`), meal select, kind select, quantity, direction+refKind shown iff kind===ADJUSTMENT, reason (required marker iff ADJUSTMENT), optional recordedAt datetime-local (empty = now) → POST → success message + refetch + triggered notifications listed.
  - Timeline: chronological list with kind badge, signed qty, author, reason, timestamp; empty state.
  - Totals table per food/meal + day totals (from `/flow/today`).
  - Risk panel per item/meal: badge (HIGH/MED/LOW gray when inestimable + reason), predicted unsold, window end, pace, explanation `<details>` expandable, limitation strings; three action buttons opening inline forms (delta+rationale / title+note / quantity) → POST → success + persisted-record summary + audit note.
  - Thresholds card (manager-only form: med/high/minSales/minSpan + Save → PUT; others read-only view of effective values).
- `Notifications.tsx`: list with type badge, title/body/time, unread highlight, Mark read/unread buttons (PATCH), working `Link to={linkPath}` deep links, unread filter toggle, empty state; email/token types never appear (server allowlist).
- Layout badge: `{unreadCount>0 && <span data-testid="notif-badge">{unreadCount}</span>}` — real fetch, no fake count.

- [ ] **Step 1: Guards check** — reuse `RequireFoodDataAccess` (FLOW_ROLES incl. STAFF, excl. NGO) for both new routes; NGO gets Blocked page (already-tested pattern).

- [ ] **Step 2: Build `Flow.tsx`.**
- [ ] **Step 3: Build `Notifications.tsx` + Layout badge/nav + Dashboard live card.**
- [ ] **Step 4: Build** — Run: `npm run build` in `client/`. Expected: exit 0.

### Task 4: Test suite (`server/accept-p5.js`)

**Files:**
- Create: `server/accept-p5.js` (delete after green; plain Node fetch, seed logins admin `Admin12345!`/staff `Staff12345!`/ngo `Ngo123456!`, unique `stamp` fixtures — same skeleton as `server/acceptance.js`)
- API must be running (`npm run dev` in server/) before `node accept-p5.js`
- Test: full suite green + rerun `server/acceptance.js` (Prompt 1 regression) green

**Interfaces:** covers contract test areas (each asserts real behavior, real DB):
```javascript
const BASE = 'http://localhost:4000/api';
async function req(path, opts = {}) { /* fetch JSON, return {status, data} */ }
async function login(email, password) { /* → token or throw */ }
// fixtures: kitchen from /organizations/mine (first kitchen); probe food P5-Probe-<stamp> via POST /food-items {name, category:'Grains', mealType:'LUNCH'}; today = new Date().toISOString().slice(0,10)
```
- F1 entry+totals: staff POST PRODUCTION 40kg, SALE 3kg@now-2h, 2kg@now-1h, 1kg@now-10min (recordedAt ISO) → GET /flow/today totals equal {produced:40, sold:6, wasted:0}; timeline length 4 chronological (recordedAt asc).
- F2 zero/negative: POST quantityKg 0 → 400; -5 → 400; totals unchanged (re-GET equals F1).
- F3 adjustments traced: ADJUSTMENT without reason → 400; `{refKind:'PRODUCTION', direction:'SUBTRACT', quantityKg:4, reason:'Spilled batch, verified'}` → 200; totals.produced === 36; timeline entry shows author staff name + reason.
- F4 risk transition: GET /flow/risk → probe row risk 'high', predictedUnsoldKg ≈ hand-computed (recompute in JS from returned sale times: pace=6/2h? use returned recordedAt values; assert |api-risk-unsold − expected| < 0.01); POST SALE 20kg now → risk drops to 'low'; explanation contains 'kg/h' and '15:00' (or configured window).
- F5 insufficient data: new food P5-Thin-<stamp> + 1 SALE → risk row estimable false + message non-empty.
- F6 actions: adjust-production `{suggestedDeltaKg:-5, rationale:'Trim batch…'}` → 200 recommendation PRODUCTION_ADJUST_SUGGESTION; totals unchanged (re-GET); special-offer `{title,note}` → INTERNAL_PROMOTION containing note; prepare-redistribution `{quantityKg:4}` → DRAFT row ngo null + notes mention NOT assessed; each response echoes audit id or `audited:true`.
- F7 notifications: unread list contains SURPLUS_RISK_HIGH for probe (from F4); PATCH read → isRead true, unread-count decremented by 1; linkPath matches `/flow?kitchen=<kid>&date=<today>`; POST /auth/forgot for fresh signup → GET /notifications contains zero EMAIL_VERIFICATION/PASSWORD_RESET rows.
- F8 seed scenario: GET /flow/risk (seed kitchen, today) — informational: log risk rows; PASS if endpoint 200 and every row has either risk+explanation or estimable:false+reason (structural honesty check, time-independent).
- F9 roles: NGO POST entry → 403; NGO GET risk → 403; staff GET risk 200.
- F10 regression: `node server/acceptance.js` passes unmodified (run from repo root: `node server/acceptance.js`).

- [ ] **Step 1: Write the script** (all 10 groups, real assertions, no mocks).

- [ ] **Step 2: Run pre-implementation (RED)** — Run: `node accept-p5.js`. Expected: FAILs on `/flow/*`, `/notifications*` 404 (setup fixtures pass — same as Prompt-4 RED pattern).

### Task 5: Verify + docs, then STOP

**Files:**
- Modify: `README.md` (append Prompt 5 section: pace formula, windows, thresholds config, actions semantics, notification rules, email exclusion)
- Delete: `server/accept-p5.js` after green

- [ ] **Step 1: Backend typecheck + build** — Run: `npx tsc --noEmit`, `npm run build` in `server/`. Expected: pass.
- [ ] **Step 2: Suite green** — Run: `node accept-p5.js` ALL PASS; rerun `node server/acceptance.js` ALL PASS.
- [ ] **Step 3: Frontend build** — Run: `npm run build` in `client/`. Expected: exit 0.
- [ ] **Step 4: Docs + cleanup** — README section; delete suite; `git status` review. STOP.

## Self-Review

- Spec coverage: entry kinds/author/timestamp/reason/server totals/timeline/Food-Flow wording → Task 2+3; pace prediction + bands + qty + window + confidence/limits + exact explanation + insufficient-data → Task 1+2+3; three prevention actions with no-auto-alter/no-payment/no-eligibility semantics + audit + feedback → Task 2+3; notification center (4 kinds + target-generated, read/unread, deep links, no email) → Task 2+3; tests (totals integrity, adjustment trace, risk transitions, insufficient-data) → Task 4; acceptance (refresh totals, seed alert, persisted actions, no dead controls) → Tasks 3–5.
- Placeholders: none — exact files, schemas, formulas, thresholds, routes, test code.
- Type consistency: `entryKind/direction/refKind/signedKg`, `linkPath`, `INAPP_TYPES`, threshold field names identical across Tasks 1–4; endpoint paths match UI calls.
