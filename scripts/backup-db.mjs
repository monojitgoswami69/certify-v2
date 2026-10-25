#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('❌ Error: DATABASE_URL not found in environment or .env file');
  process.exit(1);
}

const sql = neon(dbUrl);

// Never write credential material to disk, even locally: Gmail refresh tokens
// grant send-as access until revoked at Google.
const EXCLUDED_TABLES = new Set(['google_credentials']);

async function main() {
  console.log('🔒 Starting secure database snapshot...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(process.cwd(), 'backups', `backup-${timestamp}`);
  const latestDir = path.resolve(process.cwd(), 'backups', 'latest');

  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(latestDir, { recursive: true });

  // 1. Query tables in public schema
  const tablesResult = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
  const tableNames = tablesResult.map((t) => t.table_name);
  console.log(`📋 Found public tables: ${tableNames.join(', ')}`);

  const manifest = {
    timestamp: new Date().toISOString(),
    databaseHost: new URL(dbUrl.replace(/^postgresql:\/\//, 'http://')).host,
    tables: {},
    excludedTables: Array.from(EXCLUDED_TABLES),
    summary: {
      totalCertificates: 0,
      totalTemplates: 0,
      events: [],
    },
  };

  // 2. Backup templates
  if (tableNames.includes('templates')) {
    console.log('📦 Backing up templates...');
    const templateRows = await sql`SELECT * FROM templates ORDER BY created_at ASC;`;
    manifest.tables['templates'] = templateRows.length;
    manifest.summary.totalTemplates = templateRows.length;

    fs.writeFileSync(
      path.join(backupDir, 'templates.json'),
      JSON.stringify(templateRows, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(latestDir, 'templates.json'),
      JSON.stringify(templateRows, null, 2),
      'utf8'
    );
    console.log(`   ✓ Saved ${templateRows.length} templates.`);
  }

  // 3. Backup certificates
  if (tableNames.includes('certificates')) {
    console.log('📦 Backing up certificates & verification records...');
    const certRows = await sql`SELECT * FROM certificates ORDER BY issued_at ASC;`;
    manifest.tables['certificates'] = certRows.length;
    manifest.summary.totalCertificates = certRows.length;

    const eventSet = new Set();
    certRows.forEach((c) => {
      if (c.event_name || c.eventName) eventSet.add(c.event_name || c.eventName);
    });
    manifest.summary.events = Array.from(eventSet);

    fs.writeFileSync(
      path.join(backupDir, 'certificates.json'),
      JSON.stringify(certRows, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(latestDir, 'certificates.json'),
      JSON.stringify(certRows, null, 2),
      'utf8'
    );
    console.log(`   ✓ Saved ${certRows.length} certificates across ${eventSet.size} events: [${Array.from(eventSet).join(', ')}].`);
  }

  // 4. Users and any other custom tables (credentials excluded — see above).
  for (const table of tableNames) {
    if (table === 'certificates' || table === 'templates' || EXCLUDED_TABLES.has(table)) {
      if (EXCLUDED_TABLES.has(table)) {
        console.log(`⏭️  Skipping ${table} (credential material is never written to backups).`);
      }
      continue;
    }
    console.log(`📦 Backing up additional table: ${table}...`);
    const rows = await sql(`SELECT * FROM ${table};`);
    manifest.tables[table] = rows.length;
    fs.writeFileSync(
      path.join(backupDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(latestDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      'utf8'
    );
    console.log(`   ✓ Saved ${rows.length} rows from ${table}.`);
  }

  // Write manifest
  fs.writeFileSync(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(latestDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  console.log('\n======================================================');
  console.log('✅ BACKUP COMPLETE & SECURELY STORED LOCALLY');
  console.log(`📁 Timestamped backup: ${backupDir}`);
  console.log(`📁 Latest shortcut:   ${latestDir}`);
  console.log(`📊 Total Certificates: ${manifest.summary.totalCertificates}`);
  console.log(`📊 Total Templates:    ${manifest.summary.totalTemplates}`);
  console.log(`📊 Events:             ${manifest.summary.events.join(', ')}`);
  console.log('======================================================');
  console.log('ℹ️  Backups contain recipient PII. They live in gitignored local');
  console.log   ('   storage only — never commit, sync, or upload them.');
}

main().catch((err) => {
  console.error('❌ Backup failed with error:', err);
  process.exit(1);
});
