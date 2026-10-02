import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth';
import { buildSeries } from '../lib/kitchen-memory';
import { ML_VERSION, rollingOriginEvaluate, predictNext, describeHistory } from '../lib/ml-forecast';
import { explainPrediction } from '../lib/gemini-explain';

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

// GET /api/ml/performance?kitchenUnitId=&foodItemId=&mealType= — validated model + genuine metrics.
router.get('/performance', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
    foodItemId: z.string().min(1, 'Please choose a food item.'),
    mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(404).json({ error: 'Kitchen/unit not found in your organization.' });
  const food = await prisma.foodItem.findFirst({ where: { id: parsed.data.foodItemId, organizationId: orgId } });
  if (!food) return res.status(404).json({ error: 'Food item not found in your organization.' });
  const records = await prisma.dailyFoodRecord.findMany({
    where: { organizationId: orgId },
    orderBy: { date: 'asc' },
    take: 5000,
  });
  const series = buildSeries(records, [], kitchen.id, food.id, parsed.data.mealType);
  const sold = series.map((p) => p.soldKg);
  const dows = series.map((p) => new Date(p.date).getUTCDay());
  if (sold.length < 2) {
    return res.json({
      food: food.name, mealType: parsed.data.mealType,
      insufficient: true, sampleSize: sold.length, modelVersion: ML_VERSION,
      message: 'Insufficient historical data for reliable prediction.',
    });
  }
  const evaluation = rollingOriginEvaluate(sold, dows, 4);
  if ('insufficient' in evaluation) {
    return res.json({
      food: food.name, mealType: parsed.data.mealType,
      insufficient: true, sampleSize: sold.length, modelVersion: ML_VERSION,
      message: 'Insufficient historical data for validated prediction — baseline forecast is used instead.',
    });
  }
  return res.json({
    food: food.name, mealType: parsed.data.mealType,
    insufficient: false, modelVersion: ML_VERSION,
    modelName: evaluation.best.modelName,
    metrics: {
      mae: evaluation.best.mae, rmse: evaluation.best.rmse,
      mape: evaluation.best.mape, r2: evaluation.best.r2, folds: evaluation.best.folds,
    },
    candidates: evaluation.all,
    sampleSize: sold.length,
    history: describeHistory(sold),
  });
});

// GET /api/ml/upcoming?kitchenUnitId=&date=&daysAhead= — ML predictions labelled as predictions.
router.get('/upcoming', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    kitchenUnitId: z.string().min(1, 'Please choose a kitchen/unit.'),
    date: z.string().min(1, 'Date is required.'),
    daysAhead: z.coerce.number().int().min(1).max(7).optional().default(1),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { id: parsed.data.kitchenUnitId, organizationId: orgId } });
  if (!kitchen) return res.status(404).json({ error: 'Kitchen/unit not found in your organization.' });
  const start = new Date(parsed.data.date);
  if (isNaN(start.getTime())) return res.status(400).json({ error: 'Date is not valid.' });
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const nextDay = new Date(day.getTime() + 86400000);
  const targets = await prisma.productionTarget.findMany({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: { gte: day, lt: nextDay } },
    take: 300,
    include: { foodItem: true },
  });
  return res.json({
    date: day.toISOString().slice(0, 10),
    kitchen: { id: kitchen.id, name: kitchen.name },
    predictions: targets.map((t) => {
      let validation: unknown = null;
      let modelName = 'memory-v1';
      let sampleSize: number | null = null;
      try {
        const v = t.inputsJson ? JSON.parse(t.inputsJson as string) as {
          validation?: unknown; modelName?: string; comparableCount?: number;
        } : null;
        validation = v?.validation ?? null;
        modelName = v?.modelName ?? 'memory-v1';
        sampleSize = v?.comparableCount ?? null;
      } catch { /* legacy rows without JSON */ }
      return {
        food: t.foodItem?.name ?? '—', mealType: t.mealType,
        predictedKg: t.predictedKg, recommendedKg: t.adjustedKg ?? t.recommendedKg,
        label: 'ML Prediction',
        modelName, modelVersion: t.memoryVersion, validation, sampleSize,
      };
    }),
  });
});

const explainSchema = z.object({
  predictedKg: z.coerce.number().finite().min(0).max(1000000),
  foodName: z.string().trim().min(1).max(120),
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']),
  dayLabel: z.string().trim().min(1).max(30),
  sampleSize: z.coerce.number().int().min(0).max(100000),
  modelName: z.string().trim().min(1).max(40),
  rmse: z.coerce.number().finite().min(0).max(1000000).nullable().optional(),
});

// POST /api/ml/explain — Gemini words for ML numbers. Numbers are echoed back
// verified; anything invented is replaced with the deterministic template.
router.post('/explain', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = explainSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const out = await explainPrediction({
    predictedKg: parsed.data.predictedKg,
    foodName: parsed.data.foodName,
    mealType: parsed.data.mealType,
    dayLabel: parsed.data.dayLabel,
    sampleSize: parsed.data.sampleSize,
    modelName: parsed.data.modelName,
    rmse: parsed.data.rmse ?? null,
  });
  return res.json({ explanation: out.text, source: out.source });
});

export default router;
