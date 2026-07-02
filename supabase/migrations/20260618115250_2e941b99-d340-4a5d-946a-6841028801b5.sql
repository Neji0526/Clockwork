CREATE OR REPLACE FUNCTION public.close_open_session_segment(p_session_id uuid, p_ended_at timestamp with time zone, p_final boolean DEFAULT false)
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

  -- HARD INVARIANT: active_sec + idle_sec <= wall_sec.
  -- Clamp idle to wall first, then clamp active to whatever wall budget remains.
  -- Even with garbage duration_sec inputs (duplicated rows, suspended-worker
  -- gaps inflating a single event), totals can never exceed wall time.
  wall_sec := GREATEST(0, EXTRACT(EPOCH FROM (p_ended_at - seg.started_at))::int);
  i_sec    := LEAST(i_sec, wall_sec);
  a_sec    := LEAST(a_sec, GREATEST(0, wall_sec - i_sec));

  UPDATE public.session_segments
     SET ended_at = p_ended_at, active_sec = a_sec, idle_sec = i_sec
   WHERE id = seg.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.report_segment_day_slices(p_from date, p_to date, p_va_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(segment_id uuid, session_id uuid, va_id uuid, kind text, client_id uuid, project_id uuid, local_day date, slice_start timestamp with time zone, slice_end timestamp with time zone, active_sec integer, idle_sec integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  tz constant text := 'America/New_York';
  win_start timestamptz := (p_from::timestamp AT TIME ZONE tz);
  win_end   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE tz);
  is_admin  boolean := public.has_role(auth.uid(), 'admin');
BEGIN
  IF NOT is_admin THEN
    IF auth.uid() IS NULL OR p_va_id IS NULL OR p_va_id <> auth.uid() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  RETURN QUERY
  WITH segs_raw AS (
    SELECT s.id, s.session_id, s.va_id, s.kind, s.client_id, s.project_id,
           s.started_at AS s_start,
           COALESCE(s.ended_at, now()) AS s_end,
           CASE WHEN s.ended_at IS NULL THEN
             COALESCE((SELECT SUM(duration_sec)::int FROM public.activity_events ae
                       WHERE ae.session_id = s.session_id AND ae.started_at >= s.started_at), 0)
           ELSE s.active_sec END AS raw_active,
           CASE WHEN s.ended_at IS NULL THEN
             COALESCE((SELECT SUM(duration_sec)::int FROM public.idle_segments isg
                       WHERE isg.session_id = s.session_id AND isg.started_at >= s.started_at), 0)
           ELSE s.idle_sec END AS raw_idle,
           (s.ended_at IS NULL) AS is_open
    FROM public.session_segments s
    WHERE s.started_at < win_end
      AND COALESCE(s.ended_at, now()) > win_start
      AND (p_va_id IS NULL OR s.va_id = p_va_id)
  ),
  segs AS (
    -- Same hard invariant as close_open_session_segment: for OPEN segments,
    -- clamp recomputed active+idle so they can't exceed wall time.
    -- Closed segments already have clamped values baked in; pass through.
    SELECT id, session_id, va_id, kind, client_id, project_id, s_start, s_end,
           CASE WHEN is_open THEN
             LEAST(raw_active,
                   GREATEST(0,
                     GREATEST(0, EXTRACT(EPOCH FROM (s_end - s_start))::int)
                     - LEAST(raw_idle, GREATEST(0, EXTRACT(EPOCH FROM (s_end - s_start))::int))))
           ELSE raw_active END AS s_active,
           CASE WHEN is_open THEN
             LEAST(raw_idle, GREATEST(0, EXTRACT(EPOCH FROM (s_end - s_start))::int))
           ELSE raw_idle END AS s_idle
    FROM segs_raw
  ),
  bounds AS (
    SELECT seg.*, gs AS day_start_local
    FROM segs seg,
    LATERAL generate_series(
      date_trunc('day', (s_start AT TIME ZONE tz)),
      date_trunc('day', (s_end   AT TIME ZONE tz)),
      interval '1 day'
    ) gs
  ),
  slices AS (
    SELECT id AS segment_id, session_id, va_id, kind, client_id, project_id,
           s_start, s_end, s_active, s_idle,
           (day_start_local)::date AS local_day,
           GREATEST(s_start, (day_start_local                      AT TIME ZONE tz)) AS slice_start,
           LEAST   (s_end,   ((day_start_local + interval '1 day') AT TIME ZONE tz)) AS slice_end
    FROM bounds
  ),
  with_durs AS (
    SELECT *,
      GREATEST(0, EXTRACT(EPOCH FROM (slice_end - slice_start)))::numeric AS wall_sec,
      GREATEST(1, EXTRACT(EPOCH FROM (s_end     - s_start    )))::numeric AS total_wall_sec,
      ROW_NUMBER() OVER (PARTITION BY segment_id ORDER BY slice_start) AS rn,
      COUNT(*)    OVER (PARTITION BY segment_id)                       AS rc
    FROM slices WHERE slice_end > slice_start
  ),
  prorated AS (
    SELECT segment_id, session_id, va_id, kind, client_id, project_id,
           local_day, slice_start, slice_end,
           (CASE WHEN rn < rc
             THEN FLOOR(s_active * wall_sec / total_wall_sec)::int
             ELSE s_active - COALESCE(SUM(FLOOR(s_active * wall_sec / total_wall_sec)::int)
                    FILTER (WHERE rn < rc) OVER (PARTITION BY segment_id), 0)
           END)::int AS a_sec,
           (CASE WHEN rn < rc
             THEN FLOOR(s_idle * wall_sec / total_wall_sec)::int
             ELSE s_idle - COALESCE(SUM(FLOOR(s_idle * wall_sec / total_wall_sec)::int)
                    FILTER (WHERE rn < rc) OVER (PARTITION BY segment_id), 0)
           END)::int AS i_sec
    FROM with_durs
  )
  SELECT segment_id, session_id, va_id, kind, client_id, project_id,
         local_day, slice_start, slice_end, a_sec, i_sec
  FROM prorated
  WHERE local_day BETWEEN p_from AND p_to;
END;
$function$;