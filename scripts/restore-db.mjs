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

function sanitizeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'object') {
    if (val instanceof Date) return `'${val.toISOString()}'::timestamptz`;
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const targetDirArg = args.find((a) => !a.startsWith('--'));
  const targetDir = targetDirArg
    ? path.resolve(process.cwd(), targetDirArg)
    : path.resolve(process.cwd(), 'backups', 'latest');

  if (!fs.existsSync(targetDir)) {
    console.error(`❌ Error: Backup directory not found at ${targetDir}`);
    process.exit(1);
  }

  // The restore writes the LIVE database (same DATABASE_URL the app uses).
  // Make the operator acknowledge that explicitly unless --yes was passed.
  const dbHost = (() => {
    try {
      return new URL(dbUrl).host;
    } catch {
      return '(unparseable URL)';
    }
  })();
  console.log(`⚠️  Restore target : ${dbHost}`);
  console.log(`⚠️  Backup source  : ${targetDir}`);
  if (!confirmed) {
    console.error(
      '❌ Refusing to restore without --yes. This overwrites data in the live database.\n' +
        '   Re-run with: npm run db:restore -- ' +
        (targetDirArg ? `${targetDirArg} --yes` : '--yes')
    );
    process.exit(1);
  }

  console.log(`🔄 Restoring database from: ${targetDir}`);

  const usersFile = path.join(targetDir, 'users.json');
  const templatesFile = path.join(targetDir, 'templates.json');
  const certsFile = path.join(targetDir, 'certificates.json');

  // One transaction for the entire run: a failure anywhere rolls everything
  // back, so an interrupted restore can never leave a half-restored database.
  await sql('BEGIN');

  // 1. Ensure/Restore users and resolve default admin userId for legacy records
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@certify.local').trim().toLowerCase();
  let defaultAdminId = null;

  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    console.log(`📦 Restoring ${users.length} users...`);
    for (const u of users) {
      const id = sanitizeSqlValue(u.id);
      const email = sanitizeSqlValue(u.email);
      const name = sanitizeSqlValue(u.name);
      const issuedByName = sanitizeSqlValue(u.issued_by_name || u.issuedByName);
      const picture = sanitizeSqlValue(u.picture);
      const role = sanitizeSqlValue(u.role || (u.email?.toLowerCase() === adminEmail ? 'admin' : 'user'));
      const createdAt = sanitizeSqlValue(u.created_at || u.createdAt);
      const updatedAt = sanitizeSqlValue(u.updated_at || u.updatedAt);

      const [res] = await sql(`
        INSERT INTO users (id, email, name, issued_by_name, picture, role, created_at, updated_at)
        VALUES (${id}, ${email}, ${name}, ${issuedByName}, ${picture}, ${role}, ${createdAt}, ${updatedAt})
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          issued_by_name = COALESCE(EXCLUDED.issued_by_name, users.issued_by_name),
          picture = COALESCE(EXCLUDED.picture, users.picture),
          role = EXCLUDED.role,
          updated_at = EXCLUDED.updated_at
        RETURNING id, email;
      `);
      if (u.email?.toLowerCase() === adminEmail && res?.id) {
        defaultAdminId = res.id;
      }
    }
    console.log(`   ✓ Users restored.`);
  }

  if (!defaultAdminId) {
    const [adminRow] = await sql`
      INSERT INTO users (email, name, role)
      VALUES (${adminEmail}, 'Admin', 'admin')
      ON CONFLICT (email) DO UPDATE SET role = 'admin'
      RETURNING id;
    `;
    defaultAdminId = adminRow?.id;
  }
  console.log(`🔑 Linked legacy records to admin account: ${adminEmail} (${defaultAdminId})`);

  // 2. Restore templates
  if (fs.existsSync(templatesFile)) {
    const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
    console.log(`📦 Restoring ${templates.length} templates...`);

    for (const t of templates) {
      const id = sanitizeSqlValue(t.id);
      const userId = sanitizeSqlValue(t.user_id || t.userId || defaultAdminId);
      const name = sanitizeSqlValue(t.name);
      const imageData = sanitizeSqlValue(t.image_data || t.imageData);
      const width = sanitizeSqlValue(t.width);
      const height = sanitizeSqlValue(t.height);
      const layoutConfig = sanitizeSqlValue(t.layout_config || t.layoutConfig);
      const createdAt = sanitizeSqlValue(t.created_at || t.createdAt);
      const updatedAt = sanitizeSqlValue(t.updated_at || t.updatedAt);

      await sql(`
        INSERT INTO templates (id, user_id, name, image_data, width, height, layout_config, created_at, updated_at)
        VALUES (${id}, ${userId}, ${name}, ${imageData}, ${width}, ${height}, ${layoutConfig}, ${createdAt}, ${updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          image_data = EXCLUDED.image_data,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          layout_config = EXCLUDED.layout_config,
          updated_at = EXCLUDED.updated_at;
      `);
    }
    console.log(`   ✓ Templates restored.`);
  }

  // 3. Restore certificates in batches
  if (fs.existsSync(certsFile)) {
    const certs = JSON.parse(fs.readFileSync(certsFile, 'utf8'));
    console.log(`📦 Restoring ${certs.length} certificates...`);

    const BATCH_SIZE = 50;
    for (let i = 0; i < certs.length; i += BATCH_SIZE) {
      const batch = certs.slice(i, i + BATCH_SIZE);
      const statements = batch.map((c) => {
        const id = sanitizeSqlValue(c.id);
        const userId = sanitizeSqlValue(c.user_id || c.userId || defaultAdminId);
        const tokenHash = sanitizeSqlValue(c.token_hash || c.tokenHash);
        const eventName = sanitizeSqlValue(c.event_name || c.eventName);
        const recordFingerprint = sanitizeSqlValue(c.record_fingerprint || c.recordFingerprint);
        const recipientName = sanitizeSqlValue(c.recipient_name || c.recipientName);
        const recipientEmail = sanitizeSqlValue(c.recipient_email || c.recipientEmail);
        const templateName = sanitizeSqlValue(c.template_name || c.templateName);
        const status = sanitizeSqlValue(c.status);
        const rowData = sanitizeSqlValue(c.row_data || c.rowData);
        const issuedAt = sanitizeSqlValue(c.issued_at || c.issuedAt);

        return `
          INSERT INTO certificates (id, user_id, token_hash, event_name, record_fingerprint, recipient_name, recipient_email, template_name, status, row_data, issued_at)
          VALUES (${id}, ${userId}, ${tokenHash}, ${eventName}, ${recordFingerprint}, ${recipientName}, ${recipientEmail}, ${templateName}, ${status}, ${rowData}, ${issuedAt})
          ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            token_hash = EXCLUDED.token_hash,
            event_name = EXCLUDED.event_name,
            record_fingerprint = EXCLUDED.record_fingerprint,
            recipient_name = EXCLUDED.recipient_name,
            recipient_email = EXCLUDED.recipient_email,
            template_name = EXCLUDED.template_name,
            -- A backup older than a revocation must never resurrect a
            -- certificate the admin deliberately revoked.
            status = CASE WHEN certificates.status = 'revoked' THEN certificates.status ELSE EXCLUDED.status END,
            row_data = EXCLUDED.row_data;
        `;
      });

      await sql(statements.join('\n'));
      process.stdout.write(`   ... restored ${Math.min(i + BATCH_SIZE, certs.length)} / ${certs.length}\r`);
    }
    console.log(`\n   ✓ Certificates restored.`);
  }

  await sql('COMMIT');

  console.log('\n======================================================');
  console.log('✅ DATABASE RESTORE COMPLETED SUCCESSFULLY');
  console.log('======================================================');
}

main().catch(async (err) => {
  console.error('❌ Restore failed with error:', err);
  console.error('   Rolling back — the database is unchanged.');
  try {
    await sql('ROLLBACK');
  } catch {
    // connection/transaction already gone; nothing to roll back
  }
  process.exit(1);
});
