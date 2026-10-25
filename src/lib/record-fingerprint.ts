/**
 * Certificate identity fingerprints (server-only).
 *
 * A fingerprint is the stable identity of "one certificate for one person
 * within one account and event". Batch registration uses it for idempotency:
 * re-registering the same roster reuses the existing certificate instead of
 * issuing a duplicate.
 *
 * V2 scheme (deterministic and order-independent):
 *   with email:    sha256(`user:${userId}|event:${event}|email:${email}|name:${name}`)
 *   without email: sha256(`user:${userId}|event:${event}|name:${name}`)
 *
 * The name is always part of the identity when an email exists, so a roster
 * edit can never re-assign an already-issued certificate to a different
 * person, and batch row order can never change who owns which certificate.
 *
 * The legacy scheme (pre-hardening rows) keyed emailed rows by email only, or
 * `email|name` when a single batch contained name collisions. The `|name:`
 * variant is byte-identical to V2, so lookups check both spellings and rows
 * are migrated forward on first reuse.
 */
import { createHash } from 'crypto';

export function normalizeEventName(eventName: string): string {
  return eventName.trim().toLowerCase();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** V2 identity fingerprint. Include `scopeEmailByName` behavior implicitly: name always included. */
export function computeIdentityFingerprint(
  userId: string,
  eventName: string,
  recipientName: string,
  recipientEmail: string | null
): string {
  const owner = `user:${userId}|`;
  const event = `event:${normalizeEventName(eventName)}`;
  if (recipientEmail && recipientEmail.includes('@')) {
    return createHash('sha256')
      .update(`${owner}${event}|email:${normalizeEmail(recipientEmail)}|name:${normalizeName(recipientName)}`)
      .digest('hex');
  }
  return createHash('sha256')
    .update(`${owner}${event}|name:${normalizeName(recipientName)}`)
    .digest('hex');
}

/** Legacy email-only fingerprint (identity keyed without the name). Lookup-only. */
export function computeLegacyEmailFingerprint(
  userId: string,
  eventName: string,
  recipientEmail: string
): string | null {
  if (!recipientEmail || !recipientEmail.includes('@')) return null;
  const owner = `user:${userId}|`;
  return createHash('sha256')
    .update(`${owner}event:${normalizeEventName(eventName)}|email:${normalizeEmail(recipientEmail)}`)
    .digest('hex');
}

/**
 * Deterministically picks an email from CSV row data. Only columns explicitly
 * named like an email field are considered (never positional order), with a
 * fixed priority so the same row always resolves to the same email regardless
 * of column order in the source file.
 */
const EMAIL_KEY_PRIORITY = ['email', 'recipientemail', 'emailaddress', 'mail'];

export function pickEmailFromRowData(rowData: Record<string, string> | null): string | null {
  if (!rowData) return null;
  const byNormalizedKey = new Map<string, string>();
  for (const [key, value] of Object.entries(rowData)) {
    const normalized = key.toLowerCase().replace(/[\s_\-]/g, '');
    if (!byNormalizedKey.has(normalized)) byNormalizedKey.set(normalized, value);
  }
  for (const candidate of EMAIL_KEY_PRIORITY) {
    const value = byNormalizedKey.get(candidate);
    if (value && value.includes('@')) return value.trim();
  }
  return null;
}
