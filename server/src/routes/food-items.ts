import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';

const router = Router();
router.use(requireAuth);

const foodSchema = z.object({
  name: z.string().trim().min(2, 'Food name must be at least 2 characters.').max(120, 'Food name is too long (max 120).'),
  category: z.string().trim().min(2, 'Please choose or enter a category.').max(80, 'Category is too long.'),
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'ANY']).optional(),
  standardPortionKg: z.coerce.number().positive('Standard portion must be positive (kg).').max(1000, 'Portion looks too large.').optional(),
  sellingPrice: z.coerce.number().min(0, 'Selling price cannot be negative.').max(100000, 'Price looks too large.').optional(),
  unit: z.string().trim().min(1, 'Unit is required.').max(16, 'Unit is too long.').optional().default('kg'),
  recipeText: z.string().trim().max(2000, 'Recipe/ingredients text is too long (max 2000).').optional(),
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

/** Case-insensitive clash with another ACTIVE item. Archived names may be reused. */
async function activeNameClash(orgId: string, name: string, exceptId?: string): Promise<boolean> {
  const items = await prisma.foodItem.findMany({ where: { organizationId: orgId, isActive: true } });
  const norm = name.trim().toLowerCase();
  return items.some((i) => i.name.trim().toLowerCase() === norm && i.id !== exceptId);
}

// GET /api/food-items — every role in the org can read (menus/food-data need the list)
router.get('/', async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const items = await prisma.foodItem.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return res.json({ items });
});

// POST /api/food-items
router.post('/', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = foodSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  if (await activeNameClash(orgId, parsed.data.name)) {
    return res.status(409).json({ error: 'An active food item with this name already exists. Please change the name to keep records distinct.' });
  }
  const item = await prisma.foodItem.create({
    data: {
      organizationId: orgId,
      name: parsed.data.name.trim(),
      category: parsed.data.category.trim(),
      mealType: parsed.data.mealType,
      standardPortionKg: parsed.data.standardPortionKg,
      sellingPrice: parsed.data.sellingPrice,
      unit: (parsed.data.unit ?? 'kg').trim() || 'kg',
      recipeText: parsed.data.recipeText?.trim() || undefined,
    },
  });
  await audit('food.create', { userId: req.userId, organizationId: orgId, entityType: 'FoodItem', entityId: item.id });
  return res.status(201).json({ message: 'Food item created.', item });
});

// PUT /api/food-items/:id
router.put('/:id', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = foodSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.foodItem.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Food item not found.' });
  if (await activeNameClash(orgId, parsed.data.name, existing.id)) {
    return res.status(409).json({ error: 'Another active food item already uses this name. Please change the name.' });
  }
  const item = await prisma.foodItem.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name.trim(),
      category: parsed.data.category.trim(),
      mealType: parsed.data.mealType ?? null,
      standardPortionKg: parsed.data.standardPortionKg ?? null,
      sellingPrice: parsed.data.sellingPrice ?? null,
      unit: (parsed.data.unit ?? 'kg').trim() || 'kg',
      recipeText: parsed.data.recipeText?.trim() || null,
    },
  });
  await audit('food.update', { userId: req.userId, organizationId: orgId, entityType: 'FoodItem', entityId: item.id });
  return res.json({ message: 'Food item updated.', item });
});

// POST /api/food-items/:id/archive
router.post('/:id/archive', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.foodItem.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Food item not found.' });
  const item = await prisma.foodItem.update({ where: { id: existing.id }, data: { isActive: false } });
  await audit('food.archive', { userId: req.userId, organizationId: orgId, entityType: 'FoodItem', entityId: item.id });
  return res.json({ message: 'Food item archived. Past records and menus keep their history.', item });
});

// POST /api/food-items/:id/restore
router.post('/:id/restore', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.foodItem.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Food item not found.' });
  if (await activeNameClash(orgId, existing.name, existing.id)) {
    return res.status(409).json({ error: 'Another active item now uses this name. Rename this item before restoring.' });
  }
  const item = await prisma.foodItem.update({ where: { id: existing.id }, data: { isActive: true } });
  await audit('food.restore', { userId: req.userId, organizationId: orgId, entityType: 'FoodItem', entityId: item.id });
  return res.json({ message: 'Food item restored.', item });
});

// DELETE /api/food-items/:id — only when nothing references it; otherwise archive
router.delete('/:id', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const existing = await prisma.foodItem.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) return res.status(404).json({ error: 'Food item not found.' });
  const [menuRefs, recordRefs] = await Promise.all([
    prisma.menuItem.count({ where: { foodItemId: existing.id } }),
    prisma.dailyFoodRecord.count({ where: { foodItemId: existing.id } }),
  ]);
  if (menuRefs > 0 || recordRefs > 0) {
    return res.status(409).json({ error: `Cannot delete: used in ${menuRefs} menu line(s) and ${recordRefs} record(s). Archive it instead to preserve history.` });
  }
  await prisma.foodItem.delete({ where: { id: existing.id } });
  await audit('food.delete', { userId: req.userId, organizationId: orgId, entityType: 'FoodItem', entityId: existing.id });
  return res.json({ message: 'Food item deleted.' });
});

export default router;
