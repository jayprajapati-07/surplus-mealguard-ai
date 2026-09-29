# Prompts 9+10: Security Hardening, Test Suites, Demo Hardening, Final Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden security and reliability, add permanent automated test suites, ship a resettable SIH demo dataset with a working Demo Guide, and finish with a verified final report.

**Architecture:** No new domain models (AuditLog + existing tables suffice); one `GET /api/admin/audit-log` endpoint; one `ErrorBoundary` + `NotFound` + offline-aware `api()`; zero-dependency `node:test` unit suites plus fetch-based API/E2E scripts orchestrated by `npm test`; one `DemoGuide.tsx` page; idempotent seed additions only.

**Tech Stack:** Express + TypeScript + zod + Prisma (SQLite); React + react-router-dom + Tailwind; Node 24 built-in `node:test` + `node:assert/strict` (type-stripping, no new deps — lib has no enums/namespaces, verified); plain-Node scripts (matches `server/acceptance.js` precedent).

**Spec:** Prompts 9+10 text in conversation; design presented in chat (in-place hardening, no new tables except none, honest E2E-via-API).

## Global Constraints

- Persistent local SQLite via Prisma; every visible control performs a real action; no fake data presentation.
- No fabricated results, no guaranteed reductions, no exact-measurement claims; estimates stay labeled.
- No weather, maps, sensors, IoT, camera/OCR/computer vision, route optimization; eligibility stays operational decision support with mandatory human confirmation; impact figures stay documented estimates.
- TypeScript strict, no ignored errors; role guards on API + UI; do not regress Prompts 1–8.

---

### Task 1: Authz audit + missing audit events + admin audit-log endpoint

**Files:**
- Read: every `server/src/routes/*.ts` `findUnique|update|deleteMany|delete` call; verify org/NGO scoping.
- Modify: `server/src/routes/redistribution.ts` (add `audit('redistribution.accept'|'redistribution.decline'|'redistribution.schedule'|'redistribution.handover'|'redistribution.cancel', ...)` in the 5 transition handlers — follow the existing `audit('redistribution.callback', { userId: req.userId, organizationId: r.organizationId, entityType: 'RedistributionRecord', entityId: r.id })` shape at line 461).
- Modify: `server/src/routes/admin.ts` — add `GET /api/admin/audit-log`:
```typescript
router.get('/audit-log', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({
    action: z.string().min(1).optional(),
    entityType: z.string().min(1).optional(),
    from: z.string().optional(), to: z.string().optional(),
    organizationId: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  }).safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  const where: Record<string, unknown> = {};
  if (me?.role !== 'SUPER_ADMIN') {
    if (!me?.organizationId) return res.status(404).json({ error: 'No organization yet.' });
    where.organizationId = me.organizationId;
  } else if (parsed.data.organizationId) where.organizationId = parsed.data.organizationId;
  if (parsed.data.action) where.action = { contains: parsed.data.action };
  if (parsed.data.entityType) where.entityType = parsed.data.entityType;
  // from/to validated as dates, applied to createdAt gte/lt
  const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: parsed.data.limit ?? 100 });
  return res.json({ entries: rows });
});
```
(reuse admin.ts existing imports + zodError helper — read file head first; STAFF/NGO get 403 from requireRole.)
- Test: `server/accept-p9.js` steps S1 (below) + `npx tsc --noEmit`.

**Interfaces:**
- Consumes: existing `audit()` helper, `requireRole`, `orgIdFor`-style user lookup.
- Produces: audit rows for all 5 redistribution transitions; readable audit API for Task 4 UI + Task 5 tests.

- [ ] **Step 1: Grep every route for unscoped mutations; fix any found (org check or NGO-ownership check before write).**
- [ ] **Step 2: Add the 5 audit calls.**
- [ ] **Step 3: Add `GET /api/admin/audit-log`.**
- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` in `server/`. Expected: pass.

### Task 2: Session/rate-limit/error-handler/env hardening

**Files:**
- Modify: `server/src/app.ts`:
  - Auth-specific limiter BEFORE existing global limiter block (order matters — mount specific first):
```typescript
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes and try again.' } });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/forgot', authLimiter);
app.use('/api/auth/reset', authLimiter);
```
  - Centralized error middleware AFTER all routes incl. the /api 404 (Express 4 signature):
```typescript
// Centralized safe error handler — never leaks stacks or secrets
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  if (process.env.NODE_ENV !== 'production') console.error(err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
```
- Modify: `server/.env.example` — ensure it documents every var the server reads: grep `process.env.` in server/src, add missing lines with safe placeholder values (never real secrets).
- Test: `server/accept-p9.js` steps S2 (below): 404 JSON shape `{error}` without `stack`; 31 rapid logins → 429 with friendly message (keep suite login count elsewhere low — reuse tokens).

- [ ] **Step 1: Add limiter + error middleware.**
- [ ] **Step 2: Sync `.env.example` with `process.env` grep.**
- [ ] **Step 3: Typecheck.**

### Task 3: Reliability + accessibility UI pass

**Files:**
- Create: `client/src/components/ErrorBoundary.tsx` (class component with `getDerivedStateFromError`, reset button clearing state via key change, role="alert", "Something went wrong" + Reload action — no stack shown):
```tsx
import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (<div className="mx-auto max-w-6xl px-4 py-8" role="alert">
        <h1 className="text-xl font-bold">Something went wrong.</h1>
        <p className="mt-1 text-sm">Please reload the page. If it persists, contact your administrator.</p>
        <button onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-leaf-700 px-4 py-2 text-sm text-white">Reload</button>
      </div>);
    }
    return this.props.children;
  }
}
```
- Modify: `client/src/App.tsx` (wrap `<AuthProvider>` tree in `<ErrorBoundary>`; replace `path="*"` element with a real `NotFound` inline block: heading + "Go home" Link + "Go back" button using useNavigate? Inline component in App.tsx is fine.)
- Modify: `client/src/api.ts` — offline/TypeError mapping:
```typescript
export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // ...existing header setup...
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('You appear to be offline. Check your connection and try again.');
    }
    throw new Error('Cannot reach the server. Make sure the API is running and try again.');
  }
  // ...rest unchanged...
}
```
- Modify: `client/src/components/Layout.tsx` (add offline banner: `const [online, setOnline] = useState(navigator.onLine)` + online/offline listeners + `{!online && <p role="alert">…offline…</p>}` banner under header).
- Modify: `client/src/index.css` (append `:focus-visible { outline: 3px solid #166534; outline-offset: 2px; }`).
- Create: `client/src/pages/AuditLog.tsx` (action/entity/org/date/limit filters + results table with user/time/action/entity/metadata; roles per `RequireAuditAccess` below; empty state when no rows match).
- Modify: `client/src/components/guards.tsx` (+ `RequireAuditAccess` allowing SUPER_ADMIN + INSTITUTION_ADMIN + KITCHEN_MANAGER via a `AUDIT_ROLES` const).
- Modify: `client/src/App.tsx` (+ `/audit` route wrapped `RequireAuth` + `RequireAuditAccess`).
- Modify: `client/src/components/Layout.tsx` (+ Audit Log NavLink for AUDIT_ROLES).
- Audit (fix what the dead-controls script in Task 4 flags, nothing speculative): every `<button>` has visible text or aria-label; every form submit disabled while busy + success/error message state; every destructive button (delete/archive/close-day/cancel/deactivate) gates on a confirm step; status cues pair color with text/icon (add text where color-only); tables get `overflow-x-auto` wrappers where missing; add `title` tooltips on forecast/confidence/eligibility/estimate labels (4+ tooltips: DigitalMemory confidence + forecast, Eligibility verdicts, Reports/Analytics estimate cards).
- Test: `npm run build` in `client/`; dead-controls script (Task 4) must report zero violations.

- [ ] **Step 1: ErrorBoundary + NotFound + api offline mapping + Layout banner + CSS.**
- [ ] **Step 2: Form/a11y/terminology sweep fixes** (driven by Task 4 script output — iterate until clean).
- [ ] **Step 3: Build** — `npm run build` in `client/`. Expected: exit 0.

### Task 4: Permanent test suites + dead-controls audit + npm test

**Files:**
- Create: `server/tests/unit/*.test.js` — `node:test` + `node:assert/strict`, importing `../../src/lib/*.ts` (type-stripping, no build step). Files: `kitchen-memory.test.js` (forecast determinism: same input twice byte-identical; known hand-computed baseline case), `targets.test.js` (buffer fixed/percent math incl. rounding), `surplus-risk.test.js` (pace projection hand calc; insufficient-data branches), `waste-analysis.test.js` (claim shares sum to 100; withheld case), `eligibility-rules.test.js` — pure rule extract? Eligibility rules live in route handler (not pure). FIX first: extract `decideEligibility(input, minQty)` pure function into `server/src/lib/eligibility.ts` + thin route wrapper (tested change, rerun accept-p6 paths), then unit-test matrix (below-min, expired, tight-deadline, marginal, eligible, missing-confirmation). Same for matching (`matching.test.js` — pure already) and impact (`impact.test.js` — resolveFactors precedence + computeImpact hand calc).
- Create: `server/tests/api/authz.test.js` — needs running API (started by runner): cross-org ID tampering (org-B admin reads/edits org-A food-item/food-record/menu/inventory/EOD/assessment/NGO-record IDs → 404), NGO isolation (NGO reads other-NGO record → 404; NGO hits manage endpoints → 403), staff-vs-admin (staff POST menus/imports/targets-generate/eod-close → 403), unauthenticated 401s, NGO accept happy path on own record (needs full setup: reuse seed NGO link — ngo@mealguard.local linked to City Food Helpers; create eligible assessment via API as admin, match, notify, accept as ngo).
- Create: `server/tests/e2e/*.test.js` — 6 journey scripts (signup→onboarding; menu→import; target→flow; day-close→eligibility; NGO accept→pickup; reports→export with file assertions: CSV contains header+row, XLSX parses via require('xlsx') sheet check, PDF starts with %PDF). Document at top: E2E runs full user journeys over HTTP (no headless browser in this env).
- Create: `scripts/no-dead-controls.js` (repo root) — parses client/src for `<button|a href|<Link to|<NavLink to|<select|<input` elements; asserts each button has text/aria-label + onClick/submit handler or type=submit; each Link/NavLink target matches a Route path in App.tsx; each api('...') path matches a mounted server route (parse server/src/app.ts `app.use('/api/...')` + route files' router.get/post/put/patch/delete paths); each form has disabled-busy + error/msg state (heuristic: file contains 'disabled=' and 'setError'); writes `docs/controls-audit.md` checklist with PASS/FAIL per item; exits non-zero on FAIL.
- Modify: root `package.json` + `server/package.json` — `"test": "node --test tests/unit/ && node scripts/run-api-tests.js"`? Simpler robust: root `scripts/run-tests.js` (starts server via child_process npm run dev --prefix server, polls /api/health ≤60s, runs `node --test server/tests/api server/tests/e2e`, kills server, runs `node scripts/no-dead-controls.js`, prints summary, non-zero on any failure). Wire `"test": "node scripts/run-tests.js"` at root. Keep `server/acceptance.js` untouched (regression leg).
- Test: full `npm test` green + `node server/acceptance.js` green.

- [ ] **Step 1: Extract `decideEligibility` to lib + route-thin (verify: accept-p6 eligibility paths still pass — rerun accept-p6? It was deleted after green per Prompt-6 cleanup. Instead: targeted re-check via new suite's eligibility API tests + tsc).**
- [ ] **Step 2: Write unit suites (7 files).**
- [ ] **Step 3: Write api authz suite.**
- [ ] **Step 4: Write 6 e2e journeys.**
- [ ] **Step 5: Write dead-controls script + checklist.**
- [ ] **Step 6: Wire `npm test`; full run green.**

### Task 5: Demo dataset + Demo Guide + final verification + report

**Files:**
- Modify: `server/src/seed.ts` (idempotent only — guard each block with existence checks like existing `menuCount === 0` / `flowCount === 0` patterns):
  - Today's ProductionTargets for seed kitchen (rice/lunch + 2 items) computed via real `forecastForDate` on seeded history + 10% buffer (import from lib; method 'memory-v1', inputsJson with `seeded:true` note "regenerate from Digital Memory for live values").
  - One ELIGIBLE assessment (rice 15kg, confirmed, future deadline) + one matched+SELECTED NgoMatch to City Food Helpers (score recomputed via scoreNgoMatch, not hardcoded).
  - One COMPLETED redistribution (assessment + match + record + audit trail entries with metadata `{seeded:true}` + ImpactSnapshot from real factors) + keep one unmatched ELIGIBLE for follow-up visibility.
  - One unread SURPLUS_RISK_HIGH notification for seed org (linkPath /flow, body cites seeded rice/lunch numbers + "Seeded demo alert").
  - Completed waste-analysis inputs already exist via history (verify: at least one high-waste day + eligible assessment exist — assert in seed log output, don't fabricate).
- Create: `client/src/pages/DemoGuide.tsx` — 15 steps per Prompt 10 list, each a `<Link>` to the real route; estimate/demo labels ("Demonstration data", "estimate" tags); visible to all authenticated onboarded roles (NGO sees guard messages on admin screens — acceptable, links still navigate).
- Modify: `client/src/App.tsx` (+ `/demo-guide` route, RequireAuth only — no org requirement? Onboarding needed for most links; use RequireAuth + RequireOnboarded? NGO has no org → blocked. Use RequireAuth alone so NGO can open it; individual links enforce their own guards), `Layout.tsx` (Demo Guide nav link for all signed-in roles).
- Modify: `README.md` (exact run/seed/test/reset instructions, demo credentials table, feature inventory, honest limitations paragraph verbatim from Prompt 10 list).
- Modify: root `package.json` (+ `"db:reset": "node scripts/db-reset.js"` where db-reset deletes server/prisma/dev.db* + runs migrate deploy + seed — explicit, documented, safe-guarded to dev.db filename only).
- Test: fresh `npm run db:reset` → full 15-step demo walkthrough via API (scripted in accept-p10igy? No — manual checklist in final report + e2e suite already covers journeys) → all exports → per-role page checks (admin/manager/staff/ngo GET key pages 200 + blocked ones 403) → refresh persistence (login → reload me → same org) → controls audit clean → console/build clean.

- [ ] **Step 1: Seed additions (idempotent, verified by re-running seed twice).**
- [ ] **Step 2: DemoGuide page + nav + route.**
- [ ] **Step 3: db:reset script + README.**
- [ ] **Step 4: Full final verification + write final implementation report in chat. STOP.**

## Self-Review

- Spec coverage: authz per-route + NGO isolation + staff blocks + ID tampering → Tasks 1+4; session/hash/logout/expiry/rate-limit → Task 2 (+existing code verified); error handler + env docs + no secrets → Task 2; audit all listed events + audit page → Task 1+4(UI? audit page is Task 4? NO — audit-log page needs UI: add to Task 4 file list: `client/src/pages/AuditLog.tsx` + App route `/audit` (super-admin + institution-admin? managers? Spec: "authorized" — super-admin all, institution-admin own org; add RequireSuperAdmin-or-Admin guard? guards.tsx has RequireSuperAdmin; add `RequireAuditAccess` allowing SUPER_ADMIN + INSTITUTION_ADMIN + KITCHEN_MANAGER? Managers auditing own org is reasonable; STAFF excluded. FIX the file list below.) ; 404/boundaries/states/double-submit/confirms/a11y → Task 3; unit/API/E2E/dead-controls suites → Task 4; demo data/guide/polish/verification/report → Task 5.
- Placeholders: none — exact files, schemas, code, commands.
- Type consistency: `decideEligibility(input, minQty)` name; audit action strings; endpoint paths identical across Tasks 1–5.
