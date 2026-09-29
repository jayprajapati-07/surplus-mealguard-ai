import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';

const router = Router();
router.use(requireAuth);

const menuItemSchema = z.object({
  foodItemId: z.string().min(1, 'Each menu line must reuse a saved food item.'),
  quantityKg: z.coerce.number().positive('Quantity must be positive (kg).').max(100000, 'Quantity looks too large.'),
});

const menuSchema = z.object({
  kitchenUnitId: z.string().min(1).optional(),
  date: z.string().min(1, 'Date is required.').optional(), // daily
  weekStart: z.string().min(1).optional(), // weekly
  scope: z.enum(['DAILY', 'WEEKLY'], { errorMap: () => ({ message: 'Scope must be DAILY or WEEKLY.' }) }).default('DAILY'),
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER'], { errorMap: () => ({ message: 'Meal must be breakfast, lunch, or dinner.' }) }),
  title: z.string().trim().max(120, 'Title is too long.').optional(),
  isSpecial: z.coerce.boolean().optional().default(false),
  specialLabel: z.string().trim().max(120, 'Special label is too long.').optional(),
  items: z.array(menuItemSchema).min(1, 'Add at least one food item to the menu.'),
});

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

function parseDay(v: string | undefined, label: string): { date?: Date; error?: string } {
  if (!v) return { error: `${label} is required.` };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { error: `${label} is not a valid date.` };
  return { date: d };
}

async function validateItems(orgId: string, items: { foodItemId: string; quantityKg: number }[]): Promise<string | null> {
  const ids = [...new Set(items.map((i) => i.foodItemId))];
  const foods = await prisma.foodItem.findMany({ where: { id: { in: ids }, organizationId: orgId } });
  if (foods.length !== ids.length) return 'One or more menu lines reference a food item outside your organization.';
  const inactive = foods.find((f) => !f.isActive);
  if (inactive) return `“${inactive.name}” is archived. Restore it before adding it to a menu.`;
  return null;
}

// GET /api/menus
router.get('/', async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const where: Record<string, unknown> = { organizationId: orgId };
  if (req.query.scope === 'DAILY' || req.query.scope === 'WEEKLY') where.scope = req.query.scope;
  if (typeof req.query.kitchenUnitId === 'string' && req.query.kitchenUnitId) where.kitchenUnitId = req.query.kitchenUnitId;
  if (typeof req.query.from === 'string' && req.query.from) {
    const d = new Date(req.query.from);
    if (!isNaN(d.getTime())) (where as { date?: object }).date = { ...(where.date as object ?? {}), gte: d };
  }
  if (typeof req.query.to === 'string' && req.query.to) {
    const d = new Date(req.query.to);
    if (!isNaN(d.getTime())) (where as { date?: object }).date = { ...(where.date as object ?? {}), lte: d };
  }
  const menus = await prisma.menu.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 100,
    include: { items: { include: { foodItem: true } }, kitchenUnit: true },
  });
  return res.json({ menus });
});

// POST /api/menus
router.post('/', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = menuSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;

  if (v.kitchenUnitId) {
    const k = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
    if (!k) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  }
  const dayInput = v.scope === 'WEEKLY' ? v.weekStart ?? v.date : v.date ?? v.weekStart;
  const { date, error } = parseDay(dayInput, v.scope === 'WEEKLY' ? 'Week start date' : 'Menu date');
  if (error || !date) return res.status(400).json({ error: error ?? 'Invalid date.' });
  if (v.isSpecial && !v.specialLabel?.trim()) {
    return res.status(400).json({ error: 'Special menus need a label (e.g. “Festival special”).' });
  }
  const itemError = await validateItems(orgId, v.items);
  if (itemError) return res.status(400).json({ error: itemError });

  const foods = await prisma.foodItem.findMany({ where: { id: { in: v.items.map((i) => i.foodItemId) } } });
  const nameOf = new Map(foods.map((f) => [f.id, f.name]));
  const menu = await prisma.menu.create({
    data: {
      organizationId: orgId,
      kitchenUnitId: v.kitchenUnitId || undefined,
      date,
      scope: v.scope,
      mealType: v.mealType,
      title: v.title?.trim() || undefined,
      isSpecial: v.isSpecial ?? false,
      specialLabel: v.specialLabel?.trim() || undefined,
      items: {
        create: v.items.map((i) => ({ foodItemId: i.foodItemId, name: nameOf.get(i.foodItemId) ?? 'Item', quantityKg: i.quantityKg })),
      },
    },
    include: { items: { include: { foodItem: true } } },
  });
  await audit('menu.create', { userId: req.userId, organizationId: orgId, entityType: 'Menu', entityId: menu.id });
  return res.status(201).json({ message: 'Menu saved.', menu });
});

// PUT /api/menus/:id
router.put('/:id', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = menuSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.menu.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Menu not found.' });
  const v = parsed.data;
  if (v.kitchenUnitId) {
    const k = await prisma.kitchenUnit.findFirst({ where: { id: v.kitchenUnitId, organizationId: orgId } });
    if (!k) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
  }
  const dayInput = v.scope === 'WEEKLY' ? v.weekStart ?? v.date : v.date ?? v.weekStart;
  const { date, error } = parseDay(dayInput, 'Menu date');
  if (error || !date) return res.status(400).json({ error: error ?? 'Invalid date.' });
  if (v.isSpecial && !v.specialLabel?.trim()) {
    return res.status(400).json({ error: 'Special menus need a label.' });
  }
  const itemError = await validateItems(orgId, v.items);
  if (itemError) return res.status(400).json({ error: itemError });
  const foods = await prisma.foodItem.findMany({ where: { id: { in: v.items.map((i) => i.foodItemId) } } });
  const nameOf = new Map(foods.map((f) => [f.id, f.name]));
  await prisma.menuItem.deleteMany({ where: { menuId: existing.id } });
  const menu = await prisma.menu.update({
    where: { id: existing.id },
    data: {
      kitchenUnitId: v.kitchenUnitId || null,
      date,
      scope: v.scope,
      mealType: v.mealType,
      title: v.title?.trim() || null,
      isSpecial: v.isSpecial ?? false,
      specialLabel: v.specialLabel?.trim() || null,
      items: {
        create: v.items.map((i) => ({ foodItemId: i.foodItemId, name: nameOf.get(i.foodItemId) ?? 'Item', quantityKg: i.quantityKg })),
      },
    },
    include: { items: { include: { foodItem: true } } },
  });
  await audit('menu.update', { userId: req.userId, organizationId: orgId, entityType: 'Menu', entityId: menu.id });
  return res.json({ message: 'Menu updated.', menu });
});

// DELETE /api/menus/:id
router.delete('/:id', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.menu.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Menu not found.' });
  await prisma.menu.delete({ where: { id: existing.id } });
  await audit('menu.delete', { userId: req.userId, organizationId: orgId, entityType: 'Menu', entityId: existing.id });
  return res.json({ message: 'Menu deleted.' });
});

export default router;
