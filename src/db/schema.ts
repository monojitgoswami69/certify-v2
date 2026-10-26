import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * One account per person. Google sign-in creates the row; the address in
 * ADMIN_EMAIL is the admin and may also sign in with AUTH_PASSWORD.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    issuedByName: text('issued_by_name'),
    picture: text('picture'),
    role: text('role').notNull().default('user'), // 'user' | 'admin'
    // Session tokens issued before this instant are rejected (logout-everywhere).
    sessionsValidAfter: timestamp('sessions_valid_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)]
);

/**
 * One row per issued certificate. The public UUID embedded in the QR code is
 * the primary key; public verification looks rows up by its SHA-256 hash.
 * `userId` is the issuing account. Every private query must filter on it.
 */
export const certificates = pgTable(
  'certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    eventName: text('event_name'),
    recordFingerprint: text('record_fingerprint'),
    recipientName: text('recipient_name').notNull(),
    recipientEmail: text('recipient_email'),
    templateName: text('template_name'),
    status: text('status').notNull().default('issued'), // 'issued' | 'revoked' | 'static'
    rowData: jsonb('row_data'),
    // Aggregate verification counters (opt-in per event; see events.track_scans).
    scanCount: integer('scan_count').notNull().default(0),
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('certificates_token_hash_idx').on(table.tokenHash),
    // The idempotency key for batch registration. Unique at the database level
    // so two overlapping batch requests can never insert duplicate rows for
    // the same (account, person) — the arbiter is the index, not request timing.
    uniqueIndex('certificates_user_fingerprint_idx').on(table.userId, table.recordFingerprint),
    index('certificates_user_id_idx').on(table.userId),
    index('certificates_event_id_idx').on(table.userId, table.eventId),
    index('certificates_event_name_idx').on(table.eventName),
    index('certificates_issued_at_idx').on(table.issuedAt),
  ]
);

/**
 * Reusable certificate templates. Names are unique per account, so two
 * organizations can both keep a template called "Sample Data".
 */
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    imageData: text('image_data').notNull(),
    // SHA-256 of imageData; when a save arrives with a matching hash the image
    // column is left untouched, avoiding multi-MB row rewrites for layout-only edits.
    imageHash: text('image_hash'),
    width: integer('width'),
    height: integer('height'),
    layoutConfig: jsonb('layout_config').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('templates_user_name_idx').on(table.userId, table.name),
    index('templates_user_id_idx').on(table.userId),
  ]
);

/**
 * An event (a batch context like "Hackathon 2026") is a first-class anchor:
 * certificates reference it by id, so renaming, summarizing, and deleting an
 * event never depend on string-matching certificate rows.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Opt-in verification counting: aggregate counters only, never scan logs.
    trackScans: boolean('track_scans').notNull().default(false),
    // Optional expiry for the whole event; public verify shows an expired
    // banner past this instant (details remain; revocation stays the hard kill).
    validThrough: timestamp('valid_through', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('events_user_name_idx').on(table.userId, table.name),
    index('events_user_id_idx').on(table.userId),
  ]
);

/** Audit trail: one row per executed registration batch. */
export const registrationBatches = pgTable(
  'registration_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    rowCount: integer('row_count').notNull(),
    insertedCount: integer('inserted_count').notNull().default(0),
    reusedCount: integer('reused_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('registration_batches_event_idx').on(table.eventId)]
);

/**
 * Layout snapshots written on every template save (kept to the last 10 per
 * template) so risky edits can be rolled back.
 */
export const templateVersions = pgTable(
  'template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    layoutConfig: jsonb('layout_config').notNull(),
    imageHash: text('image_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('template_versions_template_idx').on(table.templateId, table.createdAt)]
);

/**
 * Per-account autosaved session (CSV roster, layout, email copy) so a closed
 * tab is recoverable. One row per user.
 */
export const workspaceDrafts = pgTable('workspace_drafts', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  state: jsonb('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sign-in allowlist: only emails added by an admin can access the platform.
 * Roles: 'user' | 'admin' | 'super_admin' — the ADMIN_EMAIL account
 * bootstraps as super_admin at sign-in time.
 */
export const platformAccess = pgTable('platform_access', {
  email: text('email').primaryKey(),
  role: text('role').notNull().default('user'),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Gmail OAuth credentials per account. Persisted in Postgres (not memory) so
 * they survive restarts and are shared across instances. The refresh token is
 * long-lived and sensitive; treat the table like a password store.
 */
export const googleCredentials = pgTable('google_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiryDate: integer('expiry_date'),
  scope: text('scope'),
  tokenType: text('token_type'),
  email: text('email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type CertificateRow = typeof certificates.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type GoogleCredentialRow = typeof googleCredentials.$inferSelect;
