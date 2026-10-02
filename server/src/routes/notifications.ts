import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth';
import { INAPP_TYPES } from '../lib/surplus-risk';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'] as const;

async function orgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) {
    res.status(404).json({ error: 'No organization yet. Please complete onboarding first.' });
    return null;
  }
  return me.organizationId;
}

/**
 * Create an in-app notification unless an identical unread one already exists.
 * Returns true when a new row was created. Never touches auth/token rows.
 */
export async function notifyOrg(
  organizationId: string,
  type: string,
  title: string,
  body: string,
  linkPath: string
): Promise<boolean> {
  if (!INAPP_TYPES.includes(type)) return false;
  const existing = await prisma.notification.findFirst({
    where: { organizationId, type, linkPath, isRead: false },
  });
  if (existing) return false;
  await prisma.notification.create({ data: { organizationId, type, title, body, linkPath } });
  return true;
}

async function ownsNotification(orgId: string, userId: string, n: { organizationId: string | null; userId: string | null }): Promise<boolean> {
  if (n.organizationId && n.organizationId === orgId) return true;
  if (n.userId) {
    const u = await prisma.user.findUnique({ where: { id: n.userId }, select: { organizationId: true } });
    if (u?.organizationId && u.organizationId === orgId) return true;
  }
  void userId;
  return false;
}

// GET /api/notifications — in-app center only; auth token types are never listed.
// NGO users (no institution) see only their own NGO_OPPORTUNITY rows.
router.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Not signed in.' });
  if (me.role === 'NGO') {
    if (!me.ngoOrganizationId) {
      return res.status(403).json({ error: 'NGO account is not linked to a registered NGO organization.' });
    }
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: me.id, type: 'NGO_OPPORTUNITY' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.notification.count({
        where: { userId: me.id, type: 'NGO_OPPORTUNITY', isRead: false },
      }),
    ]);
    return res.json({ notifications: items, unreadCount });
  }
  if (!['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'].includes(me.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { organizationId: orgId, type: { in: INAPP_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.notification.count({
      where: { organizationId: orgId, type: { in: INAPP_TYPES }, isRead: false },
    }),
  ]);
  return res.json({ notifications: items, unreadCount });
});

// GET /api/notifications/unread-count — powers the Layout badge (NGO-aware)
router.get('/unread-count', requireAuth, async (req: AuthenticatedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Not signed in.' });
  if (me.role === 'NGO') {
    if (!me.ngoOrganizationId) return res.json({ unreadCount: 0 });
    const unreadCount = await prisma.notification.count({
      where: { userId: me.id, type: 'NGO_OPPORTUNITY', isRead: false },
    });
    return res.json({ unreadCount });
  }
  if (!['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'].includes(me.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const unreadCount = await prisma.notification.count({
    where: { organizationId: orgId, type: { in: INAPP_TYPES }, isRead: false },
  });
  return res.json({ unreadCount });
});

// PATCH /api/notifications/:id — mark read/unread (owners only; NGO users own their rows)
router.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ isRead: z.boolean() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return res.status(400).json({ error: first?.message ?? 'isRead must be true or false.' });
  }
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Not signed in.' });
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n) return res.status(404).json({ error: 'Notification not found.' });
  if (n.userId && n.userId === me.id && (me.role === 'NGO' || n.type === 'NGO_OPPORTUNITY')) {
    const updated = await prisma.notification.update({ where: { id: n.id }, data: { isRead: parsed.data.isRead } });
    return res.json({ notification: updated });
  }
  if (!['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF'].includes(me.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  if (!(await ownsNotification(orgId, req.userId!, n))) {
    return res.status(404).json({ error: 'Notification not found.' });
  }
  const updated = await prisma.notification.update({ where: { id: n.id }, data: { isRead: parsed.data.isRead } });
  return res.json({ notification: updated });
});

export default router;
