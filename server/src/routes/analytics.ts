import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth';
import {
  loadFiltered, parseRange, buildProduction, buildSales, buildWaste,
  buildSurplus, buildAI, buildSustainability,
} from '../lib/analytics';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;

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

const filterSchema = z.object({
  from: z.string().min(1, 'From date is required.'),
  to: z.string().min(1, 'To date is required.'),
  kitchenUnitId: z.string().min(1).optional(),
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']).optional(),
  foodItemId: z.string().min(1).optional(),
});

// GET /api/analytics/overview — every section computed live from filtered rows
router.get('/overview', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  try {
    const f = parsed.data;
    if (f.kitchenUnitId) {
      const k = await prisma.kitchenUnit.findFirst({ where: { id: f.kitchenUnitId, organizationId: orgId } });
      if (!k) return res.status(400).json({ error: 'Kitchen/unit not found in your organization.' });
    }
    if (f.foodItemId) {
      const fi = await prisma.foodItem.findFirst({ where: { id: f.foodItemId, organizationId: orgId } });
      if (!fi) return res.status(400).json({ error: 'Food item not found in your organization.' });
    }
    const loaded = await loadFiltered(prisma, orgId, f);
    const { days } = parseRange(f.from, f.to);
    const foodCat = f.foodItemId ? loaded.foods.find((x) => x.id === f.foodItemId)?.category ?? null : null;
    const sustainability = buildSustainability(loaded, days, { organizationId: orgId, foodItemId: f.foodItemId ?? null, mealType: f.mealType ?? null, category: foodCat });
    return res.json({
      filters: f,
      production: buildProduction(loaded, days),
      sales: buildSales(loaded, days),
      waste: buildWaste(loaded, days),
      surplus: buildSurplus(loaded),
      ai: buildAI(loaded),
      sustainability,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not build analytics.';
    return res.status(400).json({ error: msg });
  }
});

export default router;
