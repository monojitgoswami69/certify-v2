#!/usr/bin/env node
/**
 * Stamps the drizzle migrations table for an EXISTING database.
 *
 * The project's live database was built with `db:push` (plus the two
 * hand-applied hardening/events scripts), so it has every table the baseline
 * describes but no record in drizzle.__drizzle_migrations. Running
 * `db:migrate` against it would try to CREATE TABLE everything and fail.
 *
 * This script records the baseline as already applied (hash-matched to the
 * SQL file, exactly like drizzle-kit migrate would), after which normal
 * `npm run db:migrate` works going forward.
 *
 * Usage: npm run db:stamp
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
} catch {}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[db:stamp] DATABASE_URL is not set.');
  process.exit(1);
}

const journal = JSON.parse(readFileSync(join(projectRoot, 'drizzle', 'meta', '_journal.json'), 'utf8'));
const { neon } = await import('@neondatabase/serverless');
const sql = neon(databaseUrl);

await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
)`;

const existing = await sql`SELECT hash FROM drizzle.__drizzle_migrations`;
const existingHashes = new Set(existing.map((r) => r.hash));

for (const entry of journal.entries) {
  const sqlFile = join(projectRoot, 'drizzle', `${entry.tag}.sql`);
  const hash = createHash('sha256').update(readFileSync(sqlFile)).digest('hex');
  if (existingHashes.has(hash)) {
    console.log(`  already stamped: ${entry.tag}`);
    continue;
  }
  await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`;
  console.log(`  stamped: ${entry.tag}`);
}

console.log('[db:stamp] done. `npm run db:migrate` is now safe on this database.');
