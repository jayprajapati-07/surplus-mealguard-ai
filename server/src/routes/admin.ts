import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth';

const router = Router();

router.use(requireAuth);

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the request.', details: err.errors });
}

// GET /api/admin/users — SUPER_ADMIN only. Exists to prove role guards work.
router.get('/users', requireRole('SUPER_ADMIN'), async (_req: AuthenticatedRequest, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true, role: true, emailVerified: true, organizationId: true, createdAt: true },
  });
  return res.json({ users });
});

// GET /api/admin/audit-log — Super-Admin sees everything (optional org filter);
// institution admins/managers see their own organization's rows plus their own
// org-less rows (e.g. their login events). STAFF/NGO get 403.
router.get('/audit-log', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({
    action: z.string().min(1).optional(),
    entityType: z.string().min(1).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    organizationId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  }).safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const q = parsed.data;
  const where: Record<string, unknown> = {};
  if (req.userRole !== 'SUPER_ADMIN') {
    const me = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!me?.organizationId) return res.status(404).json({ error: 'No organization yet.' });
    where.OR = [{ organizationId: me.organizationId }, { userId: me.id }];
  } else if (q.organizationId) {
    where.organizationId = q.organizationId;
  }
  if (q.action) where.action = { contains: q.action };
  if (q.entityType) where.entityType = q.entityType;
  if (q.from || q.to) {
    const dr: Record<string, Date> = {};
    if (q.from) {
      const d = new Date(q.from);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'From date is not valid.' });
      dr.gte = d;
    }
    if (q.to) {
      const d = new Date(q.to);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'To date is not valid.' });
      dr.lte = d;
    }
    where.createdAt = dr;
  }
  const rows = await prisma.auditLog.findMany({
    where, orderBy: { createdAt: 'desc' }, take: q.limit ?? 100,
    include: { user: { select: { name: true, email: true } } },
  });
  return res.json({ entries: rows });
});

export default router;
