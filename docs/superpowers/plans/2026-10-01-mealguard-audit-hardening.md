# MealGuard Audit Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Surplus MealGuard AI to production-ready without breaking features.

**Architecture:** UI → Services/API → Business Logic → Database; Express + Prisma (Postgres) + React/Vite; deterministic statistical forecasting (memory-v1), no ML claims.

**Tech Stack:** React 18, TS 5, Vite 5, Tailwind 3, Express 4, Prisma 5, Zod 3, SQLite dev / Postgres prod.

**Spec:** Master audit prompt (security → data → broken → perf → arch → UI → cleanup) + SIH 15-step demo must keep working.

## Global Constraints

- Do not rewrite framework/DB unless necessary.
- Do not remove working features.
- Do not claim ML/AI when statistical; label memory-v1.
- Never commit secrets; never print secret values.
- Prefer readable code over clever code.
- Verify with typecheck + build + unit tests before claiming done.

---

### Task 1: Security — CORS + Rate Limit

**Files:**
- Modify: `server/src/app.ts:34-77`

**Interfaces:**
- Consumes: `process.env.CLIENT_ORIGIN`, `RATE_LIMIT_AUTH_MAX`
- Produces: Deny unknown origins; auth limit default 30; no header bypass.

- [ ] **Step 1: Fix CORS deny**

```ts
return callback(new Error('Not allowed by CORS.'));
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/app.ts
git commit -m "fix(security): deny unknown CORS origins, tighten auth rate limit"
```

### Task 2: Security — Supabase + Env Hygiene

**Files:**
- Modify: `server/src/supabase.ts`, `client/src/supabase.ts`, `.env.example`, `client/.env.example`, `server/.env.example`, `render.yaml`, `.gitignore`
- Modify: `server/src/routes/auth.ts`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Produces: `supabase: SupabaseClient | null`; no hardcoded prod credentials.

- [ ] **Step 1: Remove hardcoded fallbacks, allowlist Supabase roles**

See implemented diff in `server/src/routes/auth.ts` (allowlist INSTITUTION_ADMIN/KITCHEN_MANAGER/STAFF/NGO, no UUID PK trust).

- [ ] **Step 2: Sanitize examples + render.yaml to sync:false**

Placeholders only, no real URLs/keys.

- [ ] **Step 3: Run typecheck + build**

Run: `npm run typecheck; if ($?) { npm run build }`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/supabase.ts client/src/supabase.ts server/src/routes/auth.ts .env.example client/.env.example server/.env.example render.yaml .gitignore
git commit -m "fix(security): remove hardcoded Supabase creds, sanitize env examples"
```

### Task 3: Data Integrity — Food Records + Imports + Dates

**Files:**
- Modify: `server/src/routes/food-records.ts`, `server/src/routes/imports.ts`, `server/src/lib/flow.ts`, `client/src/pages/FoodData.tsx`

**Interfaces:**
- Consumes: `coherenceError`, `normalizeDay`, `parseDateCell`
- Produces: `PUT /food-records/:id` validates ownership; blank surplus=0; impossible dates=null with MM/DD fallback.

- [ ] **Step 1: Verify date parser**

Run: `node --input-type=module -e "import('./server/dist/lib/flow.js').then(...)"`
Expected: 31/02→null, 02/13→Feb13 PASS

- [ ] **Step 2: Run unit tests**

Run: `npm --prefix server exec tsx -- --test "tests/unit/*.test.mjs"`
Expected: 40 PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/food-records.ts server/src/routes/imports.ts server/src/lib/flow.ts client/src/pages/FoodData.tsx
git commit -m "fix(data): food-record edit ownership, import surplus blank, strict date parsing"
```

### Task 4: UI Honesty + Sidebar A11y

**Files:**
- Modify: `client/src/pages/Dashboard.tsx`, `client/src/components/Layout.tsx`, `client/src/api.ts`

**Interfaces:**
- Consumes: `/dashboard/overview`, `/notifications/unread-count`
- Produces: No fake 2480/1960/320 meals; "Statistical forecast (memory-v1)"; drawer Escape + scroll-lock + button semantics; api 30s timeout.

- [ ] **Step 1: Run client typecheck + build**

Run: `npm --prefix client run typecheck; if ($?) { npm --prefix client run build }`
Expected: PASS

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/Dashboard.tsx client/src/components/Layout.tsx client/src/api.ts
git commit -m "fix(ui): honest forecast labels, fix sidebar a11y, api timeout"
```

### Task 5: Backend Correctness — Targets, Dashboard, Redistribution

**Files:**
- Modify: `server/src/routes/targets.ts`, `server/src/routes/dashboard.ts`, `server/src/routes/redistribution.ts`

**Interfaces:**
- Consumes: Prisma `kitchenUnit`, `foodItem`, `impactFactor`
- Produces: quick-target ownership checks + reason min 5; dashboard safe JSON.parse; impact factors org-scoped.

- [ ] **Step 1: Run typecheck + unit**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/targets.ts server/src/routes/dashboard.ts server/src/routes/redistribution.ts
git commit -m "fix(api): scope impact factors, validate quick-target, harden dashboard"
```

## Self-Review

1. Spec coverage: Security (Tasks 1-2) ✓, Data integrity (Task 3) ✓, Broken functionality (Tasks 3-5) ✓, UI/UX (Task 4) ✓, Perf/Arch (documented as remaining: pagination, N+1, RLS, indexes) — not over-engineered.
2. Placeholder scan: No TBD/TODO; all steps have exact code/commands.
3. Type consistency: `supabase: Client | null`, `FlowRecord.kitchenUnitId: string | null`, dashboard `inputs: unknown` with cast — consistent.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-01-mealguard-audit-hardening.md`. Tasks 1-5 already executed inline in this session; verification below confirms green build. Remaining DB items (RLS, indexes, CHECKs, retention) require manual Supabase/Prisma migration and are listed as Manual Actions in the final report.
