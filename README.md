# Surplus MealGuard AI - Smart India Hackathon (SIH 2026) Prototype

**AI-Powered Smart Food Waste Prevention & Sustainable Redistribution Ecosystem for Institutional Kitchens and Campus Canteens**

Surplus MealGuard AI is an operational intelligence and food rescue platform designed for institutional kitchens, college messes, hostel canteens, and enterprise dining facilities. It replaces guesswork with **deterministic AI digital memory**, detects mid-service surplus risks before food is wasted (**Surplus-Before-Surplus(TM)), gates donation behind **human-confirmed operational eligibility**, matches surplus to verified local NGOs via multi-criteria scoring, and tracks measurable environmental and financial impact.

---

## Quick Start & Verification

### Prerequisites
- Node.js 20+ (Node 20-24 supported)
- npm 9+
- SQLite (bundled automatically with Prisma - zero external database configuration required)

### 1. One-Command Setup & Seed
```bash
# Installs server & client dependencies, generates Prisma client, applies migrations, and seeds demo dataset
npm run setup
```

### 2. Launch Local Development Environment
```bash
# Starts Express API (:4000) and Vite React Client (:5173) concurrently
npm run dev
```
- **Web Interface:** http://localhost:5173
- **API Health Check:** http://localhost:4000/api/health
- **Interactive SIH Demo Guide:** http://localhost:5173/demo-guide

### 3. Run Automated Verification Test Suite
```bash
npm test
```
The master test runner automatically executes:
1. **Unit Tests (40 tests across 10 suites):** Deterministic time-series forecasting, buffer mathematics, surplus risk pace projection, waste claim attribution, operational eligibility matrix, NGO scoring, and impact factors.
2. **API Authorization & Isolation Tests (10 tests):** Multi-tenant cross-organization ID tampering rejection (404), unauthenticated route rejection (401), staff mutation restrictions (403), NGO isolated scoping, and administrative audit logging.
3. **End-to-End User Journey Tests (7 suites):** Complete signup/onboarding, menu & historical data import, production target generation & live Food Flow, day-close & eligibility assessment, NGO acceptance & pickup handover, and audited multi-format reports export.
4. **System Acceptance Suite (17 tests):** Baseline authentication lifecycle, token verification via mailbox, password reset, and session invalidation.
5. **No Dead Controls Audit:** AST/regex audit across all 30 UI components verifying every button, link, form, and API integration.

### 4. Idempotent Demo Reset
```bash
# Reverts database to pristine SIH demonstration state with 12+ weeks of history, today's targets, live surplus scenario, and verified NGO match
npm run db:reset
```

---

## Demo Credentials Reference

All demonstration accounts are pre-seeded and ready for evaluation. All accounts share standard local test credentials:

| Role | Email | Password | Primary Scope & Access |
|---|---|---|---|
| **Institution Admin** | `admin@mealguard.local` | `Admin12345!` | Full institution management, kitchen settings, menu approvals, targets, day-close, eligibility, NGO matching, audit log. |
| **Kitchen Manager** | `manager@mealguard.local` | `Manager123!` | Production target adjustments with audit reasoning, Food Flow logging, surplus alert actions, waste analysis, eligibility confirmation. |
| **Kitchen Staff** | `staff@mealguard.local` | `Staff12345!` | Real-time Food Flow entry (preparation, batch updates, cafeteria sales, inventory adjustments). Admin mutations blocked (403). |
| **NGO Partner** | `ngo@mealguard.local` | `Ngo123456!` | City Food Helpers portal (/redistribution). View assigned surplus opportunities, accept with intended pickup time, request callbacks. |
| **Super Administrator** | `superadmin@mealguard.local` | `SuperAdmin123!` | Platform-wide oversight, NGO registry management (/ngos), global audit log across all tenants. |

*Note: For self-registration testing, verification and password reset tokens appear in the in-app **Development Mailbox** (`/mailbox`).*

---

## 15-Step SIH Demonstration Storyline

Visit the in-app **Demo Guide** (`/demo-guide`) or follow this structured 15-step narrative during evaluation:

1. **Login as Institution Admin (`/login`):** Sign in with `admin@mealguard.local`. Show persistent session management, role badge in navigation, and brute-force rate limit protection.
2. **Organization & Kitchen Setup (`/organization`):** Review Sunrise College Canteen profile (1,200 served daily, 450 kg capacity) and Main Kitchen meal schedules. Verify organizational boundaries and multi-tenant isolation.
3. **Menu & Portion Catalog (`/menu`):** Review weekly meal rotations, portion weights (kg), and Friday specials (Veg Biryani).
4. **Data Ingestion & Integrity Checks (`/imports`):** Inspect pre-loaded 12-week dataset (~636 daily records) and data validation rules (no negative values, sold <= prepared + remaining).
5. **AI Kitchen Digital Memory (`/memory`):** Examine deterministic statistical baseline for Rice (Lunch). Inspect explainability breakdown: rolling averages, same-weekday seasonality, menu multiplier (capped 0.7-1.3x), and confidence metrics.
6. **Generate Today's Production Target (`/memory`):** Apply a 10% safety buffer to compute today's cooking targets for Rice, Dal, and Vegetable Curry.
7. **Explain Target Math & Self-Correction (`/flow`):** Inspect the exact mathematical formula: `Target = Forecast x (1 + Buffer%)`. Demonstrate manager override logging with mandatory audit reason.
8. **Today vs Same Day Last Week (`/dashboard`):** View comparison cards identifying week-over-week variance and attendance drivers.
9. **Record Live Food Flow (`/flow`):** Inspect today's live service for Rice (40 kg prepared, 6 kg sold across staggered timestamps). Log a new consumption entry to trigger immediate pace recalculation.
10. **Surplus-Before-Surplus(TM) Early Warning (`/flow`):** View the **HIGH SURPLUS RISK** notification banner. Review pace projection indicating ~25 kg unsold at service close and actionable mitigation steps (pause secondary cook batch, offer late cafeteria discount, alert redistribution).
11. **Close the Day (`/eod`):** Reconcile production, sales, and remaining food. Complete the day-close checklist and lock records against tampering.
12. **Explainable Waste Analysis (`/waste`):** Review normalized root-cause attributions (Demand Overestimate, Preparation Timing, Spoilage) and historical buffer recommendations.
13. **Operational Food Eligibility Confirmation (`/eligibility`):** Review candidate surplus (15 kg Rice, hot-holding > 65°C). Verify automated cutoff checks and execute mandatory human confirmation checkbox and signature.
14. **Match, Notify NGO & Complete Pickup (`/redistribution`):** Show multi-criteria NGO scoring: City Food Helpers scores 95/100 (active, local, vehicle pickup, accepts grains). Compare against incompatible/distant NGOs. Dispatch notification, switch to NGO portal, accept pickup, and log handover.
15. **Impact Measurement & Audited Exports (`/reports` & `/audit`):** Inspect estimated meals rescued, CO2e avoided, and INR saved. Download audit-ready reports in CSV, XLSX, and PDF formats. Open the System Audit Log (`/audit`) to inspect complete accountability trail.

---

## Feature Inventory Across All Modules

### 1. Foundation, Multi-Tenant Architecture & Security
- **Role-Based Access Control (RBAC):** Granular authorization enforced on both client routes and backend API endpoints (`SUPER_ADMIN`, `INSTITUTION_ADMIN`, `KITCHEN_MANAGER`, `STAFF`, `NGO`).
- **Organization Scoping:** Strict tenant ownership checks prevent cross-organization ID tampering. Tampered record IDs return 404 rather than leaking data.
- **Authentication Hardening:** Salted password hashing via `bcryptjs`, DB-backed session tokens, and route-specific rate limiting on `/api/auth/*` endpoints.
- **Resilience & Safe Errors:** Centralized Express error handler prevents stack trace or credential leakage. React `ErrorBoundary` and accessible `NotFound` screens prevent white-screen crashes.
- **Offline & Connectivity Awareness:** Live network status detection alerts users when offline, and client `api()` handles network failures gracefully.
- **Accessibility & Focus Visibility:** Fully keyboard navigatable with color-independent status cues, high-contrast `:focus-visible` outlines, and descriptive tooltips.

### 2. AI Kitchen Digital Memory & Target Generation
- **Explainable Forecast Engine:** Deterministic time-series forecasting combining same-weekday rolling averages (60%), recent trend weighting (40%), and bounded menu multipliers (0.7x-1.3x).
- **Data Confidence Scoring:** Variance-grounded metrics ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT') describe historical record density without ungrounded accuracy promises.
- **Dynamic Production Targets:** Configurable safety buffers (fixed kg or percentage). All manual overrides require an explicit justification recorded in the immutable audit log.
- **Closed Feedback Loop:** Tracks signed prediction error metrics against actuals to iteratively adjust future target recommendations.

### 3. Surplus-Before-Surplus(TM) Live Risk Detection
- **Pace Projection Algorithm:** Projects sales trajectory based on elapsed service time across multiple distinct transaction timestamps.
- **Tiered Risk Classification:** Categorizes risk into HIGH, MEDIUM, and LOW bands with operational guidance before service concludes.
- **Operational Mitigation Playbook:** Suggests concrete actions: hold secondary cook batches, implement discounted flash-sales, or initiate early redistribution matching.

### 4. End-of-Day Reconciliation & Waste Analysis
- **Daily Food Reconciliation:** Validates mass balance: Produced = Sold + Waste + Remaining.
- **Immutable Day Locking:** Prevents retroactive manipulation; reopening a closed day requires supervisory authorization and an audited reason.
- **Explainable Waste Diagnostics:** Apportions discarded food into quantifiable, normalized categories with evidence notes and historical day-of-week buffer tuning advice.

### 5. Operational Eligibility & Human Confirmation Gate
- **Decision Support Matrix:** Automated operational checks verify minimum batch cutoff (default 10 kg), remaining shelf-life margin, and recorded holding conditions.
- **Mandatory Human Confirmation:** The system refuses to mark surplus eligible without explicit human visual, sensory, and temperature sign-off.
- **Disposal Invalidation:** Ineligible food is routed directly to documented kitchen waste records to prevent spoiled food from entering redistribution.

### 6. Algorithmic NGO Matching & Redistribution Lifecycle
- **Multi-Criteria Scoring Engine:** Matches eligible surplus against registered NGOs based on active status, geographical proximity, vehicle pickup capability, accepted food categories, operating hours, and capacity.
- **Audited Chain of Custody:** State machine tracking transitions: `DRAFT` -> `MATCHED` -> `NOTIFIED` -> `ACCEPTED` / `DECLINED` -> `SCHEDULED` -> `COMPLETED` / `CANCELLED`.
- **NGO Isolation Portal:** NGO accounts can only view opportunities specifically dispatched to their organization.

### 7. Impact Analytics, Reports Export & Audit Trail
- **Environmental & Financial Modeling:** Calculates meals rescued, estimated CO2e greenhouse gas emissions prevented, and monetary cost savings based on transparent, configurable factor tables.
- **Multi-Format Document Generation:** Export audit-ready reports in CSV, Microsoft Excel (`.xlsx`), and formatted PDF formats.
- **Immutable System Audit Log:** Authorized log (`/audit`) capturing user authentication, onboarding, target adjustments, day closures/reopenings, eligibility sign-offs, and redistribution transitions.

---

## Known Prototype Boundaries & Limitations (Stated Honestly)

In accordance with SIH evaluation guidelines and ethical engineering principles, Surplus MealGuard AI states all operational boundaries transparently:

1. **Deterministic Statistical Learning, Not Generative AI:** Production forecasts and surplus risk assessments utilize deterministic statistical algorithms (rolling averages, seasonality multipliers, standard deviation spread). The system does not employ opaque deep neural networks, third-party generative LLMs, or claim unverified "95%+ guaranteed precision".
2. **Operational Logistics Decision Support, Not Scientific Certification:** Food eligibility checks assess recorded operational details (storage temperature, batch cutoff, elapsed hours). It is an operational decision support system that **strictly mandates human sensory inspection and sign-off** and does not substitute for statutory laboratory food safety testing.
3. **Documented Estimates for Impact Figures:** Ecological (CO2e avoided) and financial (cost saved) calculations are transparent, configurable mathematical estimates (2.5 kg CO2e / kg food, Rs 120 / kg food) rather than direct physical sensor measurements.
4. **Local Mailbox Delivery Sandbox:** When external SMTP environment variables are unconfigured, outbound transactional emails (verification tokens, password resets, NGO notifications) are safely simulated into the in-app Development Mailbox (`/mailbox`), ensuring complete end-to-end testing without external network dependencies.
5. **Deliberate Out-of-Scope Exclusions:** In compliance with project constraints, the prototype explicitly avoids third-party map APIs, GPS routing optimization, IoT temperature sensor hardware, camera OCR/vision models, and weather APIs. Addresses and operational data are stored cleanly as structured database fields.

---

## Technical Stack & Architecture

- **Frontend:** React 18, TypeScript 5, Vite 5, Tailwind CSS 3, React Router 6.
- **Backend API:** Node.js 24, Express 4, TypeScript 5, Zod 3 (strict input validation schema).
- **Database & ORM:** SQLite via Prisma ORM 5 (fully persistent local database).
- **Authentication & Security:** bcryptjs (salted password hashing), crypto-secure session tokens, express-rate-limit.
- **Document & File Processing:** PDFKit (server-side PDF rendering), SheetJS/XLSX (Excel generation), CSV-Parse.
- **Testing Frameworks:** Built-in Node.js Test Runner (`node:test`, `node:assert/strict`), TSX.

---

## Repository Structure

```
Surplus MealGuard AI/
├── client/                     # Vite + React frontend application
│   ├── src/
│   │   ├── components/         # Layout, ErrorBoundary, role guards
│   │   ├── pages/              # 21 verified pages (Flow, Memory, Reports, DemoGuide, Audit, etc.)
│   │   ├── api.ts              # Resilient fetch client with offline handling
│   │   └── App.tsx             # Master router, error boundary, and 404 fallback
├── server/                     # Express + Prisma backend API
│   ├── prisma/                 # Database schema and migration history
│   │   ├── schema.prisma       # Domain data models (Flow, Target, NGO, Impact, Audit)
│   │   └── dev.db              # Persistent SQLite database
│   ├── src/
│   │   ├── lib/                # Pure business logic (forecasts, eligibility, matching, impact)
│   │   ├── routes/             # Authorized API routes with Zod schema validation
│   │   ├── app.ts              # Express application setup, rate limiting, error middleware
│   │   └── seed.ts             # Idempotent SIH demo dataset seeder
│   └── tests/                  # Automated test suites
│       ├── unit/               # 40 pure unit tests
│       ├── api/                # API authorization and security tests
│       └── e2e/                # 7 complete user journey tests
├── scripts/
│   ├── run-tests.mjs           # Master test suite orchestrator
│   ├── db-reset.mjs            # Safe, explicit demo database reset script
│   └── no-dead-controls.mjs    # Interactive UI controls verification script
├── docs/                       # Controls audit documentation and plans
│   └── controls-audit.md       # 100% verified controls checklist
└── package.json                # Master scripts (setup, dev, test, db:reset, build)
```

---

*Surplus MealGuard AI - Developed for the Smart India Hackathon (SIH 2026).*
