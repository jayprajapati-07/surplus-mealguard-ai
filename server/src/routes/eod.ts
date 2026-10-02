import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { coherenceError } from '../lib/flow';
import { dedupeToLatest } from '../lib/kitchen-memory';
import { computeSurplus, predictionError } from '../lib/eod-report';
import { summarizeDayReport } from '../lib/gemini-explain';

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
  const { rows, totals, incoherent } = await dayAggregate(orgId, kitchen.id, day, next);
  const accuracy = await accuracyFor(orgId, kitchen.id, day, next, rows);
  const existing = await prisma.endOfDayReport.findFirst({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next }, status: 'FINAL' },
  });
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
  const { rows, totals, incoherent } = await dayAggregate(orgId, kitchen.id, day, next);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No food records for this kitchen/date — nothing to close.' });
  }
  if (incoherent.length > 0) {
    return res.status(409).json({
      error: `${incoherent.length} record(s) are incoherent (sold + waste + remaining exceeds produced). Totals were NOT forced — fix them with reasoned corrections first.`,
      incoherent,
    });
  }
  const dupe = await prisma.endOfDayReport.findFirst({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: next }, status: 'FINAL' },
  });
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
  orgId: string, kitchenId: string, day: Date, next: Date, key: string
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
  if (dupe) return { ...base, ...names, status: 'skipped-exists', reportId: dupe.id };

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
  await audit('eod.auto-close', {
    organizationId: orgId, entityType: 'EndOfDayReport', entityId: report.id,
    metadata: { kitchenUnitId: kitchen.id, date: key, predictedKg: predicted, produced, sold, surplusKg: s.surplusKg, inconsistency: s.inconsistency },
  });
  return { ...base, ...names, status: 'created', reportId: report.id, surplusKg: s.surplusKg, inconsistency: s.inconsistency };
}

/** Run the after-10PM sweep for every kitchen with records that day. One bad kitchen never blocks the rest. */
export async function runAutoEodAll(dateISO?: string, onlyOrgId?: string): Promise<{ date: string; results: AutoEodResult[] }> {
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
      results.push(await buildAutoReport(c.organizationId, c.kitchenUnitId, day, next, key));
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

export default router;
