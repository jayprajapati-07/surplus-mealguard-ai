# Prompt 2: Menu, Data Entry, Import, Cleaning, Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add food-item/menu management, manual Food Flow entry with coherence validation, and real CSV/XLSX import with mapping + error reports, plus 12-week seed history, without regressing Prompt 1.

**Architecture:** Extend Prisma models (new nullable columns only, no renames); add three Express routers (`food-items`, `menus`, `food-records`, `imports`) mounted in `app.ts` following the existing `requireAuth`/`requireRole`/`audit` patterns; add three React pages with role-aware nav/guards; extend `seed.ts` deterministically.

**Tech Stack:** Express + TypeScript + zod, Prisma + SQLite, multer + csv-parse + xlsx (SheetJS) for imports, React + react-router-dom + Tailwind.

**Spec:** Prompt 2 text in conversation (Prompt 1 contract in `README.md` still applies).

## Global Constraints

- Persistent local SQLite via Prisma; no browser-only mock state; every visible control performs a real action.
- No weather/maps/IoT/camera/OCR/vision/route-optimization; address text only (already true, keep true).
- Deterministic explainable logic only; quantities in kg; emissions/savings labelled estimates.
- Passwords hashed; role guards on API and frontend; hidden nav for unauthorized roles.
- TypeScript strict with no ignored errors (`npm run typecheck` passes).
- Preserve Prompt 1 behavior; rerun Prompt 1 regression checks after changes.

---

### Task 1: Prisma schema extension + migration

**Files:**
- Modify: `server/prisma/schema.prisma` (FoodItem, Menu, DailyFoodRecord blocks only)
- Test: `server` `npx prisma validate` + `npx prisma migrate dev`

**Interfaces:**
- Consumes: existing models and `@@unique([organizationId, name])` on FoodItem (kept).
- Produces: new columns consumed by Tasks 2–5:
  - `FoodItem: mealType String?, standardPortionKg Float?, sellingPrice Float?, recipeText String?, isActive Boolean @default(true)`
  - `Menu: title String?, scope String @default("DAILY"), isSpecial Boolean @default(false), specialLabel String?`
  - `DailyFoodRecord: foodItemId String?, foodItem FoodItem?, targetKg Float?, soldKg Float?, remainingKg Float?, adjustmentReason String?, isCorrection Boolean @default(false), correctionReason String?` plus `@@unique([organizationId, kitchenUnitId, foodItemId, date, mealType])`? No — foodItemId nullable so unique would misbehave on SQLite; instead enforce duplicates in code. Keep existing indexes.

- [ ] **Step 1: Edit schema blocks**

```prisma
model FoodItem {
  id                 String   @id @default(cuid())
  organizationId     String
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name               String
  category           String
  mealType           String?
  standardPortionKg  Float?
  sellingPrice       Float?
  recipeText         String?
  isActive           Boolean  @default(true)
  unit               String   @default("kg")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  ...
  @@unique([organizationId, name])
}
```

```prisma
model Menu {
  ...
  title       String?
  scope       String    @default("DAILY")
  isSpecial   Boolean   @default(false)
  specialLabel String?
  ...
}
```

```prisma
model DailyFoodRecord {
  ...
  foodItemId       String?
  targetKg         Float?
  soldKg           Float?
  remainingKg      Float?
  adjustmentReason String?
  isCorrection     Boolean @default(false)
  correctionReason String?
  ...
}
```

- [ ] **Step 2: Validate and migrate**

Run: `npx prisma validate`
Expected: `The schema ... is valid`

Run: `npx prisma migrate dev --name prompt2-food-menu-records`
Expected: migration applies cleanly on top of Prompt 1 migration.

- [ ] **Step 3: Regenerate client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`.

### Task 2: Food items + menus API

**Files:**
- Create: `server/src/routes/food-items.ts`, `server/src/routes/menus.ts`
- Modify: `server/src/app.ts` (mount `/api/food-items`, `/api/menus`)
- Test: acceptance script `server/accept-p2.js` steps F1–F6

**Interfaces:**
- Consumes: `requireAuth`, `requireRole`, `audit`, `prisma` (existing patterns).
- Produces: REST used by Task 6:
  - `GET /api/food-items` → `{ items }` (all, active first)
  - `POST /api/food-items` (ADMIN/MANAGER/SUPER) body `{name, category, mealType?, standardPortionKg?, sellingPrice?, unit?, recipeText?}` → 201 `{ item }`; duplicate active name (case-insensitive, trimmed) → 409 unless `{allowDuplicateName: true}`? No — spec says prevent duplicates "unless the user explicitly changes the name", i.e. rename; so 409 always on clash with an *active* item; archived names may be reused.
  - `PUT /api/food-items/:id` (ADMIN/MANAGER/SUPER) → 200; renaming onto another active item's name → 409.
  - `POST /api/food-items/:id/archive` → sets `isActive=false`; `POST .../restore` → checks clash then `isActive=true`; `DELETE ...` → hard delete only if no MenuItem/DailyFoodRecord references, else 409 telling user to archive.
  - `GET /api/menus?scope=&from=&to=&kitchenUnitId=` → `{ menus }` with items+foodItem.
  - `POST /api/menus` (ADMIN/MANAGER/SUPER) body `{kitchenUnitId?, date?, weekStart?, scope: DAILY|WEEKLY, mealType: BREAKFAST|LUNCH|DINNER, title?, isSpecial?, specialLabel?, items: [{foodItemId, quantityKg}]}` → validates every foodItemId belongs to org and isActive, quantityKg > 0 → 201.
  - `PUT /api/menus/:id` → same validation; `DELETE /api/menus/:id` → cascade items.

- [ ] **Step 1: Write `food-items.ts` with zod schemas**

```ts
const foodSchema = z.object({
  name: z.string().trim().min(2, 'Food name must be at least 2 characters.'),
  category: z.string().trim().min(2, 'Category is required.'),
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'ANY']).optional(),
  standardPortionKg: z.coerce.number().positive().max(1000).optional(),
  sellingPrice: z.coerce.number().min(0).max(100000).optional(),
  unit: z.string().trim().min(1).max(16).optional().default('kg'),
  recipeText: z.string().trim().max(2000).optional(),
});
```

Duplicate check helper (case-insensitive):

```ts
async function activeNameClash(orgId: string, name: string, exceptId?: string) {
  const items = await prisma.foodItem.findMany({ where: { organizationId: orgId, isActive: true } });
  const norm = name.trim().toLowerCase();
  return items.some((i) => i.name.trim().toLowerCase() === norm && i.id !== exceptId);
}
```

- [ ] **Step 2: Write `menus.ts`** validating scope/meal enums, date parsing, at least one item, all items resolve to active org food items.
- [ ] **Step 3: Mount routers in `app.ts`** and typecheck (`npm --prefix server run typecheck` passes).

### Task 3: Food records API (manual entry + corrections)

**Files:**
- Create: `server/src/routes/food-records.ts`
- Modify: `server/src/app.ts` (mount `/api/food-records`)
- Test: acceptance steps R1–R5

**Interfaces:**
- Consumes: FoodItem/KitchenUnit of caller's org.
- Produces for Task 6 + imports (Task 4 reuses `validateAndCreateRecord`):
  - `GET /api/food-records?from=&to=&kitchenUnitId=&foodItemId=` → `{ records }` desc by date.
  - `POST /api/food-records` (ADMIN/MANAGER/STAFF/SUPER; NGO blocked 403) body `{date, kitchenUnitId, foodItemId, mealType, targetKg?, producedKg, soldKg, wasteKg, remainingKg, notes?, adjustmentReason?, isCorrection?, correctionReason?, correctsRecordId?}` → coherence rule: if `sold+waste+remaining > produced` then `adjustmentReason` (min 5 chars) required, else 400 and nothing saved. All quantities ≥ 0. Duplicate (org, date-day, kitchen, food, meal, non-correction) → 409. Corrections (`isCorrection=true`) require `correctionReason` (min 5) and bypass duplicate check; audit logged.
  - `PUT /api/food-records/:id` same rules; stores `correctionReason` when values change.

```ts
export function coherenceError(produced: number, sold: number, waste: number, remaining: number, adjustmentReason?: string): string | null {
  if (sold + waste + remaining <= produced + 1e-9) return null;
  if (adjustmentReason && adjustmentReason.trim().length >= 5) return null;
  return 'Produced must cover sold + waste + remaining (kg), or provide an adjustment reason (min 5 characters).';
}
```

- [ ] **Step 1: Implement router** with `normalizeDay(d: Date)` helper (UTC midnight) used for duplicate checks.
- [ ] **Step 2: Mount + typecheck.**

### Task 4: Imports API (upload, mapping, confirm, jobs, downloads)

**Files:**
- Create: `server/src/routes/imports.ts`, `server/src/lib/import-parse.ts` (aliases, unit conversion, date normalization)
- Modify: `server/package.json` (+ `multer`, `csv-parse`, `xlsx`, `@types/multer`), `server/src/app.ts`
- Test: acceptance steps I1–I7 with real CSV + XLSX fixtures

**Interfaces:**
- Consumes: Task 3 duplicate/coherence logic (imported as helper or re-implemented identically).
- Produces for Task 6:
  - `GET /api/imports/templates/csv` → `text/csv` attachment `mealguard-sample-template.csv` with header `Date,Food Item,Target,Produced,Sold,Waste,Surplus/Remaining,Meal,Unit` + 3 example rows (Rice, Dal, Chapati).
  - `GET /api/imports/templates/xlsx` → same content as real `.xlsx` attachment.
  - `POST /api/imports/parse` (multipart `file`, ADMIN/MANAGER/SUPER) → `{headers, mapping: {expectedField: {column, confidence}}, preview: rows[0..5], rowCount, needsMapping: boolean}`. Aliases: date→{date}, food item→{food item, item, dish}, target→{target}, produced→{produced, prepared}, sold→{sold, served}, waste→{waste, wastage}, surplus→{surplus, remaining, leftover, balance}, meal→{meal}, unit→{unit, uom}. Confidence high if exact/lower-trim match, medium if alias substring, else unmapped → `needsMapping=true`.
  - `POST /api/imports/confirm` (multipart `file` + text fields `mapping` JSON + `kitchenUnitId` + optional `defaultMeal`) → validates each row: date parse (ISO, DD/MM/YYYY, DD-MM-YYYY, Excel serial via xlsx), food name normalize (trim+collapse spaces; lookup case-insensitive; auto-create missing as `{category:'General', unit:'kg', mealType}`), unit→kg factor map `{kg:1, g:0.001, gm:0.001, gram:0.001, quintal:100, tonne:1000, ton:1000, lb:0.453592, oz:0.0283495}` else row invalid `Unknown unit`; coherence + duplicate checks same as Task 3 → creates records for valid rows, `ImportJob{status COMPLETED, totalRows, successRows, errorRows}` + `ImportRowError{rowNumber, errorMessage, rawDataJson}` per bad row → `{job, accepted, duplicates, invalid, skipped}`. Nothing created for invalid rows.
  - `GET /api/imports/jobs` → recent jobs; `GET /api/imports/jobs/:id` → job + errors; `GET /api/imports/jobs/:id/errors.csv` → real CSV of errors.

- [ ] **Step 1: Add deps + `import-parse.ts`** with pure functions `suggestMapping(headers)`, `unitToKg(unit): number|null`, `parseDateCell(v: unknown): Date|null`, `normalizeFoodName(s: string)`.
- [ ] **Step 2: Implement router** with multer memory storage, 5 MB limit, extension filter `.csv/.xlsx/.xls`, and stream/buffer parsing (csv-parse sync for csv; `xlsx.read(buffer)` + `sheet_to_json(header:1)` for excel).
- [ ] **Step 3: Mount + typecheck.**

### Task 5: Seed 12-week history

**Files:**
- Modify: `server/src/seed.ts` (append history seeding; keep existing users/org/kitchen upserts untouched)
- Test: `recordCount >= 12*7*meals` for Main Kitchen; rerun idempotent

**Interfaces:**
- Consumes: FoodItem/Menu/DailyFoodRecord models.
- Produces: items (Rice, Dal, Vegetable Curry, Chapati, Idli + Sambar, Curd Rice, Khichdi) with portions/prices; 2 rotating weekly menus; 84 days × 2–3 meals of DailyFoodRecords ending yesterday with weekday patterns (weekend ×0.55 volume, Wednesday—butter-milk special, Friday veg-biryani special), 6 overproduction rows (produced +25%), 2 underproduction rows (sold capped, remaining 0, adjustmentReason recorded), waste 2–8%, surplus varying; notes tag `potential-surplus:likely/unlikely` for later prompts.

Deterministic PRNG:

```ts
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Idempotency: skip seeding history if `DailyFoodRecord.count({where:{organizationId}}) >= 400`.

- [ ] **Step 1: Append food items + history block** (no changes to existing seed logic).
- [ ] **Step 2: Run seed twice** → second run changes nothing (count stable).

### Task 6: Frontend (nav, guards, Menu / Food Data / Imports pages)

**Files:**
- Modify: `client/src/components/Layout.tsx` (role-aware nav), `client/src/components/guards.tsx` (+`RequireMenuAccess`, `RequireImportAccess`, `RequireFoodDataAccess`), `client/src/App.tsx` (routes `/menu`, `/food-data`, `/imports`), `client/src/auth-context.tsx` (add kitchens? already has organization.kitchens — reuse).
- Create: `client/src/pages/MenuPage.tsx`, `client/src/pages/FoodData.tsx`, `client/src/pages/Imports.tsx`
- Test: manual + acceptance A1–A5 (role visibility via rendered nav; staff blocked route message; downloads produce files)

**Interfaces:**
- Consumes: Task 2–4 endpoints via existing `api()` helper.
- Produces: visible UI where every button works:
  - Nav: SUPER/ADMIN/MANAGER → Menu, Food Data, Imports; STAFF → Food Data only; NGO → none of the three (Dashboard/Organization/Mailbox/Logout remain for all).
  - Menu page (ADMIN/MANAGER): food-item table with active/archived filter, create/edit dialog with validation, archive/restore/delete with `window.confirm`-style accessible dialog; menu builder (daily/weekly, meal, kitchen, special label, items from active-food dropdown, quantities kg); menus list; edit persists after refresh.
  - Food Data page (ADMIN/MANAGER/STAFF): entry form (date, kitchen, food dropdown from saved items, meal, target/produced/sold/waste/remaining kg, notes, adjustment/correction reasons shown conditionally); coherence error shown, nothing saved until valid; records table; financial info (selling price) shown in a separate labelled box, never mixed into kg math.
  - Imports page (ADMIN/MANAGER): kitchen selector, file input (.csv/.xlsx/.xls), Upload→mapping step (dropdown per expected field, confirm), results (accepted/duplicate/invalid counts + error table), jobs list, error CSV download, sample CSV/XLSX download buttons (anchor to template endpoints).

- [ ] **Step 1: Layout + guards + routes.**
- [ ] **Step 2: MenuPage.**
- [ ] **Step 3: FoodData.**
- [ ] **Step 4: Imports.**
- [ ] **Step 5: `npm --prefix client run typecheck` + `npm run build` pass.**

### Task 7: Verification + docs

**Files:**
- Modify: `README.md` (Prompt 2 section: routes, roles, import format, seed history)
- Create: `server/accept-p2.js` (temporary, delete after run)
- Test: full suite

- [ ] **Step 1: Typecheck + builds** (server, client).
- [ ] **Step 2: Prompt 1 regression** (signup→verify→login→onboard→role-block→logout script re-run).
- [ ] **Step 3: Prompt 2 acceptance** (food create→menu→edit→refresh persist; staff food-data ok + menu/import 403; valid CSV+XLSX import creates; invalid rows in error report, no records; duplicate re-import flagged; template + error downloads non-empty).
- [ ] **Step 4: Update README, delete temp script, `git status` review.**

## Self-Review

- Spec coverage: nav roles ✓ (T6); food fields + archive confirm + dup names + reuse items ✓ (T2/T6); daily+weekly + B/L/D + special label ✓ (T2/T6); manual entry fields + nonnegative + coherence + corrections + flow-vs-finance ✓ (T3/T6); csv/xlsx/xls + fields + templates + aliases/mapping + normalize/units + duplicates + counts/error-table + ImportJob/RowError + error CSV ✓ (T4/T6); 12-week seed with patterns/cases/items/consistency ✓ (T5); acceptance ✓ (T7).
- Placeholders: none — all steps name exact files, endpoints, schemas, and commands.
- Type consistency: field names (`standardPortionKg`, `sellingPrice`, `targetKg`, `soldKg`, `remainingKg`, `adjustmentReason`, `correctionReason`, `isSpecial`, `specialLabel`, `scope`) identical across T1–T6; frontend uses same keys.
