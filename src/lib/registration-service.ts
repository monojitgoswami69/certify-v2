/**
 * Certificate registration service (server-only).
 *
 * Domain layer beneath the /api/certificates/register route: owns the
 * identity fingerprint rules, event anchoring, idempotent batch writes, and
 * the per-batch audit record. HTTP concerns (auth, rate limits, status
 * mapping) stay in the route.
 */
import { inArray, eq, and, sql } from 'drizzle-orm';
import { db } from './db';
import { certificates, events, registrationBatches } from '../db/schema';
import { generateCertificateId, hashToken } from './verification';
import {
  computeIdentityFingerprint,
  computeLegacyEmailFingerprint,
  pickEmailFromRowData,
} from './record-fingerprint';
import type { PublicUser } from './accounts';

const MAX_BATCH = 2000;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_TEXT_LENGTH = 500;
const MAX_ROW_FIELDS = 100;
const FINGERPRINT_CHUNK_SIZE = 500;
const INSERT_CHUNK_SIZE = 500;

export class RegistrationError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = 'RegistrationError';
  }
}

export interface RegisterItemInput {
  recipientName?: unknown;
  recipientEmail?: unknown;
  rowData?: unknown;
  templateName?: unknown;
  eventName?: unknown;
  isStatic?: unknown;
}

export interface RegisterBatchCommand {
  certificates?: RegisterItemInput[];
  eventName?: unknown;
  isStatic?: unknown;
}

export interface RegisterBatchResult {
  ids: string[];
  count: number;
  reusedCount: number;
  newlyRegisteredCount: number;
  eventId: string;
}

function sanitizeRowData(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ROW_FIELDS) break;
    if (val === null || val === undefined) continue;
    if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') continue;
    out[key.slice(0, 200)] = String(val).slice(0, MAX_TEXT_LENGTH * 4);
    count++;
  }
  return out;
}

interface ParsedItem {
  index: number;
  name: string;
  email: string | null;
  eventName: string;
  templateName: string | null;
  fingerprint: string;
  legacyFingerprint: string | null;
  isStatic: boolean;
  rowData: Record<string, string> | null;
}

/** Resolves (creating on first use) the events row anchoring this batch. */
export async function ensureEvent(userId: string, name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim().slice(0, MAX_TEXT_LENGTH) || 'General Event';
  await db.insert(events).values({ userId, name: trimmed }).onConflictDoNothing({
    target: [events.userId, events.name],
  });
  const [row] = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.name, trimmed)))
    .limit(1);
  if (!row) throw new RegistrationError('Failed to resolve event', 500);
  return row;
}

export async function registerCertificates(
  user: PublicUser,
  command: RegisterBatchCommand
): Promise<RegisterBatchResult> {
  const items = command.certificates;
  if (!Array.isArray(items) || items.length === 0) {
    throw new RegistrationError('certificates must be a non-empty array');
  }
  if (items.length > MAX_BATCH) {
    throw new RegistrationError(`Batch too large: max ${MAX_BATCH} certificates per request`);
  }

  const batchEventName =
    typeof command.eventName === 'string' && command.eventName.trim()
      ? command.eventName.trim().slice(0, MAX_TEXT_LENGTH)
      : 'General Event';

  // ------------------------------------------------------------------
  // Parse items and compute deterministic identity fingerprints.
  // ------------------------------------------------------------------
  const parsedItems: ParsedItem[] = [];
  const allLookupFingerprints = new Set<string>();
  const seenNoEmail = new Map<string, { index: number; rowDataJson: string }>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i] ?? {};
    const name =
      typeof item.recipientName === 'string' ? item.recipientName.trim().slice(0, MAX_TEXT_LENGTH) : '';
    if (!name) {
      throw new RegistrationError(`certificates[${i}].recipientName is required`);
    }
    let email =
      typeof item.recipientEmail === 'string' && EMAIL_RE.test(item.recipientEmail.trim())
        ? item.recipientEmail.trim().slice(0, 320)
        : null;

    const rowData = sanitizeRowData(item.rowData);

    // Fallback: an explicitly email-named column in rowData (never positional
    // order, so reordering CSV columns cannot change a person's identity).
    if (!email) {
      const scanned = pickEmailFromRowData(rowData);
      if (scanned && EMAIL_RE.test(scanned)) {
        email = scanned.slice(0, 320);
      }
    }

    const itemEventName =
      typeof item.eventName === 'string' && item.eventName.trim()
        ? item.eventName.trim().slice(0, MAX_TEXT_LENGTH)
        : batchEventName;

    const templateName =
      typeof item.templateName === 'string' ? item.templateName.slice(0, 200) : null;

    const fingerprint = computeIdentityFingerprint(user.userId, itemEventName, name, email);
    allLookupFingerprints.add(fingerprint);

    const legacyFingerprint = email ? computeLegacyEmailFingerprint(user.userId, itemEventName, email) : null;
    if (legacyFingerprint) allLookupFingerprints.add(legacyFingerprint);

    // Email-less identity is name-based: a duplicate name that is not an
    // identical duplicate row is two people we cannot distinguish — reject
    // rather than silently merging them onto one certificate.
    if (!email) {
      const nameKey = `${itemEventName.toLowerCase()}|${name.toLowerCase()}`;
      const rowDataJson = JSON.stringify(rowData ?? null);
      const first = seenNoEmail.get(nameKey);
      if (first && first.rowDataJson !== rowDataJson) {
        throw new RegistrationError(
          `Ambiguous recipients: "${name}" appears more than once in event "${itemEventName}" ` +
            'without an email address, so their certificates cannot be told apart. ' +
            'Add an email (or another distinguishing) column and try again.'
        );
      }
      seenNoEmail.set(nameKey, { index: first ? first.index : i, rowDataJson });
    }

    parsedItems.push({
      index: i,
      name,
      email,
      eventName: itemEventName,
      templateName,
      fingerprint,
      legacyFingerprint,
      isStatic: Boolean(item.isStatic ?? command.isStatic),
      rowData,
    });
  }

  // Anchor the batch's primary event (audit record + per-event grouping).
  const event = await ensureEvent(user.userId, batchEventName);

  // ----------------------------------------------------------------
  // 1. Load any existing rows for the batch's fingerprints (chunked).
  // ----------------------------------------------------------------
  interface ExistingCertMeta {
    id: string;
    recipientName: string;
    recipientEmail: string | null;
    rowData: Record<string, string> | null;
    templateName: string | null;
    status: string;
  }
  const existingMap = new Map<string, ExistingCertMeta>();
  const fingerprintsArray = Array.from(allLookupFingerprints);

  for (let i = 0; i < fingerprintsArray.length; i += FINGERPRINT_CHUNK_SIZE) {
    const chunk = fingerprintsArray.slice(i, i + FINGERPRINT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const chunkResults = await db
      .select({
        id: certificates.id,
        recordFingerprint: certificates.recordFingerprint,
        recipientName: certificates.recipientName,
        recipientEmail: certificates.recipientEmail,
        rowData: certificates.rowData,
        templateName: certificates.templateName,
        status: certificates.status,
      })
      .from(certificates)
      .where(and(eq(certificates.userId, user.userId), inArray(certificates.recordFingerprint, chunk)));

    for (const cert of chunkResults) {
      if (cert.recordFingerprint) {
        existingMap.set(cert.recordFingerprint, {
          id: cert.id,
          recipientName: cert.recipientName,
          recipientEmail: cert.recipientEmail,
          rowData: (cert.rowData as Record<string, string> | null) || null,
          templateName: cert.templateName,
          status: cert.status,
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // 2. Resolve each item to an existing row (reuse) or a new insert.
  // ----------------------------------------------------------------
  const resultIds: string[] = new Array(parsedItems.length);
  const newRowsToInsert: Array<typeof certificates.$inferInsert> = [];
  const updatesToApply: Array<{
    id: string;
    recipientName?: string;
    recipientEmail?: string;
    rowData?: Record<string, string> | null;
    templateName?: string | null;
    status?: string;
  }> = [];
  const fingerprintMigrations: Array<{ id: string; fingerprint: string }> = [];

  const markUpdates = (item: ParsedItem, existing: ExistingCertMeta) => {
    const targetStatus = item.isStatic ? 'static' : 'issued';

    // Idempotent hit: reuse the existing certificate id. A revoked
    // certificate is never silently re-instated by re-running a batch; that
    // requires the explicit revoke/reinstate endpoint.
    const nameChanged = item.name !== existing.recipientName;
    const emailChanged = Boolean(item.email) && item.email !== existing.recipientEmail;
    const rowDataChanged =
      item.rowData &&
      (!existing.rowData || JSON.stringify(item.rowData) !== JSON.stringify(existing.rowData));
    const templateChanged = item.templateName && item.templateName !== existing.templateName;
    const statusChanged = targetStatus !== existing.status && existing.status !== 'revoked';

    if (nameChanged || emailChanged || rowDataChanged || templateChanged || statusChanged) {
      updatesToApply.push({
        id: existing.id,
        ...(nameChanged ? { recipientName: item.name } : {}),
        ...(emailChanged && item.email ? { recipientEmail: item.email } : {}),
        ...(rowDataChanged ? { rowData: item.rowData } : {}),
        ...(templateChanged ? { templateName: item.templateName } : {}),
        ...(statusChanged ? { status: targetStatus } : {}),
      });
      if (nameChanged) existing.recipientName = item.name;
      if (emailChanged) existing.recipientEmail = item.email;
      if (rowDataChanged && item.rowData) existing.rowData = item.rowData;
      if (templateChanged) existing.templateName = item.templateName;
      if (statusChanged) existing.status = targetStatus;
    }
  };

  for (const item of parsedItems) {
    const v2Existing = existingMap.get(item.fingerprint);

    if (v2Existing) {
      resultIds[item.index] = v2Existing.id;
      markUpdates(item, v2Existing);
      continue;
    }

    // Legacy adoption: an email-only row counts as the same person only
    // when the stored name matches — a different name under that email is a
    // different person and gets their own certificate from now on.
    if (item.legacyFingerprint) {
      const legacyExisting = existingMap.get(item.legacyFingerprint);
      if (
        legacyExisting &&
        legacyExisting.recipientName.trim().toLowerCase() === item.name.trim().toLowerCase()
      ) {
        resultIds[item.index] = legacyExisting.id;
        markUpdates(item, legacyExisting);
        fingerprintMigrations.push({ id: legacyExisting.id, fingerprint: item.fingerprint });
        existingMap.set(item.fingerprint, legacyExisting);
        continue;
      }
    }

    // New certificate. ON CONFLICT DO NOTHING below makes this safe even
    // when a concurrent request inserts the same fingerprint first; the
    // follow-up SELECT re-resolves those rows to the winner's id.
    const newId = generateCertificateId();
    resultIds[item.index] = newId;
    existingMap.set(item.fingerprint, {
      id: newId,
      recipientName: item.name,
      recipientEmail: item.email,
      rowData: item.rowData || null,
      templateName: item.templateName || null,
      status: item.isStatic ? 'static' : 'issued',
    });

    newRowsToInsert.push({
      id: newId,
      userId: user.userId,
      eventId: event.id,
      tokenHash: hashToken(newId),
      eventName: item.eventName,
      recordFingerprint: item.fingerprint,
      recipientName: item.name,
      recipientEmail: item.email,
      templateName: item.templateName,
      status: item.isStatic ? 'static' : 'issued',
      rowData: item.rowData,
    });
  }

  // ----------------------------------------------------------------
  // 3. Insert new rows. Conflicts (concurrent duplicate batch) resolve to
  //    the surviving row via the re-SELECT below, so no request ever
  //    yields two live certificates for one person.
  // ----------------------------------------------------------------
  const insertedFingerprints = new Set<string>();
  for (let i = 0; i < newRowsToInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = newRowsToInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const inserted = await db
      .insert(certificates)
      .values(chunk)
      .onConflictDoNothing({ target: [certificates.userId, certificates.recordFingerprint] })
      .returning({ id: certificates.id, recordFingerprint: certificates.recordFingerprint });
    for (const row of inserted) {
      if (row.recordFingerprint) insertedFingerprints.add(row.recordFingerprint);
    }
  }

  // Rows we tried to insert but lost the race: adopt the winner's id.
  const lostFingerprints = newRowsToInsert
    .map((row) => row.recordFingerprint as string)
    .filter((fp) => !insertedFingerprints.has(fp));
  for (let i = 0; i < lostFingerprints.length; i += FINGERPRINT_CHUNK_SIZE) {
    const chunk = lostFingerprints.slice(i, i + FINGERPRINT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const winners = await db
      .select({
        id: certificates.id,
        recordFingerprint: certificates.recordFingerprint,
        recipientName: certificates.recipientName,
        recipientEmail: certificates.recipientEmail,
        rowData: certificates.rowData,
        templateName: certificates.templateName,
        status: certificates.status,
      })
      .from(certificates)
      .where(and(eq(certificates.userId, user.userId), inArray(certificates.recordFingerprint, chunk)));
    for (const winner of winners) {
      if (!winner.recordFingerprint) continue;
      existingMap.set(winner.recordFingerprint, {
        id: winner.id,
        recipientName: winner.recipientName,
        recipientEmail: winner.recipientEmail,
        rowData: (winner.rowData as Record<string, string> | null) || null,
        templateName: winner.templateName,
        status: winner.status,
      });
    }
  }

  // Re-map result ids for raced items now that the winner is known.
  let reusedCount = 0;
  for (const item of parsedItems) {
    const resolved = existingMap.get(item.fingerprint);
    if (!resolved) continue;
    if (resultIds[item.index] !== resolved.id) {
      resultIds[item.index] = resolved.id;
      markUpdates(item, resolved);
    }
    if (!insertedFingerprints.has(item.fingerprint)) reusedCount++;
  }
  const newlyRegisteredCount = parsedItems.length - reusedCount;

  // ----------------------------------------------------------------
  // 4. Apply changed-field updates and legacy fingerprint migrations.
  // ----------------------------------------------------------------
  if (fingerprintMigrations.length > 0) {
    await Promise.all(
      fingerprintMigrations.map(({ id, fingerprint }) =>
        db
          .update(certificates)
          .set({ recordFingerprint: fingerprint })
          .where(
            and(
              eq(certificates.id, id),
              eq(certificates.userId, user.userId),
              sql`NOT EXISTS (SELECT 1 FROM ${certificates} c2 WHERE c2.user_id = ${user.userId} AND c2.record_fingerprint = ${fingerprint})`
            )
          )
      )
    );
  }

  if (updatesToApply.length > 0) {
    const UPDATE_BATCH_SIZE = 25;
    for (let i = 0; i < updatesToApply.length; i += UPDATE_BATCH_SIZE) {
      const batch = updatesToApply.slice(i, i + UPDATE_BATCH_SIZE);
      await Promise.all(
        batch.map((u) => {
          const setValues: Record<string, unknown> = {};
          if (u.recipientName) setValues.recipientName = u.recipientName;
          if (u.recipientEmail) setValues.recipientEmail = u.recipientEmail;
          if (u.rowData) setValues.rowData = u.rowData;
          if (u.templateName !== undefined) setValues.templateName = u.templateName;
          if (u.status) setValues.status = u.status;
          return db
            .update(certificates)
            .set(setValues)
            .where(and(eq(certificates.id, u.id), eq(certificates.userId, user.userId)));
        })
      );
    }
  }

  // 5. Audit trail: one row per executed batch (best effort).
  try {
    await db.insert(registrationBatches).values({
      userId: user.userId,
      eventId: event.id,
      rowCount: parsedItems.length,
      insertedCount: newlyRegisteredCount,
      reusedCount,
    });
  } catch (err) {
    console.warn('[registration] batch audit record failed:', err);
  }

  return {
    ids: resultIds,
    count: resultIds.length,
    reusedCount,
    newlyRegisteredCount,
    eventId: event.id,
  };
}
