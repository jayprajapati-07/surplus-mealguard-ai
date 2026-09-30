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

export default router;
