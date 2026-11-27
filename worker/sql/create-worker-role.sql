-- Least-privilege database role for the WeCertify background Heroku worker.
-- Apply as the Neon database owner after the Drizzle migrations.
-- Never grants access to `google_credentials`, `users`, `templates`, `workspace_drafts`,
-- or mutation rights on `platform_access` quotas / `certificates` recipient fields.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'certify_worker') THEN
    CREATE ROLE certify_worker NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM certify_worker;
GRANT USAGE ON SCHEMA public TO certify_worker;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM certify_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM certify_worker;

-- Worker reads the locked event artwork.
GRANT SELECT (id, user_id, issued_design)
  ON public.events TO certify_worker;

-- Worker reads issued certificate fields and updates ONLY delivery tracking columns.
GRANT SELECT (id, user_id, event_id, status, recipient_name, recipient_email, render_fields, row_data, mail_status, mail_attempt_id, mail_updated_at, mail_gmail_id, mail_detail)
  ON public.certificates TO certify_worker;
GRANT UPDATE (mail_status, mail_attempt_id, mail_updated_at, mail_gmail_id, mail_detail)
  ON public.certificates TO certify_worker;

-- Worker claims/leases batches and records status/progress.
GRANT SELECT ON public.mail_batches TO certify_worker;
GRANT UPDATE (status, lease_owner, lease_token, lease_expires_at, next_attempt_at, attempt_count, auth_expires_at, status_reason, peak_memory_mb, started_at, completed_at, updated_at)
  ON public.mail_batches TO certify_worker;

-- Worker claims per-recipient items and records completion/retry state.
GRANT SELECT ON public.mail_batch_items TO certify_worker;
GRANT UPDATE (status, attempt_count, resend_version, next_attempt_at, locked_by, locked_at, lease_expires_at, submitted_to_gmail_at, error_code, error_detail, gmail_message_id, started_at, completed_at, updated_at)
  ON public.mail_batch_items TO certify_worker;

-- Worker atomically consumes single-use OAuth PKCE handoffs and clears ciphertexts.
GRANT SELECT (id, batch_id, user_id, redirect_uri, callback_received_at, claimed_at, expires_at, created_at, encrypted_code, encrypted_verifier)
  ON public.mail_batch_oauth_handoffs TO certify_worker;
GRANT UPDATE (claimed_at, encrypted_code, encrypted_verifier)
  ON public.mail_batch_oauth_handoffs TO certify_worker;

-- Worker shares rolling per-sender rate-limit slots without altering quotas or allowlists.
GRANT SELECT (email, can_issue_certificates, mails_per_minute, mails_per_second, mail_attempts)
  ON public.platform_access TO certify_worker;
GRANT UPDATE (mail_attempts)
  ON public.platform_access TO certify_worker;
