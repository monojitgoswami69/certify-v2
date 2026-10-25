-- Events as first-class anchors (2026-10-25, phase 2)
--
--   1. events table: one row per (account, event name); certificates gain an
--      event_id FK so grouping/renaming/deleting events stop depending on
--      string-matching certificate rows.
--   2. registration_batches: audit trail, one row per executed batch.
--   3. Backfill: every existing certificate's event_name is resolved to an
--      events row (creating it if needed) and stamped onto event_id.
--
-- Idempotent — safe to re-run. Run via `npm run db:events`.

-- 1. Events table ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "events_user_name_idx" ON "events" ("user_id", "name");
CREATE INDEX IF NOT EXISTS "events_user_id_idx" ON "events" ("user_id");

-- 2. Registration batch audit trail ----------------------------------------------
CREATE TABLE IF NOT EXISTS "registration_batches" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "row_count" integer NOT NULL,
  "inserted_count" integer DEFAULT 0 NOT NULL,
  "reused_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "registration_batches_event_idx" ON "registration_batches" ("event_id");

-- 3. Certificates gain event_id ---------------------------------------------------
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "event_id" uuid REFERENCES "events"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "certificates_event_id_idx" ON "certificates" ("user_id", "event_id");

-- 4. Backfill: one events row per distinct normalized event name ------------------
INSERT INTO "events" ("user_id", "name")
SELECT DISTINCT c.user_id, coalesce(nullif(trim(c.event_name), ''), 'General Event') AS name
FROM "certificates" c
WHERE c.event_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE "certificates" c
SET event_id = e.id
FROM "events" e
WHERE e.user_id = c.user_id
  AND e.name = coalesce(nullif(trim(c.event_name), ''), 'General Event')
  AND c.event_id IS NULL;
