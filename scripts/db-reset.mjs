import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const serverDir = path.resolve(rootDir, 'server');
const prismaDir = path.resolve(serverDir, 'prisma');

console.log('--- Surplus MealGuard AI: Resetting Demo Database ---');

// 1. Safe deletion of dev.db files only
const dbFiles = ['dev.db', 'dev.db-journal', 'dev.db-wal', 'dev.db-shm'];
for (const file of dbFiles) {
  const target = path.join(prismaDir, file);
  if (fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
      console.log(`Removed existing: ${file}`);
    } catch (err) {
      console.warn(`Could not delete ${file}: ${err.message}`);
    }
  }
}

// 2. Deploy migrations
console.log('Applying database migrations...');
execSync('npx prisma migrate deploy', { cwd: serverDir, stdio: 'inherit' });

// 3. Run seed
console.log('Seeding demo data (12+ weeks history, live Food Flow, today targets, alert, redistribution, impact)...');
execSync('npm run seed', { cwd: serverDir, stdio: 'inherit' });

console.log('--- Database Reset & Seed Complete! ---');
