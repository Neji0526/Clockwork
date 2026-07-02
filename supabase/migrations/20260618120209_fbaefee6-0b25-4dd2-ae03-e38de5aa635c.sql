-- 1. Heartbeat interval setting (drives the per-row activity cap in ingest).
ALTER TABLE public.app_config
  ADD COLUMN heartbeat_sec integer NOT NULL DEFAULT 60
    CHECK (heartbeat_sec >= 15 AND heartbeat_sec <= 600);

-- 2. Dedup constraint on activity_events. NULLS NOT DISTINCT so rows with
--    null app or null url (native-app activity) still collapse on duplicates.
ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_dedup_uq
    UNIQUE NULLS NOT DISTINCT (session_id, started_at, app, url);

-- 3. close_open_session_segment: always upper-bound the activity/idle SUMs by
--    p_ended_at, even when p_final=true. Layer 1 clamp preserved.
CREATE OR REPLACE FUNCTION public.close_open_session_segment(
  p_session_id uuid, p_ended_at timestamp with time zone, p_final boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  seg      record;
  a_sec    integer;
  i_sec    integer;
  wall_sec integer;
BEGIN
  SELECT id, started_at INTO seg
    FROM public.session_segments
   WHERE session_id = p_session_id AND ended_at IS NULL
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_ended_at < seg.started_at THEN
    p_ended_at := seg.started_at;
  END IF;

  -- Always bounded by [seg.started_at, p_ended_at). p_final no longer
  -- changes the SUM window. Rows arriving after p_ended_at are not part of
  -- this segment; the previous "p_final = unbounded" behavior was a bug
  -- that let final-close on a non-last segment absorb later-segment activity.
  SELECT COALESCE(SUM(duration_sec), 0)::int INTO a_sec
    FROM public.activity_events
   WHERE session_id = p_session_id
     AND started_at >= seg.started_at
     AND started_at <  p_ended_at;
  SELECT COALESCE(SUM(duration_sec), 0)::int INTO i_sec
    FROM public.idle_segments
   WHERE session_id = p_session_id
     AND started_at >= seg.started_at
     AND started_at <  p_ended_at;

  -- Layer 1 hard invariant: active + idle <= wall.
  wall_sec := GREATEST(0, EXTRACT(EPOCH FROM (p_ended_at - seg.started_at))::int);
  i_sec    := LEAST(i_sec, wall_sec);
  a_sec    := LEAST(a_sec, GREATEST(0, wall_sec - i_sec));

  UPDATE public.session_segments
     SET ended_at = p_ended_at, active_sec = a_sec, idle_sec = i_sec
   WHERE id = seg.id;
END;
$function$;