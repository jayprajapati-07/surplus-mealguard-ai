import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { defaultThresholds, type RiskThresholds } from '../lib/surplus-risk';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;
const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour).');

function toThresholds(row: { medKg: number; highKg: number; minSales: number; minSpanMin: number; windowsJson: string | null }): RiskThresholds {
  let windows = defaultThresholds().windows;
  if (row.windowsJson) {
    try {
      const w = JSON.parse(row.windowsJson) as RiskThresholds['windows'];
      if (w?.BREAKFAST?.end && w?.LUNCH?.end && w?.DINNER?.end) windows = w;
    } catch { /* fall back to defaults on corrupt JSON */ }
  }
  return { medKg: row.medKg, highKg: row.highKg, minSales: row.minSales, minSpanMin: row.minSpanMin, windows };
}

// GET /api/risk-thresholds — stored config, or null + documented defaults
router.get('/', requireRole(...READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const row = await prisma.riskThreshold.findUnique({ where: { organizationId: orgId } });
  const defaults = defaultThresholds();
  return res.json({
    thresholds: row ? toThresholds(row) : null,
    defaults,
    note: row ? null : 'No custom thresholds saved — documented defaults are in force.',
  });
});

const putSchema = z.object({
  medKg: z.coerce.number().min(0.5, 'Medium band must be at least 0.5 kg.').max(1000, 'Medium band looks too large.'),
  highKg: z.coerce.number().min(0.5, 'High band must be at least 0.5 kg.').max(1000, 'High band looks too large.'),
  minSales: z.coerce.number().int().min(1, 'Need at least 1 sale entry.').max(20, 'At most 20 sale entries.'),
  minSpanMin: z.coerce.number().int().min(5, 'Span must be at least 5 minutes.').max(480, 'Span must be at most 480 minutes.'),
  windows: z.object({
    BREAKFAST: z.object({ start: hhmm, end: hhmm }),
    LUNCH: z.object({ start: hhmm, end: hhmm }),
    DINNER: z.object({ start: hhmm, end: hhmm }),
  }).optional(),
});

// PUT /api/risk-thresholds
router.put('/', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return res.status(400).json({ error: first?.message ?? 'Please check the thresholds.', details: parsed.error.errors });
  }
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const v = parsed.data;
  if (v.highKg <= v.medKg) {
    return res.status(400).json({ error: 'High band must be greater than medium band.' });
  }
  const row = await prisma.riskThreshold.upsert({
    where: { organizationId: orgId },
    update: { medKg: v.medKg, highKg: v.highKg, minSales: v.minSales, minSpanMin: v.minSpanMin,
      ...(v.windows ? { windowsJson: JSON.stringify(v.windows) } : {}), updatedById: req.userId },
    create: { organizationId: orgId, medKg: v.medKg, highKg: v.highKg, minSales: v.minSales, minSpanMin: v.minSpanMin,
      windowsJson: v.windows ? JSON.stringify(v.windows) : null, updatedById: req.userId },
  });
  await audit('risk.thresholds', { userId: req.userId, organizationId: orgId, entityType: 'RiskThreshold', entityId: row.id,
    metadata: { medKg: row.medKg, highKg: row.highKg, minSales: row.minSales, minSpanMin: row.minSpanMin } });
  return res.json({ message: 'Surplus-risk bands saved.', thresholds: toThresholds(row) });
});

export default router;
