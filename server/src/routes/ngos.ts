import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';

const router = Router();
router.use(requireAuth);

const READ_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the form.', details: err.errors });
}

function shapeNgo(n: {
  id: string; name: string; address: string | null; city: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  acceptedCategories: string | null; pickupCapable: boolean; operatingHours: string | null;
  capacityKg: number | null; isActive: boolean;
}) {
  let categories: string[] = [];
  try {
    const v = JSON.parse(n.acceptedCategories ?? '[]') as unknown;
    if (Array.isArray(v)) categories = v.map((x) => String(x));
  } catch {
    categories = [];
  }
  return { ...n, acceptedCategories: categories };
}

const ngoSchema = z.object({
  name: z.string().trim().min(2, 'NGO name must be at least 2 characters.').max(120, 'NGO name is too long.'),
  contactName: z.string().trim().max(120, 'Contact name is too long.').optional(),
  email: z.string().trim().email('Contact email is not valid.').max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(30, 'Phone is too long.').optional(),
  city: z.string().trim().max(120, 'City/service area is too long.').optional(),
  address: z.string().trim().max(200, 'Address is too long (text only).').optional(),
  acceptedCategories: z.union([z.string(), z.array(z.string().trim().min(1).max(40)).max(20)]).optional(),
  pickupCapable: z.boolean().optional().default(true),
  operatingHours: z.string().trim().max(120, 'Operating hours text is too long.').optional(),
  capacityKg: z.coerce.number().positive('Capacity must be greater than 0 kg.').max(100000, 'Capacity looks too large.').optional(),
  isActive: z.boolean().optional().default(true),
});

function toRow(v: z.infer<typeof ngoSchema>) {
  const cats = Array.isArray(v.acceptedCategories)
    ? v.acceptedCategories.map((c) => c.trim()).filter(Boolean)
    : (v.acceptedCategories ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  return {
    name: v.name.trim(),
    contactName: v.contactName?.trim() || null,
    contactEmail: v.email?.trim() || null,
    contactPhone: v.phone?.trim() || null,
    city: v.city?.trim() || null,
    address: v.address?.trim() || null,
    acceptedCategories: JSON.stringify(cats),
    pickupCapable: v.pickupCapable ?? true,
    operatingHours: v.operatingHours?.trim() || null,
    capacityKg: v.capacityKg ?? null,
    isActive: v.isActive ?? true,
  };
}

// GET /api/ngos — institution managers view suitable NGOs (read-only here)
router.get('/', requireRole(...READ_ROLES), async (_req: AuthenticatedRequest, res) => {
  const ngos = await prisma.ngoOrganization.findMany({ orderBy: { name: 'asc' } });
  return res.json({ ngos: ngos.map(shapeNgo) });
});

// POST /api/ngos — super-admin only
router.post('/', requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const parsed = ngoSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const dupe = await prisma.ngoOrganization.findUnique({ where: { name: parsed.data.name.trim() } });
  if (dupe) return res.status(400).json({ error: 'An NGO with this name is already registered.' });
  const ngo = await prisma.ngoOrganization.create({ data: toRow(parsed.data) });
  await audit('ngo.create', { userId: req.userId, entityType: 'NgoOrganization', entityId: ngo.id, metadata: { name: ngo.name } });
  return res.status(201).json({ message: 'NGO registered.', ngo: shapeNgo(ngo) });
});

// PUT /api/ngos/:id — super-admin only
router.put('/:id', requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const parsed = ngoSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const existing = await prisma.ngoOrganization.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'NGO not found.' });
  if (parsed.data.name && parsed.data.name.trim() !== existing.name) {
    const clash = await prisma.ngoOrganization.findUnique({ where: { name: parsed.data.name.trim() } });
    if (clash) return res.status(400).json({ error: 'An NGO with this name is already registered.' });
  }
  const merged = { ...toRow({ ...parsed.data, name: parsed.data.name ?? existing.name } as z.infer<typeof ngoSchema>) };
  // Preserve fields the caller did not send.
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = merged.name;
  if (parsed.data.contactName !== undefined) patch.contactName = merged.contactName;
  if (parsed.data.email !== undefined) patch.contactEmail = merged.contactEmail;
  if (parsed.data.phone !== undefined) patch.contactPhone = merged.contactPhone;
  if (parsed.data.city !== undefined) patch.city = merged.city;
  if (parsed.data.address !== undefined) patch.address = merged.address;
  if (parsed.data.acceptedCategories !== undefined) patch.acceptedCategories = merged.acceptedCategories;
  if (parsed.data.pickupCapable !== undefined) patch.pickupCapable = merged.pickupCapable;
  if (parsed.data.operatingHours !== undefined) patch.operatingHours = merged.operatingHours;
  if (parsed.data.capacityKg !== undefined) patch.capacityKg = merged.capacityKg;
  if (parsed.data.isActive !== undefined) patch.isActive = merged.isActive;
  const ngo = await prisma.ngoOrganization.update({ where: { id: existing.id }, data: patch });
  await audit('ngo.update', { userId: req.userId, entityType: 'NgoOrganization', entityId: ngo.id });
  return res.json({ message: 'NGO updated.', ngo: shapeNgo(ngo) });
});

async function setActive(req: AuthenticatedRequest, res: import('express').Response, active: boolean) {  const existing = await prisma.ngoOrganization.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'NGO not found.' });
  const ngo = await prisma.ngoOrganization.update({ where: { id: existing.id }, data: { isActive: active } });
  await audit(active ? 'ngo.activate' : 'ngo.deactivate', { userId: req.userId, entityType: 'NgoOrganization', entityId: ngo.id });
  return res.json({ message: active ? 'NGO reactivated.' : 'NGO deactivated. It will no longer match new surplus; history is preserved.', ngo: shapeNgo(ngo) });
}

// POST /api/ngos/:id/deactivate + /activate — super-admin only (no delete: history)
router.post('/:id/deactivate', requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  await setActive(req, res, false);
});

router.post('/:id/activate', requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  await setActive(req, res, true);
});

// POST /api/ngos/:id/link — super-admin links a user login to an NGO org
router.post('/:id/link', requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email('User email is not valid.') }).safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return res.status(400).json({ error: first?.message ?? 'User email is required.' });
  }
  const ngo = await prisma.ngoOrganization.findUnique({ where: { id: req.params.id } });
  if (!ngo) return res.status(404).json({ error: 'NGO not found.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role !== 'NGO') {
    return res.status(400).json({ error: 'Only users with the NGO role can be linked to an NGO organization.' });
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data: { ngoOrganizationId: ngo.id } });
  await audit('ngo.link-user', { userId: req.userId, entityType: 'NgoOrganization', entityId: ngo.id,
    metadata: { linkedUserId: user.id, email: user.email } });
  return res.json({ message: `${user.email} linked to ${ngo.name}.`, ngoOrganizationId: updated.ngoOrganizationId });
});

export default router;
