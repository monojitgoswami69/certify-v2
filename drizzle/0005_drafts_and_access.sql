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
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_access" (
  "email" text PRIMARY KEY NOT NULL,
  "role" text DEFAULT 'user' NOT NULL,
  "added_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- The app bootstraps ADMIN_EMAIL. Grant other accounts through the Admin
-- console so reapplying this migration cannot restore previously revoked access.
