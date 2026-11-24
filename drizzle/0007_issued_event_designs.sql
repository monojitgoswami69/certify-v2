ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "issued_design" jsonb;
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "render_fields" jsonb;

-- Prefer the original event for pre-FK certificates before names can repeat.
WITH original_events AS (
  SELECT DISTINCT ON (user_id, name) id, user_id, name
  FROM events
  ORDER BY user_id, name, created_at, id
)
UPDATE certificates
SET event_id = original_events.id
FROM original_events
WHERE certificates.event_id IS NULL
  AND certificates.user_id = original_events.user_id
  AND COALESCE(NULLIF(certificates.event_name, ''), 'General Event') = original_events.name;

-- Display names can repeat. Dashboard actions now identify the event by UUID.
DROP INDEX IF EXISTS "events_user_name_idx";
CREATE INDEX IF NOT EXISTS "events_user_display_name_idx" ON "events" ("user_id", "name");
