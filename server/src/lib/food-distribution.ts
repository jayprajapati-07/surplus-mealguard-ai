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

export const AUTO_MIN_QTY_DEFAULT = 10;
export const AUTO_NGO_LIMIT = 10;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

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

/** Mailable = active registry entry with a syntactically valid email. Nothing else qualifies. */
export function isMailableNgo(ngo: { isActive: boolean; contactEmail: string | null }): boolean {
  if (!ngo.isActive) return false;
  const email = (ngo.contactEmail ?? '').trim();
  return /^\S+@\S+\.\S+$/.test(email);
}

export interface SurplusEmailInput {
  hotelName: string;
  location: string;
  contactPhone: string;
  ngoName: string;
  surplusKg: number;
  dateLabel: string;
}

/** Exact spec template filled ONLY with verified application data. */
export function buildSurplusEmail(i: SurplusEmailInput): { subject: string; text: string } {
  const subject = `Surplus Food Available from ${i.hotelName} – ${i.dateLabel}`;
  const text = [
    `Hello ${i.ngoName},`,
    '',
    `We are from ${i.hotelName}, located in ${i.location}.`,
    '',
    `Today we have approximately ${i.surplusKg} kg of surplus food that would otherwise go to waste.`,
    '',
    'If your organization is interested in collecting or redistributing this food, please contact our hotel management at:',
    '',
    i.contactPhone,
    '',
    'Food Details:',
    '',
    `Date: ${i.dateLabel}`,
    `Surplus Quantity: ${i.surplusKg} kg`,
    `Hotel: ${i.hotelName}`,
    `Location: ${i.location}`,
    '',
    'Thank you.',
    '',
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
  results?: { ngoId: string; ngoName: string; email: string; status: 'sent' | 'failed' | 'skipped-duplicate' | 'skipped-no-email'; error?: string }[];
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

  // Discover: verified registry only (active + valid email), scored deterministically.
  const need = {
    quantityKg: assessment.quantityKg,
    foodCategory: 'Mixed Surplus Food',
    availableUntil: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
  };
  const institution = { city: org.city, address: org.address, operatingHours: org.operatingHours };
  const ngos = await prisma.ngoOrganization.findMany({ orderBy: { name: 'asc' } });
  const scored = ngos.map((n) => ({
    ngo: n,
    result: scoreNgoMatch({
      ngo: {
        isActive: n.isActive, city: n.city, address: n.address,
        acceptedCategories: n.acceptedCategories, pickupCapable: n.pickupCapable,
        operatingHours: n.operatingHours, capacityKg: n.capacityKg,
      },
      assessment: need, institution,
    }),
  }));
  const candidates = selectTopNgos(
    scored
      .filter((s) => s.result.eligible && isMailableNgo({ isActive: s.ngo.isActive, contactEmail: s.ngo.contactEmail }))
      .map((s) => ({ ngoId: s.ngo.id, score: s.result.score, ngo: s.ngo, reasons: s.result.reasons }))
  );

  const location = [org.address, org.city].filter(Boolean).join(', ');
  const results: NonNullable<AutoDistributionResult['results']> = [];
  for (const c of candidates) {
    const email = (c.ngo.contactEmail ?? '').trim();
    if (!email) {
      results.push({ ngoId: c.ngo.id, ngoName: c.ngo.name, email: '', status: 'skipped-no-email' });
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
      ngoName: c.ngo.name, surplusKg: assessment.quantityKg, dateLabel: args.dateLabel,
    });
    const attempt = await sendMail({ to: email, subject, text });
    const attempts = [...readAttempts(match.deliveryJson), attempt];
    await prisma.ngoMatch.update({ where: { id: match.id }, data: { deliveryJson: JSON.stringify({ attempts }) } });
    await prisma.notification.create({
      data: {
        organizationId: args.organizationId,
        type: attempt.channel === 'simulated' ? 'NGO_NOTIFY_SIMULATED' : attempt.ok ? 'NGO_NOTIFY_SENT' : 'NGO_NOTIFY_FAILED',
        title: `To ${c.ngo.name}: ${subject}`,
        body: attempt.channel === 'simulated'
          ? `To: ${email}\n${text}\n— simulated local delivery (no SMTP configured; no email was sent).`
          : attempt.ok
            ? `Delivered via configured SMTP at ${attempt.at}.`
            : `Delivery via configured SMTP failed at ${attempt.at}: ${attempt.error ?? 'unknown error'}. Use retry.`,
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
