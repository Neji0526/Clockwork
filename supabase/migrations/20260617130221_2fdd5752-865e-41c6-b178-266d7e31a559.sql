CREATE TABLE public.session_orphan_telemetry (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at          timestamptz NOT NULL DEFAULT now(),
  session_id           uuid NOT NULL,
  va_id                uuid NOT NULL,
  va_name              text,
  session_status       text NOT NULL,
  session_source       text,
  session_platform     text,
  session_started_at   timestamptz NOT NULL,
  session_ended_at     timestamptz NOT NULL,
  session_wall_sec     integer NOT NULL,
  finalized_active_sec integer NOT NULL,
  events_total         integer NOT NULL,
  events_in_window     integer NOT NULL,
  events_after_end     integer NOT NULL,
  orphan_sec_after_end integer NOT NULL,
  last_event_at        timestamptz,
  orphan_lag_sec       integer
  -- TODO: add extension_version once the extension reports it.
);

GRANT SELECT ON public.session_orphan_telemetry TO authenticated;
GRANT ALL    ON public.session_orphan_telemetry TO service_role;

ALTER TABLE public.session_orphan_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orphan telemetry admin read"
  ON public.session_orphan_telemetry
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX session_orphan_telemetry_snapshot_idx
  ON public.session_orphan_telemetry (snapshot_at DESC);
CREATE INDEX session_orphan_telemetry_va_idx
  ON public.session_orphan_telemetry (va_id, snapshot_at DESC);
CREATE INDEX session_orphan_telemetry_session_idx
  ON public.session_orphan_telemetry (session_id);

CREATE OR REPLACE VIEW public.session_orphan_24h
WITH (security_invoker = true) AS
SELECT
  ws.id                                                    AS session_id,
  ws.va_id,
  p.display_name                                           AS va_name,
  ws.status::text                                          AS session_status,
  ws.source                                                AS session_source,
  ws.platform                                              AS session_platform,
  ws.started_at                                            AS session_started_at,
  ws.ended_at                                              AS session_ended_at,
  GREATEST(0, EXTRACT(EPOCH FROM (ws.ended_at - ws.started_at)))::int
                                                            AS session_wall_sec,
  ws.active_sec                                            AS finalized_active_sec,
  COUNT(ae.*)::int                                         AS events_total,
  COUNT(ae.*) FILTER (
    WHERE ae.started_at >= ws.started_at
      AND ae.started_at <= ws.ended_at
  )::int                                                   AS events_in_window,
  COUNT(ae.*) FILTER (WHERE ae.started_at > ws.ended_at)::int
                                                            AS events_after_end,
  COALESCE(SUM(ae.duration_sec) FILTER (WHERE ae.started_at > ws.ended_at), 0)::int
                                                            AS orphan_sec_after_end,
  MAX(ae.started_at)                                       AS last_event_at,
  GREATEST(0, EXTRACT(EPOCH FROM (MAX(ae.started_at) - ws.ended_at)))::int
                                                            AS orphan_lag_sec
FROM public.work_sessions ws
JOIN public.profiles      p  ON p.user_id = ws.va_id
LEFT JOIN public.activity_events ae ON ae.session_id = ws.id
WHERE ws.ended_at IS NOT NULL
  AND ws.ended_at > now() - interval '24 hours'
GROUP BY ws.id, p.display_name;

GRANT SELECT ON public.session_orphan_24h TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'session-orphan-telemetry-daily',
  '10 4 * * *',
  $cron$
  INSERT INTO public.session_orphan_telemetry (
    session_id, va_id, va_name, session_status, session_source, session_platform,
    session_started_at, session_ended_at, session_wall_sec, finalized_active_sec,
    events_total, events_in_window, events_after_end, orphan_sec_after_end,
    last_event_at, orphan_lag_sec
  )
  SELECT
    v.session_id, v.va_id, v.va_name, v.session_status, v.session_source, v.session_platform,
    v.session_started_at, v.session_ended_at, v.session_wall_sec, v.finalized_active_sec,
    v.events_total, v.events_in_window, v.events_after_end, v.orphan_sec_after_end,
    v.last_event_at, v.orphan_lag_sec
  FROM public.session_orphan_24h v
  WHERE NOT EXISTS (
    SELECT 1 FROM public.session_orphan_telemetry t
    WHERE t.session_id = v.session_id
      AND t.snapshot_at::date = (now() AT TIME ZONE 'UTC')::date
  );
  $cron$
);