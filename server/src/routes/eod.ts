import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { coherenceError } from '../lib/flow';
import { dedupeToLatest } from '../lib/kitchen-memory';
import { computeSurplus, predictionError } from '../lib/eod-report';
import { summarizeDayReport } from '../lib/gemini-explain';
import { triggerAutoDistribution, type AutoDistributionResult } from '../lib/food-distribution';
import { scoreNgoMatch } from '../lib/matching';
import { geocodeHotelAddress } from '../lib/open-geo';
import { haversineKm } from '../lib/ngo-discovery';
import { smtpConfigured, resendConfigured } from '../lib/mailer';
import { getSchedulerState } from '../lib/scheduler-state';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the request.', details: err.errors });
}

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

function parseDay(dateStr: string | undefined): { day?: Date; next?: Date; key?: string; error?: string } {
  if (!dateStr) return { error: 'Date is required (YYYY-MM-DD).' };
  // App-wide convention: YYYY-MM-DD parses as UTC midnight; bucket the UTC day.
  const raw = new Date(dateStr);
  if (isNaN(raw.getTime())) return { error: 'Date is not valid (use YYYY-MM-DD).' };
  const day = new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
  return { day, next: new Date(day.getTime() + 86400000), key: day.toISOString().slice(0, 10) };
}

interface AggRow {
  recordId: string; foodItemId: string | null; food: string; mealType: string;
  targetKg: number | null; preparedKg: number; servedKg: number; soldKg: number;
  wasteKg: number; remainingKg: number; notes: string | null; isCorrection: boolean;
}

async function dayAggregate(orgId: string, kitchenUnitId: string, day: Date, next: Date) {
  const records = await prisma.dailyFoodRecord.findMany({
    where: { organizationId: orgId, kitchenUnitId, date: { gte: day, lt: next } },
    orderBy: { createdAt: 'asc' }, take: 1000,
    include: { foodItem: true },
  });
  const rows: AggRow[] = dedupeToLatest(records).map((r) => ({
    recordId: r.id, foodItemId: r.foodItemId, food: r.foodItem?.name ?? 'Unknown item', mealType: r.mealType,
    targetKg: r.targetKg, preparedKg: r.preparedKg, servedKg: r.servedKg, soldKg: r.soldKg ?? r.servedKg,
    wasteKg: r.wasteKg, remainingKg: r.remainingKg ?? 0, notes: r.notes, isCorrection: r.isCorrection,
  }));
  const incoherent = rows
    .map((r) => {
      const problem = coherenceError(r.preparedKg, r.soldKg, r.wasteKg, r.remainingKg, null);
      if (!problem) return null;
      return { recordId: r.recordId, food: r.food, mealType: r.mealType,
        shortfall: r3(r.soldKg + r.wasteKg + r.remainingKg - r.preparedKg),
        hint: 'Fix with a food-records correction carrying an adjustment reason, then close again.' };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const totals = {
    preparedKg: r3(rows.reduce((x, r) => x + r.preparedKg, 0)),
    servedKg: r3(rows.reduce((x, r) => x + r.servedKg, 0)),
    soldKg: r3(rows.reduce((x, r) => x + r.soldKg, 0)),
    wasteKg: r3(rows.reduce((x, r) => x + r.wasteKg, 0)),
    remainingKg: r3(rows.reduce((x, r) => x + r.remainingKg, 0)),
    records: rows.length,
    corrections: rows.filter((r) => r.isCorrection).length,
  };
  return { rows, totals, incoherent };
}

async function accuracyFor(orgId: string, kitchenUnitId: string, day: Date, next: Date, rows: AggRow[]) {
  const targets = await prisma.productionTarget.findMany({
    where: { organizationId: orgId, kitchenUnitId, date: { gte: day, lt: next } }, take: 500,
  });
  const errs: number[] = [];
  let withTarget = 0;
  for (const r of rows) {
    const t = targets.find((x) => x.foodItemId === r.foodItemId && x.mealType === r.mealType);
    if (!t) continue;
    withTarget++;
    const eff = t.adjustedKg ?? t.recommendedKg;
    if (r.soldKg > 0) errs.push(Math.abs(r.soldKg - eff) / r.soldKg);
  }
  return {
    pairs: errs.length,
    meanAbsPctErr: errs.length > 0 ? r3((errs.reduce((x, y) => x + y, 0) / errs.length) * 100) : null,
    targetsPresent: withTarget,
    targetsMissing: rows.length - withTarget,
  };
}

// GET /api/eod/preview — review without persisting
router.get('/preview', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'), date: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const { day, next, key, error } = parseDay(parsed.data.date);
  if (error || !day || !next || !key) return res.status(400).json({ error: error ?? 'Date is not valid.' });
  // Records read and existing-report check are independent — accuracy needs rows, so it follows.
  const [agg, existing] = await Promise.all([
    dayAggregate(orgId, kitchen.id, day, next),
    prisma.endOfDayReport.findFirst({
      where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next }, status: 'FINAL' },
    }),
  ]);
  const { rows, totals, incoherent } = agg;
  const accuracy = await accuracyFor(orgId, kitchen.id, day, next, rows);
  return res.json({
    date: key, kitchen: { id: kitchen.id, name: kitchen.name },
    rows, totals, potentialSurplusKg: totals.remainingKg, incoherent,
    accuracyPreview: accuracy, alreadyFinalized: !!existing,
  });
});

// POST /api/eod/close — finalize the day (managers only)
router.post('/close', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
    date: z.string().min(1, 'Date is required (YYYY-MM-DD).'),
    notes: z.string().trim().max(1000, 'Notes are too long.').optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const { day, next, key, error } = parseDay(parsed.data.date);
  if (error || !day || !next || !key) return res.status(400).json({ error: error ?? 'Date is not valid.' });
  const [agg, dupe] = await Promise.all([
    dayAggregate(orgId, kitchen.id, day, next),
    prisma.endOfDayReport.findFirst({
      where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next }, status: 'FINAL' },
    }),
  ]);
  const { rows, totals, incoherent } = agg;
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No food records for this kitchen/date — nothing to close.' });
  }
  if (incoherent.length > 0) {
    return res.status(409).json({
      error: `${incoherent.length} record(s) are incoherent (sold + waste + remaining exceeds produced). Totals were NOT forced — fix them with reasoned corrections first.`,
      incoherent,
    });
  }
  if (dupe) {
    return res.status(409).json({ error: 'This kitchen/date is already finalized. Reopen with an audit reason to change it.' });
  }
  const accuracy = await accuracyFor(orgId, kitchen.id, day, next, rows);
  const missingFood = rows.filter((r) => !r.foodItemId).length;
  const report = await prisma.endOfDayReport.create({
    data: {
      organizationId: orgId, kitchenUnitId: kitchen.id, date: day,
      totalPreparedKg: totals.preparedKg, totalServedKg: totals.servedKg,
      totalWasteKg: totals.wasteKg, totalSurplusKg: totals.remainingKg,
      notes: parsed.data.notes?.trim() || null, status: 'FINAL',
      accuracyJson: JSON.stringify(accuracy),
      qualityNotes: `${totals.records} records (${totals.corrections} corrections); accuracy pairs ${accuracy.pairs}; ` +
        `${accuracy.targetsMissing} line(s) without a target; ${missingFood} line(s) without a food link.`,
    },
  });
  await audit('eod.close', { userId: req.userId, organizationId: orgId, entityType: 'EndOfDayReport', entityId: report.id,
    metadata: { kitchenUnitId: kitchen.id, date: key, totals } });
  return res.status(201).json({ message: `Day closed for ${kitchen.name} on ${key}.`, report });
});

// POST /api/eod/reopen — authorized undo with audit reason
router.post('/reopen', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
    date: z.string().min(1, 'Date is required (YYYY-MM-DD).'),
    reason: z.string().trim().min(5, 'Reopening needs an audit reason (min 5 characters).').max(500, 'Reason is too long.'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  const { day, next, key, error } = parseDay(parsed.data.date);
  if (error || !day || !next || !key) return res.status(400).json({ error: error ?? 'Date is not valid.' });
  const existing = await prisma.endOfDayReport.findFirst({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next }, status: 'FINAL' },
  });
  if (!existing) return res.status(404).json({ error: 'No finalized report for this kitchen/date to reopen.' });
  const report = await prisma.endOfDayReport.update({
    where: { id: existing.id },
    data: { status: 'REOPENED', reopenedAt: new Date(), reopenReason: parsed.data.reason.trim() },
  });
  await audit('eod.reopen', { userId: req.userId, organizationId: orgId, entityType: 'EndOfDayReport', entityId: report.id,
    metadata: { kitchenUnitId: kitchen.id, date: key, reason: report.reopenReason } });
  return res.json({ message: `Report reopened for ${kitchen.name} on ${key}. Closing again creates a new finalized row.`, report });
});

// GET /api/eod/reports
router.get('/reports', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {  const schema = z.object({ kitchenUnitId: z.string().min(1).optional(), from: z.string().optional(), to: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const where: { organizationId: string; kitchenUnitId?: string; date?: { gte: Date; lt: Date } } = { organizationId: orgId };
  if (parsed.data.kitchenUnitId) where.kitchenUnitId = parsed.data.kitchenUnitId;
  if (parsed.data.from || parsed.data.to) {
    const f = parsed.data.from ? new Date(parsed.data.from) : null;
    const t = parsed.data.to ? new Date(parsed.data.to) : null;
    if ((f && isNaN(f.getTime())) || (t && isNaN(t.getTime()))) {
      return res.status(400).json({ error: 'From/to dates are not valid (use YYYY-MM-DD).' });
    }
    where.date = {
      gte: f ?? new Date(0),
      lt: t ? new Date(t.getTime() + 86400000) : new Date(Date.now() + 86400000),
    };
  }
  const reports = await prisma.endOfDayReport.findMany({
    where, orderBy: { date: 'desc' }, take: 100,
    include: { kitchenUnit: true },
  });
  return res.json({
    reports: reports.map((r) => ({
      id: r.id, date: r.date, kitchen: r.kitchenUnit?.name ?? '—',
      totalPreparedKg: r.totalPreparedKg, totalServedKg: r.totalServedKg,
      totalWasteKg: r.totalWasteKg, totalSurplusKg: r.totalSurplusKg,
      notes: r.notes, status: r.status,
      accuracy: r.accuracyJson ? JSON.parse(r.accuracyJson as string) : null,
      qualityNotes: r.qualityNotes, reopenedAt: r.reopenedAt, reopenReason: r.reopenReason,
    })),
  });
});

export interface AutoEodResult {
  organizationId: string;
  organizationName: string;
  kitchenUnitId: string;
  kitchenName: string;
  date: string;
  status: 'created' | 'skipped-empty' | 'skipped-exists' | 'failed';
  reportId?: string;
  surplusKg?: number;
  inconsistency?: boolean;
  distribution?: AutoDistributionResult;
  error?: string;
}

/**
 * Phase 3 automatic report for one kitchen/day. Sources of truth:
 * produced/sold/waste = DailyFoodRecord actuals; predicted = ML ProductionTarget;
 * surplus = computeSurplus() (deterministic, never Gemini, never negative);
 * summary words = Gemini polish over verified numbers (template fallback).
 * Never overwrites an existing FINAL report (manual close wins).
 */
export async function buildAutoReport(
  orgId: string, kitchenId: string, day: Date, next: Date, key: string, regenerate = false
): Promise<AutoEodResult> {
  const base = { organizationId: orgId, kitchenUnitId: kitchenId, date: key };
  const [kitchen, org] = await Promise.all([
    prisma.kitchenUnit.findFirst({ where: { id: kitchenId, organizationId: orgId } }),
    prisma.organization.findUnique({ where: { id: orgId } }),
  ]);
  if (!kitchen || !org) {
    return { ...base, organizationName: org?.name ?? '', kitchenName: kitchen?.name ?? '', status: 'failed', error: 'Kitchen or organization not found.' };
  }
  const names = { organizationName: org.name, kitchenName: kitchen.name };
  const { rows, totals } = await dayAggregate(orgId, kitchen.id, day, next);
  if (rows.length === 0) return { ...base, ...names, status: 'skipped-empty' };
  const dupe = await prisma.endOfDayReport.findFirst({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next }, status: 'FINAL' },
  });
  if (dupe && !regenerate) return { ...base, ...names, status: 'skipped-exists', reportId: dupe.id };
  if (dupe && regenerate) {
    // Regeneration keeps history: the previous FINAL is preserved as REOPENED,
    // and a fresh FINAL row is created below. NGO emails stay idempotent via
    // the stable distribution key (already-sent NGOs are never resent).
    await prisma.endOfDayReport.update({
      where: { id: dupe.id },
      data: { status: 'REOPENED', reopenedAt: new Date(), reopenReason: 'Regenerated — superseded by a newer report.' },
    });
  }

  const produced = totals.preparedKg;
  const sold = totals.soldKg;
  const waste = totals.wasteKg;
  const s = computeSurplus(produced, sold);

  const targets = await prisma.productionTarget.findMany({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next } },
    take: 500,
  });
  let predicted: number | null = null;
  const perFood: { food: string; mealType: string; predicted: number; sold: number; absErr: number }[] = [];
  const rmses: number[] = [];
  let mlFoods = 0;
  if (targets.length > 0) {
    predicted = r3(targets.reduce((x, t) => x + (t.adjustedKg ?? t.recommendedKg), 0));
    for (const row of rows) {
      const t = targets.find((x) => x.foodItemId === row.foodItemId && x.mealType === row.mealType);
      if (!t) continue;
      const eff = t.adjustedKg ?? t.recommendedKg;
      perFood.push({ food: row.food, mealType: row.mealType, predicted: eff, sold: row.soldKg, absErr: r3(Math.abs(row.soldKg - eff)) });
      try {
        const v = t.inputsJson ? (JSON.parse(t.inputsJson as string) as { modelVersion?: string; validation?: { rmse?: unknown } }) : null;
        if (v?.modelVersion === 'ml-v1' && typeof v?.validation?.rmse === 'number') {
          rmses.push(v.validation.rmse as number);
          mlFoods++;
        }
      } catch { /* legacy rows without JSON */ }
    }
  }
  const err = predictionError(predicted, sold);
  const accuracy = await accuracyFor(orgId, kitchen.id, day, next, rows);
  const summary = await summarizeDayReport({
    dateLabel: key, hotelName: org.name, predictedKg: predicted,
    producedKg: produced, soldKg: sold, surplusKg: s.surplusKg, wasteKg: waste,
    inconsistency: s.inconsistency,
  });

  const accuracyPayload = {
    ...accuracy,
    autoGenerated: true,
    predictedKg: predicted, producedKg: produced, soldKg: sold, wasteKg: waste,
    surplusKg: s.surplusKg, surplusRawKg: s.rawKg,
    inconsistency: s.inconsistency, inconsistencyMessage: s.message,
    predictionError: err,
    mlValidation: mlFoods > 0 ? { foods: mlFoods, avgRmse: r3(rmses.reduce((x, y) => x + y, 0) / rmses.length) } : null,
    perFood: perFood.slice(0, 100),
    summary,
    distribution: null as AutoDistributionResult | null,
  };
  const report = await prisma.endOfDayReport.create({
    data: {
      organizationId: orgId, kitchenUnitId: kitchen.id, date: day,
      totalPreparedKg: produced, totalServedKg: totals.servedKg,
      totalWasteKg: waste, totalSurplusKg: s.surplusKg,
      notes: `Auto-generated daily food waste report for ${key}.`,
      status: 'FINAL',
      accuracyJson: JSON.stringify(accuracyPayload),
      qualityNotes: `${totals.records} records (${totals.corrections} corrections); auto-generated after 10 PM; ` +
        `predicted ${predicted ?? 'n/a'} kg vs sold ${sold} kg; surplus ${s.surplusKg} kg` +
        (s.inconsistency ? ' — DATA INCONSISTENCY FLAGGED, held for review.' : '.'),
    },
  });
  // Phase 4: surplus > 0 with consistent data starts NGO distribution.
  // Distribution failure never fails the report itself. The real report id
  // anchors idempotency (one assessment per report, one send per NGO).
  let distribution: AutoDistributionResult = { started: false, reason: 'No surplus to distribute.' };
  if (s.surplusKg > 0 && !s.inconsistency) {
    try {
      distribution = await triggerAutoDistribution({
        organizationId: orgId, kitchenUnitId: kitchen.id, kitchenName: kitchen.name,
        eodReportId: report.id, dateLabel: key, surplusKg: s.surplusKg, inconsistency: s.inconsistency,
      });
    } catch (e) {
      distribution = { started: false, reason: e instanceof Error ? e.message : 'Distribution trigger failed.' };
    }
  } else if (s.inconsistency) {
    distribution = { started: false, reason: 'Data inconsistency flagged — no NGO emails sent.' };
  }
  accuracyPayload.distribution = distribution;
  await prisma.endOfDayReport.update({
    where: { id: report.id },
    data: { accuracyJson: JSON.stringify(accuracyPayload) },
  });
  await audit('eod.auto-close', {
    organizationId: orgId, entityType: 'EndOfDayReport', entityId: report.id,
    metadata: {
      kitchenUnitId: kitchen.id, date: key, predictedKg: predicted, produced, sold,
      surplusKg: s.surplusKg, inconsistency: s.inconsistency, distributionStarted: distribution.started,
    },
  });
  return { ...base, ...names, status: 'created', reportId: report.id, surplusKg: s.surplusKg, inconsistency: s.inconsistency, distribution };
}

/** Run the after-10PM sweep for every kitchen with records that day. One bad kitchen never blocks the rest. */
export async function runAutoEodAll(dateISO?: string, onlyOrgId?: string, opts?: { regenerate?: boolean }): Promise<{ date: string; results: AutoEodResult[] }> {
  const ref = dateISO ? new Date(dateISO) : new Date();
  const day = Number.isNaN(ref.getTime())
    ? (() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); })()
    : new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const next = new Date(day.getTime() + 86400000);
  const key = day.toISOString().slice(0, 10);
  const combos = await prisma.dailyFoodRecord.findMany({
    where: { date: { gte: day, lt: next }, ...(onlyOrgId ? { organizationId: onlyOrgId } : {}) },
    select: { organizationId: true, kitchenUnitId: true },
    take: 5000,
  });
  const seen = new Map<string, { organizationId: string; kitchenUnitId: string }>();
  for (const c of combos) seen.set(`${c.organizationId}|${c.kitchenUnitId}`, c);
  const results: AutoEodResult[] = [];
  for (const c of seen.values()) {
    try {
      results.push(await buildAutoReport(c.organizationId, c.kitchenUnitId, day, next, key, opts?.regenerate ?? false));
    } catch (e) {
      results.push({
        organizationId: c.organizationId, organizationName: '', kitchenUnitId: c.kitchenUnitId,
        kitchenName: '', date: key, status: 'failed', error: e instanceof Error ? e.message : 'Auto report failed.',
      });
    }
  }
  return { date: key, results };
}

// POST /api/eod/auto-run — manual retry/regenerate for the automatic job (managers).
router.post('/auto-run', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ date: z.string().optional() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  if (parsed.data.date && isNaN(new Date(parsed.data.date).getTime())) {
    return res.status(400).json({ error: 'Date is not valid (use YYYY-MM-DD).' });
  }
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Account not found.' });
  const onlyOrg = me.role === 'SUPER_ADMIN' ? undefined : me.organizationId ?? undefined;
  if (!me.organizationId && me.role !== 'SUPER_ADMIN') {
    return res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
  }
  try {
    const out = await runAutoEodAll(parsed.data.date, onlyOrg);
    const created = out.results.filter((r) => r.status === 'created').length;
    const skipped = out.results.filter((r) => r.status !== 'created' && r.status !== 'failed').length;
    const failed = out.results.filter((r) => r.status === 'failed').length;
    await audit('eod.auto-run', {
      userId: req.userId, organizationId: onlyOrg, entityType: 'EndOfDayReport', entityId: out.date,
      metadata: { date: out.date, created, skipped, failed },
    });
    return res.json({
      message: `Auto-report sweep for ${out.date}: ${created} created, ${skipped} skipped, ${failed} failed.`,
      date: out.date, created, skipped, failed, results: out.results,
    });
  } catch {
    return res.status(500).json({ error: 'Auto-report sweep failed. Please try again.' });
  }
});

// POST /api/eod/generate-now — manual "Generate Report Now" button.
// Calls the SAME runAutoEodAll service as the 10 PM scheduler; it never
// touches the scheduler itself. Existing FINAL reports are never duplicated:
// without regenerate:true the caller gets an already-generated response.
router.post('/generate-now', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ date: z.string().optional(), regenerate: z.coerce.boolean().optional().default(false) });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  if (parsed.data.date && isNaN(new Date(parsed.data.date).getTime())) {
    return res.status(400).json({ error: 'Date is not valid (use YYYY-MM-DD).' });
  }
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Account not found.' });
  const onlyOrg = me.role === 'SUPER_ADMIN' && !me.organizationId ? undefined : me.organizationId ?? undefined;
  if (!me.organizationId && me.role !== 'SUPER_ADMIN') {
    return res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
  }
  try {
    const out = await runAutoEodAll(parsed.data.date, onlyOrg, { regenerate: parsed.data.regenerate });
    const alreadyGenerated = out.results.length > 0 && out.results.every((r) => r.status === 'skipped-exists');
    await audit('eod.generate-now', {
      userId: req.userId, organizationId: onlyOrg, entityType: 'EndOfDayReport', entityId: out.date,
      metadata: { date: out.date, regenerate: parsed.data.regenerate, alreadyGenerated },
    });
    return res.json({
      alreadyGenerated,
      message: alreadyGenerated
        ? `Today's report has already been generated for ${out.date}.`
        : `Report ready for ${out.date}: ${out.results.filter((r) => r.status === 'created').length} created.`,
      date: out.date,
      results: out.results.map((r) => ({
        kitchenName: r.kitchenName, status: r.status, reportId: r.reportId ?? null,
        surplusKg: r.surplusKg ?? null, inconsistency: r.inconsistency ?? false,
        distribution: r.distribution ? {
          started: r.distribution.started, reason: r.distribution.reason,
          assessmentId: r.distribution.assessmentId ?? null,
          sent: (r.distribution.results ?? []).filter((x) => x.status === 'sent').length,
          failed: (r.distribution.results ?? []).filter((x) => x.status === 'failed').length,
        } : null,
        error: r.error ?? null,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Report generation failed. Please check today’s food records and try again.' });
  }
});

// GET /api/eod/distribution-overview?kitchenUnitId=&date= — one snapshot for the
// Food Distribution dashboard: today's actuals, report, distribution, NGO
// directory with live email states, automation heartbeat, history, activity.
// All read-only; match scores are computed in memory (never persisted here).
router.get('/distribution-overview', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1, 'Please choose a kitchen.'), date: z.string().optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(404).json({ error: 'Kitchen not found in your organization.' });
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return res.status(500).json({ error: 'Organization not found.' });

  const ref = parsed.data.date ? new Date(parsed.data.date) : new Date();
  const day = new Date(Date.UTC(
    Number.isNaN(ref.getTime()) ? new Date().getUTCFullYear() : ref.getUTCFullYear(),
    Number.isNaN(ref.getTime()) ? new Date().getUTCMonth() : ref.getUTCMonth(),
    Number.isNaN(ref.getTime()) ? new Date().getUTCDate() : ref.getUTCDate()
  ));
  const next = new Date(day.getTime() + 86400000);
  const key = day.toISOString().slice(0, 10);

  const safeJson = (raw: string | null): Record<string, unknown> | null => {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as unknown;
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  // — Independent reads run concurrently (report + registry + history alongside actuals) —
  const [agg, targets, reportRow, registry, lastAutoReport, sweepAudits, lastEmailNote, historyRows, lastDiscovery, discoveredCount] = await Promise.all([
    dayAggregate(orgId, kitchen.id, day, next),
    prisma.productionTarget.findMany({
      where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next } },
      take: 500,
    }),
    prisma.endOfDayReport.findFirst({
      where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ngoOrganization.findMany({ orderBy: { name: 'asc' } }),
    prisma.endOfDayReport.findFirst({
      where: { organizationId: orgId, status: 'FINAL' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: { action: 'eod.scheduler-run' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.notification.findFirst({
      where: { organizationId: orgId, type: { startsWith: 'NGO_NOTIFY_' } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.endOfDayReport.findMany({
      where: { organizationId: orgId, status: 'FINAL' },
      orderBy: { date: 'desc' },
      take: 30,
      include: { kitchenUnit: { select: { name: true } } },
    }),
    prisma.ngoOrganization.findFirst({
      where: { source: 'openstreetmap' },
      orderBy: { lastCheckedAt: 'desc' },
    }),
    prisma.ngoOrganization.count({ where: { source: 'openstreetmap' } }),
  ]);
  const { rows, totals } = agg;
  const produced = totals.preparedKg;
  const sold = totals.soldKg;
  const waste = totals.wasteKg;
  const surplus = computeSurplus(produced, sold);
  const predicted = targets.length > 0 ? r3(targets.reduce((x, t) => x + (t.adjustedKg ?? t.recommendedKg), 0)) : null;

  // — Today's report (if generated) —
  const reportAccuracy = reportRow ? safeJson(reportRow.accuracyJson) : null;
  const distPayload = reportAccuracy?.distribution as {
    started?: boolean; reason?: string; assessmentId?: string;
    results?: { ngoId: string; ngoName: string; email: string; status: string; error?: string }[];
  } | undefined;
  const assessmentId = distPayload?.assessmentId ?? null;

  // — Today's matches + records (live states; depend on the report's assessment) —
  const [matches, distRecords] = assessmentId
    ? await Promise.all([
      prisma.ngoMatch.findMany({ where: { assessmentId }, include: { ngo: true } }),
      prisma.redistributionRecord.findMany({
        where: { assessmentId },
        include: { ngo: { select: { id: true, name: true } } },
      }),
    ])
    : [[], []];
  const recordByNgo = new Map(distRecords.map((r) => [r.ngoId ?? '', r]));
  const emailStateByNgo = new Map<string, { status: string; at: string | null }>();
  for (const m of matches) {
    let attempts: { at: string; ok: boolean }[] = [];
    try {
      const v = JSON.parse(m.deliveryJson ?? '{}') as { attempts?: { at: string; ok: boolean }[] };
      if (Array.isArray(v.attempts)) attempts = v.attempts;
    } catch { /* none */ }
    const rec = recordByNgo.get(m.ngoId);
    let status = 'not-contacted';
    let at: string | null = null;
    if (rec && ['ACCEPTED', 'PICKUP_SCHEDULED', 'HANDED_OVER', 'COMPLETED'].includes(rec.status)) status = 'accepted';
    else if (rec && ['DECLINED', 'CANCELLED'].includes(rec.status)) status = 'rejected';
    else if (attempts.length > 0) {
      const last = attempts[attempts.length - 1];
      status = last.ok ? 'sent' : 'failed';
      at = last.at;
    } else if (rec) status = 'pending';
    emailStateByNgo.set(m.ngoId, { status, at });
  }
  const sent = [...emailStateByNgo.values()].filter((e) => e.status === 'sent').length;
  const failed = [...emailStateByNgo.values()].filter((e) => e.status === 'failed').length;
  const pending = [...emailStateByNgo.values()].filter((e) => e.status === 'pending').length;
  const accepted = [...emailStateByNgo.values()].filter((e) => e.status === 'accepted').length;
  const acceptedKg = r3(distRecords
    .filter((r) => ['ACCEPTED', 'PICKUP_SCHEDULED', 'HANDED_OVER', 'COMPLETED'].includes(r.status))
    .reduce((x, r) => x + r.quantityKg, 0));
  const distributionStatus = surplus.inconsistency
    ? 'Needs review — inconsistent data'
    : rows.length === 0
      ? 'No food records today'
      : !reportRow
        ? 'Report not generated yet'
        : failed > 0
          ? `Distribution in progress — ${failed} email${failed === 1 ? '' : 's'} need retry`
          : accepted > 0 || sent > 0
            ? 'Distribution in progress'
            : surplus.surplusKg > 0
              ? 'Surplus ready — distribution pending'
              : 'No surplus today';

  // — NGO directory (registry + today's live state; scores computed, not stored) —
  // Locate the hotel on first view when needed (saved for all future calls).
  let hotelLat = org.latitude;
  let hotelLng = org.longitude;
  if ((typeof hotelLat !== 'number' || typeof hotelLng !== 'number')) {
    const located = await geocodeHotelAddress({ address: org.address, city: org.city, state: org.state, country: org.country });
    if (located) {
      await prisma.organization.update({ where: { id: orgId }, data: { latitude: located.lat, longitude: located.lng } }).catch(() => undefined);
      hotelLat = located.lat;
      hotelLng = located.lng;
    }
  }
  const hotelHasCoords = typeof hotelLat === 'number' && typeof hotelLng === 'number';
  const institution = { city: org.city, address: org.address, operatingHours: org.operatingHours };
  const need = {
    quantityKg: surplus.surplusKg,
    foodCategory: 'Mixed Surplus Food',
    availableUntil: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
  };
  const matchByNgo = new Map(matches.map((m) => [m.ngoId, m]));
  const ngos = registry.map((n) => {
    const scored = surplus.surplusKg > 0
      ? scoreNgoMatch({
        ngo: {
          isActive: n.isActive, city: n.city, address: n.address,
          acceptedCategories: n.acceptedCategories, pickupCapable: n.pickupCapable,
          operatingHours: n.operatingHours, capacityKg: n.capacityKg,
        },
        assessment: need, institution,
      })
      : null;
    const stored = matchByNgo.get(n.id);
    let storedReasons: { criterion: string; points: number; detail: string }[] = [];
    try {
      const v = JSON.parse(stored?.reasonsJson ?? '[]') as typeof storedReasons;
      if (Array.isArray(v)) storedReasons = v;
    } catch { /* none */ }
    const reasons = storedReasons.length > 0 ? storedReasons : (scored?.reasons ?? []);
    const cat = reasons.find((x) => x.criterion === 'category');
    const area = reasons.find((x) => x.criterion === 'area');
    const email = emailStateByNgo.get(n.id) ?? { status: 'not-contacted', at: null };
    return {
      id: n.id, name: n.name, city: n.city, address: n.address,
      contactEmail: n.contactEmail, contactPhone: n.contactPhone, isActive: n.isActive,
      sameCity: (area?.points ?? 0) > 0,
      acceptance: (['confirmed', 'likely', 'unknown', 'does_not_accept'].includes(n.foodAcceptanceStatus)
        ? n.foodAcceptanceStatus
        : 'unknown') as string,
      matchScore: stored?.score ?? scored?.score ?? null,
      emailStatus: email.status, lastContact: email.at,
      verificationStatus: n.verificationStatus, verificationSource: n.verificationSource,
      externalPlaceId: n.externalPlaceId, mapsUri: n.mapsUri,
      operationalStatus: n.operationalStatus, source: n.source,
      lastCheckedAt: n.lastCheckedAt, website: n.website,
      emailVerified: n.emailVerified, emailSource: n.emailSource,
      foodAcceptanceStatus: n.foodAcceptanceStatus,
      distanceKm: typeof n.distanceKm === 'number' ? n.distanceKm : null,
      relevance: n.relevance,
      liveDistanceKm: hotelHasCoords && typeof n.latitude === 'number' && typeof n.longitude === 'number'
        ? haversineKm(hotelLat as number, hotelLng as number, n.latitude, n.longitude)
        : null,
    };
  });

  // Per-hotel view: a Mumbai kitchen must never see Ahmedabad rows. NGOs with
  // a live distance beyond 100 km are excluded; rows without coordinates
  // (deliberate admin entries) stay visible last, honestly labeled.
  const ngosVisible = ngos
    .filter((n) => !hotelHasCoords || n.liveDistanceKm === null || n.liveDistanceKm <= 100)
    .sort((a, b) => {
      if (a.liveDistanceKm !== null || b.liveDistanceKm !== null) {
        return (a.liveDistanceKm ?? Number.MAX_SAFE_INTEGER) - (b.liveDistanceKm ?? Number.MAX_SAFE_INTEGER);
      }
      return (b.matchScore ?? -1) - (a.matchScore ?? -1);
    });

  // — Automation heartbeat (real state only; reads already fetched above) —
  const sched = getSchedulerState();
  const sweepMeta = (a: { metadataJson: string | null }) => {
    try {
      return JSON.parse(a.metadataJson ?? '{}') as { date?: string; created?: number; failed?: number; errors?: string[] };
    } catch {
      return {};
    }
  };
  const lastSuccessAudit = sweepAudits.find((a) => (sweepMeta(a).failed ?? 0) === 0);
  const lastFailureAudit = sweepAudits.find((a) => (sweepMeta(a).failed ?? 0) > 0);
  const lastSuccessAt = lastSuccessAudit?.createdAt?.toISOString() ?? null;
  const lastFailureAt = lastFailureAudit?.createdAt?.toISOString() ?? null;
  const lastFailureReason = lastFailureAudit ? (sweepMeta(lastFailureAudit).errors ?? []).join('; ').slice(0, 300) || 'Sweep reported failures.' : null;
  const automationState = !sched.armed && !lastSuccessAt && !lastAutoReport
    ? 'unknown'
    : (sched.lastError || (lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt)))
      ? 'attention'
      : 'healthy';
  const automation = {
    state: automationState,
    schedulerArmed: sched.armed,
    nextRun: sched.nextRunISO,
    timeZone: sched.timeZone,
    lastRun: lastAutoReport ? { at: lastAutoReport.createdAt, date: lastAutoReport.date.toISOString().slice(0, 10) } : null,
    lastSuccess: lastSuccessAt ? { at: lastSuccessAt, ...(sweepMeta(lastSuccessAudit as { metadataJson: string | null })) } : null,
    lastFailure: lastFailureAt ? { at: lastFailureAt, reason: lastFailureReason } : null,
    emailService: {
      configured: smtpConfigured() || resendConfigured(),
      provider: resendConfigured() ? 'resend' : smtpConfigured() ? 'smtp' : null,
      lastEmail: lastEmailNote ? { at: lastEmailNote.createdAt, type: lastEmailNote.type } : null,
    },
    ngoDiscovery: {
      provider: 'openstreetmap',
      keyRequired: false,
      hotelCoordsPresent: typeof org.latitude === 'number' && typeof org.longitude === 'number',
      lastSearchAt: lastDiscovery?.lastCheckedAt ?? null,
      discoveredCount,
    },
  };

  // — History (latest FINAL reports with distribution counts; already fetched) —
  const history = historyRows.map((h) => {
    const acc = safeJson(h.accuracyJson) as {
      predictedKg?: number | null; surplusKg?: number; autoGenerated?: boolean;
      inconsistency?: boolean;
      distribution?: { results?: { status: string }[] };
      summary?: { text?: string };
    } | null;
    const res = acc?.distribution?.results ?? [];
    const hSent = res.filter((x) => x.status === 'sent').length;
    const hFailed = res.filter((x) => x.status === 'failed').length;
    return {
      id: h.id, date: h.date.toISOString().slice(0, 10), kitchen: h.kitchenUnit?.name ?? '—',
      createdAt: h.createdAt, status: h.status,
      predictedKg: acc?.predictedKg ?? null,
      producedKg: h.totalPreparedKg, soldKg: h.totalServedKg, wasteKg: h.totalWasteKg,
      surplusKg: acc?.surplusKg ?? h.totalSurplusKg,
      inconsistency: acc?.inconsistency ?? false,
      autoGenerated: acc?.autoGenerated ?? false,
      contacted: res.length, sent: hSent, failed: hFailed,
      summary: acc?.summary && typeof acc.summary === 'object' ? (acc.summary.text ?? null) : null,
      overall: (acc?.inconsistency ?? false)
        ? 'Needs review'
        : hFailed > 0 ? `${hFailed} failed` : res.length > 0 ? 'Completed' : (acc?.surplusKg ?? 0) > 0 ? 'No distribution' : 'No surplus',
    };
  });

  // — Recent activity (latest reports + distribution events) —
  type Activity = { at: string; tone: 'ok' | 'bad' | 'idle'; text: string };
  const activity: Activity[] = [];
  const recentForActivity = historyRows.slice(0, 5);
  const assessIds = recentForActivity
    .map((h) => (safeJson(h.accuracyJson) as { distribution?: { assessmentId?: string } } | null)?.distribution?.assessmentId)
    .filter((x): x is string => !!x);
  const [assessRows, activityMatches] = await Promise.all([
    assessIds.length > 0
      ? prisma.surplusEligibilityAssessment.findMany({ where: { id: { in: assessIds } } })
      : Promise.resolve([]),
    assessIds.length > 0
      ? prisma.ngoMatch.findMany({ where: { assessmentId: { in: assessIds } }, include: { ngo: { select: { name: true } } } })
      : Promise.resolve([]),
  ]);
  for (const h of recentForActivity) {
    const hk = h.date.toISOString().slice(0, 10);
    const hAcc = safeJson(h.accuracyJson) as { surplusKg?: number; inconsistency?: boolean } | null;
    activity.push({
      at: h.createdAt.toISOString(),
      tone: hAcc?.inconsistency ? 'bad' : 'ok',
      text: `Daily report generated — ${h.kitchenUnit?.name ?? ''} ${hk} (${hAcc?.surplusKg ?? h.totalSurplusKg} kg surplus)`,
    });
  }
  for (const a of assessRows) {
    activity.push({ at: a.createdAt.toISOString(), tone: 'ok', text: `${a.quantityKg} kg surplus detected — NGOs matched` });
  }
  for (const m of activityMatches) {
    let attempts: { at: string; ok: boolean; error?: string }[] = [];
    try {
      const v = JSON.parse(m.deliveryJson ?? '{}') as { attempts?: typeof attempts };
      if (Array.isArray(v.attempts)) attempts = v.attempts;
    } catch { /* none */ }
    for (const att of attempts) {
      activity.push({
        at: att.at, tone: att.ok ? 'ok' : 'bad',
        text: att.ok ? `Email sent to ${m.ngo.name}` : `Email to ${m.ngo.name} failed${att.error ? ` — ${att.error.slice(0, 120)}` : ''}`,
      });
    }
  }
  activity.sort((a, b) => (a.at < b.at ? 1 : -1));

  return res.json({
    date: key,
    kitchen: { id: kitchen.id, name: kitchen.name },
    hotel: { name: org.name, city: org.city },
    today: {
      hasRecords: rows.length > 0, records: rows.length,
      producedKg: produced, soldKg: sold, wasteKg: waste,
      surplusKg: surplus.surplusKg, inconsistency: surplus.inconsistency,
      inconsistencyMessage: surplus.message, predictedKg: predicted,
    },
    report: reportRow ? {
      id: reportRow.id, status: reportRow.status, createdAt: reportRow.createdAt,
      autoGenerated: (reportAccuracy?.autoGenerated as boolean | undefined) ?? false,
      summary: (reportAccuracy?.summary as { text?: string } | undefined)?.text ?? reportRow.qualityNotes,
    } : null,
    distribution: {
      started: distPayload?.started ?? false, reason: distPayload?.reason ?? null,
      assessmentId, matched: matches.length, sent, pending, failed, accepted,
      acceptedKg, remainingKg: r3(Math.max(0, surplus.surplusKg - acceptedKg)),
      status: distributionStatus,
    },
    ngos: ngosVisible,
    automation,
    history,
    activity: activity.slice(0, 20),
  });
});

export default router;
