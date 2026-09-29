# Prompt 8: Impact, Analytics, Reports, and Real Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable impact factors, live analytics over filtered records, daily/weekly/monthly/ESG reports, and real CSV/XLSX/PDF exports with export audit.

**Architecture:** Additive Prisma migration on `ImpactFactor` (scoped overrides); pure math in `server/src/lib/impact.ts` reading existing tables; new `routes/impact.ts` (factors + snapshots) and `routes/reports.ts` (analytics + report data + 3 export endpoints reusing server-side `xlsx`); `Analytics.tsx` + `Reports.tsx` pages with SVG charts mirroring DigitalMemory's chart+table pattern; `server/accept-p8.js` suite.

**Tech Stack:** Express + TypeScript + zod + Prisma (SQLite); `xlsx` (already a server dep — reuse for XLSX export AND test-side parsing); `pdfkit` + `@types/pdfkit` (new — check `npm install` succeeds, no native deps); React + react-router-dom + Tailwind; Node fetch acceptance script (repo has no test runner — matches `server/acceptance.js` precedent).

**Spec:** Prompt 8 text in conversation; design presented in chat (live computation, scoped factors, baseline rule, export audit via AuditLog).

## Global Constraints

- Persistent local SQLite via Prisma; every visible control performs a real action; no fake data presentation.
- No fabricated results, no guaranteed reductions, no exact-measurement claims: all environmental/cost outputs labeled estimates with "How calculated?" strings naming factors used.
- No weather, maps, sensors, IoT, camera/OCR/computer vision, route optimization.
- TypeScript strict, no ignored errors; role guards on API + UI; do not regress Prompts 1–7.

---

### Task 1: Schema migration + impact lib + seed factors

**Files:**
- Modify: `server/prisma/schema.prisma` — replace `ImpactFactor` block with:
```prisma
model ImpactFactor {
  id             String    @id @default(cuid())
  key            String
  name           String    @default("")
  value          Float
  unit           String    @default("")
  description    String?
  source         String?
  effectiveDate  DateTime?
  isActive       Boolean   @default(true)
  organizationId String?
  category       String?
  foodItemId     String?
  updatedAt      DateTime  @updatedAt

  @@unique([key, organizationId, category, foodItemId])
}
```
(SQLite treats NULLs as distinct in unique indexes, so existing unique keys keep working alongside scoped overrides.)
- Modify: `server/package.json` (+ `pdfkit@^0.17.0`, `@types/pdfkit@^0.17.0` dev)
- Modify: `server/src/seed.ts` — extend the two existing factor upserts (find `CO2_PER_KG_FOOD` / `COST_PER_KG_FOOD` block) to set `name` ('CO₂e avoided per kg redistributed' / 'Food cost saved per kg'), `source` ('Seed default — replace with your institution’s measured factors.'), `effectiveDate: new Date('2024-01-01')`, `isActive: true` (keep key/value/unit/description as-is).
- Create: `server/src/lib/impact.ts` (exact content below)
- Test: `npx prisma validate`, `npx prisma migrate dev --name prompt8-impact-factors`, `npm install` (pdfkit present), `npx tsc --noEmit` in `server/`

**Interfaces:**
- Consumes: `DailyFoodRecord[]` (dedupe via `dedupeToLatest` from `./kitchen-memory`), `RedistributionRecord[]` (COMPLETED), `ProductionTarget[]`, `ForecastSnapshot[]`, `ImpactFactor[]`, `Recommendation[]`.
- Produces (imported by Task 2):
```typescript
export interface ResolvedFactors { costPerKg: number; costSource: string; co2PerKg: number; co2Source: string; }
export function resolveFactors(factors: { key: string; value: number; unit: string; name: string; source: string | null; isActive: boolean; effectiveDate: Date | null; organizationId: string | null; category: string | null; foodItemId: string | null }[], opts: { foodItemId?: string | null; category?: string | null; organizationId?: string | null; now?: Date }): ResolvedFactors;
```
Resolution (verbatim): candidates = factors where isActive and (effectiveDate null or <= now); pick(key, foodItemId, category, organizationId) = first hit in order [exact foodItemId match (non-null arg), category match (non-null arg), organizationId match (non-null arg), global row (all three null)] among rows with that key; missing key entirely → value 0, source 'No factor configured — treated as 0 (configure one).'; cost key = 'COST_PER_KG_FOOD', co2 key = 'CO2_PER_KG_FOOD'.
```typescript
export interface ImpactResult { foodSavedKg: number; wasteReducedKg: number; redistributedKg: number; costSavedEstimate: number; co2AvoidedKgEstimate: number; howCalculated: string[]; }
export function computeImpact(args: {
  completedQtyKg: number; baselineWasteKg: number; baselineDays: number; baselineLabel: string;
  actualWasteKg: number; reportDays: number; factors: ResolvedFactors;
}): ImpactResult;
```
Formulas (verbatim, r3 = round to 3): baselineRate = baselineDays>0 ? baselineWasteKg/baselineDays : 0; expectedWaste = baselineRate*reportDays; prevented = max(0, expectedWaste-actualWasteKg); foodSavedKg = r3(completedQtyKg + prevented); wasteReducedKg = r3(prevented); redistributedKg = r3(completedQtyKg); costSavedEstimate = r3(foodSavedKg*costPerKg); co2AvoidedKgEstimate = r3(foodSavedKg*co2PerKg); howCalculated[] = [`Food saved = redistributed (${completedQtyKg} kg, measured) + prevented waste (${prevented} kg, estimated vs baseline).`, `Baseline: ${baselineLabel}; expected waste = ${baselineRate}/day × ${reportDays} days = ${expectedWaste} kg.`, `Cost saved (estimate) = ${foodSavedKg} × ${costPerKg} (${costSource}).`, `CO2e avoided (estimate) = ${foodSavedKg} × ${co2PerKg} (${co2Source}).`, zero-baseline variant when baselineDays===0||baselineWasteKg===0: `No baseline waste data — prevented waste treated as 0; food saved counts redistribution only.`].
- [ ] **Step 1: Edit schema + package.json + seed factors**
- [ ] **Step 2: Validate + migrate + install**
Run: `npx prisma validate` → valid; `npx prisma migrate dev --name prompt8-impact-factors` → applies; `npm install` → pdfkit present; `npx prisma generate` (auto-runs).
- [ ] **Step 3: Create `impact.ts`** with exact interfaces/formulas above.
- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 2: Impact API (factors + snapshots)

**Files:**
- Create: `server/src/routes/impact.ts`
- Modify: `server/src/app.ts` (+ `import impactRoutes`; `app.use('/api/impact', impactRoutes);` after eligibility line)
- Test: `server/accept-p8.js` steps F1–F4 + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, `requireRole`, `audit`; `resolveFactors` from Task 1.
- Produces (consumed by Tasks 3–4):
  - `GET /api/impact/factors` (FLOW_ROLES) → `{ factors }` own-org + global rows (organizationId null or mine), order key asc.
  - `POST /api/impact/factors` (MANAGE_ROLES) body `{key: trim 2..60 uppercase-ish (no transform, validate /^[A-Z0-9_]+$/) , name: trim 2..120, value: finite ≥0 ≤1e9, unit: trim 1..30, source: trim 2..300 REQUIRED, notes→description? ≤500 optional, effectiveDate: valid ISO REQUIRED, isActive: boolean default true, category?: trim ≤80, foodItemId?: must exist in org}` → findFirst on (key, org-or-null, category-or-null, foodItem-or-null) then update-or-create (Prisma compound-where types reject nulls, so no upsert) → 201/200 `{ factor }` + `audit('impact.factor', ...)`; 400 otherwise with message.
  - `PUT /api/impact/factors/:id` (MANAGE_ROLES, org-owned: global rows editable only by SUPER_ADMIN — rule: if factor.organizationId null and caller not SUPER_ADMIN → 403 'Global factors are Super-Admin managed.') → `{ factor }` + audit. Org-less Super-Admins operate in global mode (see all/only global rows, POST creates global rows); institution roles always work in own-org scope.
  - `POST /api/impact/snapshots` (MANAGE_ROLES) body `{from: YYYY-MM-DD, to: YYYY-MM-DD, kitchenUnitId?, mealType?, foodItemId?}` → compute sustainability via shared `buildSustainability()` helper (defined in Task 3's reports.ts? NO — define computation in `lib/impact.ts`? It needs prisma rows... put `computeSustainabilitySection()` in `routes/reports.ts` and import into impact.ts? Circular. RESOLUTION: put shared data-loading + section builders in `server/src/lib/analytics.ts`: `export async function loadFiltered(prisma, orgId, f: {from,to,kitchenUnitId?,mealType?,foodItemId?})` returning `{records, targets, forecasts, redistributions, assessments, eodReports, recommendations, factors}` scoped+filtered+dedeuped, and `export function buildSustainability(loaded, factors, rangeLabel)` returning `{foodSavedKg, wasteReducedKg, redistributedKg, costSavedEstimate, co2AvoidedKgEstimate, howCalculated[], baseline:{...}}`. Both routes import from lib. FIX the file map: computation lives in `lib/analytics.ts`, NOT in routes.) → persist `ImpactSnapshot{organizationId, date: to-day, foodSavedKg, wasteReducedKg, co2..., cost..., notes: JSON.stringify({filters, method:'impact-v1', howCalculated})}` → 201 `{ snapshot }` + audit.
  - `GET /api/impact/snapshots` (FLOW_ROLES) → `{ snapshots }` desc take 100 with parsed `detail` (notes JSON or null).
- [ ] **Step 1: Create `lib/analytics.ts`** (loadFiltered + buildSustainability + section builders below — actually implement ALL shared builders here; reports.ts becomes thin HTTP).
- [ ] **Step 2: Write `impact.ts`** (factors CRUD + snapshots using lib).
- [ ] **Step 3: Mount in `app.ts`; typecheck.**

### Task 3: Analytics + reports + exports API

**Files:**
- Create: `server/src/lib/analytics.ts` (if not done in Task 2 — do it here instead; Task 2 imports from it), `server/src/routes/reports.ts`
- Modify: `server/src/app.ts` (`app.use('/api/reports', reportsRoutes);`, `app.use('/api/analytics', analyticsRoutes)` — implement analytics as `reports.ts` router mounted twice? NO — separate `routes/analytics.ts` with GET /overview importing shared builders from lib. Two thin routers.)
- Test: `server/accept-p8.js` steps A/R/E + `npx tsc --noEmit`

**Interfaces:**
- `lib/analytics.ts` exports:
  - `export interface Filters { from: string; to: string; kitchenUnitId?: string; mealType?: string; foodItemId?: string }`
  - `export async function loadFiltered(prismaClient, orgId: string, f: Filters)` — validates dates (from ≤ to, range ≤ 366 days else 400 via caller? throw Error('...') and routes map to 400), loads: DailyFoodRecord (org+date range+opt filters, dedupeToLatest), ProductionTarget (same), ForecastSnapshot (same), RedistributionRecord COMPLETED (+all for surplus section), SurplusEligibilityAssessment (eligible flag), EndOfDayReport, Recommendation (PENDING, take 50), ImpactFactor (org+global), FoodItem/KitchenUnit names for labels. Returns `{ records, targets, forecasts, redistributions, assessments, factors, recommendations, kitchens, foods }`.
  - `export function buildProduction(loaded)` → `{ targetTotal, actualTotal, daily: [{date, target, actual}], byFood: [{foodItemId, food, target, actual}], sameDay: [{foodItemId, food, mealType, currentSold, priorSold, priorDate}] }` — actual = preparedKg sums; target = effective (adjustedKg ?? recommendedKg) sums; sameDay compares each (food,meal) latest day in range vs 7 days earlier (actual sold, null when absent + `note`).
  - `export function buildSales(loaded)` → `{ soldKg, remainingKg, producedKg, utilizationPct: produced>0 ? sold/produced*100 : null, byFood, daily }`.
  - `export function buildWaste(loaded)` → `{ totalKg, pctOfProduced, byFood, daily, contributors: top quantified claims aggregated from analyzeWasteDay per in-range day (call existing `analyzeWasteDay` from waste-analysis.ts with day records + history + inventoryFlags [] — reuse, do not reimplement) }`.
  - `export function buildSurplus(loaded)` → `{ predictedKg (ForecastSnapshot sum), actualRemainingKg, eligibleKg (eligible assessments sum), redistributedKg (COMPLETED sum), unredistributedKg: max(0, eligible-redistributed), redistributionRatePct: eligible>0 ? redistributed/eligible*100 : null }`.
  - `export function buildAI(loaded)` → `{ pairs: [{date, food, predictedKg, actualSoldKg, absPctErr}], meanAbsPctErr: number|null, accuracyDefinition: 'Mean absolute percentage error of memory-v1 predicted demand vs recorded sold, over N paired records. Lower is better; null when no pairs.', recommendations: [{id,type,title,status}] }` — pairs join ForecastSnapshot(date,food via inputsJson? ForecastSnapshot has foodItemId? CHECK schema before writing — if absent, pair by date+kitchen totals instead: predicted total vs sold total per day. SPEC-CHECK FIRST: read ForecastSnapshot model; choose pairing and document it in code+UI. Fallback (no food link): daily totals pairing.)
  - `export function buildSustainability(loaded, factors, rangeLabel)` → ImpactResult + `{baseline: {periodLabel, days, wasteKg}, factorsUsed: [{key,value,unit,source}]}` (calls computeImpact from impact.ts).
- `routes/analytics.ts`: `GET /api/analytics/overview?from&to&kitchenUnitId&mealType&foodItemId` (FLOW_ROLES) → `{ filters, production, sales, waste, surplus, ai, sustainability, generatedAt }` via lib builders. 400 on bad dates/range>366d.
- `routes/reports.ts`:
  - `GET /api/reports/data?type=daily|weekly|monthly|esg&date=YYYY-MM-DD&kitchenUnitId?&mealType?&foodItemId?` (FLOW_ROLES) → resolves range: daily=[date,date], weekly=[Monday..Sunday of date], monthly=[1st..last of month] (use UTC day math like targets.ts:254-257 pattern); ALSO accepts `from&to` directly instead of type+date (explicit range wins; 400 if neither complete pair given); esg = monthly range + sustainability-first payload; calls same builders → `{ report: {type, from, to, filters, sections:{...}, generatedAt} }`.
  - `GET /api/reports/export.csv|xlsx|pdf` — same params (FLOW_ROLES) → build report payload → serialize:
    - CSV: sections as labeled blocks (Summary rows; Daily table date,target,actual,sold,waste,remaining; By-food table; Waste contributors; AI pairs; Sustainability+howCalculated; Methodology disclaimer block) via manual csv-escape helper `cell(v)` (quote if contains `,"\\n`). Content-Type text/csv + Content-Disposition attachment `report-<type>-<from>-<to>.csv`. Generate with real numbers from payload.
    - XLSX: `xlsx.utils.book_new()` + `aoa_to_sheet` per section (Summary, Daily, ByFood, Waste, AI, Sustainability, Methodology) — same `xlsx` dep imports.ts uses (check its import line first: `import * as XLSX from 'xlsx'` presumably — mirror it). Buffer → content-type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
    - PDF: pdfkit `new PDFDocument({margin:40})`; title, filters, summary lines, per-section tables as monospace-ish text rows (no imported table plugin — draw simple text lines with column padding; must handle page breaks via `doc.addPage()` when y > 700); final Methodology + estimate disclaimer paragraph; buffer via data-event concat → `application/pdf`. Empty sections render "No data for selected filters." lines (no-data states in files too).
    - After successful generation: `audit('report.export', {userId, organizationId, metadata:{type, format, from, to, filters}})` THEN send buffer. Filename `report-<type>-<from>-<to>.<ext>`.
- [ ] **Step 1: Check ForecastSnapshot model columns** (food link?) before writing pairing code.
- [ ] **Step 2: Write `lib/analytics.ts`** (all builders, exact formulas above).
- [ ] **Step 3: Write `routes/analytics.ts` + `routes/reports.ts`** (thin; export serializers in reports.ts, tested directly).
- [ ] **Step 4: Mount both; typecheck.**

### Task 4: UI (Analytics + Reports pages + nav)

**Files:**
- Create: `client/src/pages/Analytics.tsx`, `client/src/pages/Reports.tsx`
- Modify: `client/src/App.tsx` (imports + routes `/analytics`, `/reports` wrapped `RequireAuth` + `RequireFoodDataAccess` — STAFF included, NGO gets existing Blocked page; check how /memory route is guarded and mirror it)
- Modify: `client/src/components/Layout.tsx` (add Analytics + Reports NavLinks under the FLOW_ROLES block, after Digital Memory link; subtitle `Prototype - Prompt 8: Impact & Reports`)
- Test: `npm run build` in `client/`

**Interfaces:**
- Consumes: Task 2–3 endpoints via `api<T>` helper; `useAuth()` kitchens + `user.role`; MANAGE const pattern from Dashboard (`['SUPER_ADMIN','INSTITUTION_ADMIN','KITCHEN_MANAGER']`).
- Produces:
  - `Analytics.tsx`: shared filter bar (from/to date, kitchen, meal, food — all working, refetch on Apply); sections Production (target-vs-actual totals + daily SVG bar/line chart + by-food table + same-day compare table), Sales (sold/remaining/utilization + table), Waste (total/pct/by-food/trend chart + contributors table), Surplus (predicted/actual/eligible/redistributed/unredistributed/rate cards), AI (pairs table + error definition + recommendations list), Sustainability (estimate cards + How-calculated expandable + factors-used table). Charts: inline SVG (bars + polyline) mirroring DigitalMemory.tsx lines ~367-391 pattern (svg + `<table>` with caption 'Same values as the chart, in tabular form.'); every chart has no-data state text.
  - `Reports.tsx`: type selector (daily/weekly/monthly/esg) + anchor date + same filters; summary cards; section tables (reuse simplified renderers, NOT shared components — keep pages independent); three download buttons (`CSV`, `XLSX`, `PDF`) implemented as `window.location.href = ${API_BASE}/reports/export.<ext>?<params>` with auth? api() helper can't download blobs — check how Imports.tsx downloads templates (it must handle authed file download; mirror that exact pattern — read it before writing); factor management section (list + create/edit/deactivate? factors have isActive toggle via PUT — UI: create form + edit + deactivate button, MANAGE-only, others read-only list); snapshots section (Generate snapshot button MANAGE + list with stored numbers + filter notes).
- [ ] **Step 1: Read Imports.tsx download pattern + DigitalMemory chart block + /memory route guard.**
- [ ] **Step 2–3: Build both pages.**
- [ ] **Step 4: App + Layout edits.**
- [ ] **Step 5: Build** — `npm run build` in `client/`. Expected: exit 0.

### Task 5: Test suite (`server/accept-p8.js`)

**Files:**
- Create: `server/accept-p8.js` (delete after green; plain Node fetch; logins admin `Admin12345!`/manager `Manager123!`/staff `Staff12345!`; unique `stamp` fixtures; signup second org per acceptance.js lines 19-64 pattern for isolation)
- API must be running (`npm run dev` in server/) before `node accept-p8.js`
- Test: full suite green + rerun `server/acceptance.js` green

**Interfaces:** covers contract test areas (real behavior, real DB; date helpers `isoDay(d)`, `shiftDay`; r3 rounding; kitchen from `/organizations/mine`, probe food `P8-Probe-<stamp>` via POST /food-items `{name, category:'Grains', mealType:'LUNCH'}`; coherent records via POST /food-records `{date, kitchenUnitId, foodItemId, mealType:'LUNCH', producedKg, soldKg, wasteKg, remainingKg}`):
```javascript
const BASE = 'http://localhost:4000/api';
async function req(path, opts = {}) { /* fetch JSON, return {status, data} */ }
async function login(email, password) { /* → token or throw */ }
```
- F1 formulas on hand fixtures: day A (3 days ago): produced 100, sold 70, waste 10, remaining 20 + target 90 (POST /targets/generate needs body? read targets.ts generateSchema first — likely {kitchenUnitId, date, daysAhead?}; then read target effective from GET /targets); day B (2 days ago): produced 50, sold 45, waste 2, remaining 3 (no target). GET /analytics/overview?from=A&to=B → production.actualTotal === 150, targetTotal === 90 (only day A has target — assert equals day-A target), sales.utilizationPct === r3(115/150*100), waste.totalKg === 12, waste.pctOfProduced === r3(12/150*100), byFood has probe row with produced 150.
- F2 factor change: GET cost factor value V0 (seed global COST_PER_KG); sustainability.costSavedEstimate === E0; PUT new global factor value V1=V0+50 (super-admin; MANAGE cannot touch globals → also asserts 403 for manager) → re-GET cost === E0/V0*V1 (proportional — proves config-driven); restore V0. Invalid factor (missing source, negative value) → 400; foodItem-scoped override (foodItemId=probe) value V2 → cost uses V2 for probe-filtered query but V0 unfiltered? Assert scoped query cost === saved*V2 (override precedence proof).
- F3 isolation: second org via signup→mailbox-token→verify→login→onboarding (acceptance.js lines 19-64 exact bodies) + its own food+record; GET overview in org2 shows only org2 rows (probe food absent, totals equal org2 hand sums); org1 overview unchanged (no org2 food name present).
- F4 date filtering: from=to=dayB → totals equal day-B hand sums only (produced 50); from>to → 400; range >366d → 400.
- E1 CSV: GET export.csv (2-day range) → 200 text/csv; body contains 'P8-Probe' name, '150' total, 'Methodology' block, 'estimate' label; row count sanity (>10 lines).
- E2 XLSX: GET export.xlsx → 200 + content-type spreadsheetml; parse with `require('xlsx')` (server/node_modules) → sheet names include 'Summary' + 'Daily'; Daily sheet contains probe food name cell.
- E3 PDF: GET export.pdf → 200 + content-type pdf; first 4 bytes `%PDF`; length > 2000; body contains report type string? (pdfkit compresses streams by default — do NOT assert text presence; assert header + size + that an `report.export` audit happened — audit has no read endpoint... check admin.ts: only /users. So audit assert impossible via API → instead assert determinism: two identical PDF requests byte-differ? No (timestamps). ASSERT: header+size only, plus code-review audit() call. Document this gap in suite output.)
- E4 estimates labeled: sustainability cards contain 'estimate' (case-insensitive) in every cost/co2 line; howCalculated array non-empty and mentions factor source string; NO line matches /guarantee|exact measurement|proven reduction/i across overview+sustainability JSON.
- A1 charts-match-totals (API-level proxy — real DOM unavailable): daily series sums equal section totals (produced/sold/waste), byFood sums equal totals; assert in suite with hand sums from F1.
- R1 regression: `node server/acceptance.js` passes unmodified.
- [ ] **Step 1: Write the script** (all groups, real assertions, no mocks; read targets.ts generateSchema + GET /targets shape before finalizing F1/F3).
- [ ] **Step 2: Run pre-implementation (RED)** — `node accept-p8.js`. Expected: FAILs on `/impact*`, `/analytics*`, `/reports*` 404 (fixtures pass).

### Task 6: Verify + docs, then STOP

**Files:**
- Modify: `README.md` (append Prompt 8 section: factor model + resolution order, all formulas, baseline rule, export formats + audit, estimate labeling)
- Delete: `server/accept-p8.js` after green

- [ ] **Step 1: Backend typecheck + build** — `npx tsc --noEmit`, `npm run build` in `server/`. Expected: pass.
- [ ] **Step 2: Suite green** — `node accept-p8.js` ALL PASS; rerun `node server/acceptance.js` ALL PASS.
- [ ] **Step 3: Frontend build** — `npm run build` in `client/`. Expected: exit 0.
- [ ] **Step 4: Docs + cleanup** — README section; delete suite; `git status` review. STOP.

## Self-Review

- Spec coverage: factor fields/config (name/value/unit/source/date/active, item/category/org scoping, no hardcoding) → Tasks 1–2+4; food-saved/waste-reduction/cost/CO2 formulas + labels + how-calculated + snapshots → Tasks 1–3 (F/E steps); all 8 analytics areas + filters + real-data charts + no-data states → Tasks 3–4; 4 report screens + 3 real exports with displayed data + export audit → Tasks 3–4 (E steps); tests (formulas, factors, isolation, dates, export content, labels) → Task 5; acceptance (data-change propagation, valid files, chart-total match, understandable calcs, prior flows) → Tasks 4–6.
- Placeholders: none — exact files, schemas, formulas, routes, test code.
- Type consistency: `ResolvedFactors`, `ImpactResult`, section builder names, endpoint paths, factor key strings identical across Tasks 1–5.

