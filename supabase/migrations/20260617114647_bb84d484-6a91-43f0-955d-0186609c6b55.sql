CREATE OR REPLACE FUNCTION public.close_stale_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  timeout_min   integer;
  max_break     integer;
  cutoff        timestamptz;
  closed_count  integer := 0;
  rec           record;
  a_sec         integer;
  i_sec         integer;
  break_end     timestamptz;
BEGIN
  SELECT session_timeout_minutes, max_break_sec
    INTO timeout_min, max_break
    FROM public.app_config WHERE id = 1;
  timeout_min := COALESCE(timeout_min, 10);
  max_break   := COALESCE(max_break, 3600);
  cutoff      := now() - make_interval(mins => timeout_min);

  -- Branch A: activity-timeout sweep, excluding sessions on an open break.
  FOR rec IN
    SELECT ws.id, ws.va_id, ws.started_at, ws.last_activity_at
    FROM public.work_sessions ws
    WHERE ws.status = 'active'
      AND ws.last_activity_at < cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.break_segments b
        WHERE b.session_id = ws.id AND b.ended_at IS NULL
      )
  LOOP
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO a_sec
      FROM public.activity_events WHERE session_id = rec.id;
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO i_sec
      FROM public.idle_segments  WHERE session_id = rec.id;

    UPDATE public.work_sessions
       SET status     = 'abandoned',
           ended_at   = rec.last_activity_at,
           active_sec = a_sec,
           idle_sec   = i_sec
     WHERE id = rec.id;

    INSERT INTO public.admin_actions (actor_id, action, metadata)
    VALUES (
      NULL,
      'session_stale_closed',
      jsonb_build_object(
        'session_id', rec.id,
        'va_id', rec.va_id,
        'ended_at', rec.last_activity_at,
        'timeout_minutes', timeout_min
      )
    );

    closed_count := closed_count + 1;
  END LOOP;

  -- Branch B: break cap. Any active session with an open break older than
  -- max_break_sec is closed; the break row is stamped at start + max_break_sec.
  FOR rec IN
    SELECT ws.id, ws.va_id, b.started_at AS break_started
    FROM public.work_sessions ws
    JOIN public.break_segments b ON b.session_id = ws.id
    WHERE ws.status   = 'active'
      AND b.ended_at IS NULL
      AND b.started_at < now() - make_interval(secs => max_break)
  LOOP
    break_end := rec.break_started + make_interval(secs => max_break);

    UPDATE public.break_segments
       SET ended_at     = break_end,
           duration_sec = max_break
     WHERE session_id = rec.id AND ended_at IS NULL;

    SELECT COALESCE(SUM(duration_sec), 0)::int INTO a_sec
      FROM public.activity_events WHERE session_id = rec.id;
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO i_sec
      FROM public.idle_segments  WHERE session_id = rec.id;

    UPDATE public.work_sessions
       SET status     = 'abandoned',
           ended_at   = break_end,
           active_sec = a_sec,
           idle_sec   = i_sec
     WHERE id = rec.id;

    INSERT INTO public.admin_actions (actor_id, action, metadata)
    VALUES (
      NULL,
      'session_break_capped',
      jsonb_build_object(
        'session_id', rec.id,
        'va_id', rec.va_id,
        'break_started_at', rec.break_started,
        'ended_at', break_end,
        'max_break_sec', max_break
      )
    );

    closed_count := closed_count + 1;
  END LOOP;

  RETURN closed_count;
END;
$$;