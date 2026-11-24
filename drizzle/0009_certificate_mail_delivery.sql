-- Historic certificates and concurrent inserts by older writers have no reliable send history.
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS mail_status text NOT NULL DEFAULT 'unknown'
    CHECK (mail_status IN ('pending', 'sending', 'accepted', 'failed', 'unknown')),
  ADD COLUMN IF NOT EXISTS mail_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS mail_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS mail_gmail_id text,
  ADD COLUMN IF NOT EXISTS mail_detail text;

ALTER TABLE events ADD COLUMN IF NOT EXISTS mail_preferences jsonb;
