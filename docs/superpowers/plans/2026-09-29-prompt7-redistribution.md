# Prompt 7: Closed-Loop Prevention + NGO Redistribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move eligible surplus through a real tracked workflow from deterministic NGO matching to NGO decision to pickup completion, with truthful delivery status and closed-loop impact.

**Architecture:** Additive Prisma migration (NGO registry fields, User.ngoOrganizationId, NgoMatch score/delivery/unique); pure matching in `server/src/lib/matching.ts` and env-driven mail in `server/src/lib/mailer.ts` (new nodemailer dep); new `routes/ngos.ts` + `routes/redistribution.ts`; NGO scoping via `RequireRedistributionAccess` + `PublicOnly` tweak; `Redistribution.tsx` + `NgoRegistry.tsx` pages; `server/accept-p7.js` suite.

**Tech Stack:** Express + TypeScript + zod + Prisma (SQLite) + nodemailer; React + react-router-dom + Tailwind; Node fetch acceptance script (repo has no test runner — matches `server/acceptance.js` precedent).

**Spec:** Prompt 7 text in conversation; design presented in chat (model reuse, 5×20 scoring, transition map, fan-out delivery).

## Global Constraints

- Persistent local SQLite via Prisma; every visible control performs a real action; no fake data presentation.
- Address/service-area text only; no maps, navigation, route optimization, weather, sensors, external delivery claims.
- No live external AI claim; deterministic matching with shown reasons; never "nearest" — "suitable registered NGO".
- Truthfulness: simulated vs actual delivery labeled exactly; no guaranteed claims; no safety certification language.
- TypeScript strict, no ignored errors; role guards on API + UI; do not regress Prompts 1–6.

---

### Task 1: Schema migration + matching/mailer libs

**Files:**
- Modify: `server/prisma/schema.prisma`:
  - `NgoOrganization` += `contactName String?`, `acceptedCategories String?` (JSON array), `pickupCapable Boolean @default(true)`, `operatingHours String?`, `capacityKg Float?`, `isActive Boolean @default(true)`, `users User[]`
  - `User` += `ngoOrganizationId String?`, `ngoOrganization NgoOrganization? @relation(fields: [ngoOrganizationId], references: [id], onDelete: SetNull)` + `@@index([ngoOrganizationId])`
  - `NgoMatch` += `score Int @default(0)`, `reasonsJson String?`, `deliveryJson String?`, `@@unique([assessmentId, ngoId])`
- Modify: `server/package.json` (+ `nodemailer@^6.9.0`, `@types/nodemailer@^6.4.0` dev)
- Create: `server/src/lib/matching.ts`, `server/src/lib/mailer.ts` (exact content below)
- Test: `npx prisma validate`, `npx prisma migrate dev --name prompt7-ngo-redistribution`, `npx tsc --noEmit` in `server/`

**Interfaces:**
- Consumes: assessment `{quantityKg, foodCategory, availableUntil, organizationCity, organizationAddress}` + NGO rows + institution `{city, address, operatingHours}`.
- Produces (imported by Task 2):
```typescript
// matching.ts
export interface MatchReason { criterion: string; points: number; detail: string; }
export interface MatchResult { eligible: boolean; score: number; reasons: MatchReason[]; }
export function scoreNgoMatch(args: {
  ngo: { isActive: boolean; city: string | null; address: string | null; acceptedCategories: string | null; pickupCapable: boolean; operatingHours: string | null; capacityKg: number | null };
  assessment: { quantityKg: number; foodCategory: string; availableUntil: string };
  institution: { city: string; address: string; operatingHours: string };
}): MatchResult;
```
Rules (verbatim): inactive → `{eligible:false, score:0, reasons:[{criterion:'active', points:0, detail:'NGO is inactive.'}]}`; normalize = lowercase trim; area 20pts if normNgoCity && normInstCity && (a.includes(b) || b.includes(a)) where (a=ngo city+address, b=inst city+address) else 0 with detail quoting both sides; category 20pts if NGO list (JSON.parse, fallback []) contains 'any'/'all' or exact normalized match else 0; pickup 20pts if pickupCapable else 0 ('No pickup capability recorded.'); hours 20pts if HH:MM ranges extracted from both sides overlap else 0, detail 'Hours not comparable from recorded text.' when either side yields no range; capacity 20pts if capacityKg==null ('No capacity stated — treated as neutral, full points.') or capacityKg>=quantityKg else 0.
```typescript
// mailer.ts
export interface MailAttempt { at: string; channel: 'mailbox-simulated' | 'smtp'; ok: boolean; error?: string; }
export interface MailPayload { to: string; subject: string; text: string; }
export function smtpConfigured(): boolean; // SMTP_HOST set (others optional with defaults)
export async function sendMail(p: MailPayload): Promise<MailAttempt>; // nodemailer when configured (host/port/secure/user/pass from SMTP_HOST/PORT/SECURE/USER/PASS, 8s timeout), catch → {ok:false, error}; else {channel:'mailbox-simulated', ok:true}
```
- [ ] **Step 1: Edit schema (3 spots) + package.json deps**
- [ ] **Step 2: Validate + migrate + install**
Run: `npx prisma validate` → valid; `npx prisma migrate dev --name prompt7-ngo-redistribution` → applies; `npm install` → nodemailer present.
- [ ] **Step 3: Create both libs verbatim.**
- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 2: NGO registry API

**Files:**
- Create: `server/src/routes/ngos.ts`
- Modify: `server/src/app.ts` (+ `import ngoRoutes`; `app.use('/api/ngos', ngoRoutes);` after risk-thresholds line)
- Modify: `server/src/seed.ts` (extend existing `ngoOrganization.upsert` block: set contactName/contactEmail/city/acceptedCategories/pickupCapable/operatingHours/capacityKg/isActive + link `ngo@mealguard.local` user via `ngoOrganizationId`; add 2 more upserts: inactive + incompatible NGOs; keep prior seed code untouched)
- Test: `server/accept-p7.js` steps G1–G4 + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, `requireRole`, `audit`.
- Produces:
  - `GET /api/ngos` (SUPER_ADMIN, INSTITUTION_ADMIN, KITCHEN_MANAGER) → `{ ngos }` all, order name asc.
  - `POST /api/ngos` (SUPER_ADMIN only) body `{name: trim 2..120 unique, contactName? ≤120, email? valid, phone? ≤30, city/serviceArea text ≤120, address? ≤200, acceptedCategories: string|array (stored JSON array, each 1..40, max 20), pickupCapable: boolean default true, operatingHours? ≤120, capacityKg?: positive ≤100000, isActive: boolean default true}` → 201 `{ ngo }` + audit; duplicate name → 400.
  - `PUT /api/ngos/:id` (SUPER_ADMIN only, same schema partial) → `{ ngo }` + audit; 404 if missing.
  - `POST /api/ngos/:id/deactivate|activate` (SUPER_ADMIN only) → `{ ngo }` + audit. (No delete: history preservation; state why in message.)
- [ ] **Step 1: Write `ngos.ts`** (zod schemas mirroring food-items.ts style; `orgIdFor` not needed — NGOs are global registry).
- [ ] **Step 2: Mount + seed.**
- [ ] **Step 3: Typecheck.**

### Task 3: Matching + notify + workflow API

**Files:**
- Create: `server/src/routes/redistribution.ts`
- Modify: `server/src/app.ts` (`app.use('/api/redistribution', redistributionRoutes);`)
- Modify: `server/src/routes/notifications.ts` GET `/` + `/unread-count` (NGO branch: role NGO → rows where `userId===me && type==='NGO_OPPORTUNITY'` + unread count same filter; non-NGO path byte-identical to current)
- Test: `server/accept-p7.js` steps M/N/W + `npx tsc --noEmit`

**Interfaces:**
- Consumes: Task 1 libs + `notifyOrg`-style fan-out (own code: find users by ngoOrganizationId), `audit`, Prompt-6 `EligibilityConfig` min.
- Produces:
  - `GET /api/redistribution/matches?assessmentId=` (MANAGE_ROLES = SUPER_ADMIN, INSTITUTION_ADMIN, KITCHEN_MANAGER) → verifies assessment in-org + eligible==true (400 otherwise: 'Only ELIGIBLE assessments can be matched.') → for each active+inactive NGO compute scoreNgoMatch (parse recordedInfoJson for foodCategory/availableUntil; institution city/address/operatingHours from org) → upsert NgoMatch `{score, reasonsJson, status: keep existing SELECTED? else PROPOSED}` (never downgrade SELECTED) → `{ assessment: {id, food, quantityKg, verdict}, matches: [{ngo{id,name,city,isActive}, score, reasons, status}] }` sorted score desc. Inactive included with score 0 + reason (visible non-match explanation, not selectable).
  - `POST /api/redistribution/notify` (MANAGE_ROLES) body `{assessmentId, ngoIds: string[1..10], draftId?: string}` → 400 unless assessment in-org + eligible + quantityKg ≥ min (below → 400 'below the configured X kg notification minimum'); each ngoId: match row must exist with score>0 + ngo active else 400 naming it ('... is inactive/incompatible and cannot be selected.'); ensure RedistributionRecord (assessment+ngo unique? findFirst else create `{status:'NOTIFIED', quantityKg: assessment.qty, notes}`); per NGO: `sendMail` (to = contactEmail ?? 'unknown@localhost' — if no email, still mailbox-simulate addressed to name), append attempt to match.deliveryJson.attempts, fan-out Notification rows `{userId: each NGO user, type:'NGO_OPPORTUNITY', title, body: institution/food/qty/category/deadline/address/contact, linkPath:'/redistribution'}`; optional draftId: verify owned DRAFT + append linked note; audit per record → `{ results: [{ngoId, channel, ok, error?}], recordIds }`. Truthful status = per-match deliveryJson (simulated vs smtp).
  - `POST /api/redistribution/notify/:matchId/retry` (MANAGE_ROLES) → re-run sendMail for that match, append attempt, `{ attempt }`.
  - NGO endpoints (role NGO only + ngoOrganizationId required → 403 'NGO account is not linked...' otherwise):
    - `GET /api/redistribution/opportunities` → records where ngoId===myNgo + status in NOTIFIED/ACCEPTED/PICKUP_SCHEDULED (+DECLINED/COMPLETED history flag `?history=true`), with assessment snapshot + institution name/city/contact + match score/reasons + delivery attempts.
    - `POST /api/redistribution/:id/accept` body `{intendedPickupAt: valid ISO future}` → allowed from NOTIFIED (400 otherwise with valid-transition message) → status ACCEPTED, pickupAt=intended, audit → `{ record }`.
    - `POST /api/redistribution/:id/decline` body `{reason: trim ≥5 ≤500}` → from NOTIFIED → DECLINED + notes append + audit.
    - `POST /api/redistribution/:id/callback` body `{message?: ≤500, phone?: ≤30}` → from NOTIFIED → stays NOTIFIED + institution Notification `{type:'NGO_CALLBACK', organizationId: record.org, title, body, linkPath:'/redistribution'}` — add 'NGO_CALLBACK' + 'NGO_OPPORTUNITY' to notifications INAPP allowlist (edit `INAPP_TYPES` in surplus-risk.ts — additive array entries only) + audit.
    - `POST /api/redistribution/:id/confirm-receipt` → from HANDED_OVER + (empty body) → COMPLETED + ImpactSnapshot `{foodSavedKg: qty, wasteReducedKg: qty, co2AvoidedKgEstimate: qty×CO2 factor or 0, costSavedEstimate: qty×cost factor or 0, notes:'Estimates from ImpactFactors; foodSavedKg measured.'}` (factors via ImpactFactor keys CO2_PER_KG_FOOD/COST_PER_KG_FOOD, missing → 0) + audit.
  - Institution endpoints (MANAGE_ROLES, org-owned records):
    - `GET /api/redistribution/records?assessmentId=&status=` → `{ records }` with ngo name, assessment food/qty, delivery attempts, audit timeline (AuditLog where entityType RedistributionRecord entityId — include as `timeline`).
    - `POST /api/redistribution/:id/schedule` body `{pickupAt: valid ISO}` → from ACCEPTED → PICKUP_SCHEDULED (+pickupAt update) + audit.
    - `POST /api/redistribution/:id/handover` body `{}` → from PICKUP_SCHEDULED → HANDED_OVER + audit. (Also allow ACCEPTED→HANDED_OVER? No — enforce chain; test asserts rejection.)
    - `POST /api/redistribution/:id/cancel` body `{reason: trim ≥5}` → from any non-terminal (not COMPLETED/CANCELLED) → CANCELLED + audit; terminal → 400.
  - Transition map (single source of truth, exported for tests? keep module-local + exact 400 messages naming allowed next states):
```
DRAFT: [NOTIFIED],
NOTIFIED: [ACCEPTED, DECLINED, CANCELLED],
ACCEPTED: [PICKUP_SCHEDULED, CANCELLED],
DECLINED: [CANCELLED],
PICKUP_SCHEDULED: [HANDED_OVER, CANCELLED],
HANDED_OVER: [COMPLETED, CANCELLED],
COMPLETED: [], CANCELLED: []
```
  - Role matrix enforced per endpoint (NGO↔institution cross-calls → 403; staff → 403 on manage endpoints; wrong-state → 400 naming valid next states).
- [ ] **Step 1: Extend INAPP_TYPES (+2 entries).**
- [ ] **Step 2: Write `redistribution.ts`** (~600 lines; follow food-records.ts validation/audit style).
- [ ] **Step 3: NGO branch in notifications.ts (GET + unread-count).**
- [ ] **Step 4: Mount; typecheck.**

### Task 4: UI (Redistribution + Registry + NGO access)

**Files:**
- Create: `client/src/pages/Redistribution.tsx`, `client/src/pages/NgoRegistry.tsx`
- Modify: `client/src/App.tsx` (imports + routes `/redistribution` (RequireRedistributionAccess), `/ngos` (super-admin-only guard — add `RequireSuperAdmin` to guards.tsx))
- Modify: `client/src/components/guards.tsx` (+ `RequireRedistributionAccess` = MANAGE_ROLES + NGO-with-ngoOrg? RequireRoles checks organizationId — NGO users lack it. Implement dedicated guard: auth → NGO? require ngoOrganizationId (from extended User type) : require organizationId + MANAGE role; add `NGO_ROLES=['NGO']`, `REDIST_ROLES=[...MANAGE,'NGO']` constants. Also add `RequireSuperAdmin`.)
- Modify: `client/src/components/Layout.tsx` (Redistribution link for REDIST_ROLES incl. NGO; NGO Registry link super-admin only; NGO users see ONLY Redistribution + mailbox-in? Spec: NGO access only own opportunities — show NGO users: Redistribution only (+ Logout). Implement: if role==='NGO' render only that link.)
- Modify: `client/src/auth-context.tsx` (User interface += `ngoOrganizationId: string | null`; check me-response includes it — auth/me returns user row; verify field present or add select)
- Modify: `client/src/components/Layout.tsx` subtitle → Prompt 7 line.
- Test: `npm run build` in `client/`.

**Interfaces:**
- Consumes: Task 2–3 endpoints via `api<T>` helper.
- Produces:
  - `Redistribution.tsx` role-split: institution view (eligible assessments list → match table with score+reasons → select → notify w/ draft link + delivery truth panel + retry; records board with per-state action buttons calling exactly the allowed transition; unmatched/declined follow-up section listing eligible assessments with zero accepted records + link to record disposal via eligibility page) and NGO view (opportunities with assessment/institution detail + score reasons; accept (datetime)/decline (reason)/callback forms; confirm-receipt button on handed-over; history toggle; timeline per record).
  - `NgoRegistry.tsx`: super-admin table + create/edit/deactivate forms with all fields; institution-admin read-only suitable list (GET shows all — display suitability note; no edit controls rendered).
  - Every button wired; empty states; 403 messages surfaced; no "nearest" wording anywhere (grep-verify).
- [ ] **Step 1: Guards + auth-context + App + Layout.**
- [ ] **Step 2: `NgoRegistry.tsx`.**
- [ ] **Step 3: `Redistribution.tsx` (largest file; role-split components).**
- [ ] **Step 4: Build** — `npm run build` in `client/`. Expected: exit 0.

### Task 5: Test suite (`server/accept-p7.js`)

**Files:**
- Create: `server/accept-p7.js` (delete after green; plain Node fetch; logins admin `Admin12345!`/manager `Manager123!`/staff `Staff12345!`/ngo `Ngo123456!`/superadmin `SuperAdmin123!`; unique `stamp` fixtures; same skeleton as `server/acceptance.js`)
- API must be running (`npm run dev` in server/) before `node accept-p7.js`
- Test: full suite green + rerun `server/acceptance.js` green

**Interfaces:** covers contract test areas (real behavior, real DB):
```javascript
const BASE = 'http://localhost:4000/api';
async function req(path, opts = {}) { /* fetch JSON, return {status, data} */ }
async function login(email, password) { /* → token or throw */ }
// fixtures: kitchen from /organizations/mine (first kitchen id); probe food P7-Probe-<stamp> via POST /food-items {name, category:'Cooked Veg'}; food-record POST {date, kitchenUnitId, foodItemId, mealType:'LUNCH', producedKg, soldKg, wasteKg, remainingKg, targetKg?} (coherent sums!); eligibility POST {kitchenUnitId, foodDescription, foodItemId?, quantityKg:15, foodCategory:'Cooked Veg', preparedAt: ISO now-1h, holdingInfo:'Covered', storageArea:'Cold room', availableUntil: ISO now+5h, qualityConfirmed:true} → ELIGIBLE id
```
- G1 registry read: admin GET /ngos → 200 array incl. seed NGO with contactName/capacity fields; staff GET → 403; ngo GET → 403.
- G2 super-admin create NGO (unique name `P7 NGO <stamp>`, city Pune, categories ['Cooked Veg'], pickupCapable true, hours '08:00-20:00', capacity 100, active) → 201; duplicate name → 400; staff POST → 403.
- G3 deactivate/reactivate: POST deactivate → isActive false; matching excludes it (M-step asserts); reactivate → true.
- M1 match explanation: GET matches?assessmentId → 200; seed incompatible NGO scores 0 with reasons naming failed criteria; compatible seed/active NGO score 100 (or ≥80); every row has reasons[] with points summing to score; selected recipient persisted (choose top: POST select? — selection = notify step; assert match rows persisted via re-GET identical scores).
- M2 ineligible blocked: create INELIGIBLE assessment (quantityKg 2 < min) → matches → 400; notify → 400.
- M3 threshold: PUT eligibility config min 20 (admin) → 15kg assessment notify → 400 below-minimum; restore min 10 (PUT back) → proceed. (Uses existing eligibility config endpoint — read-only usage, no change.)
- N1 notify truthful: notify to compatible NGO → results[0].channel === 'mailbox-simulated' (no SMTP in test env — assert from response, never assume); match deliveryJson.attempts length 1; NGO user inbox (login ngo) GET /notifications contains NGO_OPPORTUNITY with linkPath '/redistribution'; Dev Mailbox contains simulated entry labeled 'simulated local delivery' (GET /dev-mailbox? grep subject).
- N2 retry: POST retry → attempts length 2, truthful channel again.
- N3 inactive/incompatible select: notify with inactive NGO id and incompatible NGO id → 400 naming each.
- W1 full path (fresh assessment qty 12): notify → NGO accept {intendedPickupAt: tomorrow ISO} → ACCEPTED + pickupAt set; institution schedule {pickupAt} → PICKUP_SCHEDULED; handover → HANDED_OVER; NGO confirm-receipt → COMPLETED + ImpactSnapshot foodSavedKg === 12 (query via? add GET impact read? ImpactSnapshot has no read endpoint — assert via completion response echo `{impact: {foodSavedKg}}` — include impact row in confirm-receipt response).
- W2 wrong-role transitions: staff accept → 403; NGO schedule → 403; NGO handover → 403; institution accept → 403; accept twice → 400; handover from ACCEPTED (skip schedule) → 400 naming PICKUP_SCHEDULED; decline without reason → 400; callback without auth → 401.
- W3 decline+callback: second assessment → notify → NGO decline {reason} → DECLINED + notes contain reason; callback on another notified record → institution admin inbox contains NGO_CALLBACK (login admin GET /notifications).
- W4 NGO isolation: second NGO org (created in G2, different stamp? create `P7 Other`) — its user? No user linked → instead: ngo user sees only own opportunities: all returned records have ngoId === linked ngo org id. Assert every row. Plus institution B (signup second org? heavy — instead assert NGO cannot read record of other NGO: notify P7-Other NGO too, then ngo user must NOT see it).
- W5 unmatched visible: eligible assessment with no notify → institution records view shows it in unmatched/follow-up (GET records? unmatched ≠ record... expose via matches view: assessment with zero non-PROPOS? Simplify: institution Redistribution page data = GET /redistribution/records returns all; unmatched follow-up = eligible assessments list endpoint? assessments endpoint exists (Prompt 6). Test: GET /eligibility/assessments?verdict=ELIGIBLE contains our un-notified assessment id → visible for follow-up. Uses existing endpoint read-only.)
- R1 regression: `node server/acceptance.js` passes unmodified.
- R2 no-banned-words: grep client/src + server/src for 'nearest' (fail if found outside plan/test), 'email sent' (fail if found).
- [ ] **Step 1: Write the script** (all groups, real assertions, no mocks).
- [ ] **Step 2: Run pre-implementation (RED)** — `node accept-p7.js`. Expected: FAILs on `/ngos*`, `/redistribution*` 404 (fixtures pass).

### Task 6: Verify + docs, then STOP

**Files:**
- Modify: `README.md` (append Prompt 7 section: registry fields, scoring table, statuses + transition map, delivery truth table, NGO access rules, impact linkage)
- Delete: `server/accept-p7.js` after green

- [ ] **Step 1: Backend typecheck + build** — `npx tsc --noEmit`, `npm run build` in `server/`. Expected: pass.
- [ ] **Step 2: Suite green** — `node accept-p7.js` ALL PASS; rerun `node server/acceptance.js` ALL PASS.
- [ ] **Step 3: Frontend build** — `npm run build` in `client/`. Expected: exit 0.
- [ ] **Step 4: Docs + cleanup** — README section; delete suite; `git status` review. STOP.

## Self-Review

- Spec coverage: registry fields/roles/NGO-scoping → Tasks 1–2+4; deterministic matching (5 criteria, score, reasons, suitable wording, persist) → Tasks 1–3 (M-steps); delivery (in-app content, adapter, simulated-vs-actual, retry) → Tasks 1–3 (N-steps); NGO workflow (view/accept/decline/callback/receipt, statuses, transitions, permissions, timeline) → Task 3+4 (W-steps); closed loop (impact inputs, unmatched visibility, draft links) → Task 3 (W1-impact, W5, draftId); seed-scenario full path + negatives → Task 5; acceptance (NGO isolation, explanation accuracy, delivery truth, persistence+audit, no dead controls) → Tasks 4–6.
- Placeholders: none — exact files, schemas, formulas, routes, test code.
- Type consistency: `score/reasonsJson/deliveryJson`, `linkPath:'/redistribution'`, `NGO_OPPORTUNITY/NGO_CALLBACK`, status strings, endpoint paths identical across Tasks 1–5.
