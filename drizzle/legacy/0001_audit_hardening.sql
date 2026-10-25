-- Audit hardening migration (2026-10-25)
--
-- Applies the database changes from the security audit:
--   1. users.sessions_valid_after  — enables server-side session revocation on logout
--   2. templates.image_hash        — lets saves skip rewriting the multi-MB image column
--   3. certificates unique (user_id, record_fingerprint) — makes batch registration
--      idempotency race-proof (two overlapping batches can never both insert)
--   4. google_credentials          — persists Gmail OAuth tokens across restarts
--
-- Run via `npm run db:harden` (idempotent — safe to re-run).

-- 1. Session revocation cutoff -------------------------------------------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessions_valid_after" timestamp with time zone;

-- 2. Template image hash --------------------------------------------------------
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "image_hash" text;

-- 3a. Dedup existing duplicate fingerprints before the unique index ------------
-- For each (user_id, record_fingerprint) group keep the earliest-issued row and
-- deterministically suffix every later duplicate. No rows are deleted, so QR
-- codes already distributed keep verifying; the suffixed rows simply stop
-- matching new registrations (they were ambiguous duplicates anyway).
UPDATE certificates c
SET record_fingerprint = c.record_fingerprint || ':legacy:' || c.id
WHERE c.record_fingerprint IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM certificates earlier
    WHERE earlier.user_id = c.user_id
      AND earlier.record_fingerprint = c.record_fingerprint
      AND (earlier.issued_at, earlier.id) < (c.issued_at, c.id)
  );

-- 3b. Enforce one certificate per (account, identity fingerprint) --------------
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_user_fingerprint_idx"
  ON "certificates" ("user_id", "record_fingerprint");

-- Superseded by the composite unique index above.
DROP INDEX IF EXISTS "certificates_record_fingerprint_idx";

-- 4. Gmail OAuth credential store ----------------------------------------------
CREATE TABLE IF NOT EXISTS "google_credentials" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "expiry_date" integer,
  "scope" text,
  "token_type" text,
  "email" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
