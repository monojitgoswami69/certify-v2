#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import {
  databaseUrl, reportSnapshotFailure, snapshotTables, SnapshotInputError,
} from './db-snapshot.mjs';

function readRows(directory, table, columns, expectedCount) {
  const file = path.join(directory, `${table}.json`);
  if (!fs.existsSync(file)) {
    if (expectedCount !== undefined) throw new SnapshotInputError(`Missing ${table}.json`);
    return [];
  }

  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows) || (expectedCount !== undefined && rows.length !== expectedCount)) {
    throw new SnapshotInputError(`Invalid row count in ${table}.json`);
  }
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new SnapshotInputError(`Invalid row in ${table}.json`);
    }
    const clean = {};
    for (const key of columns.split(' ')) {
      const camelKey = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
      if (Object.hasOwn(row, key)) clean[key] = row[key];
      else if (Object.hasOwn(row, camelKey)) clean[key] = row[camelKey];
    }
    return clean;
  });
}

function groupByColumns(rows) {
  const groups = new Map();
  for (const row of rows) {
    const columns = Object.keys(row).sort().join(' ');
    if (!groups.has(columns)) groups.set(columns, []);
    groups.get(columns).push(row);
  }
  return groups;
}

function updatedValue(table, column) {
  if (table === 'certificates' && column === 'status') {
    return "CASE WHEN certificates.status = 'revoked' THEN certificates.status ELSE EXCLUDED.status END";
  }
  if (table === 'users' && column === 'sessions_valid_after') {
    return 'GREATEST(users.sessions_valid_after, EXCLUDED.sessions_valid_after)';
  }
  return `EXCLUDED.${column}`;
}

function restoreRows(sql, table, spec, rows) {
  const queries = [];
  for (const [shape, group] of groupByColumns(rows)) {
    const columns = shape.split(' ');
    if (!columns.includes(spec.key) || group.some((row) => !row[spec.key])) {
      throw new SnapshotInputError(`Missing ${spec.key} in ${table}.json`);
    }

    const fields = columns.map((column) => column === spec.userColumn
      ? `COALESCE((SELECT target_id FROM restore_user_ids WHERE source_id = src.${column}), src.${column})`
      : `src.${column}`);
    const updates = columns.filter((column) => column !== 'id' && column !== spec.key)
      .map((column) => `${column} = ${updatedValue(table, column)}`);
    const conflict = updates.length > 0 ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING';

    const query = `
      INSERT INTO public.${table} (${columns.join(', ')})
      SELECT ${fields.join(', ')}
      FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb) AS src
      ON CONFLICT (${spec.key}) ${conflict}
    `;
    for (let i = 0; i < group.length; i += 50) {
      queries.push(sql.query(query, [JSON.stringify(group.slice(i, i + 50))]));
    }
  }
  return queries;
}

async function main() {
  const url = databaseUrl();
  const args = process.argv.slice(2);
  const directory = path.resolve(args.find((arg) => !arg.startsWith('--')) || 'backups/latest');
  if (!fs.existsSync(directory)) throw new SnapshotInputError(`Backup directory not found: ${directory}`);
  if (!args.includes('--yes')) {
    throw new SnapshotInputError(`Restore writes to ${new URL(url).host}. Pass --yes to confirm.`);
  }

  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const data = Object.fromEntries(Object.entries(snapshotTables).map(([table, { columns }]) =>
    [table, readRows(directory, table, columns, manifest?.tables?.[table])]
  ));
  if (!Object.keys(data).some((table) => fs.existsSync(path.join(directory, `${table}.json`)))) {
    throw new SnapshotInputError('The directory contains no supported snapshot tables.');
  }

  const sql = neon(url);
  const users = data.users.filter((user) => user.id).map(({ id, email }) => ({ id, email }));
  const legacyOwner = '00000000-0000-0000-0000-000000000000';
  const queries = [
    ...restoreRows(sql, 'users', snapshotTables.users, data.users),
    // The account UUID participates in certificate fingerprints. Replacing it
    // for an existing account would silently break idempotency after restore.
    sql`CREATE TEMP TABLE restore_user_ids (
      source_id uuid PRIMARY KEY,
      target_id uuid NOT NULL,
      CHECK (source_id = target_id OR source_id = '00000000-0000-0000-0000-000000000000'::uuid)
    ) ON COMMIT DROP`,
    sql`
      INSERT INTO restore_user_ids
      SELECT source.id, users.id
      FROM jsonb_to_recordset(${JSON.stringify(users)}::jsonb) AS source(id uuid, email text)
      JOIN public.users ON users.email = source.email
    `,
  ];

  const usesLegacyOwner = Object.entries(snapshotTables).some(([table, spec]) =>
    spec.legacyOwner && data[table].some((row) => !row.user_id)
  );
  if (usesLegacyOwner) {
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (!adminEmail) throw new SnapshotInputError('Set ADMIN_EMAIL to restore legacy rows without an owner.');
    queries.push(
      sql`INSERT INTO public.users (email, name, role) VALUES (${adminEmail}, 'Admin', 'admin') ON CONFLICT (email) DO NOTHING`,
      sql`INSERT INTO restore_user_ids SELECT ${legacyOwner}::uuid, id FROM public.users WHERE email = ${adminEmail}`
    );
    for (const [table, spec] of Object.entries(snapshotTables)) {
      if (!spec.legacyOwner) continue;
      for (const row of data[table]) row.user_id ||= legacyOwner;
    }
  }

  for (const [table, spec] of Object.entries(snapshotTables)) {
    if (table !== 'users') queries.push(...restoreRows(sql, table, spec, data[table]));
  }
  console.log(`Restoring ${directory} to ${new URL(url).host}`);
  await sql.transaction(queries);
  console.log('Database restore completed.');
}

main().catch((error) => reportSnapshotFailure('Restore', error));
