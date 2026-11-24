#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { databaseUrl, reportSnapshotFailure, snapshotTables } from './db-snapshot.mjs';

async function main() {
  const url = databaseUrl();
  const sql = neon(url);
  const tables = Object.keys(snapshotTables);
  const rows = await sql.transaction(
    tables.map((table) => sql.query(`SELECT ${snapshotTables[table].columns.replaceAll(' ', ', ')} FROM public.${table}`)),
    { isolationLevel: 'RepeatableRead', readOnly: true }
  );
  const timestamp = new Date().toISOString();
  const root = path.resolve('backups');
  const backupName = `backup-${timestamp.replace(/[:.]/g, '-')}`;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  const tempDir = fs.mkdtempSync(path.join(root, '.backup-'));
  const backupDir = path.join(root, backupName);
  const latest = path.join(root, 'latest');
  const nextLink = path.join(root, `.latest-${randomUUID()}`);
  let previousLatest;

  try {
    const write = (name, data) => {
      fs.writeFileSync(path.join(tempDir, `${name}.json`), JSON.stringify(data, null, 2), { mode: 0o600 });
    };
    tables.forEach((table, i) => write(table, rows[i]));
    const certificateRows = rows[tables.indexOf('certificates')];
    write('manifest', {
      timestamp,
      databaseHost: new URL(url).host,
      tables: Object.fromEntries(tables.map((table, i) => [table, rows[i].length])),
      excludedTables: ['google_credentials'],
      summary: {
        totalCertificates: certificateRows.length,
        totalTemplates: rows[tables.indexOf('templates')].length,
        events: [...new Set(certificateRows.map((row) => row.event_name).filter(Boolean))],
      },
    });
    fs.renameSync(tempDir, backupDir);
    fs.symlinkSync(backupName, nextLink, 'dir');

    // Older releases used a directory for latest. Preserve its contents when
    // converting it to a symlink for atomic publication of future backups.
    if (fs.lstatSync(latest, { throwIfNoEntry: false })?.isDirectory()) {
      const previous = path.join(root, `previous-latest-${randomUUID()}`);
      fs.renameSync(latest, previous);
      previousLatest = previous;
    }
    fs.renameSync(nextLink, latest);
  } catch (error) {
    if (previousLatest) fs.renameSync(previousLatest, latest);
    throw error;
  } finally {
    fs.rmSync(nextLink, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`Database snapshot saved to ${backupDir}`);
  console.log(`Latest snapshot: ${latest}`);
}

main().catch((error) => reportSnapshotFailure('Backup', error));
