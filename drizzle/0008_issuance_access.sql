ALTER TABLE "platform_access" ADD COLUMN IF NOT EXISTS "can_issue_certificates" boolean DEFAULT false NOT NULL;
