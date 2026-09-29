import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';

const router = Router();

const kitchenSchema = z.object({
  name: z.string().trim().min(2, 'Unit name must be at least 2 characters.'),
  mealTimings: z.string().trim().min(3, 'Please describe meal timings (e.g. Breakfast 8–10am, Lunch 12–2pm).'),
  storageAreas: z.string().trim().min(2, 'Please describe storage areas (e.g. Dry store, Cold room).'),
  foodCategories: z.string().trim().min(2, 'Please list food categories handled.'),
  productionCapacityKg: z.coerce.number().positive('Production capacity must be a positive number (kg).').max(1000000, 'Capacity looks too large — please check kg value.'),
});

const onboardingSchema = z.object({
  sector: z.enum(['GOVERNMENT', 'PRIVATE'], { errorMap: () => ({ message: 'Please choose Government or Private.' }) }),
  institutionType: z.enum(
    ['COLLEGE_CANTEEN', 'HOTEL_RESTAURANT', 'HOSTEL_MESS', 'HOSPITAL_CAFETERIA', 'CATERING', 'FOOD_PROCESSING_UNIT', 'OTHER'],
    { errorMap: () => ({ message: 'Please choose an institution type.' }) }
  ),
  name: z.string().trim().min(2, 'Organization name must be at least 2 characters.'),
  address: z.string().trim().min(5, 'Please enter the full street address (min 5 characters).'),
  city: z.string().trim().min(2, 'Please enter city / service area.'),
  contactName: z.string().trim().min(2, 'Please enter a contact person name.'),
  contactPhone: z.string().trim().min(7, 'Please enter a valid contact phone.'),
  contactEmail: z.string().trim().toLowerCase().email('Please enter a valid contact email.'),
  operatingHours: z.string().trim().min(3, 'Please enter operating hours (e.g. 8am–8pm).'),
  peopleServedDaily: z.coerce.number().int('People served must be a whole number.').min(1, 'Must serve at least 1 person daily.').max(1000000, 'Value looks too large.'),
  kitchenCapacityKg: z.coerce.number().positive('Kitchen capacity must be positive (kg).').max(1000000, 'Value looks too large — please check kg value.'),
  kitchens: z.array(kitchenSchema).min(1, 'Add at least one kitchen / unit.'),
});

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the form.', details: err.errors });
}

// All org routes need auth
router.use(requireAuth);

// GET /api/organizations/mine
router.get('/mine', async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user?.organizationId) {
    return res.status(404).json({ error: 'No organization yet. Please complete onboarding.', needsOnboarding: true });
  }
  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    include: { kitchens: { orderBy: { createdAt: 'asc' } }, profile: true },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found.', needsOnboarding: true });
  return res.json({ organization: org });
});

// POST /api/organizations/onboarding — blocked for STAFF and NGO (they join later)
router.post('/onboarding', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);

  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Account not found.' });
  if (me.organizationId) {
    return res.status(409).json({ error: 'You already belong to an organization. Use Organization page to manage it.' });
  }

  const existing = await prisma.organization.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return res.status(409).json({ error: 'An organization with this name already exists. Please choose a different name.' });
  }

  // unique kitchen names within this onboarding payload
  const names = parsed.data.kitchens.map((k) => k.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    return res.status(400).json({ error: 'Kitchen/unit names must be unique within the organization.' });
  }

  try {
    const { kitchens, ...orgFields } = parsed.data;
    const org = await prisma.organization.create({
      data: {
        ...orgFields,
        ownerId: me.id,
        kitchens: {
          create: kitchens.map((k) => ({
            name: k.name.trim(),
            mealTimings: k.mealTimings.trim(),
            storageAreas: k.storageAreas.trim(),
            foodCategories: k.foodCategories.trim(),
            productionCapacityKg: k.productionCapacityKg,
          })),
        },
        profile: { create: { notes: 'Created during onboarding.' } },
      },
      include: { kitchens: true, profile: true },
    });
    await prisma.user.update({ where: { id: me.id }, data: { organizationId: org.id } });
    await audit('org.onboarding', { userId: me.id, organizationId: org.id, entityType: 'Organization', entityId: org.id });
    return res.status(201).json({ message: 'Onboarding complete. Organization saved.', organization: org });
  } catch (e) {
    return res.status(500).json({ error: 'Could not save organization. Please try again.' });
  }
});

// PUT /api/organizations/mine — admin + manager only
router.put('/mine', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    address: z.string().trim().min(5).optional(),
    city: z.string().trim().min(2).optional(),
    contactName: z.string().trim().min(2).optional(),
    contactPhone: z.string().trim().min(7).optional(),
    contactEmail: z.string().trim().toLowerCase().email().optional(),
    operatingHours: z.string().trim().min(3).optional(),
    peopleServedDaily: z.coerce.number().int().min(1).optional(),
    kitchenCapacityKg: z.coerce.number().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) return res.status(404).json({ error: 'No organization to update.' });
  const org = await prisma.organization.update({ where: { id: me.organizationId }, data: parsed.data });
  await audit('org.update', { userId: me.id, organizationId: org.id, entityType: 'Organization', entityId: org.id });
  return res.json({ message: 'Organization updated.', organization: org });
});

// POST /api/organizations/kitchens — admin + manager only
router.post('/kitchens', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = kitchenSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me?.organizationId) return res.status(404).json({ error: 'Complete onboarding before adding kitchens.' });
  const dup = await prisma.kitchenUnit.findUnique({
    where: { organizationId_name: { organizationId: me.organizationId, name: parsed.data.name.trim() } },
  }).catch(() => null);
  if (dup) return res.status(409).json({ error: 'A kitchen/unit with this name already exists in your organization.' });
  try {
    const k = await prisma.kitchenUnit.create({
      data: {
        organizationId: me.organizationId,
        name: parsed.data.name.trim(),
        mealTimings: parsed.data.mealTimings.trim(),
        storageAreas: parsed.data.storageAreas.trim(),
        foodCategories: parsed.data.foodCategories.trim(),
        productionCapacityKg: parsed.data.productionCapacityKg,
      },
    });
    await audit('kitchen.create', { userId: me.id, organizationId: me.organizationId, entityType: 'KitchenUnit', entityId: k.id });
    return res.status(201).json({ message: 'Kitchen/unit added.', kitchen: k });
  } catch {
    return res.status(500).json({ error: 'Could not add kitchen. The name may already exist.' });
  }
});

export default router;
