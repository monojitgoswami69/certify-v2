-- Run after 0005. Existing Gmail grants require verified reauthorization.
ALTER TABLE platform_access
  ADD COLUMN IF NOT EXISTS mails_per_minute integer NOT NULL DEFAULT 55 CHECK (mails_per_minute BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS mails_per_second integer NOT NULL DEFAULT 8 CHECK (mails_per_second BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS mail_attempts timestamptz[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

-- Google returns expiry_date in Unix milliseconds, which cannot fit in int4.
ALTER TABLE google_credentials ALTER COLUMN expiry_date TYPE bigint;
--> statement-breakpoint

-- These grants predate verified sender matching and may belong to another mailbox.
DELETE FROM google_credentials
WHERE (access_token IS NOT NULL AND access_token NOT LIKE 'v1.%')
   OR (refresh_token IS NOT NULL AND refresh_token NOT LIKE 'v1.%');
