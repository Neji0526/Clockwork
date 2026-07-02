
-- 1. Session timeout setting
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS session_timeout_minutes integer NOT NULL DEFAULT 10
  CONSTRAINT app_config_session_timeout_chk CHECK (session_timeout_minutes BETWEEN 2 AND 240);

-- 2. Heartbeat column on work_sessions
ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

UPDATE public.work_sessions
SET last_activity_at = COALESCE(ended_at, started_at)
WHERE last_activity_at IS NULL OR last_activity_at < started_at;

CREATE INDEX IF NOT EXISTS work_sessions_active_heartbeat_idx
  ON public.work_sessions (status, last_activity_at)
  WHERE status = 'active';

-- 3. Add 'abandoned' status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'session_status' AND e.enumlabel = 'abandoned'
  ) THEN
    ALTER TYPE public.session_status ADD VALUE 'abandoned';
  END IF;
END $$;

-- 4. Generic heartbeat trigger function — bumps last_activity_at on the parent session
CREATE OR REPLACE FUNCTION public.bump_session_heartbeat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  ts  timestamptz;
BEGIN
  -- Pull session_id from the row (all heartbeat-eligible tables have one).
  sid := NEW.session_id;
  IF sid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Best timestamp from the row, falling back to now().
  ts := COALESCE(
    NULLIF((to_jsonb(NEW) ->> 'ended_at'),'')::timestamptz,
    NULLIF((to_jsonb(NEW) ->> 'sampled_at'),'')::timestamptz,
    NULLIF((to_jsonb(NEW) ->> 'captured_at'),'')::timestamptz,
    NULLIF((to_jsonb(NEW) ->> 'started_at'),'')::timestamptz,
    now()
  );
  IF ts > now() THEN ts := now(); END IF;

  UPDATE public.work_sessions
  SET last_activity_at = GREATEST(last_activity_at, ts)
  WHERE id = sid AND status = 'active';

  RETURN NEW;
END;
$$;

-- 5. Wire heartbeat triggers on every signal table
DROP TRIGGER IF EXISTS trg_heartbeat_activity ON public.activity_events;
CREATE TRIGGER trg_heartbeat_activity
AFTER INSERT ON public.activity_events
FOR EACH ROW EXECUTE FUNCTION public.bump_session_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_idle ON public.idle_segments;
CREATE TRIGGER trg_heartbeat_idle
AFTER INSERT ON public.idle_segments
FOR EACH ROW EXECUTE FUNCTION public.bump_session_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_break ON public.break_segments;
CREATE TRIGGER trg_heartbeat_break
AFTER INSERT OR UPDATE ON public.break_segments
FOR EACH ROW EXECUTE FUNCTION public.bump_session_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_screenshot ON public.screenshots;
CREATE TRIGGER trg_heartbeat_screenshot
AFTER INSERT ON public.screenshots
FOR EACH ROW EXECUTE FUNCTION public.bump_session_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_engagement ON public.engagement_samples;
CREATE TRIGGER trg_heartbeat_engagement
AFTER INSERT ON public.engagement_samples
FOR EACH ROW EXECUTE FUNCTION public.bump_session_heartbeat();

-- 6. Auto-close stale sessions
CREATE OR REPLACE FUNCTION public.close_stale_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  timeout_min integer;
  cutoff timestamptz;
  closed_count integer := 0;
  rec record;
  a_sec integer;
  i_sec integer;
BEGIN
  SELECT session_timeout_minutes INTO timeout_min FROM public.app_config WHERE id = 1;
  timeout_min := COALESCE(timeout_min, 10);
  cutoff := now() - make_interval(mins => timeout_min);

  FOR rec IN
    SELECT id, va_id, started_at, last_activity_at
    FROM public.work_sessions
    WHERE status = 'active' AND last_activity_at < cutoff
  LOOP
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO a_sec
    FROM public.activity_events WHERE session_id = rec.id;
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO i_sec
    FROM public.idle_segments WHERE session_id = rec.id;

    UPDATE public.work_sessions
    SET status = 'abandoned',
        ended_at = rec.last_activity_at,
        active_sec = a_sec,
        idle_sec = i_sec
    WHERE id = rec.id;

    -- Close any dangling open break on the abandoned session
    UPDATE public.break_segments
    SET ended_at = rec.last_activity_at,
        duration_sec = GREATEST(0, EXTRACT(EPOCH FROM (rec.last_activity_at - started_at))::int)
    WHERE session_id = rec.id AND ended_at IS NULL;

    closed_count := closed_count + 1;
  END LOOP;

  RETURN closed_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_stale_sessions() TO authenticated, service_role;

-- 7. Schedule via pg_cron, every minute
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-stale-sessions') THEN
    PERFORM cron.unschedule('close-stale-sessions');
  END IF;
  PERFORM cron.schedule(
    'close-stale-sessions',
    '* * * * *',
    $cron$ SELECT public.close_stale_sessions(); $cron$
  );
END $$;

-- Run once immediately so the live board reflects reality right away
SELECT public.close_stale_sessions();
