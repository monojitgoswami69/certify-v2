/**
 * Applies a numbered SQL migration file to the configured DATABASE_URL.
 *
 * Every statement in these files guards itself (IF NOT EXISTS / ON CONFLICT),
 * so re-running is a no-op. Statements execute one by one over the neon-http
 * driver (same driver the app uses — no local Postgres required).
 *
 * Usage: node scripts/db-migrate-sql.mjs drizzle/0002_events.sql
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
try {
  const env = readFileSync(join(projectRoot, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // no .env — rely on real environment variables
}

const target = process.argv[2];
if (!target) {
  console.error('[db-migrate-sql] usage: node scripts/db-migrate-sql.mjs <migration.sql>');
  process.exit(1);
}
const migrationPath = target.includes('/')
  ? join(projectRoot, target)
  : join(projectRoot, 'drizzle', target);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(`[db-migrate-sql] DATABASE_URL is not set.`);
  process.exit(1);
}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(databaseUrl);

const migrationSql = readFileSync(migrationPath, 'utf8');

// Split on semicolons that end a line (no multi-line strings/functions in these files).
const statements = migrationSql
  .split(/;\s*\n/)
  .map((s) => s.replace(/^--.*$/gm, '').trim())
  .filter((s) => s.length > 0);

console.log(
  `[db-migrate-sql] ${basename(migrationPath)}: running ${statements.length} statements against ${new URL(databaseUrl).host}`
);
for (const statement of statements) {
  const preview = statement.replace(/\s+/g, ' ').slice(0, 90);
  try {
    const rows = await sql.query(statement, []);
    const affected = Array.isArray(rows) ? rows.length : 0;
    console.log(`  ok  ${preview}${affected ? `  (${affected} rows)` : ''}`);
  } catch (err) {
    console.error(`  FAILED: ${preview}`);
    console.error(err.message || err);
    process.exit(1);
  }
}
console.log('[db-migrate-sql] done.');
