import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { certificates, events, registrationBatches } from '../db/schema';
import type { PublicUser } from './accounts';
import { db } from './db';
import type { EventLayout, IssuedEventDesign } from './event-design';
import { freezeRenderFields } from './render-fields';
import { eventCertificatesWhere } from './event-records';
import { readIssuedDesign } from './event-design-validation';
import { isAllowedR2TemplateUrl, verifyR2Artwork } from './r2-storage';
import { log } from './logger';
import { computeIdentityFingerprint, computeLegacyEmailFingerprint, normalizeName, pickEmailFromRowData } from './record-fingerprint';
import { generateCertificateId, hashToken, isValidCertificateId } from './verification';
import { readMailPreferences, singleRecipientEmail } from './mail-preferences';

const MAX_BATCH = 2000;
const CHUNK_SIZE = 500;

export class RegistrationError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
    this.name = 'RegistrationError';
  }
}

interface RegisterItemInput {
  recipientName?: unknown;
  recipientEmail?: unknown;
  rowData?: unknown;
}

export interface RegisterBatchCommand {
  certificates?: RegisterItemInput[];
  eventId?: unknown;
  eventName?: unknown;
  label?: unknown;
  design?: unknown;
  mailPreferences?: unknown;
}

function boundedText(input: unknown, max: number): string {
  return typeof input === 'string' ? input.trim().slice(0, max) : '';
}

function readRow(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(([, item]) =>
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  );
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]));
}

function storeRosterRow(row: Record<string, string> | null): Record<string, string> | null {
  return row && Object.fromEntries(Object.entries(row).slice(0, 100)
    .map(([key, value]) => [key.slice(0, 200), value.slice(0, 2000)]));
}

function canonicalDesignForMatch(design: IssuedEventDesign): Omit<
  IssuedEventDesign,
  'verificationOrigin' | 'issuedBy' | 'previewImageData' | 'previewWidth' | 'previewHeight'
> {
  return {
    imageData: design.imageData,
    width: design.width,
    height: design.height,
    layoutConfig: design.layoutConfig,
  };
}

function findOwnedEvent(userId: string, eventId: string, design: IssuedEventDesign | null) {
  return db.select({
    name: events.name,
    label: events.label,
    layout: sql<EventLayout | null>`${events.issuedDesign}->'layoutConfig'`,
    verificationOrigin: sql<string | null>`${events.issuedDesign}->>'verificationOrigin'`,
    matchesDesign: design
      ? sql<boolean>`(${events.issuedDesign} - 'verificationOrigin' - 'issuedBy' - 'previewImageData' - 'previewWidth' - 'previewHeight') = ${JSON.stringify(canonicalDesignForMatch(design))}::jsonb`
      : sql<boolean>`true`,
  }).from(events).where(and(eq(events.id, eventId), eq(events.userId, userId))).limit(1);
}

function sameFields(a: Record<string, string>, b: Record<string, string>): boolean {
  return Object.keys(a).length === Object.keys(b).length
    && Object.entries(a).every(([field, value]) => Object.hasOwn(b, field) && b[field] === value);
}

type CertRow = Pick<typeof certificates.$inferSelect, 'id' | 'recordFingerprint' | 'recipientName' | 'recipientEmail' | 'rowData' | 'renderFields'>;
const existingFields = {
  id: certificates.id,
  recordFingerprint: certificates.recordFingerprint,
  recipientName: certificates.recipientName,
  recipientEmail: certificates.recipientEmail,
  rowData: certificates.rowData,
  renderFields: certificates.renderFields,
};

export async function registerCertificates(user: PublicUser, command: RegisterBatchCommand, verificationOrigin: string) {
  if (!Array.isArray(command.certificates) || command.certificates.length === 0) {
    throw new RegistrationError('certificates must be a non-empty array');
  }
  if (command.certificates.length > MAX_BATCH) throw new RegistrationError(`A request can register up to ${MAX_BATCH} recipients`);
  if (typeof command.eventId !== 'string' || !isValidCertificateId(command.eventId)) {
    throw new RegistrationError('A valid event ID is required');
  }

  const eventId = command.eventId.toLowerCase();
  const design = command.design === undefined ? null : readIssuedDesign(command.design);
  if (command.design !== undefined && !design) throw new RegistrationError('A valid certificate design is required');
  const requestedName = boundedText(command.eventName, 500) || 'General Event';
  const requestedLabel = boundedText(command.label, 120) || null;
  const mailPreferences = readMailPreferences(command.mailPreferences);
  let [event] = await findOwnedEvent(user.userId, eventId, design);
  if (!event && !design) throw new RegistrationError('Event not found', 404);
  if (event && design && (!event.matchesDesign || event.name !== requestedName || event.label !== requestedLabel)) {
    throw new RegistrationError('This event is already issued. Make a copy to change its design or name.', 409);
  }
  const layout = event?.layout ?? design?.layoutConfig;
  if (!layout) throw new RegistrationError('Confirm the original design before adding recipients.', 409);

  const name = event?.name ?? requestedName;
  const isStatic = !layout.qrZones?.length;
  const unique = new Map<string, Record<string, string>>();
  const items = command.certificates.map((item, index) => {
    const recipientName = boundedText(item?.recipientName, 500);
    if (!recipientName) throw new RegistrationError(`Recipient name is required on row ${index + 1}`);
    const row = readRow(item?.rowData);
    const rowData = storeRosterRow(row);
    const rawEmail = typeof item?.recipientEmail === 'string' ? item.recipientEmail.trim() : pickEmailFromRowData(row);
    if (rawEmail && (rawEmail.length > 320 || !singleRecipientEmail.test(rawEmail))) {
      throw new RegistrationError(`Invalid recipient email on row ${index + 1}`);
    }
    const recipientEmail = rawEmail || null;
    const fingerprint = computeIdentityFingerprint(user.userId, eventId, recipientName, recipientEmail);
    const fields = freezeRenderFields(layout, row);
    const first = unique.get(fingerprint);
    if (first && !sameFields(first, row ?? {})) {
      throw new RegistrationError(`Ambiguous recipients: "${recipientName}" appears more than once with different certificate data.`);
    }
    unique.set(fingerprint, row ?? {});
    return {
      recipientName, recipientEmail, rowData, fingerprint, fields,
      legacyNameFingerprint: computeIdentityFingerprint(user.userId, name, recipientName, recipientEmail),
      legacyEmailFingerprint: recipientEmail ? computeLegacyEmailFingerprint(user.userId, name, recipientEmail) : null,
    };
  });

  let firstFingerprint: string | null = null;
  if (!event && design) {
    const preview = design.previewImageData;
    const [mainValid, previewValid] = await Promise.all([
      !isAllowedR2TemplateUrl(design.imageData, 'full') ||
        verifyR2Artwork(design.imageData, user.userId, 'full', design.width, design.height),
      !preview || !isAllowedR2TemplateUrl(preview, 'preview') ||
        verifyR2Artwork(preview, user.userId, 'preview', design.previewWidth!, design.previewHeight!),
    ]);
    if (!mainValid || !previewValid) {
      throw new RegistrationError('Uploaded artwork is missing, invalid, or does not belong to your account.');
    }
    const issuedBy = user.issuedByName?.trim() || user.name;
    const issuedDesign: IssuedEventDesign = { ...design, verificationOrigin, issuedBy };
    const first = items[0];
    const id = generateCertificateId();
    // The event and its first certificate commit together. A concurrent
    // retry may reuse the event ID after checking the same design below.
    const created = await db.execute<{ fingerprint: string }>(sql`
      WITH created_event AS (
        INSERT INTO ${events} (id, user_id, name, label, issued_design, mail_preferences)
        VALUES (${eventId}, ${user.userId}, ${name}, ${requestedLabel}, ${JSON.stringify(issuedDesign)}::jsonb,
          ${mailPreferences ? JSON.stringify(mailPreferences) : null}::jsonb)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      INSERT INTO ${certificates} (id, user_id, event_id, token_hash, event_name, record_fingerprint,
        recipient_name, recipient_email, row_data, render_fields, template_name, status, mail_status)
      SELECT ${id}::uuid, ${user.userId}::uuid, created_event.id, ${hashToken(id)}, ${name}, ${first.fingerprint},
        ${first.recipientName}, ${first.recipientEmail}, ${JSON.stringify(first.rowData)}::jsonb,
        ${JSON.stringify(first.fields)}::jsonb, ${name}, ${isStatic ? 'static' : 'issued'}, 'pending'
      FROM created_event
      RETURNING record_fingerprint AS fingerprint
    `);
    firstFingerprint = created.rows[0]?.fingerprint ?? null;
    [event] = await findOwnedEvent(user.userId, eventId, design);
    if (!event) throw new RegistrationError('Event not found', 404);
    if (!event.matchesDesign || event.name !== requestedName || event.label !== requestedLabel) {
      throw new RegistrationError('This event is already issued. Make a copy to issue a different design.', 409);
    }
  }

  const eventScope = eventCertificatesWhere(user.userId, eventId);
  const lookups = [...new Set(items.flatMap(({ fingerprint, legacyNameFingerprint, legacyEmailFingerprint }) =>
    legacyEmailFingerprint ? [fingerprint, legacyNameFingerprint, legacyEmailFingerprint] : [fingerprint, legacyNameFingerprint]
  ))];
  const existing = new Map<string, CertRow>();
  for (let i = 0; i < lookups.length; i += CHUNK_SIZE) {
    const rows = await db.select(existingFields).from(certificates)
      .where(and(eventScope, inArray(certificates.recordFingerprint, lookups.slice(i, i + CHUNK_SIZE))));
    for (const row of rows) if (row.recordFingerprint) existing.set(row.recordFingerprint, row);
  }

  const recordsWithoutFingerprints = await db.select(existingFields).from(certificates)
    .where(and(eventScope, isNull(certificates.recordFingerprint)));
  const legacyIdentities = new Map(recordsWithoutFingerprints.map((row) => [
    computeIdentityFingerprint(user.userId, eventId, row.recipientName, row.recipientEmail), row,
  ]));

  const findExisting = (item: (typeof items)[number]) => {
    const legacy = item.legacyEmailFingerprint ? existing.get(item.legacyEmailFingerprint) : undefined;
    return existing.get(item.fingerprint) ?? existing.get(item.legacyNameFingerprint) ?? legacyIdentities.get(item.fingerprint)
      ?? (legacy && normalizeName(legacy.recipientName) === normalizeName(item.recipientName) ? legacy : undefined);
  };

  const toInsert = new Map<string, typeof certificates.$inferInsert>();
  for (const item of items) {
    if (findExisting(item) || toInsert.has(item.fingerprint)) continue;
    const id = generateCertificateId();
    toInsert.set(item.fingerprint, {
      id, userId: user.userId, eventId, tokenHash: hashToken(id), eventName: name, recordFingerprint: item.fingerprint,
      recipientName: item.recipientName, recipientEmail: item.recipientEmail, rowData: item.rowData,
      templateName: name, status: isStatic ? 'static' : 'issued', renderFields: item.fields, mailStatus: 'pending',
    });
  }

  const inserted = new Set(firstFingerprint ? [firstFingerprint] : []);
  const requestedRows = [...toInsert.values()];
  for (let i = 0; i < requestedRows.length; i += CHUNK_SIZE) {
    const rows = await db.insert(certificates).values(requestedRows.slice(i, i + CHUNK_SIZE))
      .onConflictDoNothing({ target: [certificates.userId, certificates.recordFingerprint] }).returning(existingFields);
    for (const row of rows) {
      if (!row.recordFingerprint) continue;
      inserted.add(row.recordFingerprint);
      existing.set(row.recordFingerprint, row);
    }
  }
  const conflicts = [...toInsert.keys()].filter((fingerprint) => !inserted.has(fingerprint));
  for (let i = 0; i < conflicts.length; i += CHUNK_SIZE) {
    const rows = await db.select(existingFields).from(certificates)
      .where(and(eventScope, inArray(certificates.recordFingerprint, conflicts.slice(i, i + CHUNK_SIZE))));
    for (const row of rows) if (row.recordFingerprint) existing.set(row.recordFingerprint, row);
  }

  const outcomes = items.map((item) => {
    const current = findExisting(item);
    if (!current) throw new RegistrationError('A recipient could not be resolved. Please retry.', 409);
    const currentFields = current.renderFields ?? freezeRenderFields(layout, current.rowData as Record<string, string> | null);
    const status = inserted.delete(item.fingerprint) ? 'issued'
      : sameFields(currentFields, item.fields) ? 'existing' : 'conflict';
    return { id: current.id, status };
  });

  const newlyRegisteredCount = outcomes.filter(({ status }) => status === 'issued').length;
  const reusedCount = outcomes.length - newlyRegisteredCount;
  try {
    await db.insert(registrationBatches).values({
      userId: user.userId, eventId, rowCount: outcomes.length, insertedCount: newlyRegisteredCount, reusedCount,
    });
  } catch (error) {
    log.warn('registration', 'Failed to write batch audit record', { userId: user.userId }, error);
  }

  return { eventId, verificationOrigin: event?.verificationOrigin ?? null, ids: outcomes.map(({ id }) => id), count: items.length, newlyRegisteredCount, reusedCount, outcomes };
}
