
CREATE OR REPLACE FUNCTION public._test_bridge_scenarios()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_va uuid;
  ws_a uuid; ws_b uuid; ws_c uuid;
  r_a record; r_b record; r_c record;
  ab_a record; ab_b record; ab_c record;
  msg text;
BEGIN
  SELECT user_id INTO v_va FROM public.profiles WHERE role='va' LIMIT 1;

  -- ===== A: no interaction, 30-min segment, propose now =====
  INSERT INTO public.work_sessions (va_id, status, source, platform, started_at, last_activity_at)
  VALUES (v_va, 'active', 'extension', 'chrome', now() - interval '30 minutes', now() - interval '30 minutes')
  RETURNING id INTO ws_a;
  UPDATE public.session_segments SET started_at = now() - interval '30 minutes'
   WHERE session_id = ws_a AND ended_at IS NULL;
  PERFORM public.bridge_session_idle_and_close(ws_a, now());
  SELECT active_sec, idle_sec,
         EXTRACT(EPOCH FROM (ended_at - started_at))::int AS wall
    INTO r_a FROM public.session_segments WHERE session_id = ws_a;
  SELECT (metadata->>'bridge_sec')::int AS bridge_sec,
         (metadata->>'had_interaction')::boolean AS had_int
    INTO ab_a FROM public.admin_actions
    WHERE metadata->>'session_id' = ws_a::text AND action='session_idle_bridged';

  -- ===== B: 3-min idle, under 10-min timeout =====
  INSERT INTO public.work_sessions (va_id, status, source, platform, started_at, last_activity_at)
  VALUES (v_va, 'active', 'extension', 'chrome', now() - interval '5 minutes', now())
  RETURNING id INTO ws_b;
  UPDATE public.session_segments SET started_at = now() - interval '5 minutes'
   WHERE session_id = ws_b AND ended_at IS NULL;
  INSERT INTO public.engagement_samples (va_id, session_id, sampled_at, window_sec, interacted, click_count, key_count, scroll_count, source, platform)
  VALUES (v_va, ws_b, now() - interval '3 minutes', 60, true, 5, 5, 0, 'extension', 'chrome');
  INSERT INTO public.activity_events (session_id, va_id, app, url, started_at, duration_sec, source, platform)
  VALUES (ws_b, v_va, 'chrome', 'https://x', now() - interval '5 minutes', 120, 'extension', 'chrome');
  PERFORM public.bridge_session_idle_and_close(ws_b, now());
  SELECT active_sec, idle_sec,
         EXTRACT(EPOCH FROM (ended_at - started_at))::int AS wall
    INTO r_b FROM public.session_segments WHERE session_id = ws_b;
  SELECT (metadata->>'bridge_sec')::int AS bridge_sec,
         (metadata->>'had_interaction')::boolean AS had_int
    INTO ab_b FROM public.admin_actions
    WHERE metadata->>'session_id' = ws_b::text AND action='session_idle_bridged';

  -- ===== C: long gap caps at LRS + 10min =====
  INSERT INTO public.work_sessions (va_id, status, source, platform, started_at, last_activity_at)
  VALUES (v_va, 'active', 'extension', 'chrome', now() - interval '60 minutes', now())
  RETURNING id INTO ws_c;
  UPDATE public.session_segments SET started_at = now() - interval '60 minutes'
   WHERE session_id = ws_c AND ended_at IS NULL;
  INSERT INTO public.engagement_samples (va_id, session_id, sampled_at, window_sec, interacted, click_count, key_count, scroll_count, source, platform)
  VALUES (v_va, ws_c, now() - interval '59 minutes', 60, true, 1, 0, 0, 'extension', 'chrome');
  PERFORM public.bridge_session_idle_and_close(ws_c, now());
  SELECT active_sec, idle_sec,
         EXTRACT(EPOCH FROM (ended_at - started_at))::int AS wall
    INTO r_c FROM public.session_segments WHERE session_id = ws_c;
  SELECT (metadata->>'bridge_sec')::int AS bridge_sec,
         (metadata->>'had_interaction')::boolean AS had_int
    INTO ab_c FROM public.admin_actions
    WHERE metadata->>'session_id' = ws_c::text AND action='session_idle_bridged';

  msg := format(
    E'\nTEST A (no interaction, 30min):\n  active=%s idle=%s wall=%s | bridge_sec=%s had_int=%s\n'
    'TEST B (3-min idle under timeout):\n  active=%s idle=%s wall=%s | bridge_sec=%s had_int=%s\n'
    'TEST C (long gap, timeout cap):\n  active=%s idle=%s wall=%s | bridge_sec=%s had_int=%s',
    r_a.active_sec, r_a.idle_sec, r_a.wall, ab_a.bridge_sec, ab_a.had_int,
    r_b.active_sec, r_b.idle_sec, r_b.wall, ab_b.bridge_sec, ab_b.had_int,
    r_c.active_sec, r_c.idle_sec, r_c.wall, ab_c.bridge_sec, ab_c.had_int
  );

  -- Rollback everything by raising; the message carries all results.
  RAISE EXCEPTION 'TEST_RESULTS: %', msg;
END;
$fn$;
