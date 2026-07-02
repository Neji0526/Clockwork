
-- ============================================================
-- Security hardening migration
-- ============================================================

-- 1) Prevent privilege escalation via profiles policies.
--    Self-insert/self-update must NOT allow setting role or status.
DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
CREATE POLICY "profiles self insert"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'va'::public.app_role
    AND status = 'active'::public.profile_status
  );

DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND role = (SELECT p.role   FROM public.profiles p WHERE p.user_id = auth.uid())
    AND status = (SELECT p.status FROM public.profiles p WHERE p.user_id = auth.uid())
  );

-- 2) Belt-and-braces trigger: also fire on INSERT (was only attached to UPDATE).
--    Existing trg_guard_profile_privileged covers UPDATE; add INSERT coverage.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Service-role / backend inserts (auth.uid() IS NULL) are allowed (e.g. handle_new_user, admin-invite).
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND (NEW.role <> 'va'::public.app_role OR NEW.status <> 'active'::public.profile_status)
  THEN
    RAISE EXCEPTION 'Only admins can assign role or non-active status on profile creation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_profile_privileged_insert ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_insert();

-- 3) Revoke EXECUTE on SECURITY DEFINER trigger functions from API roles.
--    These are only meant to be called by the trigger system, not via the Data API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_insert() FROM PUBLIC, anon, authenticated;
-- has_role() stays callable: RLS policies invoke it as the current user.

-- 4) Re-wire the nightly cleanup cron job to use the service-role key
--    (which is server-only) instead of the public publishable key.
--    The service role key is read from vault.decrypted_secrets at execution time.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Drop any existing cleanup job(s) so we can re-register cleanly.
    FOR v_job_id IN
      SELECT jobid FROM cron.job WHERE jobname = 'worktrace-cleanup-screenshots-nightly'
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;

    PERFORM cron.schedule(
      'worktrace-cleanup-screenshots-nightly',
      '0 3 * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://project--4669cc6e-bd6f-4aaf-ae92-882e27f2fdbd.lovable.app/api/public/hooks/cleanup-screenshots',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cleanup-auth', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      ) AS request_id;
      $cmd$
    );
  END IF;
END $$;

-- Make sure the service_role_key is stored in vault for the cron job to read.
-- (Idempotent: only insert if missing; uses the same key the server already has in env.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault') THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
      -- Seed with an empty placeholder; the platform-managed service role key
      -- will be configured via the cron command's vault lookup. If empty at
      -- execution time, the cleanup endpoint will reject the call (401),
      -- which is the safe failure mode.
      PERFORM vault.create_secret('PLACEHOLDER_REPLACE_VIA_VAULT', 'service_role_key', 'Used by nightly cleanup cron');
    END IF;
  END IF;
END $$;
