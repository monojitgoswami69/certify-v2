-- Earlier manual upgrades used PostgreSQL's default foreign-key names.
-- Match Drizzle's snapshot so future generated ALTERs address the same
-- constraints on both upgraded and freshly provisioned databases.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('certificates', 'certificates_event_id_fkey', 'certificates_event_id_events_id_fk'),
    ('events', 'events_user_id_fkey', 'events_user_id_users_id_fk'),
    ('google_credentials', 'google_credentials_user_id_fkey', 'google_credentials_user_id_users_id_fk'),
    ('platform_access', 'platform_access_added_by_fkey', 'platform_access_added_by_users_id_fk'),
    ('registration_batches', 'registration_batches_user_id_fkey', 'registration_batches_user_id_users_id_fk'),
    ('registration_batches', 'registration_batches_event_id_fkey', 'registration_batches_event_id_events_id_fk'),
    ('template_versions', 'template_versions_template_id_fkey', 'template_versions_template_id_templates_id_fk'),
    ('workspace_drafts', 'workspace_drafts_user_id_fkey', 'workspace_drafts_user_id_users_id_fk')
  ) AS names(table_name, old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = format('public.%I', fk.table_name)::regclass
               AND conname = fk.old_name AND contype = 'f') THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', fk.table_name, fk.old_name, fk.new_name);
    END IF;
  END LOOP;
END
$$;
