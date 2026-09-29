import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../server/node_modules/@prisma/client/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const prisma = new PrismaClient();

function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return val.toString();
  if (val instanceof Date) return `'${val.toISOString()}'`;
  return `'${val.toString().replace(/'/g, "''")}'`;
}

function generateInserts(tableName, rows, conflictCol = 'id') {
  if (!rows || rows.length === 0) return '';
  const lines = [`-- Data for "${tableName}"`];
  for (const row of rows) {
    const cols = Object.keys(row).map(c => `"${c}"`).join(', ');
    const vals = Object.values(row).map(v => escapeSql(v)).join(', ');
    lines.push(`INSERT INTO "${tableName}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING;`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const users = await prisma.user.findMany();
  const orgs = await prisma.organization.findMany();
  const profiles = await prisma.organizationProfile.findMany();
  const kitchens = await prisma.kitchenUnit.findMany();
  const foodItems = await prisma.foodItem.findMany();
  const impactFactors = await prisma.impactFactor.findMany();
  const ngos = await prisma.ngoOrganization.findMany();
  const menus = await prisma.menu.findMany();
  const menuItems = await prisma.menuItem.findMany();
  const bufferConfigs = await prisma.bufferConfig.findMany();
  const riskThresholds = await prisma.riskThreshold.findMany();
  const invThresholds = await prisma.inventoryThreshold.findMany();
  const eligConfigs = await prisma.eligibilityConfig.findMany();
  const targets = await prisma.productionTarget.findMany();
  const assessments = await prisma.surplusEligibilityAssessment.findMany();
  const matches = await prisma.ngoMatch.findMany();
  const notifs = await prisma.notification.findMany();
  const redists = await prisma.redistributionRecord.findMany();
  const snapshots = await prisma.impactSnapshot.findMany();
  const flowEntries = await prisma.foodFlowEntry.findMany();

  let sql = `-- ========================================================\n`;
  sql += `-- Surplus MealGuard AI: Initial Seed Data for Supabase\n`;
  sql += `-- ========================================================\n\n`;

  sql += generateInserts('Organization', orgs);
  sql += generateInserts('OrganizationProfile', profiles);
  sql += generateInserts('KitchenUnit', kitchens);
  sql += generateInserts('NgoOrganization', ngos);
  sql += generateInserts('User', users);
  sql += generateInserts('ImpactFactor', impactFactors);
  sql += generateInserts('FoodItem', foodItems);
  sql += generateInserts('BufferConfig', bufferConfigs);
  sql += generateInserts('RiskThreshold', riskThresholds);
  sql += generateInserts('InventoryThreshold', invThresholds);
  sql += generateInserts('EligibilityConfig', eligConfigs);
  sql += generateInserts('Menu', menus);
  sql += generateInserts('MenuItem', menuItems);
  sql += generateInserts('ProductionTarget', targets);
  sql += generateInserts('SurplusEligibilityAssessment', assessments);
  sql += generateInserts('NgoMatch', matches);
  sql += generateInserts('Notification', notifs);
  sql += generateInserts('RedistributionRecord', redists);
  sql += generateInserts('ImpactSnapshot', snapshots);
  sql += generateInserts('FoodFlowEntry', flowEntries);

  fs.writeFileSync(path.resolve(rootDir, 'supabase-seed.sql'), sql, 'utf8');
  console.log('Successfully generated supabase-seed.sql!');
}

main().finally(() => prisma.$disconnect());
