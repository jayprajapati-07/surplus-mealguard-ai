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
  website: string | null; externalPlaceId: string | null; mapsUri: string | null;
  operationalStatus: string | null; source: string; lastCheckedAt: Date | null;
  verificationStatus: string; verificationSource: string | null; ngoDarpanId: string | null;
  emailSource: string | null; emailVerified: boolean; emailLastChecked: Date | null;
  foodAcceptanceStatus: string; acceptsCookedFood: boolean | null;
  acceptsPreparedFood: boolean | null; acceptsPackagedFood: boolean | null;
  distanceKm: number | null; relevance: string | null; relevanceReason: string | null;
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

const VERIFICATION_STATUSES = ['unverified', 'verification_pending', 'website_verified', 'admin_verified', 'darpan_verified'] as const;
const ACCEPTANCE_STATUSES = ['confirmed', 'likely', 'unknown', 'does_not_accept'] as const;

const ngoSchema = z.object({
  name: z.string().trim().min(2, 'NGO name must be at least 2 characters.').max(120, 'NGO name is too long.'),
  contactName: z.string().trim().max(120, 'Contact name is too long.').optional(),
  email: z.string().trim().email('Contact email is not valid.').max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(30, 'Phone is too long.').optional(),
  city: z.string().trim().max(120, 'City/service area is too long.').optional(),
  address: z.string().trim().max(200, 'Address is too long (text only).').optional(),
  website: z.string().trim().max(300, 'Website is too long.').optional(),
  acceptedCategories: z.union([z.string(), z.array(z.string().trim().min(1).max(40)).max(20)]).optional(),
  pickupCapable: z.boolean().optional().default(true),
  operatingHours: z.string().trim().max(120, 'Operating hours text is too long.').optional(),
  capacityKg: z.coerce.number().positive('Capacity must be greater than 0 kg.').max(100000, 'Capacity looks too large.').optional(),
  isActive: z.boolean().optional().default(true),
  emailVerified: z.boolean().optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  verificationSource: z.string().trim().max(200, 'Verification source is too long.').optional(),
  ngoDarpanId: z.string().trim().max(60, 'NGO-DARPAN id is too long.').optional(),
  foodAcceptanceStatus: z.enum(ACCEPTANCE_STATUSES).optional(),
  acceptsCookedFood: z.boolean().optional(),
  acceptsPreparedFood: z.boolean().optional(),
  acceptsPackagedFood: z.boolean().optional(),
});

function toRow(v: z.infer<typeof ngoSchema>) {
  const cats = Array.isArray(v.acceptedCategories)
    ? v.acceptedCategories.map((c) => c.trim()).filter(Boolean)
    : (v.acceptedCategories ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const email = v.email?.trim() || null;
  if (v.emailVerified && !email) throw new Error('An email address is required to mark it verified.');
  return {
    name: v.name.trim(),
    contactName: v.contactName?.trim() || null,
    contactEmail: email,
    contactPhone: v.phone?.trim() || null,
    city: v.city?.trim() || null,
    address: v.address?.trim() || null,
    website: v.website?.trim() || null,
    acceptedCategories: JSON.stringify(cats),
    pickupCapable: v.pickupCapable ?? true,
    operatingHours: v.operatingHours?.trim() || null,
    capacityKg: v.capacityKg ?? null,
    isActive: v.isActive ?? true,
    emailSource: email ? (v.emailVerified ? 'admin' : 'admin_unverified') : null,
    emailVerified: v.emailVerified ?? false,
    emailLastChecked: email ? new Date() : null,
    verificationStatus: v.verificationStatus ?? 'unverified',
    verificationSource: v.verificationSource?.trim() || (v.verificationStatus === 'admin_verified' ? 'admin' : null),
    ngoDarpanId: v.ngoDarpanId?.trim() || null,
    foodAcceptanceStatus: v.foodAcceptanceStatus ?? 'unknown',
    acceptsCookedFood: v.acceptsCookedFood ?? null,
    acceptsPreparedFood: v.acceptsPreparedFood ?? null,
    acceptsPackagedFood: v.acceptsPackagedFood ?? null,
    source: 'admin',
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
  let row: ReturnType<typeof toRow>;
  try {
    row = toRow(parsed.data);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'Please check the form.' });
  }
  const ngo = await prisma.ngoOrganization.create({ data: row });
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
  let merged: ReturnType<typeof toRow>;
  try {
    merged = { ...toRow({ ...parsed.data, name: parsed.data.name ?? existing.name } as z.infer<typeof ngoSchema>) };
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'Please check the form.' });
  }
  // Preserve fields the caller did not send.
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = merged.name;
  if (parsed.data.contactName !== undefined) patch.contactName = merged.contactName;
  if (parsed.data.email !== undefined) {
    patch.contactEmail = merged.contactEmail;
    patch.emailSource = merged.emailSource;
    patch.emailVerified = merged.emailVerified;
    patch.emailLastChecked = merged.emailLastChecked;
  }
  if (parsed.data.phone !== undefined) patch.contactPhone = merged.contactPhone;
  if (parsed.data.city !== undefined) patch.city = merged.city;
  if (parsed.data.address !== undefined) patch.address = merged.address;
  if (parsed.data.website !== undefined) patch.website = merged.website;
  if (parsed.data.acceptedCategories !== undefined) patch.acceptedCategories = merged.acceptedCategories;
  if (parsed.data.pickupCapable !== undefined) patch.pickupCapable = merged.pickupCapable;
  if (parsed.data.operatingHours !== undefined) patch.operatingHours = merged.operatingHours;
  if (parsed.data.capacityKg !== undefined) patch.capacityKg = merged.capacityKg;
  if (parsed.data.isActive !== undefined) patch.isActive = merged.isActive;
  if (parsed.data.emailVerified !== undefined) patch.emailVerified = merged.emailVerified;
  if (parsed.data.verificationStatus !== undefined) {
    patch.verificationStatus = merged.verificationStatus;
    patch.verificationSource = merged.verificationSource;
  }
  if (parsed.data.verificationSource !== undefined) patch.verificationSource = merged.verificationSource;
  if (parsed.data.ngoDarpanId !== undefined) patch.ngoDarpanId = merged.ngoDarpanId;
  if (parsed.data.foodAcceptanceStatus !== undefined) patch.foodAcceptanceStatus = merged.foodAcceptanceStatus;
  if (parsed.data.acceptsCookedFood !== undefined) patch.acceptsCookedFood = merged.acceptsCookedFood;
  if (parsed.data.acceptsPreparedFood !== undefined) patch.acceptsPreparedFood = merged.acceptsPreparedFood;
  if (parsed.data.acceptsPackagedFood !== undefined) patch.acceptsPackagedFood = merged.acceptsPackagedFood;
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
