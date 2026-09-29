import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const serverDir = path.resolve(rootDir, 'server');
const schemaPath = path.resolve(serverDir, 'prisma', 'schema.prisma');
const pgSchemaPath = path.resolve(serverDir, 'prisma', 'schema.pg.prisma');

const original = fs.readFileSync(schemaPath, 'utf8');
const pgSchema = original.replace('provider = "sqlite"', 'provider = "postgresql"');
fs.writeFileSync(pgSchemaPath, pgSchema, 'utf8');

try {
  const sql = execSync(
    'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.pg.prisma --script',
    { cwd: serverDir, encoding: 'utf8' }
  );
  fs.writeFileSync(path.resolve(rootDir, 'supabase-schema.sql'), sql, 'utf8');
  console.log('Successfully generated supabase-schema.sql!');
} catch (err) {
  console.error('Error generating pg sql:', err.message);
  if (err.stdout) console.log('stdout:', err.stdout);
  if (err.stderr) console.error('stderr:', err.stderr);
} finally {
  if (fs.existsSync(pgSchemaPath)) {
    fs.unlinkSync(pgSchemaPath);
  }
}
