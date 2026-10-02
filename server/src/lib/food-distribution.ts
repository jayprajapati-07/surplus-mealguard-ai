// Phase 4: automatic NGO distribution — deterministic engine, fully inspectable.
// Gates: surplus > 0 AND consistent data AND operational minimum AND an
// ELIGIBLE operational verdict. Human sensory confirmation is NEVER faked:
// auto assessments record humanConfirmed:false, and physical handover stays
// human via the existing redistribution endpoints. NGO discovery draws ONLY
// from the verified in-app registry (active + valid contact + positive match
// score) — external names, emails and phones are never invented.
// Idempotency: one assessment per EOD report; one send per NGO per assessment
// unless an explicit retry is requested after failure.
import { prisma } from '../prisma';
import { audit } from '../auth';
import { scoreNgoMatch } from './matching';
import { sendMail } from './mailer';
import { decideEligibility } from './eligibility';
import { haversineKm, keywordRelevance, rankScore } from './ngo-discovery';

export const AUTO_MIN_QTY_DEFAULT = 10;
export const AUTO_NGO_LIMIT = 10;

function parseTypes(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/**
 * Stable identity for one hotel + kitchen + day distribution event.
 * Regenerations reuse the same key, so the assessment (and its send history)
 * is found again instead of duplicating NGO emails.
 */
export function distributionKeyFor(organizationId: string, kitchenUnitId: string | null, dateKey: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  return `auto:${safe(organizationId)}:${safe(kitchenUnitId ?? 'nokitchen')}:${dateKey}`;
}

/** Gate: start the workflow only for positive, consistent surplus. */
export function shouldAutoDistribute(args: { surplusKg: number; inconsistency: boolean }): {
  start: boolean; reason: string;
} {
  if (args.inconsistency) {
    return { start: false, reason: 'Data inconsistency flagged — no NGO emails sent.' };
  }
  if (!(args.surplusKg > 0)) {
    return { start: false, reason: 'Zero surplus — no NGO emails sent.' };
  }
  return { start: true, reason: `Surplus ${args.surplusKg} kg — starting NGO distribution workflow.` };
}

/** Mailable = active + syntactically valid email + explicitly verified. Nothing else qualifies. */
export function isMailableNgo(ngo: { isActive: boolean; contactEmail: string | null; emailVerified?: boolean }): boolean {
  if (!ngo.isActive) return false;
  if (!ngo.emailVerified) return false;
  const email = (ngo.contactEmail ?? '').trim();
  return /^\S+@\S+\.\S+$/.test(email);
}

export interface SurplusEmailInput {
  hotelName: string;
  location: string;
  contactPhone: string;
  ngoName: string;
  surplusKg: number;
}

/** Redistribution notice filled ONLY with verified application data. */
export function buildSurplusEmail(i: SurplusEmailInput): { subject: string; text: string } {
  const subject = `Surplus Food Available for Redistribution – ${i.hotelName}`;
  const text = [
    `Hello ${i.ngoName},`,
    '',
    `We are from ${i.hotelName}.`,
    '',
    `Today our hotel has approximately ${i.surplusKg} kg of surplus food available for potential redistribution.`,
    '',
    'If your organization is interested in receiving this surplus food, please contact our management team at:',
    '',
    i.contactPhone,
    '',
    'Hotel:',
    i.hotelName,
    '',
    'Location:',
    i.location,
    '',
    'Thank you for helping us reduce food waste and support the community.',
    '',
    'Regards,',
    i.hotelName,
  ].join('\n');
  return { subject, text };
}

/** Keep positive scores, best-first, capped. Pure selection over verified candidates. */
export function selectTopNgos<T extends { ngoId: string; score: number }>(scored: T[], limit: number = AUTO_NGO_LIMIT): T[] {
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

export interface AutoDistributionResult {
  started: boolean;
  reason: string;
  assessmentId?: string;
  results?: { ngoId: string; ngoName: string; email: string; status: 'sent' | 'failed' | 'skipped-duplicate' | 'skipped-no-email' | 'skipped-unverified' | 'email-unavailable' | 'not-eligible'; error?: string }[];
}

function readAttempts(deliveryJson: string | null): { at: string; channel: string; ok: boolean; error?: string }[] {
  try {
    const v = JSON.parse(deliveryJson ?? '{}') as { attempts?: { at: string; channel: string; ok: boolean; error?: string }[] };
    return Array.isArray(v.attempts) ? v.attempts : [];
  } catch {
    return [];
  }
}

/**
 * Automatic distribution for one EOD report. Idempotent: re-running for the
 * same report reuses the assessment and never resends to already-sent NGOs.
 */
export async function triggerAutoDistribution(args: {
  organizationId: string;
  kitchenUnitId: string | null;
  kitchenName: string;
  eodReportId: string;
  dateLabel: string;
  surplusKg: number;
  inconsistency: boolean;
}): Promise<AutoDistributionResult> {
  const gate = shouldAutoDistribute({ surplusKg: args.surplusKg, inconsistency: args.inconsistency });
  if (!gate.start) return { started: false, reason: gate.reason };

  const org = await prisma.organization.findUnique({ where: { id: args.organizationId } });
  if (!org) return { started: false, reason: 'Organization not found.' };
  const cfg = await prisma.eligibilityConfig.findUnique({ where: { organizationId: args.organizationId } });
  const min = cfg?.minQuantityKg ?? AUTO_MIN_QTY_DEFAULT;
  if (args.surplusKg < min) {
    return { started: false, reason: `Surplus ${args.surplusKg} kg is below the configured ${min} kg notification minimum.` };
  }

  // One assessment per EOD report — reuse on re-runs and regenerations
  // (stable distribution key; legacy eodReportId match as fallback).
  const distKey = distributionKeyFor(args.organizationId, args.kitchenUnitId, args.dateLabel);
  const existing = (await prisma.surplusEligibilityAssessment.findFirst({
    where: { organizationId: args.organizationId, recordedInfoJson: { contains: distKey } },
  })) ?? (await prisma.surplusEligibilityAssessment.findFirst({
    where: { organizationId: args.organizationId, recordedInfoJson: { contains: args.eodReportId } },
  }));
  let assessment = existing;
  if (!assessment) {
    const availableUntil = new Date(Date.now() + 20 * 3600 * 1000).toISOString();
    const { verdict, reasons } = decideEligibility(
      { quantityKg: args.surplusKg, expiryDate: null, availableUntil },
      min
    );
    assessment = await prisma.surplusEligibilityAssessment.create({
      data: {
        organizationId: args.organizationId,
        kitchenUnitId: args.kitchenUnitId,
        foodDescription: `EOD surplus ${args.dateLabel} (${args.kitchenName})`,
        quantityKg: args.surplusKg,
        recordedInfoJson: JSON.stringify({
          auto: true, eodReportId: args.eodReportId, distributionKey: distKey, verdict,
          foodCategory: 'Mixed Surplus Food', availableUntil, minQuantityKg: min,
        }),
        // Operational matrix only — human sensory confirmation outstanding.
        humanConfirmed: false,
        eligible: verdict === 'ELIGIBLE',
        reason: `Auto-created from EOD report ${args.eodReportId}: ${reasons.join(' ')} Human quality confirmation still required before physical handover.`,
      },
    });
    await audit('distribution.auto-assess', {
      organizationId: args.organizationId, entityType: 'SurplusEligibilityAssessment', entityId: assessment.id,
      metadata: { eodReportId: args.eodReportId, verdict, quantityKg: args.surplusKg },
    });
    if (verdict !== 'ELIGIBLE') {
      return { started: false, reason: `Operational verdict ${verdict} — held for review, no NGO emails sent.`, assessmentId: assessment.id };
    }
  } else if (!assessment.eligible) {
    return { started: false, reason: 'Existing assessment is not eligible — held for review.', assessmentId: assessment.id };
  }

  // Discover: REAL organizations only — active registry rows with a verified
  // email and no food refusal. Ranked by the documented transparent formula
  // (distance + relevance + verification + acceptance) when coordinates exist,
  // otherwise by the legacy text matcher. Nothing is ever invented.
  const need = {
    quantityKg: assessment.quantityKg,
    foodCategory: 'Mixed Surplus Food',
    availableUntil: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
  };
  const institution = { city: org.city, address: org.address, operatingHours: org.operatingHours };
  const orgHasCoords = typeof org.latitude === 'number' && typeof org.longitude === 'number';
  const ngos = await prisma.ngoOrganization.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  const ranked = ngos.map((n) => {
    if (orgHasCoords && typeof n.latitude === 'number' && typeof n.longitude === 'number') {
      const relevance = (n.relevance === 'high' || n.relevance === 'likely' ? n.relevance : keywordRelevance(n.name, parseTypes(n.googleTypes)).level) as 'high' | 'likely' | 'unknown';
      const rank = rankScore({
        distanceKm: haversineKm(org.latitude as number, org.longitude as number, n.latitude as number, n.longitude as number),
        maxRadiusKm: 50,
        relevance,
        verificationStatus: n.verificationStatus,
        acceptance: (['confirmed', 'likely', 'unknown', 'does_not_accept'].includes(n.foodAcceptanceStatus) ? n.foodAcceptanceStatus : 'unknown') as 'confirmed' | 'likely' | 'unknown' | 'does_not_accept',
        businessStatus: n.googleBusinessStatus,
      });
      const reasons = [
        { criterion: 'distance', points: rank.parts.distance, detail: `Real distance ${haversineKm(org.latitude as number, org.longitude as number, n.latitude as number, n.longitude as number)} km (40 max).` },
        { criterion: 'relevance', points: rank.parts.relevance, detail: `Relevance ${relevance} (30/15/5).` },
        { criterion: 'verification', points: rank.parts.verification, detail: `Verification ${n.verificationStatus} (20/10/0).` },
        { criterion: 'acceptance', points: rank.parts.acceptance, detail: `Food acceptance ${n.foodAcceptanceStatus} (10/5/0).` },
      ];
      return { ngo: n, score: rank.total, reasons };
    }
    const result = scoreNgoMatch({
      ngo: {
        isActive: n.isActive, city: n.city, address: n.address,
        acceptedCategories: n.acceptedCategories, pickupCapable: n.pickupCapable,
        operatingHours: n.operatingHours, capacityKg: n.capacityKg,
      },
      assessment: need, institution,
    });
    return { ngo: n, score: result.score, reasons: result.reasons };
  });
  const candidates = selectTopNgos(
    ranked.map((s) => ({ ngoId: s.ngo.id, score: s.score, ngo: s.ngo, reasons: s.reasons }))
  );

  const location = [org.address, org.city, org.state, org.country].filter(Boolean).join(', ');
  const results: NonNullable<AutoDistributionResult['results']> = [];
  const deliveryUpsert = (ngoId: string, email: string, data: {
    status: string; providerMessageId?: string; failureReason?: string; sentAt?: Date;
  }) => prisma.ngoEmailDelivery.upsert({
    where: { assessmentId_ngoId_recipientEmail: { assessmentId: assessment.id, ngoId, recipientEmail: email } },
    update: { ...data, eodReportId: args.eodReportId, organizationId: args.organizationId },
    create: {
      organizationId: args.organizationId, eodReportId: args.eodReportId, assessmentId: assessment.id,
      ngoId, recipientEmail: email, ...data,
    },
  });
  for (const c of candidates) {
    const email = (c.ngo.contactEmail ?? '').trim();
    // Eligibility gates — each outcome stored honestly, nothing sent unless verified.
    if (!email) {
      await deliveryUpsert(c.ngo.id, '', { status: 'email_unavailable', failureReason: 'Email unavailable — no legitimate email on record. No email sent.' });
      results.push({ ngoId: c.ngo.id, ngoName: c.ngo.name, email: '', status: 'email-unavailable' });
      continue;
    }
    if (!c.ngo.emailVerified) {
      await deliveryUpsert(c.ngo.id, email, { status: 'skipped', failureReason: 'Email unverified — admin verification required. No email sent.' });
      results.push({ ngoId: c.ngo.id, ngoName: c.ngo.name, email, status: 'skipped-unverified' });
      continue;
    }
    if (c.ngo.foodAcceptanceStatus === 'does_not_accept' || c.ngo.googleBusinessStatus === 'CLOSED_PERMANENTLY') {
      const why = c.ngo.foodAcceptanceStatus === 'does_not_accept' ? 'Organization does not accept surplus food.' : 'Organization is permanently closed.';
      await deliveryUpsert(c.ngo.id, email, { status: 'not_eligible', failureReason: why });
      results.push({ ngoId: c.ngo.id, ngoName: c.ngo.name, email, status: 'not-eligible' });
      continue;
    }
    const prev = await prisma.ngoMatch.findUnique({
      where: { assessmentId_ngoId: { assessmentId: assessment.id, ngoId: c.ngo.id } },
    });
    const priorOk = prev ? readAttempts(prev.deliveryJson).some((a) => a.ok) : false;
    if (priorOk) {
      results.push({ ngoId: c.ngo.id, ngoName: c.ngo.name, email, status: 'skipped-duplicate' });
      continue;
    }
    const match = prev
      ? await prisma.ngoMatch.update({
        where: { id: prev.id },
        data: { score: c.score, reasonsJson: JSON.stringify(c.reasons), status: 'SELECTED' },
      })
      : await prisma.ngoMatch.create({
        data: { assessmentId: assessment.id, ngoId: c.ngo.id, status: 'SELECTED', score: c.score, reasonsJson: JSON.stringify(c.reasons) },
      });
    let record = await prisma.redistributionRecord.findFirst({
      where: { assessmentId: assessment.id, ngoId: c.ngo.id },
    });
    if (!record) {
      record = await prisma.redistributionRecord.create({
        data: {
          organizationId: args.organizationId, kitchenUnitId: args.kitchenUnitId, ngoId: c.ngo.id,
          assessmentId: assessment.id, quantityKg: assessment.quantityKg, status: 'NOTIFIED',
          notes: `Auto-notified ${c.ngo.name} for ${assessment.quantityKg} kg surplus (${args.dateLabel}).`,
        },
      });
    } else if (record.status === 'DRAFT') {
      record = await prisma.redistributionRecord.update({ where: { id: record.id }, data: { status: 'NOTIFIED' } });
    }
    const { subject, text } = buildSurplusEmail({
      hotelName: org.name, location, contactPhone: org.contactPhone,
      ngoName: c.ngo.name, surplusKg: assessment.quantityKg,
    });
    const attempt = await sendMail({ to: email, subject, text });
    const attempts = [...readAttempts(match.deliveryJson), attempt];
    await prisma.ngoMatch.update({ where: { id: match.id }, data: { deliveryJson: JSON.stringify({ attempts }) } });
    await deliveryUpsert(c.ngo.id, email, attempt.ok
      ? { status: 'sent', providerMessageId: attempt.messageId, sentAt: new Date(attempt.at) }
      : { status: 'failed', providerMessageId: attempt.messageId, failureReason: attempt.error ?? 'Delivery failed.' });
    await prisma.notification.create({
      data: {
        organizationId: args.organizationId,
        type: attempt.channel === 'simulated' ? 'NGO_NOTIFY_SIMULATED' : attempt.ok ? 'NGO_NOTIFY_SENT' : 'NGO_NOTIFY_FAILED',
        title: `To ${c.ngo.name}: ${subject}`,
        body: attempt.channel === 'simulated'
          ? `To: ${email}\n${text}\n— simulated local delivery (no email provider configured; no email was sent).`
          : attempt.ok
            ? `Delivered via ${attempt.channel} at ${attempt.at}.`
            : `Delivery via ${attempt.channel} failed at ${attempt.at}: ${attempt.error ?? 'unknown error'}. Use retry.`,
        linkPath: '/food-distribution',
      },
    });
    const ngoUsers = await prisma.user.findMany({ where: { ngoOrganizationId: c.ngo.id }, select: { id: true } });
    for (const u of ngoUsers) {
      await prisma.notification.create({
        data: {
          userId: u.id, type: 'NGO_OPPORTUNITY',
          title: `Pickup opportunity: ${assessment.quantityKg} kg surplus (${args.dateLabel})`,
          body: `${org.name} (${org.city}) offers ${assessment.quantityKg} kg surplus food. ${location}. Contact: ${org.contactName}, ${org.contactPhone}.`,
          linkPath: '/redistribution',
        },
      });
    }
    await audit('distribution.auto-notify', {
      organizationId: args.organizationId, entityType: 'RedistributionRecord', entityId: record.id,
      metadata: { assessmentId: assessment.id, ngoId: c.ngo.id, channel: attempt.channel, ok: attempt.ok },
    });
    results.push({
      ngoId: c.ngo.id, ngoName: c.ngo.name, email,
      status: attempt.ok ? 'sent' : 'failed',
      ...(attempt.error ? { error: attempt.error } : {}),
    });
  }
  return { started: true, reason: gate.reason, assessmentId: assessment.id, results };
}

export default { shouldAutoDistribute, isMailableNgo, buildSurplusEmail, selectTopNgos, distributionKeyFor, triggerAutoDistribution, AUTO_MIN_QTY_DEFAULT, AUTO_NGO_LIMIT };
