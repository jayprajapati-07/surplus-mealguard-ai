import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the form.', details: err.errors });
}

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

export const DEFAULT_INVENTORY_THRESHOLDS = { lowStockKg: 5, nearExpiryDays: 3, excessKg: 100 };

async function thresholdsFor(orgId: string) {
  const row = await prisma.inventoryThreshold.findUnique({ where: { organizationId: orgId } });
  if (!row) return { ...DEFAULT_INVENTORY_THRESHOLDS };
  return { lowStockKg: row.lowStockKg, nearExpiryDays: row.nearExpiryDays, excessKg: row.excessKg };
}

function daysToExpiry(expiry: Date | null): number | null {
  if (!expiry) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

const itemSchema = z.object({
  foodItemId: z.string().min(1, 'Please choose a food item.'),
  quantityKg: z.coerce.number().min(0, 'Quantity cannot be negative.').max(1000000, 'Quantity looks too large.'),
  supplier: z.string().trim().max(120, 'Supplier is too long.').optional(),
  purchaseDate: z.string().optional(),
  expiryDate: z.string().optional(),
  storageArea: z.string().trim().max(120, 'Storage area is too long (text only, no sensors).').optional(),
  batchCode: z.string().trim().max(60, 'Batch code is too long.').optional(),
});

function parseOptDate(v: string | undefined, label: string): { date?: Date | null; error?: string } {
  if (v === undefined || v === '') return { date: undefined };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { error: `${label} is not a valid date.` };
  return { date: d };
}

// GET /api/inventory
router.get('/', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ status: z.string().optional(), foodItemId: z.string().min(1).optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const where: { organizationId: string; status?: string; foodItemId?: string } = { organizationId: orgId };
  if (parsed.data.status) where.status = parsed.data.status;
  if (parsed.data.foodItemId) where.foodItemId = parsed.data.foodItemId;
  const items = await prisma.inventoryItem.findMany({
    where, orderBy: { updatedAt: 'desc' }, take: 500,
    include: { foodItem: true, kitchenUnit: true },
  });
  return res.json({
    items: items.map((i) => ({
      id: i.id, foodItemId: i.foodItemId, food: i.foodItem?.name ?? 'Unknown item',
      kitchen: i.kitchenUnit?.name ?? null, quantityKg: i.quantityKg, unit: i.foodItem?.unit ?? 'kg',
      supplier: i.supplier, purchaseDate: i.purchaseDate, expiryDate: i.expiryDate,
      daysToExpiry: daysToExpiry(i.expiryDate), storageArea: i.storageArea,
      batchCode: i.batchCode, status: i.status,
    })),
  });
});

// POST /api/inventory
router.post('/', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = itemSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;
  const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
  if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  const { date: purchaseDate, error: pErr } = parseOptDate(v.purchaseDate, 'Purchase date');
  if (pErr) return res.status(400).json({ error: pErr });
  const { date: expiryDate, error: eErr } = parseOptDate(v.expiryDate, 'Expiry date');
  if (eErr) return res.status(400).json({ error: eErr });
  if (purchaseDate && expiryDate && expiryDate < purchaseDate) {
    return res.status(400).json({ error: 'Expiry date cannot be before purchase date.' });
  }
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId: orgId, foodItemId: v.foodItemId, quantityKg: v.quantityKg,
      supplier: v.supplier?.trim() || null,
      purchaseDate: purchaseDate ?? null, expiryDate: expiryDate ?? null,
      storageArea: v.storageArea?.trim() || null, batchCode: v.batchCode?.trim() || null,
      status: 'ACTIVE',
    },
    include: { foodItem: true },
  });
  await audit('inventory.create', { userId: req.userId, organizationId: orgId, entityType: 'InventoryItem', entityId: item.id,
    metadata: { foodItemId: v.foodItemId, quantityKg: v.quantityKg } });
  return res.status(201).json({ message: 'Inventory lot recorded.', item });
});

// PUT /api/inventory/thresholds — fixed path registered first: Express matches
// routes in definition order and PUT /:id below would otherwise swallow it.
router.put('/thresholds', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    lowStockKg: z.coerce.number().min(0, 'Low-stock threshold cannot be negative.').max(10000, 'Low-stock threshold looks too large.'),
    nearExpiryDays: z.coerce.number().int().min(0, 'Near-expiry days cannot be negative.').max(90, 'Near-expiry window looks too large.'),
    excessKg: z.coerce.number().min(1, 'Excess threshold must be at least 1 kg.').max(100000, 'Excess threshold looks too large.'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  if (parsed.data.excessKg <= parsed.data.lowStockKg) {
    return res.status(400).json({ error: 'Excess threshold must be greater than low-stock threshold.' });
  }
  const row = await prisma.inventoryThreshold.upsert({
    where: { organizationId: orgId },
    update: { ...parsed.data, updatedById: req.userId },
    create: { organizationId: orgId, ...parsed.data, updatedById: req.userId },
  });
  await audit('inventory.thresholds', { userId: req.userId, organizationId: orgId, entityType: 'InventoryThreshold', entityId: row.id,
    metadata: parsed.data });
  return res.json({ message: 'Inventory thresholds saved.',
    thresholds: { lowStockKg: row.lowStockKg, nearExpiryDays: row.nearExpiryDays, excessKg: row.excessKg } });
});

// PUT /api/inventory/:id — edit fields
router.put('/:id', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = itemSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Inventory lot not found in your organization.' });
  const v = parsed.data;
  if (v.foodItemId) {
    const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
    if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  }
  const patch: Record<string, unknown> = {};
  if (v.foodItemId !== undefined) patch.foodItemId = v.foodItemId;
  if (v.quantityKg !== undefined) patch.quantityKg = v.quantityKg;
  if (v.supplier !== undefined) patch.supplier = v.supplier.trim() || null;
  if (v.storageArea !== undefined) patch.storageArea = v.storageArea.trim() || null;
  if (v.batchCode !== undefined) patch.batchCode = v.batchCode.trim() || null;
  if (v.purchaseDate !== undefined || v.expiryDate !== undefined) {
    const purchaseRaw = v.purchaseDate !== undefined ? v.purchaseDate : existing.purchaseDate?.toISOString();
    const expiryRaw = v.expiryDate !== undefined ? v.expiryDate : existing.expiryDate?.toISOString();
    const { date: purchaseDate, error: pErr } = parseOptDate(purchaseRaw, 'Purchase date');
    if (pErr) return res.status(400).json({ error: pErr });
    const { date: expiryDate, error: eErr } = parseOptDate(expiryRaw, 'Expiry date');
    if (eErr) return res.status(400).json({ error: eErr });
    if (purchaseDate && expiryDate && expiryDate < purchaseDate) {
      return res.status(400).json({ error: 'Expiry date cannot be before purchase date.' });
    }
    patch.purchaseDate = purchaseDate ?? null;
    patch.expiryDate = expiryDate ?? null;
  }
  const item = await prisma.inventoryItem.update({ where: { id: existing.id }, data: patch });
  await audit('inventory.edit', { userId: req.userId, organizationId: orgId, entityType: 'InventoryItem', entityId: item.id });
  return res.json({ message: 'Inventory lot updated.', item });
});

// PUT /api/inventory/:id/adjust — stock adjustment with mandatory reason
router.put('/:id/adjust', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    deltaKg: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 1000000, 'Adjustment must be non-zero and within ±1000000 kg.'),
    reason: z.string().trim().min(5, 'Stock adjustments need a reason (min 5 characters).').max(500, 'Reason is too long.'),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Inventory lot not found in your organization.' });
  const next = r3(existing.quantityKg + parsed.data.deltaKg);
  if (next < 0) {
    return res.status(400).json({ error: `Adjustment would drive stock negative (${next} kg). Record consumption or correct the entry instead.` });
  }
  const item = await prisma.inventoryItem.update({ where: { id: existing.id }, data: { quantityKg: next } });
  await audit('inventory.adjust', { userId: req.userId, organizationId: orgId, entityType: 'InventoryItem', entityId: item.id,
    metadata: { fromKg: existing.quantityKg, deltaKg: parsed.data.deltaKg, toKg: next, reason: parsed.data.reason.trim() } });
  return res.json({ message: `Stock adjusted to ${next} kg.`, item });
});

// POST /api/inventory/:id/archive + /restore
async function setStatus(req: AuthenticatedRequest, res: import('express').Response, status: string, action: string) {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Inventory lot not found in your organization.' });
  const item = await prisma.inventoryItem.update({ where: { id: existing.id }, data: { status } });
  await audit(action, { userId: req.userId, organizationId: orgId, entityType: 'InventoryItem', entityId: item.id });
  return res.json({ message: status === 'ARCHIVED' ? 'Inventory lot archived.' : 'Inventory lot restored to active.', item });
}

router.post('/:id/archive', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  await setStatus(req, res, 'ARCHIVED', 'inventory.archive');
});

router.post('/:id/restore', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  await setStatus(req, res, 'ACTIVE', 'inventory.restore');
});

// GET /api/inventory/alerts — computed from actual dates/quantities
router.get('/alerts', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const row = await prisma.inventoryThreshold.findUnique({ where: { organizationId: orgId } });
  const t = row
    ? { lowStockKg: row.lowStockKg, nearExpiryDays: row.nearExpiryDays, excessKg: row.excessKg }
    : { ...DEFAULT_INVENTORY_THRESHOLDS };
  const items = await prisma.inventoryItem.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' }, take: 1000,
    include: { foodItem: true },
  });
  const lowStock: unknown[] = [];
  const nearExpiry: unknown[] = [];
  const expired: unknown[] = [];
  const excess: unknown[] = [];
  for (const i of items) {
    const base = { id: i.id, food: i.foodItem?.name ?? 'Unknown item', quantityKg: i.quantityKg, unit: i.foodItem?.unit ?? 'kg', storageArea: i.storageArea, batchCode: i.batchCode };
    if (i.quantityKg <= t.lowStockKg) lowStock.push({ ...base, threshold: t.lowStockKg });
    if (i.quantityKg >= t.excessKg) excess.push({ ...base, threshold: t.excessKg });
    const d = daysToExpiry(i.expiryDate);
    if (d !== null) {
      if (d < 0) expired.push({ ...base, daysToExpiry: d, expiryDate: i.expiryDate });
      else if (d <= t.nearExpiryDays) nearExpiry.push({ ...base, daysToExpiry: d, expiryDate: i.expiryDate });
    }
  }
  return res.json({
    thresholds: t,
    customized: !!row,
    alerts: { lowStock, nearExpiry, expired, excess },
  });
});

// GET /api/inventory/thresholds
router.get('/thresholds', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const row = await prisma.inventoryThreshold.findUnique({ where: { organizationId: orgId } });
  return res.json({
    thresholds: row ? { lowStockKg: row.lowStockKg, nearExpiryDays: row.nearExpiryDays, excessKg: row.excessKg } : null,
    defaults: { ...DEFAULT_INVENTORY_THRESHOLDS },
    note: row ? null : 'No custom thresholds saved — documented defaults are in force.',
  });
});

export default router;
