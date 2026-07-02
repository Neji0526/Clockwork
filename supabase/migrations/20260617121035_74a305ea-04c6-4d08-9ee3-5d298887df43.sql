-- Phase 2: segment lifecycle RPCs.
-- Invariant: a work_session has at most one open session_segments row
-- (ended_at IS NULL) at any time. Enforced by logic and by partial index.

CREATE UNIQUE INDEX session_segments_one_open_per_session
  ON public.session_segments(session_id)
  WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- close_open_session_segment(p_session_id, p_ended_at, p_final)
-- Rollup window for child rows:
--   p_final=false -> [seg.started_at, p_ended_at)
--   p_final=true  -> [seg.started_at, +infinity)
-- Convention: every mid-session close uses p_final=false; the final close of
-- a session uses p_final=true. Under this convention, every activity_event /
-- idle_segment row belongs to exactly one segment and
-- SUM(session_segments.active_sec WHERE session_id=X) =
-- work_sessions.active_sec for X.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_open_session_segment(
  p_session_id uuid,
  p_ended_at   timestamptz,
  p_final      boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  seg   record;
  a_sec integer;
  i_sec integer;
BEGIN
  SELECT id, started_at INTO seg
    FROM public.session_segments
   WHERE session_id = p_session_id AND ended_at IS NULL
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_ended_at < seg.started_at THEN
    p_ended_at := seg.started_at;
  END IF;

  IF p_final THEN
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO a_sec
      FROM public.activity_events
     WHERE session_id = p_session_id AND started_at >= seg.started_at;
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO i_sec
      FROM public.idle_segments
     WHERE session_id = p_session_id AND started_at >= seg.started_at;
  ELSE
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
  END IF;

  UPDATE public.session_segments
     SET ended_at = p_ended_at, active_sec = a_sec, idle_sec = i_sec
   WHERE id = seg.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_open_session_segment(uuid, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.close_open_session_segment(uuid, timestamptz, boolean)
  TO service_role;

-- ---------------------------------------------------------------------------
-- open_session_segment: VA-callable. Mid-session close (p_final=false), then
-- insert with one-shot retry on unique_violation so a race never wedges the
-- extension's ingest loop.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_session_segment(
  p_session_id uuid,
  p_kind       text,
  p_client_id  uuid,
  p_project_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  ws_va     uuid;
  ws_status text;
  new_id    uuid;
BEGIN
  IF p_kind NOT IN ('work','break') THEN
    RAISE EXCEPTION 'invalid_kind: %', p_kind;
  END IF;

  SELECT va_id, status::text INTO ws_va, ws_status
    FROM public.work_sessions WHERE id = p_session_id FOR UPDATE;
  IF ws_va IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF auth.uid() IS NOT NULL AND ws_va <> auth.uid() THEN
    RAISE EXCEPTION 'not_session_owner';
  END IF;
  IF ws_status <> 'active' THEN
    RAISE EXCEPTION 'session_not_active: %', ws_status;
  END IF;

  PERFORM public.close_open_session_segment(p_session_id, now(), false);

  BEGIN
    INSERT INTO public.session_segments
      (session_id, va_id, kind, client_id, project_id, started_at)
    VALUES (p_session_id, ws_va, p_kind, p_client_id, p_project_id, now())
    RETURNING id INTO new_id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM public.close_open_session_segment(p_session_id, now(), false);
    INSERT INTO public.session_segments
      (session_id, va_id, kind, client_id, project_id, started_at)
    VALUES (p_session_id, ws_va, p_kind, p_client_id, p_project_id, now())
    RETURNING id INTO new_id;
  END;

  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.open_session_segment(uuid, text, uuid, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.open_session_segment(uuid, text, uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- switch_session_client: tag-and-go wrapper around open_session_segment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.switch_session_client(
  p_session_id uuid, p_client_id uuid, p_project_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN public.open_session_segment(p_session_id, 'work', p_client_id, p_project_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.switch_session_client(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.switch_session_client(uuid, uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- start_break: close stale opens, insert break_segments, close current
-- session_segment (mid-session), open kind='break' session_segment.
-- DESIGN NOTE: break flow keys off va_id and assumes one active work_session
-- per VA. If we ever support concurrent sessions per VA, this needs revisiting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_break(
  p_session_id uuid, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  ws_va    uuid;
  break_id uuid;
BEGIN
  SELECT va_id INTO ws_va FROM public.work_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF ws_va IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF auth.uid() IS NOT NULL AND ws_va <> auth.uid() THEN
    RAISE EXCEPTION 'not_session_owner';
  END IF;

  UPDATE public.break_segments SET ended_at = now()
   WHERE va_id = ws_va AND ended_at IS NULL;

  INSERT INTO public.break_segments (va_id, session_id, started_at, reason)
  VALUES (ws_va, p_session_id, now(), p_reason)
  RETURNING id INTO break_id;

  PERFORM public.close_open_session_segment(p_session_id, now(), false);

  BEGIN
    INSERT INTO public.session_segments (session_id, va_id, kind, started_at)
    VALUES (p_session_id, ws_va, 'break', now());
  EXCEPTION WHEN unique_violation THEN
    PERFORM public.close_open_session_segment(p_session_id, now(), false);
    INSERT INTO public.session_segments (session_id, va_id, kind, started_at)
    VALUES (p_session_id, ws_va, 'break', now());
  END;

  RETURN break_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_break(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.start_break(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- end_break(p_va_id): derives session_id from the open break row server-side;
-- closes break_segments and the kind='break' session_segment as FINAL (no
-- segment is open until Phase 3 resume).
-- DESIGN NOTE: break flow keys off va_id and assumes one active work_session
-- per VA. The extension's break_end payload carries no session_id, by design.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_break(
  p_va_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  b        record;
  ended_at timestamptz := now();
  dur      integer;
BEGIN
  IF auth.uid() IS NOT NULL AND p_va_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_break_owner';
  END IF;

  SELECT id, session_id, started_at INTO b
    FROM public.break_segments
   WHERE va_id = p_va_id AND ended_at IS NULL
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  dur := GREATEST(0, EXTRACT(EPOCH FROM (ended_at - b.started_at))::int);

  UPDATE public.break_segments
     SET ended_at = ended_at, duration_sec = dur
   WHERE id = b.id;

  PERFORM public.close_open_session_segment(b.session_id, ended_at, true);

  RETURN dur;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.end_break(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.end_break(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- close_stale_sessions: both branches close the open session_segment as FINAL
-- with the same ended_at stamped on work_sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_stale_sessions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  timeout_min  integer;
  max_break    integer;
  cutoff       timestamptz;
  closed_count integer := 0;
  rec          record;
  a_sec        integer;
  i_sec        integer;
  break_end    timestamptz;
BEGIN
  SELECT session_timeout_minutes, max_break_sec
    INTO timeout_min, max_break FROM public.app_config WHERE id = 1;
  timeout_min := COALESCE(timeout_min, 10);
  max_break   := COALESCE(max_break, 3600);
  cutoff      := now() - make_interval(mins => timeout_min);

  FOR rec IN
    SELECT ws.id, ws.va_id, ws.started_at, ws.last_activity_at
    FROM public.work_sessions ws
    WHERE ws.status = 'active'
      AND ws.last_activity_at < cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.break_segments b
        WHERE b.session_id = ws.id AND b.ended_at IS NULL)
  LOOP
    PERFORM public.close_open_session_segment(rec.id, rec.last_activity_at, true);

    SELECT COALESCE(SUM(duration_sec), 0)::int INTO a_sec
      FROM public.activity_events WHERE session_id = rec.id;
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO i_sec
      FROM public.idle_segments  WHERE session_id = rec.id;

    UPDATE public.work_sessions
       SET status='abandoned', ended_at=rec.last_activity_at,
           active_sec=a_sec, idle_sec=i_sec
     WHERE id = rec.id;

    INSERT INTO public.admin_actions (actor_id, action, metadata)
    VALUES (NULL, 'session_stale_closed', jsonb_build_object(
      'session_id', rec.id, 'va_id', rec.va_id,
      'ended_at', rec.last_activity_at, 'timeout_minutes', timeout_min));

    closed_count := closed_count + 1;
  END LOOP;

  FOR rec IN
    SELECT ws.id, ws.va_id, b.started_at AS break_started
    FROM public.work_sessions ws
    JOIN public.break_segments b ON b.session_id = ws.id
    WHERE ws.status = 'active' AND b.ended_at IS NULL
      AND b.started_at < now() - make_interval(secs => max_break)
  LOOP
    break_end := rec.break_started + make_interval(secs => max_break);

    UPDATE public.break_segments
       SET ended_at = break_end, duration_sec = max_break
     WHERE session_id = rec.id AND ended_at IS NULL;

    PERFORM public.close_open_session_segment(rec.id, break_end, true);

    SELECT COALESCE(SUM(duration_sec), 0)::int INTO a_sec
      FROM public.activity_events WHERE session_id = rec.id;
    SELECT COALESCE(SUM(duration_sec), 0)::int INTO i_sec
      FROM public.idle_segments  WHERE session_id = rec.id;

    UPDATE public.work_sessions
       SET status='abandoned', ended_at=break_end,
           active_sec=a_sec, idle_sec=i_sec
     WHERE id = rec.id;

    INSERT INTO public.admin_actions (actor_id, action, metadata)
    VALUES (NULL, 'session_break_capped', jsonb_build_object(
      'session_id', rec.id, 'va_id', rec.va_id,
      'break_started_at', rec.break_started,
      'ended_at', break_end, 'max_break_sec', max_break));

    closed_count := closed_count + 1;
  END LOOP;

  RETURN closed_count;
END;
$$;