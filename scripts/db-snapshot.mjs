import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

export const snapshotTables = {
  users: {
    key: 'email',
    columns: 'id email name issued_by_name picture role sessions_valid_after created_at updated_at',
  },
  events: {
    key: 'id',
    columns: 'id user_id name label issued_design mail_preferences track_scans valid_through created_at updated_at',
    userColumn: 'user_id',
  },
  templates: {
    key: 'id',
    columns: 'id user_id name image_data image_hash width height layout_config created_at updated_at',
    userColumn: 'user_id',
    legacyOwner: true,
  },
  platform_access: {
    key: 'email',
    columns: 'email role can_issue_certificates mails_per_minute mails_per_second mail_attempts added_by created_at updated_at',
    userColumn: 'added_by',
  },
  workspace_drafts: {
    key: 'user_id',
    columns: 'user_id state updated_at',
    userColumn: 'user_id',
  },
  template_versions: {
    key: 'id',
    columns: 'id template_id layout_config image_hash created_at',
  },
  certificates: {
    key: 'id',
    columns: 'id user_id event_id token_hash event_name record_fingerprint recipient_name recipient_email template_name status row_data render_fields scan_count last_scanned_at issued_at mail_status mail_attempt_id mail_updated_at mail_gmail_id mail_detail',
    userColumn: 'user_id',
    legacyOwner: true,
  },
  registration_batches: {
    key: 'id',
    columns: 'id user_id event_id row_count inserted_count reused_count created_at',
    userColumn: 'user_id',
  },
};

export function databaseUrl() {
  const envFile = path.resolve('.env');
  if (fs.existsSync(envFile)) config({ path: envFile, quiet: true });
  if (!process.env.DATABASE_URL) throw new SnapshotInputError('DATABASE_URL is missing from the environment and .env');
  return process.env.DATABASE_URL;
}

export function reportSnapshotFailure(action, error) {
  // Postgres error details may contain recipient data, image bytes, or connection material.
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : null;
  console.error(`${action} failed${code ? ` (${code})` : ''}.`);
  if (error instanceof SnapshotInputError) console.error(error.message);
  process.exitCode = 1;
}

export class SnapshotInputError extends Error {}
