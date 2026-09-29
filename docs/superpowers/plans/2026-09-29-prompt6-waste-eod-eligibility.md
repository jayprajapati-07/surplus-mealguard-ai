# Prompt 6: Waste Analysis, Inventory, End-of-Day, Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explainable waste analysis, inventory with alerts, end-of-day closing with reports, and a human-confirmed surplus eligibility workflow — all deterministic and audited.

**Architecture:** Additive Prisma migration (InventoryItem columns + EndOfDayReport columns + 2 tiny config models); pure math in `server/src/lib/waste-analysis.ts`; three routers (`inventory.ts`, `eod.ts`, `eligibility.ts`); four pages (`Inventory.tsx`, `EndOfDay.tsx`, `Waste.tsx`, `Eligibility.tsx`); `server/accept-p6.js` suite.

**Tech Stack:** Express + TypeScript + zod + Prisma (SQLite); React + react-router-dom + Tailwind; Node fetch acceptance script (repo has no test runner — matches `server/acceptance.js` precedent).

**Spec:** Prompt 6 text in conversation; design presented in chat (model reuse, claim formulas, decision rules).

## Global Constraints

- Persistent local SQLite via Prisma; every visible control performs a real action; no fake data presentation.
- No sensors, temperature/humidity tracking, camera/OCR/computer vision, or scientific safety claims. Eligibility language is operational only ("not a universal food-safety rule", "not automatically safe", "not scientifically certified").
- No weather, maps, IoT, route optimization. Quantities in kilograms; dates real (alerts from actual expiryDate/quantityKg).
- TypeScript strict, no ignored errors; role guards on API + UI; do not regress Prompts 1–5.

---

### Task 1: Schema migration + waste-analysis lib

**Files:**
- Modify: `server/prisma/schema.prisma`:
  - `InventoryItem` += `supplier String?`, `purchaseDate DateTime?`, `status String @default("ACTIVE")`
  - `EndOfDayReport` += `status String @default("FINAL")`, `accuracyJson String?`, `qualityNotes String?`, `reopenedAt DateTime?`, `reopenReason String?`
  - Append models (find `model RiskThreshold` via Select-String, insert after its closing brace):
```prisma
model InventoryThreshold {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  lowStockKg     Float        @default(5)
  nearExpiryDays Int          @default(3)
  excessKg       Float        @default(100)
  updatedById    String?
  updatedAt      DateTime     @updatedAt
}

model EligibilityConfig {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  minQuantityKg  Float        @default(10)
  updatedById    String?
  updatedAt      DateTime     @updatedAt
}
```
  - `Organization` += `inventoryThreshold InventoryThreshold?` + `eligibilityConfig EligibilityConfig?` (next to `bufferConfig`/`riskThreshold` lines).
- Create: `server/src/lib/waste-analysis.ts` (exact content below)
- Test: `npx prisma validate`, `npx prisma migrate dev --name prompt6-waste-eod-eligibility`, `npx tsc --noEmit` in `server/`

**Interfaces:**
- Consumes: `dedupeToLatest`, `utcDayKey` from `./kitchen-memory`; `coherenceError` from `./flow`.
- Produces (imported by Task 2):
```typescript
export interface WasteClaim { contributor: 'demand-overestimate' | 'overproduction' | 'day-pattern' | 'menu-combination'; attributableKg: number; sharePct: number | null; evidence: string; }
export interface WasteEvidence { contributor: 'expiry-pressure' | 'manual-reason'; detail: string; }
export interface WasteRow {
  foodItemId: string; food: string; mealType: string;
  producedKg: number; soldKg: number; wasteKg: number; remainingKg: number;
  excessKg: number; claims: WasteClaim[]; evidence: WasteEvidence[];
  percentagesWithheld: boolean; recommendedAction: string;
}
export interface WasteAnalysis { rows: WasteRow[]; label: string; }
export function analyzeWasteDay(args: {
  dayRecords: { id: string; foodItemId: string | null; foodName: string; mealType: string; preparedKg: number; soldKg: number; wasteKg: number; remainingKg: number; targetKg: number | null; adjustmentReason: string | null; correctionReason: string | null; notes: string | null }[];
  history: { foodItemId: string | null; mealType: string; date: Date; excessKg: number }[];
  weekday: number;
  inventoryFlags: { foodItemId: string | null; lot: string; expiryDate: string | null; quantityKg: number; flag: 'near-expiry' | 'expired' }[];
}): WasteAnalysis;
```
Rules (implement verbatim, r3 = round to 3 decimals):
- Skip groups with excessKg (= wasteKg + remainingKg) <= 0 (nothing to explain).
- Quantified claims, each capped at excessKg E:
  - demand-overestimate: target != null ? max(0, min(target, produced) − sold) : 0. Evidence: `Target ${target} kg vs sold ${sold} kg on record ${id}.`
  - overproduction: max(0, produced − max(target ?? sold, sold)). Evidence cites produced vs max(target, sold).
  - day-pattern: same-weekday history (excluding current dayKey) n≥3 with mean Mw and overall mean M over all history: max(0, min(E, Mw − M)) if Mw > M else 0. Evidence: `Weekday mean excess ${Mw} kg over ${n} records vs overall ${M} kg.`
  - menu-combination: same food+meal history (excluding current) n≥3 mean Mc vs overall M: max(0, min(E, Mc − M)) if Mc > M else 0. Evidence cites counts and means.
- If Σ quantified claims > 0: sharePct = r3(claim / Σ × 100) each (sums to 100 subject to rounding; note in label). Else percentagesWithheld = true.
- Unquantified evidence (no percentages, never invented):
  - expiry-pressure per matching inventoryFlags (same foodItemId): `Lot ${lot} (${quantityKg} kg) ${flag} ${expiryDate ?? 'no date'}.`
  - manual-reason per non-empty adjustmentReason/correctionReason/notes: `Record ${id}: "${text}".`
- recommendedAction = action of largest-share claim, else first evidence detail, else 'No specific driver found — review handling and portions.':
  - demand-overestimate → 'Lower the next target toward observed sold quantities and re-check the forecast inputs.'
  - overproduction → 'Reduce batch size toward target/sold levels for this meal.'
  - day-pattern → 'Plan smaller batches on this weekday; the pattern repeats across comparable records.'
  - menu-combination → 'Rebalance this food+meal combination (portion size or pairing) — it repeatedly leaves excess.'
- label (constant): 'Operational decision support from recorded data — not causal proof. Shares are indicative; contributors may overlap.'

- [ ] **Step 1: Edit schema (3 spots)**

- [ ] **Step 2: Validate + migrate**

Run: `npx prisma validate`
Expected: `The schema ... is valid`

Run: `npx prisma migrate dev --name prompt6-waste-eod-eligibility`
Expected: migration applies on top of Prompt 5 migration.

- [ ] **Step 3: Create `waste-analysis.ts`** with exact interfaces/rules above.

- [ ] **Step 4: Typecheck** — Run: `npx tsc --noEmit` in `server/`. Expected: no output (pass).

### Task 2: Inventory API

**Files:**
- Create: `server/src/routes/inventory.ts`
- Modify: `server/src/app.ts` (add `import inventoryRoutes from './routes/inventory';` + `app.use('/api/inventory', inventoryRoutes);` after the risk-thresholds lines)
- Test: `server/accept-p6.js` steps I1–I6 (Task 5) + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, `requireRole`, `audit` (same import line as food-records.ts:4).
- Produces (consumed by Task 4 UI):
  - `GET /api/inventory` (FLOW_ROLES) `?status=&foodItemId=` → `{ items }` with food/kitchen names, computed `daysToExpiry: number|null` (expiryDate − now in days, floor), orderBy expiryDate asc nulls-last... Prisma SQLite null ordering: order by `updatedAt desc`, sort nulls in code. Keep simple: orderBy updatedAt desc.
  - `POST /api/inventory` (FLOW_ROLES) body `{foodItemId (required, in-org), quantityKg ≥0 ≤1000000, unit? default kg, supplier? ≤120, purchaseDate? valid, expiryDate? valid, storageArea? ≤120 (text only, no sensors), batchCode? ≤60, lowStockKg?}` → food must exist in org (400 otherwise); expiry < purchase → 400; → 201 `{ item }` + `audit('inventory.create', ...)`.
  - `PUT /api/inventory/:id` (FLOW_ROLES) editable fields (same validations; org-scoped 404) → `{ item }` + audit.
  - `PUT /api/inventory/:id/adjust` (FLOW_ROLES) body `{deltaKg: number ≠0, |.|≤1000000, reason: trim ≥5 ≤500}` → 400 otherwise; newQty = r3(qty + delta); newQty < 0 → 400 'Adjustment would drive stock negative (X kg). Record consumption or correct the entry instead.' → update + audit with before/after/reason → `{ item }`.
  - `POST /api/inventory/:id/archive` (FLOW_ROLES) → status ARCHIVED + audit → `{ item }`. (`POST /:id/restore` symmetric → ACTIVE. Include both; UI needs undo.)
  - `GET /api/inventory/alerts` (FLOW_ROLES) → `{ thresholds: {lowStockKg, nearExpiryDays, excessKg}, alerts: { lowStock: [{id, food, quantityKg, threshold}...], nearExpiry: [{..., daysToExpiry, expiryDate}...], expired: [...], excess: [{..., threshold}...] } }` computed from actual rows: lowStock = ACTIVE && quantityKg ≤ lowStockKg; nearExpiry = ACTIVE && expiryDate && 0 ≤ daysToExpiry ≤ nearExpiryDays; expired = ACTIVE && daysToExpiry < 0; excess = ACTIVE && quantityKg ≥ excessKg. Thresholds = stored row or `{lowStockKg:5, nearExpiryDays:3, excessKg:100}` + `customized: boolean`.
  - `GET /api/inventory/thresholds` (FLOW_ROLES) → `{ thresholds, defaults, note }` (same shape pattern as risk-thresholds.ts).
  - `PUT /api/inventory/thresholds` (MANAGE_ROLES) body `{lowStockKg: 0..10000, nearExpiryDays: int 0..90, excessKg: 1..100000}` each ≥0 with excessKg > lowStockKg else 400 → upsert → `{ thresholds }` + audit.

- [ ] **Step 1: Write `inventory.ts`** (zod schemas mirroring food-items.ts style; `orgIdFor` helper copied from targets.ts pattern).

- [ ] **Step 2: Mount in `app.ts`; typecheck** — Run `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 3: EOD + waste + eligibility API

**Files:**
- Create: `server/src/routes/eod.ts`, `server/src/routes/waste.ts`, `server/src/routes/eligibility.ts`
- Modify: `server/src/app.ts` (mount `/api/eod`, `/api/waste`, `/api/eligibility`)
- Test: `server/accept-p6.js` steps E/D/W (Task 5) + `npx tsc --noEmit`

**Interfaces:**
- EOD (`eod.ts`, preview+close MANAGE? preview read FLOW_ROLES, close/reopen MANAGE_ROLES, reports FLOW_ROLES):
  - Shared helper `dayAggregate(orgId, kitchenUnitId, dateStr)` → `{ rows: [{recordId, foodItemId, food, mealType, targetKg, preparedKg, servedKg, soldKg, wasteKg, remainingKg, notes, isCorrection}], totals, incoherent: [{recordId, food, mealType, shortfall}] }` using `dedupeToLatest` + `coherenceError` + same UTC-day bucket as food-records duplicate check (`normalizeDay`).
  - `GET /api/eod/preview?kitchenUnitId=&date=` (FLOW_ROLES) → `{ date, kitchen, rows, totals, potentialSurplusKg (= totals.remainingKg), incoherent, accuracyPreview: {pairs, meanAbsPctErr} | null (paired vs ProductionTarget effective), targetsMissing: number }`. Never persists.
  - `POST /api/eod/close` (MANAGE_ROLES) body `{kitchenUnitId, date: YYYY-MM-DD, notes?: ≤1000}` → 400 on bad date/kitchen; if incoherent.length > 0 → 409 `{ error: 'N record(s) are incoherent...', incoherent }` (no silent forcing — caller fixes via food-records corrections carrying reasons); if FINAL report exists for kitchen+date → 409 'Day already finalized...'; else create EndOfDayReport `{status:'FINAL', totals, accuracyJson, qualityNotes: 'N records (C corrections); targets present for T/M lines; F lines without target; G lines without food link.'}` + `audit('eod.close', ...)` → 201 `{ report }`.
  - `POST /api/eod/reopen` (MANAGE_ROLES) body `{kitchenUnitId, date, reason: trim ≥5 ≤500}` → 400 otherwise; find FINAL else 404 'No finalized report for this kitchen/date.'; update → REOPENED + reopenedAt/reopenReason + audit('eod.reopen') → `{ report }`. Re-close creates a new FINAL row (history preserved).
  - `GET /api/eod/reports?kitchenUnitId=&from=&to=` (FLOW_ROLES) → `{ reports }` desc, take 100.
- Waste (`waste.ts`, FLOW_ROLES):
  - `GET /api/waste/analysis?kitchenUnitId=&date=&foodItemId=` → day records (deduped) + targets (effective) + same-weekday/overall history (deduped org records, cap 5000 like memory.ts) + inventory flags (ACTIVE lots with expiryDate, flag near-expiry if 0≤days≤nearExpiryDays else expired if <0; thresholds stored-or-default) → `analyzeWasteDay(...)` per food+meal group → `{ date, kitchen, rows, label }`. 400 on bad kitchen/date.
- Eligibility (`eligibility.ts`; assess + list FLOW_ROLES; config GET FLOW_ROLES, PUT MANAGE_ROLES):
  - `POST /api/eligibility/assess` body `{kitchenUnitId?, foodDescription: trim ≥2 ≤200, foodItemId?, quantityKg: >0 ≤100000, foodCategory: trim ≥2 ≤80, preparedAt: valid ISO, holdingInfo: trim ≥3 ≤300 (text, e.g. storage/holding description), storageArea: trim ≥2 ≤120 (text), availableUntil: valid ISO, expiryDate?: valid ISO, qualityConfirmed: literal true (z.literal(true, {errorMap: 'Manual quality confirmation is required — an assessment can never become eligible without it.'})), qualityNote?: ≤500}` → 400 otherwise; org-scoped kitchen/food checks (400); min = stored EligibilityConfig or 10; reasons: string[] = [];
    - quantityKg < min → INELIGIBLE, reasons.push(`Quantity ${q} kg is below the operational minimum ${min} kg. This is an operational cutoff, not a universal food-safety rule.`)
    - expiryDate past OR availableUntil past (vs now) → INELIGIBLE + reason citing the recorded date (`Recorded expiry ${d} has passed.` / `Recorded availability deadline ${d} has passed.`)
    - else if availableUntil − now < 2h → REVIEW_REQUIRED + reason `Availability deadline is within 2 hours (logistics margin).`
    - else if quantityKg < 1.5 × min → REVIEW_REQUIRED + reason `Quantity is marginal (under 1.5× the ${min} kg operational minimum).`
    - else ELIGIBLE + reason `Meets recorded operational criteria; human quality confirmation on file. Not automatically safe or scientifically certified — redistribution decides next phase.`
    - persist SurplusEligibilityAssessment `{humanConfirmed: true, eligible: verdict==='ELIGIBLE', reason: reasons.join(' '), recordedInfoJson: JSON.stringify(all inputs + evaluated rules + min)}` + `assessedById: req.userId` + audit('eligibility.assess') → 201 `{ assessment: {..., verdict} }` (verdict derived field, not a column).
    - If INELIGIBLE → also create FoodFlowEntry `{kind:'WASTE', quantityKg, mealType: null, foodItemId ?? null, reason: 'Disposal: ' + reasons.join(' '), createdByName}` + audit('eligibility.disposal') → response includes `disposalEntry: {id, quantityKg}`.
  - `GET /api/eligibility/assessments?kitchenUnitId=&verdict=` → `{ assessments }` desc, take 100, each with derived `verdict`.
  - `GET /api/eligibility/config` (FLOW_ROLES) → `{ config: {minQuantityKg} | null, defaults: {minQuantityKg: 10}, note }`.
  - `PUT /api/eligibility/config` (MANAGE_ROLES) body `{minQuantityKg: 1..1000}` → upsert + audit → `{ config }`.

- [ ] **Step 1: Write `eod.ts`.**
- [ ] **Step 2: Write `waste.ts`.**
- [ ] **Step 3: Write `eligibility.ts`.**
- [ ] **Step 4: Mount all three; typecheck** — Run `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 4: UI pages + nav

**Files:**
- Create: `client/src/pages/Inventory.tsx`, `client/src/pages/EndOfDay.tsx`, `client/src/pages/Waste.tsx`, `client/src/pages/Eligibility.tsx`
- Modify: `client/src/App.tsx` (import pages; routes `/inventory`, `/eod`, `/waste`, `/eligibility` wrapped `RequireAuth` + `RequireFoodDataAccess` — STAFF included, NGO gets existing Blocked page)
- Modify: `client/src/components/Layout.tsx` (add four NavLinks under the FLOW_ROLES block, after Food Flow link; subtitle `Prototype — Prompt 6: Waste, Inventory & EOD`)
- Test: `npm run build` in `client/`

**Interfaces:**
- Consumes: Task 2–3 endpoints via `api<T>` helper; `useAuth()` kitchens + `user.role`; MANAGE const = `['SUPER_ADMIN','INSTITUTION_ADMIN','KITCHEN_MANAGER']` (same literal as Dashboard.tsx).
- Produces (every button real; shared card style `rounded-2xl border border-stone-200 bg-white p-6 shadow-sm`):
  - `Inventory.tsx`: kitchen/food filters + status filter; items table (food, qty, unit, supplier, purchase/expiry dates, days-to-expiry, storage area, status) with Edit (inline form), Adjust (delta + reason form), Archive/Restore buttons + confirm via `window.confirm`? No — repo pattern? Check MenuPage/FoodData for confirm style and mirror it (read before writing). Alerts section (4 groups with computed values + threshold note). Thresholds card (manager form / read-only).
  - `EndOfDay.tsx`: kitchen + date selectors; Preview button → review table + incoherent list (each with "fix in Food Data" link to `/food-data`) + accuracy preview; Close button (manager only; others see note) → success shows report id + totals; Reports list with status chips + Reopen button (manager; reason prompt inline form) → status flips; duplicate-close 409 surfaces server message.
  - `Waste.tsx`: kitchen + date (+food filter) → rows with excess, quantified claims table (contributor, attributable kg, share %, evidence), supporting-evidence list, "insufficient evidence" state, recommended action, decision-support label verbatim.
  - `Eligibility.tsx`: assessment form (all required fields + quality-confirmation checkbox with explicit label) → verdict card with every reason + persisted timestamp/assessor; INELIGIBLE shows linked disposal entry; assessments list with verdict chips + filter; config card (manager form / read-only + "not a universal food-safety rule" note).
- [ ] **Step 1: Check confirm/audit UI pattern** in MenuPage.tsx (grep `confirm(`), mirror it.
- [ ] **Step 2–5: Build the four pages.**
- [ ] **Step 6: App routes + Layout nav/subtitle.**
- [ ] **Step 7: Build** — Run: `npm run build` in `client/`. Expected: exit 0.

### Task 5: Test suite (`server/accept-p6.js`)

**Files:**
- Create: `server/accept-p6.js` (delete after green; plain Node fetch, seed logins admin `Admin12345!`/staff `Staff12345!`, unique `stamp` fixtures — same skeleton as `server/acceptance.js`)
- API must be running (`npm run dev` in server/) before `node accept-p6.js`
- Test: full suite green + rerun `server/acceptance.js` green

**Interfaces:** covers contract test areas (real behavior, real DB; date helpers: `isoDay(d)`, `shiftDay`; r3 rounding; kitchen from `/organizations/mine`, probe food `P6-Probe-<stamp>` via POST /food-items `{name, category:'Grains', mealType:'LUNCH'}`):
```javascript
const BASE = 'http://localhost:4000/api';
async function req(path, opts = {}) { /* fetch JSON, return {status, data} */ }
async function login(email, password) { /* → token or throw */ }
// record helper posts coherent /food-records (produced = sold+waste+remaining)
```
- I1 inventory CRUD+audit: staff POST item (Rice link, 50kg, supplier, purchase/expiry future, storage text) → 201; PUT adjust {deltaKg:-5, reason:'Stock count correction'} → qty 45; adjust {deltaKg:-100, reason:'...'} → 400 and qty still 45; archive → ARCHIVED; restore → ACTIVE.
- I2 alerts from real dates: item expiring in 2 days → nearExpiry lists it with daysToExpiry 2; item expired yesterday → expired lists it; item qty 2 → lowStock; item qty 500 → excess (defaults 5/3/100); PUT thresholds {lowStockKg:10,...} as admin → alerts change accordingly.
- E1 reconcile: post incoherent-able record? food-records blocks incoherent entry without reason — create record WITH adjustmentReason (coherent=False but reasoned: produced 10, sold 8, waste 3, remaining 2 + reason) → preview/close → 409 names the record and nothing persisted (reports list empty for date); PUT food-records correction fixing numbers (correctionReason) → close → 201 with totals matching hand sums.
- E2 duplicate-close: close same kitchen/date again → 409; reopen as staff → 403; reopen as admin without reason → 400; with reason → 200 REOPENED; close again → 201 new FINAL row; reports list shows both (FINAL + REOPENED).
- E3 accuracy: target exists (POST /targets/generate for date — check generate body in targets.ts: kitchenUnitId+date? read before writing test) + sold actual → report.accuracyJson.pairs ≥1 and meanAbsPctErr equals hand calc |sold−effective|/sold×100.
- W1 analysis reasons: fixture with target above sold (generate target, record sold well below) + same-weekday history ×3 + menu combo ×3 + near-expiry lot + note reason → analysis names demand-overestimate/overproduction/day-pattern/menu-combination with evidence strings containing actual numbers, expiry-pressure + manual-reason present without percentages.
- W2 shares: quantified shares sum to 100 ±0.5 when shown; zero-waste day → percentagesWithheld true + 'insufficient evidence' text.
- L1 eligibility matrix: qty 2 (<10) full-input → INELIGIBLE with below-minimum reason + disposal FoodFlowEntry WASTE exists with assessment-linked reason; qualityConfirmed false/missing → 400; past-expiry → INELIGIBLE; deadline <2h → REVIEW_REQUIRED; full valid → ELIGIBLE with all reasons persisted (GET assessments shows them); PUT config min 20 as admin → qty 15 now INELIGIBLE (configurable proof); staff PUT config → 403.
- R1 regression: `node server/acceptance.js` passes unmodified.
- R2 roles: staff close/reopen/thresholds-put → 403 (covered in E2/L1); NGO inventory GET → 403.

- [ ] **Step 1: Write the script** (all groups, real assertions, no mocks; read targets.ts generate body + food-records PUT correction schema before finalizing step E1/E3).

- [ ] **Step 2: Run pre-implementation (RED)** — Run: `node accept-p6.js`. Expected: FAILs on `/inventory*`, `/eod*`, `/waste*`, `/eligibility*` 404 (fixtures pass — same RED pattern as Prompt 5).

### Task 6: Verify + docs, then STOP

**Files:**
- Modify: `README.md` (append Prompt 6 section: waste rules, EOD semantics, eligibility rules + non-safety language, inventory alerts)
- Delete: `server/accept-p6.js` after green

- [ ] **Step 1: Backend typecheck + build** — Run: `npx tsc --noEmit`, `npm run build` in `server/`. Expected: pass.
- [ ] **Step 2: Suite green** — Run: `node accept-p6.js` ALL PASS; rerun `node server/acceptance.js` ALL PASS.
- [ ] **Step 3: Frontend build** — Run: `npm run build` in `client/`. Expected: exit 0.
- [ ] **Step 4: Docs + cleanup** — README section; delete suite; `git status` review. STOP.

## Self-Review

- Spec coverage: inventory fields/alerts/no-hardware/edit/adjust/archive/audit → Task 2+4; EOD review/reconcile-no-silence/dup-prevention/reopen-audit/report+accuracy+quality → Task 3+4; waste rules/percentages-only-if-normalized/insufficient-evidence/evidence+action/decision-support label → Task 1+3+4; eligibility threshold+required fields+confirm mandatory/ELIGIBLE-REVIEW-INELIGIBLE/disposal/eligible-to-next-phase/no-auto-safe → Task 3+4; tests for all five areas → Task 5; acceptance (alerts real, close-once+reopen-auth, named reasons, confirm-required, prior flows) → Tasks 4–6.
- Placeholders: none — exact files, schemas, formulas, thresholds, routes, test code.
- Type consistency: `InventoryThreshold/EligibilityConfig` names, endpoint paths, verdict strings, claim contributor keys identical across Tasks 1–5.
