import { Router } from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import {
  coherenceError,
  normalizeDay,
  normalizeFoodName,
  normalizeMeal,
  parseDateCell,
  suggestMapping,
  unitToKg,
  type ExpectedField,
} from '../lib/flow';

const router = Router();

// Sample templates are static reference files — public so anyone can download them directly.
router.get('/templates/csv', async (_req, res) => {
  const csv = toCsv(TEMPLATE_HEADERS, TEMPLATE_ROWS);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mealguard-sample-template.csv"');
  return res.send(csv);
});

router.get('/templates/xlsx', async (_req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_ROWS]);
  XLSX.utils.book_append_sheet(wb, ws, 'FoodFlow');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="mealguard-sample-template.xlsx"');
  return res.send(buf);
});

router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) return cb(null, true);
    return cb(new Error('Only .csv, .xlsx, and .xls files are accepted.'));
  },
});

const TEMPLATE_HEADERS = ['Date', 'Food Item', 'Target', 'Produced', 'Sold', 'Waste', 'Surplus/Remaining', 'Meal', 'Unit'];
const TEMPLATE_ROWS: (string | number)[][] = [
  ['2026-09-21', 'Rice', 40, 42, 36, 2, 4, 'Lunch', 'kg'],
  ['2026-09-21', 'Dal', 18, 18, 15, 1, 2, 'Lunch', 'kg'],
  ['2026-09-22', 'Chapati', 25, 25, 22, 1, 2, 'Dinner', 'kg'],
];

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
}

interface ParsedFile {
  headers: string[];
  rows: Record<string, unknown>[];
}

function parseFile(buffer: Buffer, filename: string): ParsedFile {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    const recs = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, unknown>[];
    const headers = recs.length > 0 ? Object.keys(recs[0]) : [];
    return { headers, rows: recs };
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  const headerIdx = aoa.findIndex((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (headerIdx === -1) return { headers: [], rows: [] };
  const headers = (aoa[headerIdx] as unknown[]).map((c) => String(c ?? '').trim());
  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const line = aoa[i] as unknown[];
    if (!Array.isArray(line) || line.every((c) => String(c ?? '').trim() === '')) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = line[idx] ?? '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

function cell(row: Record<string, unknown>, col: string | null): unknown {
  if (!col) return undefined;
  return row[col];
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// POST /api/imports/parse or /api/imports/preview — detect headers, suggest mapping, preview (no DB writes)
router.post(['/parse', '/preview'], requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), (req: AuthenticatedRequest, res) => {
  upload.single('file')(req as never, res as never, async (err?: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
    const f = (req as unknown as { file?: Express.Multer.File }).file;
    if (!f) return res.status(400).json({ error: 'Please choose a .csv, .xlsx, or .xls file first.' });
    try {
      const { headers, rows } = parseFile(f.buffer, f.originalname);
      if (headers.length === 0) return res.status(400).json({ error: 'No header row found. Use the sample template format.' });
      const { mapping, needsMapping } = suggestMapping(headers);
      const preview = rows.slice(0, 10);
      return res.json({
        filename: f.originalname,
        headers,
        mapping,
        needsMapping,
        rowCount: rows.length,
        preview: preview.slice(0, 5),
        previewRows: preview,
        notice: needsMapping
          ? 'Some columns were uncertain. Please confirm the column mapping before importing.'
          : 'Columns detected with confidence. You can still adjust the mapping before importing.',
      });
    } catch {
      return res.status(400).json({ error: 'Could not read this file. Check it matches the sample template.' });
    }
  });
});

const confirmSchema = z.object({
  mapping: z.record(z.string()).optional().default({}),
  kitchenUnitId: z.string().min(1, 'Please choose the kitchen/unit this file belongs to.').optional(),
  defaultMeal: z.string().optional(),
});

// POST /api/imports/confirm or /api/imports/execute — validate rows, create records, persist job + row errors
router.post(['/confirm', '/execute'], requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), (req: AuthenticatedRequest, res) => {
  upload.single('file')(req as never, res as never, async (err?: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
    try {
      const me = await prisma.user.findUnique({ where: { id: (req as AuthenticatedRequest).userId! } });
      const orgId = me?.organizationId;
      if (!orgId) return res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });

      const f = (req as unknown as { file?: Express.Multer.File }).file;
      if (!f) return res.status(400).json({ error: 'Please attach the file again to confirm the import.' });

      let bodyMap: Record<string, string> = {};
      try {
        const raw = (req.body?.mapping as string | undefined) ?? '{}';
        bodyMap = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, string>) : {};
      } catch {
        return res.status(400).json({ error: 'Mapping is not valid JSON.' });
      }
      const parsed = confirmSchema.safeParse({ mapping: bodyMap, kitchenUnitId: req.body?.kitchenUnitId, defaultMeal: req.body?.defaultMeal });
      if (!parsed.success) {
        const first = parsed.error.errors[0];
        return res.status(400).json({ error: first?.message ?? 'Please check the import options.' });
      }

      const { headers, rows } = parseFile(f.buffer, f.originalname);
      if (headers.length === 0) return res.status(400).json({ error: 'No header row found.' });
      const { mapping: suggested } = suggestMapping(headers);
      const col = (field: ExpectedField): string | null => {
        const manual = (bodyMap[field] ?? '').trim();
        if (manual && headers.includes(manual)) return manual;
        return suggested[field]?.column ?? null;
      };
      const required: ExpectedField[] = ['date', 'food', 'produced', 'sold', 'waste'];
      const missing = required.filter((fld) => !col(fld));
      if (missing.length > 0) {
        return res.status(400).json({ error: `These required columns are unmapped: ${missing.join(', ')}. Please confirm the mapping.` });
      }

      // Resolve fallback kitchen once
      let fallbackKitchenId: string | null = parsed.data.kitchenUnitId ?? null;
      if (fallbackKitchenId) {
        const k = await prisma.kitchenUnit.findFirst({ where: { id: fallbackKitchenId, organizationId: orgId } });
        if (!k) return res.status(400).json({ error: 'Chosen kitchen/unit is not in your organization.' });
      } else if (!col('kitchen')) {
        return res.status(400).json({ error: 'Please choose the kitchen/unit this file belongs to.' });
      }
      const kitchens = await prisma.kitchenUnit.findMany({ where: { organizationId: orgId } });
      const kitchenByName = new Map(kitchens.map((k) => [k.name.trim().toLowerCase(), k.id]));
      const defaultMeal = parsed.data.defaultMeal ? normalizeMeal(parsed.data.defaultMeal) : null;
      if (parsed.data.defaultMeal && !defaultMeal) {
        return res.status(400).json({ error: 'Default meal must be breakfast, lunch, or dinner.' });
      }

      const foods = await prisma.foodItem.findMany({ where: { organizationId: orgId } });
      const foodByName = new Map(foods.map((x) => [x.name.trim().toLowerCase(), x]));
      let createdFoods = 0;
      let accepted = 0;
      let duplicates = 0;
      let invalid = 0;
      let skipped = 0;
      const errors: { rowNumber: number; raw: Record<string, unknown>; message: string }[] = [];

      const bad = (i: number, row: Record<string, unknown>, message: string) => {
        invalid++;
        errors.push({ rowNumber: i + 2, raw: row, message });
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (Object.values(row).every((v) => String(v ?? '').trim() === '')) {
          skipped++;
          continue;
        }
        const date = parseDateCell(cell(row, col('date')));
        if (!date) {
          bad(i, row, 'Date is missing or unrecognized. Use YYYY-MM-DD or DD/MM/YYYY.');
          continue;
        }
        const rawName = cell(row, col('food'));
        const name = normalizeFoodName(String(rawName ?? ''));
        if (!name) {
          bad(i, row, 'Food Item is blank.');
          continue;
        }
        const mealRaw = cell(row, col('meal'));
        const meal = normalizeMeal(String(mealRaw ?? '')) ?? defaultMeal;
        if (!meal) {
          bad(i, row, 'Meal must be breakfast, lunch, or dinner (or set a default meal).');
          continue;
        }
        // Kitchen: mapped column wins, else fallback
        let kitchenId = fallbackKitchenId;
        const kRaw = col('kitchen') ? String(cell(row, col('kitchen')) ?? '').trim() : '';
        if (kRaw) {
          const hit = kitchenByName.get(kRaw.toLowerCase());
          if (!hit) {
            bad(i, row, `Kitchen “${kRaw}” is not in your organization.`);
            continue;
          }
          kitchenId = hit;
        }
        if (!kitchenId) {
          bad(i, row, 'Kitchen/unit is missing for this row.');
          continue;
        }
        // Unit → kg
        const unitRaw = col('unit') ? String(cell(row, col('unit')) ?? '') : '';
        const factor = unitToKg(unitRaw);
        if (factor === null) {
          bad(i, row, `Unknown unit “${unitRaw.trim()}”. Supported: kg, g, quintal, tonne, lb, oz (or blank = kg).`);
          continue;
        }
        const q = (fld: ExpectedField, requiredQty: boolean): number | null | 'bad' => {
          const c = col(fld);
          if (!c) return requiredQty ? 'bad' : fld === 'surplus' || fld === 'target' ? null : 'bad';
          const v = cell(row, c);
          if (v === undefined || v === null || String(v).trim() === '') {
            if (fld === 'target') return null;
            if (fld === 'surplus' && !c) return 0;
            return 'bad';
          }
          const n = num(v);
          if (n === null || n < 0) return 'bad';
          return round3(n * factor);
        };
        const target = q('target', false);
        const produced = q('produced', true);
        const sold = q('sold', true);
        const waste = q('waste', true);
        let surplus = col('surplus') ? q('surplus', true) : 0;
        if (target === 'bad' || produced === 'bad' || sold === 'bad' || waste === 'bad' || surplus === 'bad') {
          bad(i, row, 'Quantities must be numbers ≥ 0 (Target may be blank).');
          continue;
        }
        const t = target === null ? undefined : (target as number);
        const p = produced as number;
        const s = sold as number;
        const w = waste as number;
        const r = (surplus as number) ?? 0;
        const cerr = coherenceError(p, s, w, r, null);
        if (cerr) {
          bad(i, row, `${cerr} Fix the row or enter it manually with an adjustment reason.`);
          continue;
        }
        // Food lookup / auto-create (normalized name)
        let food = foodByName.get(name.toLowerCase());
        if (!food) {
          food = await prisma.foodItem.create({
            data: { organizationId: orgId, name, category: 'General', mealType: meal, unit: 'kg' },
          });
          foodByName.set(name.toLowerCase(), food);
          createdFoods++;
        }
        // Duplicate check
        const day = normalizeDay(date);
        const next = new Date(day.getTime() + 86400000);
        const dup = await prisma.dailyFoodRecord.findFirst({
          where: { organizationId: orgId, kitchenUnitId: kitchenId, foodItemId: food.id, mealType: meal, isCorrection: false, date: { gte: day, lt: next } },
        });
        if (dup) {
          duplicates++;
          errors.push({ rowNumber: i + 2, raw: row, message: 'Duplicate: a record already exists for this date, kitchen, food item, and meal.' });
          continue;
        }
        await prisma.dailyFoodRecord.create({
          data: {
            organizationId: orgId,
            kitchenUnitId: kitchenId,
            foodItemId: food.id,
            date,
            mealType: meal,
            targetKg: t,
            preparedKg: p,
            servedKg: s,
            soldKg: s,
            wasteKg: w,
            remainingKg: r,
          },
        });
        accepted++;
      }

      const job = await prisma.importJob.create({
        data: {
          organizationId: orgId,
          fileName: f.originalname,
          status: 'COMPLETED',
          totalRows: rows.length,
          successRows: accepted,
          errorRows: invalid + duplicates,
          completedAt: new Date(),
          errors: {
            create: errors.map((e) => ({ rowNumber: e.rowNumber, rawDataJson: JSON.stringify(e.raw).slice(0, 2000), errorMessage: e.message })),
          },
        },
      });
      await audit('import.confirm', {
        userId: (req as AuthenticatedRequest).userId,
        organizationId: orgId,
        entityType: 'ImportJob',
        entityId: job.id,
        metadata: { fileName: f.originalname, accepted, duplicates, invalid, skipped, createdFoods },
      });
      return res.status(201).json({
        message: `Import complete: ${accepted} accepted, ${duplicates} duplicate(s), ${invalid} invalid, ${skipped} skipped.`,
        job: { id: job.id, fileName: job.fileName, status: job.status },
        accepted,
        duplicates,
        invalid,
        skipped,
        createdFoods,
        summary: { accepted, duplicates, invalid, skipped, createdFoods, totalRows: rows.length },
      });
    } catch (e) {
      return res.status(500).json({ error: 'Import failed. Please check the file and try again.' });
    }
  });
});

// GET /api/imports/jobs
router.get('/jobs', async (req: AuthenticatedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) return res.status(404).json({ error: 'No organization yet.' });
  const jobs = await prisma.importJob.findMany({
    where: { organizationId: me.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return res.json({ jobs });
});

// GET /api/imports/jobs/:id
router.get('/jobs/:id', async (req: AuthenticatedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) return res.status(404).json({ error: 'No organization yet.' });
  const job = await prisma.importJob.findFirst({
    where: { id: req.params.id, organizationId: me.organizationId },
    include: { errors: { orderBy: { rowNumber: 'asc' } } },
  });
  if (!job) return res.status(404).json({ error: 'Import job not found.' });
  return res.json({ job });
});

// GET /api/imports/jobs/:id/errors.csv — real generated error report
router.get('/jobs/:id/errors.csv', async (req: AuthenticatedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) return res.status(404).json({ error: 'No organization yet.' });
  const job = await prisma.importJob.findFirst({
    where: { id: req.params.id, organizationId: me.organizationId },
    include: { errors: { orderBy: { rowNumber: 'asc' } } },
  });
  if (!job) return res.status(404).json({ error: 'Import job not found.' });
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['rowNumber,error,data', ...job.errors.map((e) => [e.rowNumber, e.errorMessage, e.rawDataJson ?? ''].map(esc).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import-errors-${job.id}.csv"`);
  return res.send(lines.join('\n') + '\n');
});

export default router;
