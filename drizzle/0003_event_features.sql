-- Event features (2026-10-26): opt-in scan analytics + validity windows
--
--   1. events.track_scans  — per-event opt-in for verification counting
--   2. events.valid_through — optional expiry timestamp for the whole event
--   3. certificates.scan_count / last_scanned_at — aggregate-only counters
--      (no IPs, no user agents, no scan log), written only when the issuer
--      opts in.
--
-- Idempotent — safe to re-run.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "track_scans" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "valid_through" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "scan_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "last_scanned_at" timestamp with time zone;
