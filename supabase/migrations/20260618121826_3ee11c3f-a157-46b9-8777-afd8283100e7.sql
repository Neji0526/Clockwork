
-- Bug C: idle bridging. Server-side authority.
-- Last Real Signal = MAX(engagement_samples.sampled_at WHERE interacted=true)
-- Bridge end = LEAST(p_proposed_ended_at, LRS + session_timeout)
-- If no LRS, fall back to segment start.

CREATE OR REPLACE FUNCTION public.bridge_session_idle_and_close(
  p_session_id uuid,
  p_proposed_ended_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  seg            record;
  v_va_id        uuid;
  v_lrs          timestamptz;
  v_timeout_min  integer;
  v_cap_end      timestamptz;
  v_effective_end timestamptz;
  v_bridge_start timestamptz;
  v_bridge_sec   integer;
  v_had_lrs      boolean;
BEGIN
  SELECT session_timeout_minutes INTO v_timeout_min FROM public.app_config WHERE id = 1;
  v_timeout_min := COALESCE(v_timeout_min, 10);

  SELECT id, started_at, va_id INTO seg
    FROM public.session_segments
   WHERE session_id = p_session_id AND ended_at IS NULL
   ORDER BY started_at DESC LIMIT 1;

  IF NOT FOUND THEN
    -- No open segment to bridge; just delegate close (no-op).
    PERFORM public.close_open_session_segment(p_session_id, p_proposed_ended_at, true);
    RETURN;
  END IF;

  v_va_id := seg.va_id;

  -- LRS: last interacted engagement sample within this segment window.
  SELECT MAX(sampled_at) INTO v_lrs
    FROM public.engagement_samples
   WHERE session_id = p_session_id
     AND interacted = true
     AND sampled_at >= seg.started_at
     AND sampled_at <= p_proposed_ended_at;

  v_had_lrs := v_lrs IS NOT NULL;
  -- Fallback: no real interaction in this segment -> bridge from segment start.
  v_bridge_start := COALESCE(v_lrs, seg.started_at);

  -- Cap the bridge end at LRS + timeout (or seg.started_at + timeout if no LRS).
  v_cap_end := v_bridge_start + make_interval(mins => v_timeout_min);
  v_effective_end := LEAST(p_proposed_ended_at, v_cap_end);
  IF v_effective_end < seg.started_at THEN
    v_effective_end := seg.started_at;
  END IF;

  v_bridge_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_effective_end - v_bridge_start))::int);

  IF v_bridge_sec > 0 THEN
    INSERT INTO public.idle_segments (session_id, va_id, started_at, duration_sec)
    VALUES (p_session_id, v_va_id, v_bridge_start, v_bridge_sec);

    INSERT INTO public.admin_actions (actor_id, action, metadata)
    VALUES (NULL, 'session_idle_bridged', jsonb_build_object(
      'session_id', p_session_id,
      'segment_id', seg.id,
      'va_id', v_va_id,
      'segment_started_at', seg.started_at,
      'last_real_signal', v_lrs,
      'had_interaction', v_had_lrs,
      'proposed_ended_at', p_proposed_ended_at,
      'effective_ended_at', v_effective_end,
      'bridge_start', v_bridge_start,
      'bridge_sec', v_bridge_sec,
      'timeout_minutes', v_timeout_min
    ));
  END IF;

  -- Now do the authoritative close. The Layer-1 clamp inside
  -- close_open_session_segment enforces active+idle <= wall.
  PERFORM public.close_open_session_segment(p_session_id, v_effective_end, true);
END;
$function$;

-- Wire close_stale_sessions through the bridge so timed-out sessions get the
-- bridging idle row. Aggregate work_sessions totals from the clamped segment.
CREATE OR REPLACE FUNCTION public.close_stale_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Bridge + close. Use last_activity_at as the proposed end; the bridge
    -- caps at LRS+timeout, so heartbeat-polluted last_activity_at can't
    -- inflate active time.
    PERFORM public.bridge_session_idle_and_close(rec.id, rec.last_activity_at);

    SELECT COALESCE(SUM(active_sec), 0)::int,
           COALESCE(SUM(idle_sec), 0)::int
      INTO a_sec, i_sec
      FROM public.session_segments WHERE session_id = rec.id;

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

    -- Break segments don't need LRS bridging (the break itself accounts for
    -- the time); regular close is correct.
    PERFORM public.close_open_session_segment(rec.id, break_end, true);

    SELECT COALESCE(SUM(active_sec), 0)::int,
           COALESCE(SUM(idle_sec), 0)::int
      INTO a_sec, i_sec
      FROM public.session_segments WHERE session_id = rec.id;

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
$function$;
