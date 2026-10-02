import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, requireRole, audit, type AuthenticatedRequest } from '../auth';
import { scoreNgoMatch } from '../lib/matching';
import { sendMail } from '../lib/mailer';
import { buildSurplusEmail } from '../lib/food-distribution';

const router = Router();
router.use(requireAuth);

const MANAGE_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'] as const;
const TERMINAL = ['COMPLETED', 'CANCELLED'] as const;

// status -> { next states, who may move there }
const TRANSITIONS: Record<string, { to: string[]; by: ('institution' | 'ngo')[] }> = {
  DRAFT: { to: ['NOTIFIED'], by: ['institution'] },
  NOTIFIED: { to: ['ACCEPTED', 'DECLINED', 'CANCELLED'], by: ['institution', 'ngo'] },
  ACCEPTED: { to: ['PICKUP_SCHEDULED', 'DECLINED', 'CANCELLED'], by: ['institution', 'ngo'] },
  DECLINED: { to: ['CANCELLED'], by: ['institution'] },
  PICKUP_SCHEDULED: { to: ['HANDED_OVER', 'CANCELLED'], by: ['institution'] },
  HANDED_OVER: { to: ['COMPLETED', 'CANCELLED'], by: ['institution', 'ngo'] },
  COMPLETED: { to: [], by: [] },
  CANCELLED: { to: [], by: [] },
};

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

async function ngoOrgIdFor(req: AuthenticatedRequest, res: import('express').Response): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me || me.role !== 'NGO' || !me.ngoOrganizationId) {
    res.status(403).json({ error: 'NGO account is not linked to a registered NGO organization.' });
    return null;
  }
  return me.ngoOrganizationId;
}

function parseRecorded(a: { recordedInfoJson: string | null }) {
  try {
    return JSON.parse(a.recordedInfoJson ?? '{}') as {
      foodCategory?: string; availableUntil?: string;
    };
  } catch {
    return {};
  }
}

async function notifyMin(orgId: string): Promise<number> {
  const cfg = await prisma.eligibilityConfig.findUnique({ where: { organizationId: orgId } });
  return cfg?.minQuantityKg ?? 10;
}

type InstCtx = {
  org: { id: string; name: string; city: string; address: string; operatingHours: string; contactName: string; contactPhone: string; contactEmail: string };
  assessment: { id: string; foodDescription: string; quantityKg: number; kitchenUnitId: string | null; foodCategory: string; availableUntil: string };
};

async function matchOne(ngo: {
  id: string; name: string; city: string | null; address: string | null;
  acceptedCategories: string | null; pickupCapable: boolean; operatingHours: string | null;
  capacityKg: number | null; isActive: boolean;
}, ctx: InstCtx) {
  const r = scoreNgoMatch({
    ngo: { isActive: ngo.isActive, city: ngo.city, address: ngo.address, acceptedCategories: ngo.acceptedCategories,
      pickupCapable: ngo.pickupCapable, operatingHours: ngo.operatingHours, capacityKg: ngo.capacityKg },
    assessment: { quantityKg: ctx.assessment.quantityKg, foodCategory: ctx.assessment.foodCategory, availableUntil: ctx.assessment.availableUntil },
    institution: { city: ctx.org.city, address: ctx.org.address, operatingHours: ctx.org.operatingHours },
  });
  return r;
}

async function institutionCtx(orgId: string, assessmentId: string) {
  const a = await prisma.surplusEligibilityAssessment.findFirst({ where: { id: assessmentId, organizationId: orgId } });
  if (!a) return { error: 'Assessment not found in your organization.' as const };
  const rec = parseRecorded(a);
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return { error: 'Organization not found.' as const };
  return {
    ctx: {
      org: { id: org.id, name: org.name, city: org.city, address: org.address, operatingHours: org.operatingHours,
        contactName: org.contactName, contactPhone: org.contactPhone, contactEmail: org.contactEmail },
      assessment: { id: a.id, foodDescription: a.foodDescription, quantityKg: a.quantityKg,
        kitchenUnitId: a.kitchenUnitId, foodCategory: rec.foodCategory ?? 'Unspecified', availableUntil: rec.availableUntil ?? new Date().toISOString() },
    } as InstCtx,
    eligible: a.eligible,
  };
}

async function upsertMatch(assessmentId: string, ngoId: string, score: number, reasons: { criterion: string; points: number; detail: string }[]) {
  const reasonsJson = JSON.stringify(reasons);
  const existing = await prisma.ngoMatch.findUnique({ where: { assessmentId_ngoId: { assessmentId, ngoId } } });
  if (existing) {
    // Never downgrade a SELECTED match back to PROPOSED.
    return prisma.ngoMatch.update({ where: { id: existing.id }, data: { score, reasonsJson } });
  }
  return prisma.ngoMatch.create({ data: { assessmentId, ngoId, status: 'PROPOSED', score, reasonsJson } });
}

function readAttempts(m: { deliveryJson: string | null }): { at: string; channel: string; ok: boolean; error?: string }[] {
  try {
    const v = JSON.parse(m.deliveryJson ?? '{}') as { attempts?: { at: string; channel: string; ok: boolean; error?: string }[] };
    return Array.isArray(v.attempts) ? v.attempts : [];
  } catch {
    return [];
  }
}

// GET /api/redistribution/matches?assessmentId= — scored candidates, persisted
router.get('/matches', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ assessmentId: z.string().min(1) }).safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const loaded = await institutionCtx(orgId, parsed.data.assessmentId);
  if ('error' in loaded) return res.status(loaded.error === 'Organization not found.' ? 500 : 404).json({ error: loaded.error });
  if (!loaded.eligible) {
    return res.status(400).json({ error: 'Only ELIGIBLE assessments can be matched to NGOs.' });
  }
  const ngos = await prisma.ngoOrganization.findMany({ orderBy: { name: 'asc' } });
  const out = [];
  for (const n of ngos) {
    const r = await matchOne(n, loaded.ctx);
    const row = await upsertMatch(loaded.ctx.assessment.id, n.id, r.score, r.reasons);
    out.push({
      id: row.id, status: row.status, score: r.score, eligible: r.eligible, reasons: r.reasons,
      deliveryAttempts: readAttempts(row),
      ngo: { id: n.id, name: n.name, city: n.city, isActive: n.isActive, acceptedCategories: safeCats(n.acceptedCategories) },
    });
  }
  out.sort((a, b) => b.score - a.score);
  return res.json({ assessment: { id: loaded.ctx.assessment.id, food: loaded.ctx.assessment.foodDescription, quantityKg: loaded.ctx.assessment.quantityKg, verdict: 'ELIGIBLE' }, matches: out });
});

function safeCats(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

// POST /api/redistribution/notify — institution sends opportunity to selected NGOs
router.post('/notify', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    assessmentId: z.string().min(1),
    ngoIds: z.array(z.string().min(1)).min(1, 'Select at least one NGO.').max(10, 'Notify at most 10 NGOs at once.'),
    draftId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const loaded = await institutionCtx(orgId, parsed.data.assessmentId);
  if ('error' in loaded) return res.status(404).json({ error: loaded.error });
  if (!loaded.eligible) {
    return res.status(400).json({ error: 'Only ELIGIBLE assessments can notify NGOs.' });
  }
  const min = await notifyMin(orgId);
  if (loaded.ctx.assessment.quantityKg < min) {
    return res.status(400).json({ error: `Quantity ${loaded.ctx.assessment.quantityKg} kg is below the configured ${min} kg notification minimum.` });
  }
  const { ctx } = loaded;
  let linkedDraft: { id: string } | null = null;
  if (parsed.data.draftId) {
    const draft = await prisma.redistributionRecord.findFirst({
      where: { id: parsed.data.draftId, organizationId: orgId, status: 'DRAFT' },
    });
    if (!draft) return res.status(400).json({ error: 'Preparation draft not found (must be your organization’s DRAFT).' });
    await prisma.redistributionRecord.update({
      where: { id: draft.id },
      data: { notes: `${draft.notes ?? ''}\nLinked assessment ${ctx.assessment.id}.`.trim().slice(0, 1000) },
    });
    linkedDraft = { id: draft.id };
  }
  const results: { ngoId: string; channel: string; ok: boolean; error?: string }[] = [];
  const recordIds: string[] = [];
  for (const ngoId of parsed.data.ngoIds) {
    const ngo = await prisma.ngoOrganization.findUnique({ where: { id: ngoId } });
    if (!ngo) return res.status(400).json({ error: 'One of the selected NGOs does not exist.' });
    const scored = await matchOne(ngo, ctx);
    if (!ngo.isActive || scored.score <= 0) {
      const why = !ngo.isActive ? 'inactive' : 'incompatible (score 0)';
      return res.status(400).json({ error: `${ngo.name} is ${why} and cannot be selected. See matching reasons.` });
    }
    await upsertMatch(ctx.assessment.id, ngo.id, scored.score, scored.reasons);
    await prisma.ngoMatch.updateMany({ where: { assessmentId: ctx.assessment.id, ngoId: ngo.id }, data: { status: 'SELECTED' } });
    let record = await prisma.redistributionRecord.findFirst({
      where: { assessmentId: ctx.assessment.id, ngoId: ngo.id },
    });
    if (!record) {
      record = await prisma.redistributionRecord.create({
        data: { organizationId: orgId, kitchenUnitId: ctx.assessment.kitchenUnitId, ngoId: ngo.id,
          assessmentId: ctx.assessment.id, quantityKg: ctx.assessment.quantityKg, status: 'NOTIFIED',
          notes: `Notified ${ngo.name} for ${ctx.assessment.quantityKg} kg ${ctx.assessment.foodDescription}.` },
      });
    } else if (record.status === 'DRAFT') {
      record = await prisma.redistributionRecord.update({ where: { id: record.id }, data: { status: 'NOTIFIED' } });
    }
    recordIds.push(record.id);
    const subject = `Surplus pickup opportunity: ${ctx.assessment.quantityKg} kg ${ctx.assessment.foodDescription}`;
    const text = [
      `Institution: ${ctx.org.name} (${ctx.org.city}; ${ctx.org.address}).`,
      `Food: ${ctx.assessment.foodDescription} (${ctx.assessment.foodCategory}), quantity ${ctx.assessment.quantityKg} kg.`,
      `Available until: ${ctx.assessment.availableUntil}.`,
      `Contact: ${ctx.org.contactName}, ${ctx.org.contactPhone}, ${ctx.org.contactEmail}.`,
      `Reply in the app: accept, decline with reason, or request a callback.`,
    ].join('\n');
    const attempt = await sendMail({ to: ngo.contactEmail ?? `${ngo.name} <unknown@localhost>`, subject, text });
    const match = await prisma.ngoMatch.findUniqueOrThrow({ where: { assessmentId_ngoId: { assessmentId: ctx.assessment.id, ngoId: ngo.id } } });
    const attempts = [...readAttempts(match), attempt];
    await prisma.ngoMatch.update({ where: { id: match.id }, data: { deliveryJson: JSON.stringify({ attempts }) } });
    if (attempt.channel === 'simulated') {
      await prisma.notification.create({
        data: { organizationId: orgId, type: 'NGO_NOTIFY_SIMULATED',
          title: `To ${ngo.name}: ${subject}`,
          body: `To: ${ngo.contactEmail ?? ngo.name}\n${text}\n— simulated local delivery (no SMTP configured; no email was sent).`,
          linkPath: '/redistribution' },
      });
    } else {
      await prisma.notification.create({
        data: { organizationId: orgId, type: attempt.ok ? 'NGO_NOTIFY_SENT' : 'NGO_NOTIFY_FAILED',
          title: `To ${ngo.name}: ${subject}`,
          body: attempt.ok
            ? `Delivered via configured SMTP at ${attempt.at}.`
            : `Delivery via configured SMTP failed at ${attempt.at}: ${attempt.error ?? 'unknown error'}. Use retry.`,
          linkPath: '/redistribution' },
      });
    }
    const ngoUsers = await prisma.user.findMany({ where: { ngoOrganizationId: ngo.id }, select: { id: true } });
    for (const u of ngoUsers) {
      await prisma.notification.create({
        data: { userId: u.id, type: 'NGO_OPPORTUNITY',
          title: `Pickup opportunity: ${ctx.assessment.quantityKg} kg ${ctx.assessment.foodDescription}`,
          body: `${ctx.org.name} (${ctx.org.city}) offers ${ctx.assessment.quantityKg} kg ${ctx.assessment.foodDescription} (${ctx.assessment.foodCategory}). Available until ${ctx.assessment.availableUntil}. ${ctx.org.address}. Contact: ${ctx.org.contactName}, ${ctx.org.contactPhone}.`,
          linkPath: '/redistribution' },
      });
    }
    await audit('redistribution.notify', { userId: req.userId, organizationId: orgId, entityType: 'RedistributionRecord', entityId: record.id,
      metadata: { assessmentId: ctx.assessment.id, ngoId: ngo.id, channel: attempt.channel, ok: attempt.ok } });
    results.push({ ngoId: ngo.id, channel: attempt.channel, ok: attempt.ok, ...(attempt.error ? { error: attempt.error } : {}) });
  }
  return res.json({ message: `Notified ${results.length} NGO(s).`, results, recordIds, linkedDraft });
});

// POST /api/redistribution/notify/:matchId/retry
router.post('/notify/:matchId/retry', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const match = await prisma.ngoMatch.findUnique({
    where: { id: req.params.matchId },
    include: { ngo: true, assessment: true },
  });
  if (!match || match.assessment.organizationId !== orgId) {
    return res.status(404).json({ error: 'Match not found in your organization.' });
  }
  const rec = parseRecorded(match.assessment);
  const subject = `Surplus pickup opportunity (retry): ${match.assessment.quantityKg} kg ${match.assessment.foodDescription}`;
  const attempt = await sendMail({ to: match.ngo.contactEmail ?? `${match.ngo.name} <unknown@localhost>`, subject,
    text: `Reminder: ${match.assessment.quantityKg} kg ${match.assessment.foodDescription} (${rec.foodCategory ?? 'Unspecified'}) available until ${rec.availableUntil ?? '—'}. Reply in the app.` });
  const attempts = [...readAttempts(match), attempt];
  await prisma.ngoMatch.update({ where: { id: match.id }, data: { deliveryJson: JSON.stringify({ attempts }) } });
  await audit('redistribution.notify-retry', { userId: req.userId, organizationId: orgId, entityType: 'NgoMatch', entityId: match.id,
    metadata: { channel: attempt.channel, ok: attempt.ok } });
  return res.json({ message: 'Delivery retried; attempt recorded truthfully.', attempt });
});

// POST /api/redistribution/auto-retry — retry ONLY failed auto-distribution emails.
// Matches with a prior successful send are never resent (duplicate protection).
router.post('/auto-retry', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ assessmentId: z.string().min(1) }).safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const assessment = await prisma.surplusEligibilityAssessment.findFirst({
    where: { id: parsed.data.assessmentId, organizationId: orgId },
  });
  if (!assessment) return res.status(404).json({ error: 'Assessment not found in your organization.' });
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return res.status(500).json({ error: 'Organization not found.' });
  const location = [org.address, org.city, org.state, org.country].filter(Boolean).join(', ');
  const matches = await prisma.ngoMatch.findMany({
    where: { assessmentId: assessment.id },
    include: { ngo: true },
  });
  const results: { ngoId: string; ngoName: string; status: string; error?: string }[] = [];
  for (const m of matches) {
    const attempts = readAttempts(m);
    if (attempts.some((a) => a.ok)) {
      results.push({ ngoId: m.ngoId, ngoName: m.ngo.name, status: 'skipped-duplicate' });
      continue;
    }
    const email = (m.ngo.contactEmail ?? '').trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      results.push({ ngoId: m.ngoId, ngoName: m.ngo.name, status: 'email-unavailable' });
      continue;
    }
    if (!m.ngo.emailVerified) {
      results.push({ ngoId: m.ngoId, ngoName: m.ngo.name, status: 'skipped-unverified' });
      continue;
    }
    const { subject, text } = buildSurplusEmail({
      hotelName: org.name, location, contactPhone: org.contactPhone,
      ngoName: m.ngo.name, surplusKg: assessment.quantityKg,
    });
    const attempt = await sendMail({ to: email, subject, text });
    await prisma.ngoMatch.update({
      where: { id: m.id },
      data: { deliveryJson: JSON.stringify({ attempts: [...attempts, attempt] }) },
    });
    await prisma.ngoEmailDelivery.upsert({
      where: { assessmentId_ngoId_recipientEmail: { assessmentId: assessment.id, ngoId: m.ngoId, recipientEmail: email } },
      update: {
        status: attempt.ok ? 'sent' : 'failed',
        providerMessageId: attempt.messageId ?? null,
        failureReason: attempt.ok ? null : (attempt.error ?? 'Delivery failed.'),
        sentAt: attempt.ok ? new Date(attempt.at) : null,
      },
      create: {
        organizationId: orgId, assessmentId: assessment.id, ngoId: m.ngoId, recipientEmail: email,
        status: attempt.ok ? 'sent' : 'failed',
        providerMessageId: attempt.messageId ?? null,
        failureReason: attempt.ok ? null : (attempt.error ?? 'Delivery failed.'),
        sentAt: attempt.ok ? new Date(attempt.at) : null,
      },
    });
    await prisma.notification.create({
      data: {
        organizationId: orgId,
        type: attempt.channel === 'simulated' ? 'NGO_NOTIFY_SIMULATED' : attempt.ok ? 'NGO_NOTIFY_SENT' : 'NGO_NOTIFY_FAILED',
        title: `To ${m.ngo.name}: ${subject}`,
        body: attempt.ok ? `Retried via ${attempt.channel} at ${attempt.at}.` : `Retry failed at ${attempt.at}: ${attempt.error ?? 'unknown error'}.`,
        linkPath: '/food-distribution',
      },
    });
    await audit('distribution.auto-retry', {
      userId: req.userId, organizationId: orgId, entityType: 'NgoMatch', entityId: m.id,
      metadata: { channel: attempt.channel, ok: attempt.ok },
    });
    results.push({
      ngoId: m.ngoId, ngoName: m.ngo.name, status: attempt.ok ? 'sent' : 'failed',
      ...(attempt.error ? { error: attempt.error } : {}),
    });
  }
  const sent = results.filter((r) => r.status === 'sent').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  return res.json({ message: `Retry finished: ${sent} sent, ${failed} failed, ${results.length - sent - failed} skipped.`, results });
});

function shapeRecord(r: {  id: string; organizationId: string; kitchenUnitId: string | null; ngoId: string | null;
  assessmentId: string | null; quantityKg: number; status: string; pickupAt: Date | null;
  deliveredAt: Date | null; notes: string | null; createdAt: Date;
  ngo?: { id: string; name: string; city: string | null } | null;
  assessment?: { id: string; foodDescription: string; quantityKg: number; reason: string | null } | null;
  kitchenUnit?: { name: string } | null;
}) {
  return { ...r, ngoName: r.ngo?.name ?? null, assessmentFood: r.assessment?.foodDescription ?? null };
}

// GET /api/redistribution/records — institution board
router.get('/records', requireRole(...MANAGE_ROLES), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ assessmentId: z.string().min(1).optional(), status: z.string().min(1).optional() }).safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const orgId = await orgIdFor(req, res);
  if (!orgId) return;
  const where: { organizationId: string; assessmentId?: string; status?: string } = { organizationId: orgId };
  if (parsed.data.assessmentId) where.assessmentId = parsed.data.assessmentId;
  if (parsed.data.status) where.status = parsed.data.status;
  const records = await prisma.redistributionRecord.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 100,
    include: { ngo: { select: { id: true, name: true, city: true } }, assessment: true, kitchenUnit: true },
  });
  const withTimeline = await Promise.all(records.map(async (r) => {
    const timeline = await prisma.auditLog.findMany({
      where: { entityType: 'RedistributionRecord', entityId: r.id },
      orderBy: { createdAt: 'asc' }, take: 50,
    });
    const match = r.assessmentId && r.ngoId
      ? await prisma.ngoMatch.findUnique({ where: { assessmentId_ngoId: { assessmentId: r.assessmentId, ngoId: r.ngoId } } })
      : null;
    return { ...shapeRecord(r),
      deliveryAttempts: match ? readAttempts(match) : [],
      timeline: timeline.map((t) => ({ at: t.createdAt, action: t.action, metadata: t.metadataJson })) };
  }));
  return res.json({ records: withTimeline });
});

// GET /api/redistribution/opportunities — NGO inbox (own org only)
router.get('/opportunities', requireRole('NGO'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ history: z.coerce.boolean().optional().default(false) }).safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me || me.role !== 'NGO' || !me.ngoOrganizationId) {
    return res.status(403).json({ error: 'NGO account is not linked to a registered NGO organization.' });
  }
  const statuses = parsed.data.history
    ? ['NOTIFIED', 'ACCEPTED', 'DECLINED', 'PICKUP_SCHEDULED', 'HANDED_OVER', 'COMPLETED', 'CANCELLED']
    : ['NOTIFIED', 'ACCEPTED', 'PICKUP_SCHEDULED', 'HANDED_OVER'];
  const records = await prisma.redistributionRecord.findMany({
    where: { ngoId: me.ngoOrganizationId, status: { in: statuses } },
    orderBy: { createdAt: 'desc' }, take: 100,
    include: { assessment: true, organization: { select: { name: true, city: true, address: true, contactName: true, contactPhone: true, contactEmail: true } } },
  });
  const out = await Promise.all(records.map(async (r) => {
    const match = r.assessmentId
      ? await prisma.ngoMatch.findUnique({ where: { assessmentId_ngoId: { assessmentId: r.assessmentId, ngoId: me.ngoOrganizationId as string } } })
      : null;
    let score = 0;
    let reasons: { criterion: string; points: number; detail: string }[] = [];
    try {
      const v = JSON.parse(match?.reasonsJson ?? '[]') as typeof reasons;
      if (Array.isArray(v)) { reasons = v; score = match?.score ?? 0; }
    } catch { /* keep defaults */ }
    return { id: r.id, ngoId: r.ngoId, status: r.status, quantityKg: r.quantityKg, pickupAt: r.pickupAt,
      notes: r.notes, createdAt: r.createdAt,
      assessment: r.assessment ? { id: r.assessment.id, food: r.assessment.foodDescription, quantityKg: r.assessment.quantityKg, reason: r.assessment.reason } : null,
      institution: r.organization, score, reasons,
      deliveryAttempts: match ? readAttempts(match) : [] };
  }));
  return res.json({ records: out });
});

// GET /api/redistribution/:id — scoped detail (institution owner or assigned NGO)
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Not signed in.' });
  const r = await prisma.redistributionRecord.findUnique({
    where: { id: req.params.id },
    include: { ngo: { select: { id: true, name: true, city: true } }, assessment: true, kitchenUnit: true,
      organization: { select: { id: true, name: true, city: true, address: true, contactName: true, contactPhone: true, contactEmail: true } } },
  });
  if (!r) return res.status(404).json({ error: 'Redistribution record not found.' });
  const isOwner = !!me.organizationId && r.organizationId === me.organizationId &&
    ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'].includes(me.role);
  const isNgo = me.role === 'NGO' && !!me.ngoOrganizationId && r.ngoId === me.ngoOrganizationId;
  if (!isOwner && !isNgo) return res.status(404).json({ error: 'Redistribution record not found.' });
  const timeline = await prisma.auditLog.findMany({
    where: { entityType: 'RedistributionRecord', entityId: r.id },
    orderBy: { createdAt: 'asc' }, take: 50,
  });
  const match = r.assessmentId && r.ngoId
    ? await prisma.ngoMatch.findUnique({ where: { assessmentId_ngoId: { assessmentId: r.assessmentId, ngoId: r.ngoId } } })
    : null;
  let reasons: { criterion: string; points: number; detail: string }[] = [];
  try {
    const v = JSON.parse(match?.reasonsJson ?? '[]') as typeof reasons;
    if (Array.isArray(v)) reasons = v;
  } catch { /* keep defaults */ }
  return res.json({ record: { ...shapeRecord(r),
    institution: r.organization,
    deliveryAttempts: match ? readAttempts(match) : [],
    matchScore: match?.score ?? null, matchReasons: reasons,
    timeline: timeline.map((t) => ({ at: t.createdAt, action: t.action, metadata: t.metadataJson })) } });
});

async function move(
  req: AuthenticatedRequest, res: import('express').Response,
  opts: { id: string; to: string; actor: 'institution' | 'ngo'; auditAction: string; patch?: Record<string, unknown>; check?: (r: { status: string }) => string | null }
) {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(401).json({ error: 'Not signed in.' });
  const r = await prisma.redistributionRecord.findUnique({ where: { id: opts.id } });
  if (!r) return res.status(404).json({ error: 'Redistribution record not found.' });
  if (opts.actor === 'institution') {
    if (!me.organizationId || r.organizationId !== me.organizationId ||
      !['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'].includes(me.role)) {
      return res.status(403).json({ error: 'Only the owning institution’s managers can perform this action.' });
    }
  } else {
    if (me.role !== 'NGO' || !me.ngoOrganizationId || r.ngoId !== me.ngoOrganizationId) {
      return res.status(403).json({ error: 'Only the assigned NGO can perform this action.' });
    }
  }
  const rule = TRANSITIONS[r.status];
  if (!rule || !rule.to.includes(opts.to) || !rule.by.includes(opts.actor)) {
    const allowed = rule && rule.to.length > 0 ? rule.to.join(', ') : 'none (terminal state)';
    return res.status(400).json({ error: `Cannot move from ${r.status} to ${opts.to}. Valid next states: ${allowed}.` });
  }
  if (opts.check) {
    const problem = opts.check(r);
    if (problem) return res.status(400).json({ error: problem });
  }
  const updated = await prisma.redistributionRecord.update({ where: { id: r.id }, data: { status: opts.to, ...(opts.patch ?? {}) } });
  await audit(opts.auditAction, { userId: req.userId, organizationId: r.organizationId, entityType: 'RedistributionRecord', entityId: r.id,
    metadata: { from: r.status, to: opts.to } });
  return res.json({ record: updated });
}

// NGO: accept with intended pickup time
router.post('/:id/accept', requireRole('NGO'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ intendedPickupAt: z.string().min(1, 'Intended pickup time is required.') }).safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const at = new Date(parsed.data.intendedPickupAt);
  if (isNaN(at.getTime())) return res.status(400).json({ error: 'Intended pickup time is not valid.' });
  if (at.getTime() <= Date.now()) return res.status(400).json({ error: 'Intended pickup time must be in the future.' });
  await move(req, res, { id: req.params.id, to: 'ACCEPTED', actor: 'ngo', auditAction: 'redistribution.accept', patch: { pickupAt: at } });
});

// NGO: decline with reason
router.post('/:id/decline', requireRole('NGO'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ reason: z.string().trim().min(5, 'A decline reason (min 5 characters) is required.').max(500, 'Reason is too long.') }).safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  const cur = me ? await prisma.redistributionRecord.findUnique({ where: { id: req.params.id } }) : null;
  const note = `Declined: ${parsed.data.reason.trim()}`;
  await move(req, res, { id: req.params.id, to: 'DECLINED', actor: 'ngo', auditAction: 'redistribution.decline',
    patch: { notes: cur ? `${cur.notes ?? ''}\n${note}`.trim().slice(0, 1000) : note } });
});

// NGO: request callback (no state change; institution is notified)
router.post('/:id/callback', requireRole('NGO'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ message: z.string().trim().max(500, 'Message is too long.').optional(), phone: z.string().trim().max(30, 'Phone is too long.').optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me || me.role !== 'NGO' || !me.ngoOrganizationId) {
    return res.status(403).json({ error: 'NGO account is not linked to a registered NGO organization.' });
  }
  const r = await prisma.redistributionRecord.findFirst({
    where: { id: req.params.id, ngoId: me.ngoOrganizationId },
    include: { ngo: true },
  });
  if (!r || r.status !== 'NOTIFIED') {
    return res.status(400).json({ error: 'Callback can only be requested on a NOTIFIED opportunity.' });
  }
  await prisma.notification.create({
    data: { organizationId: r.organizationId, type: 'NGO_CALLBACK',
      title: `Callback requested by ${r.ngo?.name ?? 'NGO'}`,
      body: `${r.ngo?.name ?? 'NGO'} asks for a call about ${r.quantityKg} kg (record ${r.id}). Message: ${parsed.data.message?.trim() || '—'}. Phone: ${parsed.data.phone?.trim() || '—'}.`,
      linkPath: '/redistribution' },
  });
  await audit('redistribution.callback', { userId: req.userId, organizationId: r.organizationId, entityType: 'RedistributionRecord', entityId: r.id });
  return res.json({ message: 'Callback requested. The institution has been notified; the opportunity stays open.' });
});

// Institution: schedule pickup
router.post('/:id/schedule', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ pickupAt: z.string().min(1, 'Pickup time is required.') }).safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const at = new Date(parsed.data.pickupAt);
  if (isNaN(at.getTime())) return res.status(400).json({ error: 'Pickup time is not valid.' });
  await move(req, res, { id: req.params.id, to: 'PICKUP_SCHEDULED', actor: 'institution', auditAction: 'redistribution.schedule', patch: { pickupAt: at } });
});

// Institution: confirm handover
router.post('/:id/handover', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  await move(req, res, { id: req.params.id, to: 'HANDED_OVER', actor: 'institution', auditAction: 'redistribution.handover' });
});

// Institution: cancel with reason
router.post('/:id/cancel', requireRole('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'KITCHEN_MANAGER'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ reason: z.string().trim().min(5, 'A cancel reason (min 5 characters) is required.').max(500, 'Reason is too long.') }).safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  const cur = await prisma.redistributionRecord.findUnique({ where: { id: req.params.id } });
  const note = `Cancelled: ${parsed.data.reason.trim()}`;
  await move(req, res, { id: req.params.id, to: 'CANCELLED', actor: 'institution', auditAction: 'redistribution.cancel',
    patch: { notes: cur ? `${cur.notes ?? ''}\n${note}`.trim().slice(0, 1000) : note } });
});

// NGO: confirm receipt → COMPLETED + closed-loop impact
router.post('/:id/confirm-receipt', requireRole('NGO'), async (req: AuthenticatedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  const cur = me ? await prisma.redistributionRecord.findUnique({ where: { id: req.params.id } }) : null;
  if (!cur) return res.status(404).json({ error: 'Redistribution record not found.' });
  if (me?.role !== 'NGO' || !me.ngoOrganizationId || cur.ngoId !== me.ngoOrganizationId) {
    return res.status(403).json({ error: 'Only the assigned NGO can perform this action.' });
  }
  if (cur.status !== 'HANDED_OVER') {
    return res.status(400).json({ error: 'Receipt can only be confirmed after handover. Valid next states: none until HANDED_OVER.' });
  }
  const updated = await prisma.redistributionRecord.update({
    where: { id: cur.id }, data: { status: 'COMPLETED', deliveredAt: new Date() },
  });
  await audit('redistribution.receipt', { userId: req.userId, organizationId: cur.organizationId, entityType: 'RedistributionRecord', entityId: cur.id,
    metadata: { from: 'HANDED_OVER', to: 'COMPLETED' } });
  const factors = await prisma.impactFactor.findMany({
    where: {
      key: { in: ['CO2_PER_KG_FOOD', 'COST_PER_KG_FOOD'] },
      OR: [{ organizationId: cur.organizationId }, { organizationId: null }],
    },
    orderBy: { updatedAt: 'desc' },
  });
  const co2 = factors.find((f) => f.key === 'CO2_PER_KG_FOOD')?.value ?? 0;
  const cost = factors.find((f) => f.key === 'COST_PER_KG_FOOD')?.value ?? 0;
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const impact = await prisma.impactSnapshot.create({
    data: { organizationId: cur.organizationId, date: day,
      foodSavedKg: cur.quantityKg, wasteReducedKg: cur.quantityKg,
      co2AvoidedKgEstimate: Math.round(cur.quantityKg * co2 * 100) / 100,
      costSavedEstimate: Math.round(cur.quantityKg * cost * 100) / 100,
      notes: 'Estimates from ImpactFactors; foodSavedKg measured from completed redistribution.' },
  });
  return res.json({ record: updated, impact: { id: impact.id, foodSavedKg: impact.foodSavedKg } });
});

export default router;
