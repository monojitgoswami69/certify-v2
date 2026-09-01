import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * One row per issued certificate. The public UUID embedded in the QR code is
 * never stored — only its SHA-256 hash — so a database leak does not expose
 * live verification URLs.
 */
export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    eventName: text('event_name'),
    recordFingerprint: text('record_fingerprint'),
    recipientName: text('recipient_name').notNull(),
    recipientEmail: text('recipient_email'),
    rowData: jsonb('row_data'),
    templateName: text('template_name'),
    status: text('status').notNull().default('issued'), // 'issued' | 'revoked'
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    scanCount: integer('scan_count').notNull().default(0),
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('certificates_token_hash_idx').on(table.tokenHash),
    index('certificates_event_name_idx').on(table.eventName),
    index('certificates_record_fingerprint_idx').on(table.recordFingerprint),
  ]
);

export const scanEvents = pgTable(
  'scan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    certificateId: uuid('certificate_id')
      .notNull()
      .references(() => certificates.id, { onDelete: 'cascade' }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (table) => [index('scan_events_certificate_id_idx').on(table.certificateId)]
);

export type CertificateRow = typeof certificates.$inferSelect;
export type ScanEventRow = typeof scanEvents.$inferSelect;
