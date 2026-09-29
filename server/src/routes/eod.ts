import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { coherenceError } from '../lib/flow';
import { dedupeToLatest } from '../lib/kitchen-memory';

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
router.get('/reports', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ kitchenUnitId: z.string().min(1).optional(), from: z.string().optional(), to: z.string().optional() });
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

export default router;
