import dotenv from 'dotenv';
import { prisma } from './prisma';
import { hashPassword } from './auth';

dotenv.config();

// Idempotent seed: upserts by email / name so re-running is safe.
async function main() {
  const users = [
    { name: 'Super Admin', email: 'superadmin@mealguard.local', role: 'SUPER_ADMIN' as const, password: 'SuperAdmin123!' },
    { name: 'Institution Admin', email: 'admin@mealguard.local', role: 'INSTITUTION_ADMIN' as const, password: 'Admin12345!' },
    { name: 'Kitchen Manager', email: 'manager@mealguard.local', role: 'KITCHEN_MANAGER' as const, password: 'Manager123!' },
    { name: 'Kitchen Staff', email: 'staff@mealguard.local', role: 'STAFF' as const, password: 'Staff12345!' },
    { name: 'NGO Partner', email: 'ngo@mealguard.local', role: 'NGO' as const, password: 'Ngo123456!' },
  ];

  for (const u of users) {
    const passwordHash = await hashPassword(u.password);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash, emailVerified: true, verificationToken: null },
      create: { name: u.name, email: u.email, role: u.role, passwordHash, emailVerified: true },
    });
  }

  // Seed one institution + one kitchen, owned by the institution admin
  const admin = await prisma.user.findUnique({ where: { email: 'admin@mealguard.local' } });
  let org = await prisma.organization.findUnique({ where: { name: 'Sunrise College Canteen' } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Sunrise College Canteen',
        sector: 'PRIVATE',
        institutionType: 'COLLEGE_CANTEEN',
        address: '12 Campus Road, Block B',
        city: 'Pune',
        contactName: 'Institution Admin',
        contactPhone: '+91-9876543210',
        contactEmail: 'admin@mealguard.local',
        operatingHours: '8:00am – 8:00pm',
        peopleServedDaily: 1200,
        kitchenCapacityKg: 450,
        ownerId: admin?.id,
        profile: { create: { notes: 'Seed institution for local prototype.', dietaryFocus: 'Vegetarian, balanced meals' } },
        kitchens: {
          create: [
            {
              name: 'Main Kitchen',
              mealTimings: 'Breakfast 8–10am, Lunch 12–2pm, Dinner 6–8pm',
              storageAreas: 'Dry store, Cold room, Walk-in freezer',
              foodCategories: 'Grains, Vegetables, Dairy, Pulses',
              productionCapacityKg: 450,
            },
          ],
        },
      },
      include: { kitchens: true },
    });
  }

  // Attach institution users to the seed org (idempotent)
  if (org && admin) {
    for (const email of ['admin@mealguard.local', 'manager@mealguard.local', 'staff@mealguard.local']) {
      await prisma.user.update({ where: { email }, data: { organizationId: org.id } }).catch(() => undefined);
    }
  }

  // Seed impact factors used later (estimates, clearly labelled)
  const factors = [
    { key: 'CO2_PER_KG_FOOD', name: 'CO2e avoided per kg redistributed', value: 2.5, unit: 'kgCO2e/kg', description: 'Estimate: average emissions avoided per kg food saved (label as estimate).', source: 'Seed default - replace with measured factors.', effectiveDate: new Date('2024-01-01'), isActive: true },
    { key: 'COST_PER_KG_FOOD', name: 'Food cost saved per kg', value: 120, unit: 'INR/kg', description: 'Estimate: average cost saved per kg food saved (label as estimate).', source: 'Seed default - replace with measured factors.', effectiveDate: new Date('2024-01-01'), isActive: true },
  ];
  for (const f of factors) {
    const existing = await prisma.impactFactor.findFirst({
      where: { key: f.key, organizationId: null, category: null, foodItemId: null },
    });
    if (existing) {
      await prisma.impactFactor.update({ where: { id: existing.id },
        data: { value: f.value, unit: f.unit, name: f.name, source: f.source, effectiveDate: f.effectiveDate, isActive: f.isActive } });
    } else {
      await prisma.impactFactor.create({ data: f });
    }
  }

  // NGO registry intentionally starts EMPTY. Real organizations enter only via
  // map discovery, administrator verification, or explicit admin
  // entry. No demo/seed NGOs are ever created (production users must never
  // see fabricated organizations). The seed NGO login keeps working but stays
  // unlinked until a super-admin links it to a real organization.

  if (org) {
    await seedPrompt2History(org.id);
    await seedPrompt10Demo(org.id);
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete. Credentials: see README.');
}

// Deterministic PRNG so history is stable across runs/machines.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Prompt 2: ≥12 weeks of internally consistent history for the seed kitchen.
async function seedPrompt2History(orgId: string) {
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { organizationId: orgId, name: 'Main Kitchen' } });
  if (!kitchen) return;

  const itemDefs = [
    { name: 'Rice', category: 'Grains', mealType: 'LUNCH', standardPortionKg: 0.25, sellingPrice: 40, recipeText: 'Rice, water, salt' },
    { name: 'Dal', category: 'Pulses', mealType: 'LUNCH', standardPortionKg: 0.15, sellingPrice: 35, recipeText: 'Toor dal, turmeric, tempering' },
    { name: 'Vegetable Curry', category: 'Vegetables', mealType: 'ANY', standardPortionKg: 0.2, sellingPrice: 45, recipeText: 'Seasonal vegetables, spices' },
    { name: 'Chapati', category: 'Grains', mealType: 'DINNER', standardPortionKg: 0.08, sellingPrice: 10, recipeText: 'Whole wheat flour, water, salt' },
    { name: 'Idli', category: 'Grains', mealType: 'BREAKFAST', standardPortionKg: 0.12, sellingPrice: 20, recipeText: 'Rice + urad batter, steamed' },
    { name: 'Sambar', category: 'Pulses', mealType: 'BREAKFAST', standardPortionKg: 0.15, sellingPrice: 25, recipeText: 'Dal, vegetables, sambar powder' },
    { name: 'Curd Rice', category: 'Grains', mealType: 'LUNCH', standardPortionKg: 0.25, sellingPrice: 35, recipeText: 'Rice, curd, tempering' },
    { name: 'Khichdi', category: 'Grains', mealType: 'DINNER', standardPortionKg: 0.3, sellingPrice: 40, recipeText: 'Rice, moong dal, vegetables' },
    { name: 'Veg Biryani', category: 'Grains', mealType: 'LUNCH', standardPortionKg: 0.35, sellingPrice: 60, recipeText: 'Basmati rice, vegetables, biryani masala (Friday special)' },
  ];
  const items = new Map<string, { id: string }>();
  for (const d of itemDefs) {
    const item = await prisma.foodItem.upsert({
      where: { organizationId_name: { organizationId: orgId, name: d.name } },
      update: { category: d.category, mealType: d.mealType, standardPortionKg: d.standardPortionKg, sellingPrice: d.sellingPrice, recipeText: d.recipeText, isActive: true, unit: 'kg' },
      create: { organizationId: orgId, unit: 'kg', isActive: true, ...d },
    });
    items.set(d.name, item);
  }

  // Sample menus (kept small; API covers full CRUD)
  const menuCount = await prisma.menu.count({ where: { organizationId: orgId } });
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  if (menuCount === 0) {
    const monday = new Date(todayUtc);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    await prisma.menu.create({
      data: {
        organizationId: orgId,
        kitchenUnitId: kitchen.id,
        date: monday,
        scope: 'WEEKLY',
        mealType: 'LUNCH',
        title: 'Weekday lunch rotation',
        items: {
          create: [
            { foodItemId: items.get('Rice')!.id, name: 'Rice', quantityKg: 85 },
            { foodItemId: items.get('Dal')!.id, name: 'Dal', quantityKg: 35 },
            { foodItemId: items.get('Vegetable Curry')!.id, name: 'Vegetable Curry', quantityKg: 40 },
          ],
        },
      },
    });
    await prisma.menu.create({
      data: {
        organizationId: orgId,
        kitchenUnitId: kitchen.id,
        date: new Date(monday.getTime() + 4 * 86400000),
        scope: 'DAILY',
        mealType: 'LUNCH',
        title: 'Friday special',
        isSpecial: true,
        specialLabel: 'Friday Veg Biryani special',
        items: {
          create: [
            { foodItemId: items.get('Veg Biryani')!.id, name: 'Veg Biryani', quantityKg: 70 },
            { foodItemId: items.get('Curd Rice')!.id, name: 'Curd Rice', quantityKg: 25 },
          ],
        },
      },
    });
  }

  // Prompt 5 demo: today's live Food Flow for Main Kitchen / Rice / LUNCH,
  // paced so the surplus-risk engine has timing to work with. Guarded to keep
  // re-seeds idempotent. Runs before the history early-return below.
  const flowCount = await prisma.foodFlowEntry.count({ where: { organizationId: orgId } });
  if (flowCount === 0) {
    const rice = items.get('Rice');
    const nowMs = Date.now();
    const at = (minsAgo: number) => new Date(nowMs - minsAgo * 60 * 1000);
    const seedEntries = [
      { kind: 'PRODUCTION', qty: 40, mins: 180 },
      { kind: 'SALE', qty: 3, mins: 120 },
      { kind: 'SALE', qty: 2, mins: 60 },
      { kind: 'SALE', qty: 1, mins: 20 },
    ];
    for (const e of seedEntries) {
      await prisma.foodFlowEntry.create({
        data: {
          organizationId: orgId, kitchenUnitId: kitchen.id, foodItemId: rice!.id,
          stage: e.kind, quantityKg: e.qty, mealType: 'LUNCH', entryKind: e.kind,
          direction: 'ADD', recordedAt: at(e.mins),
          createdByName: 'Seed Data',
        },
      });
    }
    // eslint-disable-next-line no-console
    console.log('Seeded 4 live Food Flow entries for today (surplus-risk demo).');
  }

  // 12-week daily history (idempotent: skip once seeded)
  const existing = await prisma.dailyFoodRecord.count({ where: { organizationId: orgId } });
  if (existing >= 400) {
    // eslint-disable-next-line no-console
    console.log(`History already seeded (${existing} records). Skipping.`);
    return;
  }
  const rand = mulberry32(42);
  const end = new Date(todayUtc.getTime() - 86400000); // yesterday
  const DAYS = 84;
  const UNDERPRODUCTION_OFFSETS = new Set([30, 65]); // days-ago offsets with a shortfall case
  const rnd = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  type Plan = { food: string; meal: 'BREAKFAST' | 'LUNCH' | 'DINNER'; base: number };
  const plans: Plan[] = [
    { food: 'Idli', meal: 'BREAKFAST', base: 28 },
    { food: 'Sambar', meal: 'BREAKFAST', base: 22 },
    { food: 'Rice', meal: 'LUNCH', base: 85 },
    { food: 'Dal', meal: 'LUNCH', base: 34 },
    { food: 'Vegetable Curry', meal: 'LUNCH', base: 40 },
    { food: 'Chapati', meal: 'DINNER', base: 30 },
    { food: 'Vegetable Curry', meal: 'DINNER', base: 26 },
  ];

  const batch: {
    organizationId: string; kitchenUnitId: string; foodItemId: string; date: Date; mealType: string;
    targetKg: number; preparedKg: number; servedKg: number; soldKg: number; wasteKg: number;
    remainingKg: number; notes?: string; adjustmentReason?: string;
  }[] = [];

  for (let ago = DAYS; ago >= 1; ago--) {
    const date = new Date(end.getTime() - (ago - 1) * 86400000);
    const dow = date.getUTCDay(); // 0=Sun..6=Sat
    const weekend = dow === 0 || dow === 6;
    const vol = weekend ? 0.55 : 1;
    const friday = dow === 5;
    const dayPlans: Plan[] = [...plans];
    if (friday) dayPlans.push({ food: 'Veg Biryani', meal: 'LUNCH', base: 70 });
    if (dow === 3) dayPlans.push({ food: 'Curd Rice', meal: 'LUNCH', base: 30 }); // Wednesday variation
    if (dow === 2 || dow === 4) dayPlans.push({ food: 'Khichdi', meal: 'DINNER', base: 32 }); // Tue/Thu variation

    for (const p of dayPlans) {
      const target = round1(p.base * vol * rnd(0.95, 1.05));
      const over = ago % 12 === 0; // overproduction case every ~12 days
      let produced = round1(target * (over ? rnd(1.2, 1.3) : rnd(0.98, 1.06)));
      const wasteRate = rnd(0.02, 0.08);
      let waste = round1(produced * wasteRate);
      let remaining: number;
      let sold: number;
      let notes: string | undefined;
      let adjustmentReason: string | undefined;
      if (UNDERPRODUCTION_OFFSETS.has(ago) && p.meal === 'LUNCH' && p.food === 'Rice') {
        // Underproduction: shortfall vs target; everything produced is sold except waste.
        produced = round1(target * 0.8);
        waste = round1(produced * 0.03);
        remaining = 0;
        sold = round1(produced - waste);
        notes = 'Underproduction: late ingredient delivery, portions reduced. potential-surplus:unlikely';
        adjustmentReason = 'Underproduction shortfall verified by kitchen manager; sold capped at available quantity.';
      } else {
        remaining = round1(Math.max(0, produced * rnd(0.03, over ? 0.22 : 0.1)));
        sold = round1(Math.max(0, produced - waste - remaining));
        if (remaining >= 8) notes = 'Large surplus — review forecast. potential-surplus:likely';
        else if (remaining <= 1) notes = 'Tight day, near-zero surplus. potential-surplus:unlikely';
        else notes = 'Normal service. potential-surplus:unlikely';
      }
      batch.push({
        organizationId: orgId,
        kitchenUnitId: kitchen.id,
        foodItemId: items.get(p.food)!.id,
        date,
        mealType: p.meal,
        targetKg: target,
        preparedKg: produced,
        servedKg: sold,
        soldKg: sold,
        wasteKg: waste,
        remainingKg: remaining,
        notes,
        adjustmentReason,
      });
    }
  }

  // Insert in chunks to stay within SQLite variable limits
  for (let i = 0; i < batch.length; i += 200) {
    await prisma.dailyFoodRecord.createMany({ data: batch.slice(i, i + 200) });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${batch.length} historical food records (12 weeks).`);
}

// Prompt 10: Complete, polished, and resettable SIH demonstration dataset
async function seedPrompt10Demo(orgId: string) {
  const kitchen = await prisma.kitchenUnit.findFirst({ where: { organizationId: orgId, name: 'Main Kitchen' } });
  if (!kitchen) return;

  const admin = await prisma.user.findUnique({ where: { email: 'admin@mealguard.local' } });

  const rice = await prisma.foodItem.findUnique({ where: { organizationId_name: { organizationId: orgId, name: 'Rice' } } });
  const dal = await prisma.foodItem.findUnique({ where: { organizationId_name: { organizationId: orgId, name: 'Dal' } } });
  const vegCurry = await prisma.foodItem.findUnique({ where: { organizationId_name: { organizationId: orgId, name: 'Vegetable Curry' } } });

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  // 1. Today's production targets for Lunch (deterministic baseline targets)
  const targetCount = await prisma.productionTarget.count({
    where: { organizationId: orgId, kitchenUnitId: kitchen.id, date: todayUtc },
  });
  if (targetCount === 0 && rice && dal && vegCurry) {
    const demoTargets = [
      { foodItemId: rice.id, mealType: 'LUNCH', predictedKg: 75.0, bufferKg: 7.5, recommendedKg: 82.5 },
      { foodItemId: dal.id, mealType: 'LUNCH', predictedKg: 32.0, bufferKg: 3.2, recommendedKg: 35.2 },
      { foodItemId: vegCurry.id, mealType: 'LUNCH', predictedKg: 38.0, bufferKg: 3.8, recommendedKg: 41.8 },
    ];
    for (const dt of demoTargets) {
      await prisma.productionTarget.create({
        data: {
          organizationId: orgId,
          kitchenUnitId: kitchen.id,
          foodItemId: dt.foodItemId,
          mealType: dt.mealType,
          date: todayUtc,
          predictedKg: dt.predictedKg,
          bufferKg: dt.bufferKg,
          recommendedKg: dt.recommendedKg,
          status: 'ACCEPTED',
          memoryVersion: 'memory-v1',
          inputsJson: JSON.stringify({ seeded: true, bufferMode: 'PERCENT', bufferValue: 10, note: 'Seeded today baseline target' }),
        },
      });
    }
    // eslint-disable-next-line no-console
    console.log("Seeded today's production targets (Rice, Dal, Vegetable Curry).");
  }

  // 2. Predicted surplus alert notification (SURPLUS_RISK_HIGH)
  const notifCount = await prisma.notification.count({
    where: { organizationId: orgId, type: 'SURPLUS_RISK_HIGH' },
  });
  if (notifCount === 0 && admin) {
    await prisma.notification.create({
      data: {
        userId: admin.id,
        organizationId: orgId,
        type: 'SURPLUS_RISK_HIGH',
        title: 'High Surplus Risk: Rice (Lunch)',
        body: 'High surplus risk detected for Rice (Lunch). Pace projection indicates ~25 kg unsold at current service rate. Action required.',
        linkPath: '/flow',
        isRead: false,
      },
    });
    // eslint-disable-next-line no-console
    console.log('Seeded unread SURPLUS_RISK_HIGH notification for live Food Flow.');
  }

  // 3. NGO-linked demo content removed (see note at end of this function).

  // 4. NGO-linked demo content removed: assessments, matches, redistribution
  // records and impact snapshots referencing fabricated organizations are
  // never seeded. Real activity appears once genuine NGOs are discovered
  // and the kitchen records actual data.
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

