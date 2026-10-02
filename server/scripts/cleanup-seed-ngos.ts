// One-off cleanup: remove fabricated seed NGO organizations and their demo
// distribution rows. Legitimate user-created records are never touched:
// only rows matching the known seed fingerprints are deleted.
// Run once: npx tsx scripts/cleanup-seed-ngos.ts (safe to re-run).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_NAMES = ['City Food Helpers', 'Suburban Meal Collective', 'Distant Hills Kitchen'];

async function main() {
  const fakes = await prisma.ngoOrganization.findMany({
    where: {
      OR: [
        { name: { in: SEED_NAMES } },
        { contactEmail: { endsWith: '@test.local' } },
        { contactEmail: { endsWith: '@mealguard.local' } },
        { contactPhone: { startsWith: '+91-900000000' } },
      ],
    },
  });
  console.log(`Found ${fakes.length} fabricated NGO row(s).`);
  let matches = 0;
  let records = 0;
  let deliveries = 0;
  for (const n of fakes) {
    const dm = await prisma.ngoMatch.deleteMany({ where: { ngoId: n.id } });
    const dr = await prisma.redistributionRecord.deleteMany({ where: { ngoId: n.id } });
    const dd = await prisma.ngoEmailDelivery.deleteMany({ where: { ngoId: n.id } });
    matches += dm.count;
    records += dr.count;
    deliveries += dd.count;
    await prisma.user.updateMany({ where: { ngoOrganizationId: n.id }, data: { ngoOrganizationId: null } });
    await prisma.ngoOrganization.delete({ where: { id: n.id } });
    console.log(`Deleted "${n.name}" (+${dm.count} matches, +${dr.count} records, +${dd.count} deliveries).`);
  }
  console.log(`Done. NGOs: ${fakes.length}, matches: ${matches}, records: ${records}, deliveries: ${deliveries}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
