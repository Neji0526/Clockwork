
-- Internal secrets table: NO grants to anon/authenticated, RLS denies all.
-- Only service_role (backend) and the postgres role (cron) can read it.
CREATE TABLE IF NOT EXISTS public.internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.internal_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_secrets TO service_role;

ALTER TABLE public.internal_secrets ENABLE ROW LEVEL SECURITY;
-- No policies = no access for anon/authenticated even if grants slipped in.

-- Seed the cleanup secret with a fresh 48-byte random value (idempotent).
INSERT INTO public.internal_secrets (name, value)
VALUES ('cleanup_webhook_secret', encode(gen_random_bytes(48), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- Rewire cron to use the DB-stored secret (run as postgres = bypasses RLS).
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
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
          'x-cleanup-auth', (SELECT value FROM public.internal_secrets WHERE name = 'cleanup_webhook_secret')
        ),
        body := '{}'::jsonb
      ) AS request_id;
      $cmd$
    );
  END IF;
END $$;
