-- Template version history (2026-10-26)
-- Layout snapshots written on every save (kept to the last 10 per template)
-- so risky edits can be rolled back. Image bytes stay in the templates row;
--> statement-breakpoint
-- versions record the image hash for reference.

CREATE TABLE IF NOT EXISTS "template_versions" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "templates"("id") ON DELETE CASCADE,
  "layout_config" jsonb NOT NULL,
  "image_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "template_versions_template_idx" ON "template_versions" ("template_id", "created_at" DESC);
