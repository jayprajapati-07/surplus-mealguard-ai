import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { buildSustainability, loadFiltered, parseRange } from '../lib/analytics';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;

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

// Super-Admins without an organization operate in global mode: they see and
// edit global (organization-less) factor rows only.
async function scopeFor(req: AuthenticatedRequest, res: import('express').Response): Promise<{ orgId: string | null; globalOnly: boolean } | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) {
    res.status(401).json({ error: 'Not signed in.' });
    return null;
  }
  if (!me.organizationId) {
    if (me.role !== 'SUPER_ADMIN') {
      res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
      return null;
    }
    return { orgId: null, globalOnly: true };
  }
  return { orgId: me.organizationId, globalOnly: false };
}

function shapeFactor(f: {
  id: string; key: string; name: string; value: number; unit: string;
  description: string | null; source: string | null; effectiveDate: Date | null;
  isActive: boolean; organizationId: string | null; category: string | null; foodItemId: string | null;
}) {
  return { ...f, effectiveDate: f.effectiveDate ? f.effectiveDate.toISOString().slice(0, 10) : null };
}

// GET /api/impact/factors — own-org + global rows (global-only for org-less super-admins)
router.get('/factors', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const scope = await scopeFor(req, res);
  if (!scope) return;
  const factors = scope.globalOnly
    ? await prisma.impactFactor.findMany({ where: { organizationId: null }, orderBy: { key: 'asc' } })
    : await prisma.impactFactor.findMany({
      where: { OR: [{ organizationId: scope.orgId }, { organizationId: null }] },
      orderBy: { key: 'asc' },
    });
  return res.json({ factors: factors.map(shapeFactor) });
});

const factorSchema = z.object({
  key: z.string().trim().regex(/^[A-Z0-9_]+$/, 'Key must use A-Z, 0-9, underscores.').min(2).max(60),
  name: z.string().trim().min(2, 'Name is required.').max(120, 'Name is too long.'),
  value: z.coerce.number().finite('Value must be a number.').min(0, 'Value cannot be negative.').max(1e9, 'Value looks too large.'),
  unit: z.string().trim().min(1, 'Unit is required.').max(30, 'Unit is too long.'),
  source: z.string().trim().min(2, 'Source/notes are required — unexplained numbers are not allowed.').max(300, 'Source is too long.'),
  description: z.string().trim().max(500, 'Notes are too long.').optional(),
  effectiveDate: z.string().min(1, 'Effective date is required.'),
  isActive: z.boolean().optional().default(true),
  category: z.string().trim().max(80).optional(),
  foodItemId: z.string().min(1).optional(),
});

// POST /api/impact/factors
router.post('/factors', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = factorSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const ctx = await scopeFor(req, res);
  if (!ctx) return;
  const orgId = ctx.orgId;
  const v = parsed.data;
  const eff = new Date(v.effectiveDate);
  if (isNaN(eff.getTime())) return res.status(400).json({ error: 'Effective date is not valid.' });
  if (v.foodItemId) {
    if (!orgId) return res.status(400).json({ error: 'Global rows cannot link a food item.' });
    const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
    if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  }
  const scope: { key: string; organizationId: string | null; category: string | null; foodItemId: string | null } = {
    key: v.key,
    organizationId: orgId,
    category: v.category?.trim() || null,
    foodItemId: v.foodItemId ?? null,
  };
  const existing = await prisma.impactFactor.findFirst({ where: scope });
  const data = {
    key: v.key, name: v.name.trim(), value: v.value, unit: v.unit.trim(),
    description: v.description?.trim() || null, source: v.source.trim(),
    effectiveDate: eff, isActive: v.isActive ?? true,
    organizationId: orgId, category: v.category?.trim() || null, foodItemId: v.foodItemId ?? null,
  };
  const factor = existing
    ? await prisma.impactFactor.update({ where: { id: existing.id }, data })
    : await prisma.impactFactor.create({ data });
  await audit('impact.factor', { userId: req.userId, organizationId: orgId ?? undefined, entityType: 'ImpactFactor', entityId: factor.id,
    metadata: { key: factor.key, value: factor.value } });
  return res.status(existing ? 200 : 201).json({ message: existing ? 'Factor updated.' : 'Factor created.', factor: shapeFactor(factor) });
});

// PUT /api/impact/factors/:id
router.put('/factors/:id', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = factorSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const ctx = await scopeFor(req, res);
  if (!ctx) return;
  const orgId = ctx.orgId;
  const existing = await prisma.impactFactor.findFirst({ where: { id: req.params.id } });
  if (!existing || (existing.organizationId !== null && existing.organizationId !== orgId)) {
    return res.status(404).json({ error: 'Factor not found in your organization.' });
  }
  if (existing.organizationId === null && req.userRole !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Global factors are Super-Admin managed.' });
  }
  const v = parsed.data;
  if (v.foodItemId && orgId) {
    const food = await prisma.foodItem.findFirst({ where: { id: v.foodItemId, organizationId: orgId } });
    if (!food) return res.status(400).json({ error: 'Food item not found in your organization.' });
  }
  if (v.foodItemId && !orgId) {
    return res.status(400).json({ error: 'Global rows cannot link a food item.' });
  }
  let eff: Date | undefined;
  if (v.effectiveDate !== undefined) {
    eff = new Date(v.effectiveDate);
    if (isNaN(eff.getTime())) return res.status(400).json({ error: 'Effective date is not valid.' });
  }
  const patch: Record<string, unknown> = {};
  if (v.name !== undefined) patch.name = v.name.trim();
  if (v.value !== undefined) patch.value = v.value;
  if (v.unit !== undefined) patch.unit = v.unit.trim();
  if (v.source !== undefined) patch.source = v.source.trim();
  if (v.description !== undefined) patch.description = v.description?.trim() || null;
  if (eff !== undefined) patch.effectiveDate = eff;
  if (v.isActive !== undefined) patch.isActive = v.isActive;
  if (v.category !== undefined) patch.category = v.category.trim() || null;
  if (v.foodItemId !== undefined) patch.foodItemId = v.foodItemId;
  const factor = await prisma.impactFactor.update({ where: { id: existing.id }, data: patch });
  await audit('impact.factor', { userId: req.userId, organizationId: orgId ?? undefined, entityType: 'ImpactFactor', entityId: factor.id,
    metadata: { key: factor.key, value: factor.value } });
  return res.json({ message: 'Factor updated.', factor: shapeFactor(factor) });
});

// POST /api/impact/snapshots — persist computed sustainability for reproducibility
router.post('/snapshots', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    from: z.string().min(1, 'From date is required.'),
    to: z.string().min(1, 'To date is required.'),
    kitchenUnitId: z.string().min(1).optional(),
    mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']).optional(),
    foodItemId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  try {
    const loaded = await loadFiltered(prisma, orgId, parsed.data);
    const { days } = parseRange(parsed.data.from, parsed.data.to);
    const foodCat = parsed.data.foodItemId ? loaded.foods.find((x) => x.id === parsed.data.foodItemId)?.category ?? null : null;
    const s = buildSustainability(loaded, days, { organizationId: orgId, foodItemId: parsed.data.foodItemId ?? null, mealType: parsed.data.mealType ?? null, category: foodCat });
    const toDay = new Date(`${parsed.data.to}T00:00:00Z`);
    const snapshot = await prisma.impactSnapshot.create({
      data: { organizationId: orgId, date: toDay,
        foodSavedKg: s.foodSavedKg, wasteReducedKg: s.wasteReducedKg,
        co2AvoidedKgEstimate: s.co2AvoidedKgEstimate, costSavedEstimate: s.costSavedEstimate,
        notes: JSON.stringify({ filters: parsed.data, method: 'impact-v1', howCalculated: s.howCalculated, baseline: s.baseline }) },
    });
    await audit('impact.snapshot', { userId: req.userId, organizationId: orgId, entityType: 'ImpactSnapshot', entityId: snapshot.id,
      metadata: { from: parsed.data.from, to: parsed.data.to } });
    return res.status(201).json({ message: 'Impact snapshot saved.', snapshot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not build snapshot.';
    return res.status(400).json({ error: msg });
  }
});

// GET /api/impact/snapshots
router.get('/snapshots', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const snapshots = await prisma.impactSnapshot.findMany({
    where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 100,
  });
  return res.json({
    snapshots: snapshots.map((s) => {
      let detail: unknown = null;
      try {
        detail = s.notes ? JSON.parse(s.notes) : null;
      } catch {
        detail = null;
      }
      return { ...s, detail };
    }),
  });
});

export default router;

