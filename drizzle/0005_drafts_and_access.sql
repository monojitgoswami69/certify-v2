-- Draft workspaces + platform access allowlist (2026-10-26)
--
--   1. workspace_drafts: per-account autosaved session (CSV, layout, email
--      copy) so a closed tab is recoverable.
--   2. platform_access: the sign-in allowlist. Only emails added by an admin
--      can access the platform. Roles: 'user' | 'admin' | 'super_admin' —
--      the ADMIN_EMAIL account bootstraps as super_admin; admins can add
--      regular users, only super admins can add more admins.
--
-- Idempotent — safe to re-run. Run via `npm run db:drafts-access`.

CREATE TABLE IF NOT EXISTS "workspace_drafts" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "state" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "platform_access" (
  "email" text PRIMARY KEY NOT NULL,
  "role" text DEFAULT 'user' NOT NULL,
  "added_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Bootstrap: existing accounts keep access; ADMIN_EMAIL becomes super_admin.
INSERT INTO "platform_access" ("email", "role")
SELECT u.email, 'user' FROM "users" u
ON CONFLICT ("email") DO NOTHING;

UPDATE "platform_access" p
SET role = 'super_admin'
FROM "users" u
WHERE u.email = p.email
  AND u.email = lower(trim(coalesce(NULLIF(current_setting('certify.admin_email', true), ''), '')));

-- The env-based bootstrap below is applied at sign-in time by the app
-- (ADMIN_EMAIL lives in the app env, not the database).
