import { Router } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import {
  loadFiltered, parseRange, buildProduction, buildSales, buildWaste,
  buildSurplus, buildAI, buildSustainability,
} from '../lib/analytics';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const TYPES = ['daily', 'weekly', 'monthly', 'esg'] as const;

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

const reportQuery = z.object({
  type: z.enum(TYPES, { errorMap: () => ({ message: 'Report type must be daily, weekly, monthly, or esg.' }) }).optional().default('daily'),
  date: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  kitchenUnitId: z.string().min(1).optional(),
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']).optional(),
  foodItemId: z.string().min(1).optional(),
});

function resolveRangeOrDirect(q: { type: string; date?: string; from?: string; to?: string }): { from: string; to: string } {
  if (q.from || q.to) {
    if (!q.from || !q.to) throw new Error('Provide both from and to, or an anchor date.');
    const f = new Date(`${q.from}T00:00:00Z`);
    const t = new Date(`${q.to}T00:00:00Z`);
    if (isNaN(f.getTime()) || isNaN(t.getTime())) throw new Error('From/to must be valid YYYY-MM-DD.');
    return { from: q.from, to: q.to };
  }
  if (!q.date) throw new Error('Provide from/to or an anchor date.');
  return resolveRange(q.type, q.date);
}

function resolveRange(type: string, dateStr: string): { from: string; to: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new Error('Anchor date is not valid (use YYYY-MM-DD).');
  const iso = (t: Date) => t.toISOString().slice(0, 10);
  if (type === 'daily') return { from: iso(d), to: iso(d) };
  if (type === 'weekly') {
    const dow = d.getUTCDay();
    const mon = new Date(d.getTime() - ((dow + 6) % 7) * 86400000);
    return { from: iso(mon), to: iso(new Date(mon.getTime() + 6 * 86400000)) };
  }
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: iso(first), to: iso(last) };
}

interface ReportPayload {
  type: string;
  from: string;
  to: string;
  filters: { kitchenUnitId?: string; mealType?: string; foodItemId?: string };
  generatedAt: string;
  production: ReturnType<typeof buildProduction>;
  sales: ReturnType<typeof buildSales>;
  waste: ReturnType<typeof buildWaste>;
  surplus: ReturnType<typeof buildSurplus>;
  ai: ReturnType<typeof buildAI>;
  sustainability: ReturnType<typeof buildSustainability>;
}

async function buildReport(orgId: string, q: z.infer<typeof reportQuery>): Promise<ReportPayload> {
  const { from, to } = resolveRangeOrDirect(q);
  if (q.kitchenUnitId) {
    const k = await prisma.kitchenUnit.findFirst({ where: { id: q.kitchenUnitId, organizationId: orgId } });
    if (!k) throw new Error('Kitchen/unit not found in your organization.');
  }
  if (q.foodItemId) {
    const fi = await prisma.foodItem.findFirst({ where: { id: q.foodItemId, organizationId: orgId } });
    if (!fi) throw new Error('Food item not found in your organization.');
  }
  const f = { from, to, kitchenUnitId: q.kitchenUnitId, mealType: q.mealType, foodItemId: q.foodItemId };
  const loaded = await loadFiltered(prisma, orgId, f);
  const { days } = parseRange(from, to);
  const foodCat = q.foodItemId ? loaded.foods.find((x) => x.id === q.foodItemId)?.category ?? null : null;  return {
    type: q.type, from, to,
    filters: { ...(q.kitchenUnitId ? { kitchenUnitId: q.kitchenUnitId } : {}),
      ...(q.mealType ? { mealType: q.mealType } : {}), ...(q.foodItemId ? { foodItemId: q.foodItemId } : {}) },
    generatedAt: new Date().toISOString(),
    production: buildProduction(loaded, days),
    sales: buildSales(loaded, days),
    waste: buildWaste(loaded, days),
    surplus: buildSurplus(loaded),
    ai: buildAI(loaded),
    sustainability: buildSustainability(loaded, days, { organizationId: orgId, foodItemId: q.foodItemId ?? null, mealType: q.mealType ?? null, category: foodCat }),
  };
}

// GET /api/reports/data — report payload backing every screen and export
router.get('/data', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = reportQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  try {
    return res.json({ report: await buildReport(orgId, parsed.data) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not build report.';
    return res.status(400).json({ error: msg });
  }
});

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(r: ReportPayload): string {
  const L: string[] = [];
  L.push(`Report type,${r.type}`, `Date range,${r.from} to ${r.to}`,
    `Filters,${JSON.stringify(r.filters)}`, `Generated at,${r.generatedAt}`, '');
  L.push('SUMMARY');
  L.push('metric,value,unit');
  L.push(`Target total,${r.production.targetTotal},kg`);
  L.push(`Actual produced,${r.production.actualTotal},kg`);
  L.push(`Sold,${r.sales.soldKg},kg`);
  L.push(`Utilization,${r.sales.utilizationPct ?? 'n/a'},%`);
  L.push(`Waste total,${r.waste.totalKg},kg`);
  L.push(`Waste share,${r.waste.pctOfProduced ?? 'n/a'},% of produced`);
  L.push(`Predicted surplus,${r.surplus.predictedKg},kg`);
  L.push(`Actual remaining,${r.surplus.actualRemainingKg},kg`);
  L.push(`Eligible,${r.surplus.eligibleKg},kg`);
  L.push(`Redistributed,${r.surplus.redistributedKg},kg`);
  L.push(`Redistribution rate,${r.surplus.redistributionRatePct ?? 'n/a'},%`);
  L.push(`Food saved,${r.sustainability.foodSavedKg},kg`);
  L.push(`Cost saved (estimate),${r.sustainability.costSavedEstimate},INR`);
  L.push(`CO2e avoided (estimate),${r.sustainability.co2AvoidedKgEstimate},kgCO2e`);
  L.push('');
  L.push('DAILY');
  L.push('date,target_kg,actual_kg,sold_kg,waste_kg,remaining_kg');
  const salesByDay = new Map(r.sales.daily.map((d) => [d.date, d]));
  for (const d of r.production.daily) {
    const s = salesByDay.get(d.date);
    const w = r.waste.daily.find((x) => x.date === d.date);
    L.push([d.date, d.target, d.actual, s?.sold ?? '', w?.waste ?? '', s?.remaining ?? ''].map(cell).join(','));
  }
  L.push('');
  L.push('BY_FOOD');
  L.push('food,target_kg,actual_kg,sold_kg,waste_kg');
  for (const f of r.production.byFood) {
    const s = r.sales.byFood.find((x) => x.foodItemId === f.foodItemId);
    const w = r.waste.byFood.find((x) => x.foodItemId === f.foodItemId);
    L.push([f.food, f.target, f.actual, s?.sold ?? '', w?.waste ?? ''].map(cell).join(','));
  }
  L.push('');
  L.push('WASTE_CONTRIBUTORS');
  L.push('contributor,attributable_kg,days');
  for (const c of r.waste.contributors) L.push([c.contributor, c.attributableKg, c.days].map(cell).join(','));
  L.push('');
  L.push('AI_FORECAST_VS_ACTUAL');
  L.push('date,food,predicted_kg,actual_sold_kg,abs_pct_err');
  for (const p of r.ai.pairs) L.push([p.date, p.food, p.predictedKg, p.actualSoldKg, p.absPctErr ?? ''].map(cell).join(','));
  L.push(`Mean abs pct err,${r.ai.meanAbsPctErr ?? 'n/a'}`);
  L.push(`Accuracy definition,${r.ai.accuracyDefinition}`);
  L.push('');
  L.push('SUSTAINABILITY_HOW_CALCULATED');
  for (const h of r.sustainability.howCalculated) L.push(cell(h));
  L.push('');
  L.push('METHODOLOGY');
  L.push(cell('Aggregates deduplicated DailyFoodRecord rows, COMPLETED redistributions, and configured ImpactFactors. Cost and CO2e figures are estimates, not measurements. No guaranteed reductions are claimed.'));
  return L.join('\n') + '\n';
}

function toXlsx(r: ReportPayload): Buffer {
  const wb = XLSX.utils.book_new();
  const add = (name: string, aoa: (string | number | null)[][]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  };
  add('Summary', [
    ['Metric', 'Value', 'Unit'],
    ['Report type', r.type, ''], ['Date range', `${r.from} to ${r.to}`, ''], ['Generated at', r.generatedAt, ''],
    ['Target total', r.production.targetTotal, 'kg'], ['Actual produced', r.production.actualTotal, 'kg'],
    ['Sold', r.sales.soldKg, 'kg'], ['Utilization', r.sales.utilizationPct, '%'],
    ['Waste total', r.waste.totalKg, 'kg'], ['Waste share', r.waste.pctOfProduced, '% of produced'],
    ['Predicted surplus', r.surplus.predictedKg, 'kg'], ['Actual remaining', r.surplus.actualRemainingKg, 'kg'],
    ['Eligible', r.surplus.eligibleKg, 'kg'], ['Redistributed', r.surplus.redistributedKg, 'kg'],
    ['Redistribution rate', r.surplus.redistributionRatePct, '%'],
    ['Food saved', r.sustainability.foodSavedKg, 'kg'],
    ['Cost saved (estimate)', r.sustainability.costSavedEstimate, 'INR'],
    ['CO2e avoided (estimate)', r.sustainability.co2AvoidedKgEstimate, 'kgCO2e'],
  ]);
  const salesByDay = new Map(r.sales.daily.map((d) => [d.date, d]));
  add('Daily', [
    ['Date', 'Target kg', 'Actual kg', 'Sold kg', 'Waste kg', 'Remaining kg'],
    ...r.production.daily.map((d) => {
      const s = salesByDay.get(d.date);
      const w = r.waste.daily.find((x) => x.date === d.date);
      return [d.date, d.target, d.actual, s?.sold ?? null, w?.waste ?? null, s?.remaining ?? null] as (string | number | null)[];
    }),
  ]);
  add('ByFood', [
    ['Food', 'Target kg', 'Actual kg', 'Sold kg', 'Waste kg'],
    ...r.production.byFood.map((f) => {
      const s = r.sales.byFood.find((x) => x.foodItemId === f.foodItemId);
      const w = r.waste.byFood.find((x) => x.foodItemId === f.foodItemId);
      return [f.food, f.target, f.actual, s?.sold ?? null, w?.waste ?? null] as (string | number | null)[];
    }),
  ]);
  add('Waste', [
    ['Contributor', 'Attributable kg', 'Days'],
    ...r.waste.contributors.map((c) => [c.contributor, c.attributableKg, c.days] as (string | number)[]),
  ]);
  add('AI', [
    ['Date', 'Food', 'Predicted kg', 'Actual sold kg', 'Abs pct err'],
    ...r.ai.pairs.map((p) => [p.date, p.food, p.predictedKg, p.actualSoldKg, p.absPctErr] as (string | number | null)[]),
    ['Mean abs pct err', r.ai.meanAbsPctErr ?? 'n/a', '', '', ''],
    ['Accuracy definition', r.ai.accuracyDefinition, '', '', ''],
  ]);
  add('Sustainability', [
    ['Line', 'Detail'],
    ...r.sustainability.howCalculated.map((h) => ['How calculated', h]),
    ['Methodology', 'Aggregates deduplicated DailyFoodRecord rows, COMPLETED redistributions, and configured ImpactFactors. Cost and CO2e figures are estimates, not measurements. No guaranteed reductions are claimed.'],
  ]);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function toPdf(r: ReportPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const needPage = () => {
      if (doc.y > 700) doc.addPage();
    };
    doc.fontSize(18).text(`MealGuard ${r.type.toUpperCase()} report`, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Range: ${r.from} to ${r.to}   Generated: ${r.generatedAt}`);
    doc.text(`Filters: ${JSON.stringify(r.filters)}`);
    doc.moveDown(0.5);
    doc.fontSize(13).text('Summary');
    doc.fontSize(10);
    const lines = [
      `Target total: ${r.production.targetTotal} kg; actual produced: ${r.production.actualTotal} kg`,
      `Sold: ${r.sales.soldKg} kg; utilization: ${r.sales.utilizationPct ?? 'n/a'}%`,
      `Waste: ${r.waste.totalKg} kg (${r.waste.pctOfProduced ?? 'n/a'}% of produced)`,
      `Surplus — predicted ${r.surplus.predictedKg}, actual remaining ${r.surplus.actualRemainingKg}, eligible ${r.surplus.eligibleKg}, redistributed ${r.surplus.redistributedKg} kg (rate ${r.surplus.redistributionRatePct ?? 'n/a'}%)`,
      `Food saved: ${r.sustainability.foodSavedKg} kg; cost saved (estimate): INR ${r.sustainability.costSavedEstimate}; CO2e avoided (estimate): ${r.sustainability.co2AvoidedKgEstimate} kgCO2e`,
    ];
    for (const l of lines) {
      needPage();
      doc.text(l);
    }
    const table = (title: string, head: string[], rows: (string | number | null)[][]) => {
      doc.moveDown(0.5);
      doc.fontSize(13).text(title);
      doc.fontSize(9);
      doc.text(head.join(' | '));
      for (const row of rows.slice(0, 60)) {
        needPage();
        doc.text(row.map((c) => (c === null || c === undefined ? '' : String(c)).slice(0, 28)).join(' | '));
      }
      if (rows.length > 60) doc.text(`… ${rows.length - 60} more rows (see CSV/XLSX export).`);
    };
    const salesByDay = new Map(r.sales.daily.map((d) => [d.date, d]));
    table('Daily', ['Date', 'Target', 'Actual', 'Sold', 'Waste', 'Remaining'],
      r.production.daily.map((d) => {
        const s = salesByDay.get(d.date);
        const w = r.waste.daily.find((x) => x.date === d.date);
        return [d.date, d.target, d.actual, s?.sold ?? '', w?.waste ?? '', s?.remaining ?? ''];
      }));
    table('By food', ['Food', 'Target', 'Actual', 'Sold', 'Waste'],
      r.production.byFood.map((f) => {
        const s = r.sales.byFood.find((x) => x.foodItemId === f.foodItemId);
        const w = r.waste.byFood.find((x) => x.foodItemId === f.foodItemId);
        return [f.food, f.target, f.actual, s?.sold ?? '', w?.waste ?? ''];
      }));
    table('AI forecast vs actual', ['Date', 'Food', 'Predicted', 'Sold', 'Err%'],
      r.ai.pairs.map((p) => [p.date, p.food, p.predictedKg, p.actualSoldKg, p.absPctErr ?? '']));
    doc.moveDown(0.5);
    doc.fontSize(13).text('How calculated (estimates)');
    doc.fontSize(9);
    for (const h of r.sustainability.howCalculated) {
      needPage();
      doc.text(`- ${h}`);
    }
    doc.moveDown(0.5);
    doc.fontSize(13).text('Methodology disclaimer');
    doc.fontSize(9).text(
      'Aggregates deduplicated DailyFoodRecord rows, COMPLETED redistributions, and configured ImpactFactors. ' +
      'Cost and CO2e figures are estimates derived from those factors, not direct measurements. ' +
      'No guaranteed reductions are claimed. Baseline: earliest third of the selected range.'
    );
    doc.end();
  });
}

async function exportReport(
  req: AuthenticatedRequest, res: import('express').Response,
  format: 'csv' | 'xlsx' | 'pdf'
) {
  const parsed = reportQuery.safeParse(req.query);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return res.status(400).json({ error: first?.message ?? 'Please check the request.' });
  }
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) return res.status(404).json({ error: 'No organization yet.' });
  try {
    const report = await buildReport(me.organizationId, parsed.data);
    const fname = `report-${report.type}-${report.from}-to-${report.to}`;
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
      res.send(toCsv(report));
    } else if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
      res.send(toXlsx(report));
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
      res.send(await toPdf(report));
    }
    await audit('report.export', { userId: req.userId, organizationId: me.organizationId, entityType: 'Report', entityId: `${report.type}:${report.from}:${report.to}`,
      metadata: { type: report.type, format, from: report.from, to: report.to, filters: report.filters } });
  } catch (err) {
    if (!res.headersSent) {
      const msg = err instanceof Error ? err.message : 'Could not generate export.';
      return res.status(400).json({ error: msg });
    }
  }
}

// GET /api/reports/export.csv|xlsx|pdf — real files from live data + export audit
router.get('/export.csv', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  await exportReport(req, res, 'csv');
});
router.get('/export.xlsx', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  await exportReport(req, res, 'xlsx');
});
router.get('/export.pdf', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  await exportReport(req, res, 'pdf');
});

export default router;
