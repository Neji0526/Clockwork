-- Phase 6, Item 2: scope client-share tokens to a single (VA, client) pair.
-- Closes the legacy leak where a token holder could see the VA's totals across all clients.

ALTER TABLE public.client_share_tokens
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS client_share_tokens_va_client_idx
  ON public.client_share_tokens (va_id, client_id);

-- Public, token-gated read: returns ONLY hours + sessions for (token.va_id, token.client_id).
-- Token is the sole input. va_id / client_id can never be supplied by the caller.
-- Inlines the Eastern-bucketed, pro-rated slice logic from report_segment_day_slices,
-- but hard-filtered to one (va, client) pair so cross-client data never enters the CTE.
CREATE OR REPLACE FUNCTION public.get_client_share_billable(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  tok        record;
  tz constant text := 'America/New_York';
  p_from     date;
  p_to       date;
  win_start  timestamptz;
  win_end    timestamptz;
  va_name    text;
  daily_json jsonb;
  sessions_json jsonb;
  totals_active int;
  totals_sessions int;
BEGIN
  SELECT t.token, t.va_id, t.client_id, t.label, t.expires_at, t.revoked_at
    INTO tok
    FROM public.client_share_tokens t
   WHERE t.token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF tok.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;
  IF tok.expires_at IS NOT NULL AND tok.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  -- Legacy tokens (created before client_id was required) short-circuit BEFORE
  -- touching any segment data, so a legacy token can never leak cross-client totals.
  IF tok.client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'legacy_token_reissue_required');
  END IF;

  p_to   := (now() AT TIME ZONE tz)::date;
  p_from := p_to - 29;
  win_start := (p_from::timestamp AT TIME ZONE tz);
  win_end   := ((p_to + 1)::timestamp AT TIME ZONE tz);

  SELECT display_name INTO va_name FROM public.profiles WHERE user_id = tok.va_id;

  -- Per-day active_sec for (va, client), 'work' only, Eastern-bucketed and pro-rated.
  -- Single hard filter (s.va_id = tok.va_id AND s.client_id = tok.client_id) keeps
  -- the entire CTE chain scoped to one pair.
  WITH segs AS (
    SELECT s.id, s.session_id, s.started_at AS s_start,
           COALESCE(s.ended_at, now()) AS s_end,
           CASE WHEN s.ended_at IS NULL THEN
             COALESCE((SELECT SUM(duration_sec)::int FROM public.activity_events ae
                       WHERE ae.session_id = s.session_id AND ae.started_at >= s.started_at), 0)
           ELSE s.active_sec END AS s_active
    FROM public.session_segments s
    WHERE s.kind = 'work'
      AND s.va_id = tok.va_id
      AND s.client_id = tok.client_id
      AND s.started_at < win_end
      AND COALESCE(s.ended_at, now()) > win_start
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
    SELECT id AS segment_id, session_id, s_start, s_end, s_active,
           (day_start_local)::date AS local_day,
           GREATEST(s_start, (day_start_local AT TIME ZONE tz)) AS slice_start,
           LEAST(s_end, ((day_start_local + interval '1 day') AT TIME ZONE tz)) AS slice_end
    FROM bounds
  ),
  with_durs AS (
    SELECT *,
      GREATEST(0, EXTRACT(EPOCH FROM (slice_end - slice_start)))::numeric AS wall_sec,
      GREATEST(1, EXTRACT(EPOCH FROM (s_end - s_start)))::numeric AS total_wall_sec,
      ROW_NUMBER() OVER (PARTITION BY segment_id ORDER BY slice_start) AS rn,
      COUNT(*)    OVER (PARTITION BY segment_id)                       AS rc
    FROM slices WHERE slice_end > slice_start
  ),
  prorated AS (
    SELECT segment_id, session_id, local_day, slice_start, slice_end,
           CASE WHEN rn < rc
             THEN FLOOR(s_active * wall_sec / total_wall_sec)::int
             ELSE s_active - COALESCE(SUM(FLOOR(s_active * wall_sec / total_wall_sec)::int)
                    FILTER (WHERE rn < rc) OVER (PARTITION BY segment_id), 0)
           END AS a_sec
    FROM with_durs
  ),
  in_window AS (
    SELECT * FROM prorated WHERE local_day BETWEEN p_from AND p_to
  ),
  daily_agg AS (
    SELECT local_day, SUM(a_sec)::int AS active_sec
    FROM in_window GROUP BY local_day
  ),
  day_series AS (
    SELECT gs::date AS d FROM generate_series(p_from, p_to, interval '1 day') gs
  ),
  recent AS (
    SELECT session_id,
           MIN(slice_start) AS started_at,
           MAX(slice_end)   AS ended_at,
           SUM(a_sec)::int  AS active_sec
    FROM in_window
    GROUP BY session_id
    ORDER BY MAX(slice_end) DESC
    LIMIT 10
  )
  SELECT
    COALESCE(SUM(da.active_sec), 0)::int,
    (SELECT COUNT(*)::int FROM recent),
    COALESCE(jsonb_agg(
      jsonb_build_object('date', to_char(ds.d, 'YYYY-MM-DD'),
                         'activeSec', COALESCE(da.active_sec, 0))
      ORDER BY ds.d
    ), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(
       jsonb_build_object('startedAt', r.started_at,
                          'endedAt',   r.ended_at,
                          'activeSec', r.active_sec)
       ORDER BY r.ended_at DESC) FROM recent r), '[]'::jsonb)
  INTO totals_active, totals_sessions, daily_json, sessions_json
  FROM day_series ds
  LEFT JOIN daily_agg da ON da.local_day = ds.d;

  RETURN jsonb_build_object(
    'ok', true,
    'label', tok.label,
    'vaName', COALESCE(va_name, 'Your virtual assistant'),
    'windowDays', 30,
    'totals', jsonb_build_object('activeSec', totals_active, 'sessions', totals_sessions),
    'daily', daily_json,
    'recentSessions', sessions_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_client_share_billable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_share_billable(text) TO anon, authenticated, service_role;