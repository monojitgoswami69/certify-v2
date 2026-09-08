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
    templateName: text('template_name'),
    status: text('status').notNull().default('issued'), // 'issued' | 'revoked' | 'static'
    rowData: jsonb('row_data'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('certificates_token_hash_idx').on(table.tokenHash),
    index('certificates_event_name_idx').on(table.eventName),
    index('certificates_record_fingerprint_idx').on(table.recordFingerprint),
    index('certificates_issued_at_idx').on(table.issuedAt),
  ]
);

/**
 * Reusable certificate templates stored directly in PostgreSQL.
 * Holds the background graphic (imageData) and full canvas layout configuration
 * (text boxes, QR zones, font styles, alignments).
 */
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    imageData: text('image_data').notNull(),
    width: integer('width'),
    height: integer('height'),
    layoutConfig: jsonb('layout_config').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('templates_name_idx').on(table.name),
  ]
);

export type CertificateRow = typeof certificates.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
