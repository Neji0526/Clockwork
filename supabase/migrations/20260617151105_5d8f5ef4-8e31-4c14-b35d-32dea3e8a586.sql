-- (a) Trigger: every new work_session gets a default work segment with no client.
-- The existing switch_session_client / start_break / end_break paths already
-- close the open segment before opening the next one, so the one-open-segment
-- invariant per session is preserved automatically.
CREATE OR REPLACE FUNCTION public.tg_open_default_work_segment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only seed for active sessions. Sessions created already-closed (rare:
  -- agent-ingest backfills) don't need a live segment.
  IF NEW.status = 'active' THEN
    PERFORM public.open_session_segment(NEW.id, 'work', NULL, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS open_default_work_segment ON public.work_sessions;
CREATE TRIGGER open_default_work_segment
AFTER INSERT ON public.work_sessions
FOR EACH ROW
EXECUTE FUNCTION public.tg_open_default_work_segment();

-- (b) Backfill: every session with zero segments gets one work segment
-- mirroring its totals. Preserves SUM(active_sec) and SUM(idle_sec) exactly;
-- cross-midnight pro-ration is handled by the reporting RPC at read time.
INSERT INTO public.session_segments
  (session_id, va_id, kind, client_id, project_id,
   started_at, ended_at, active_sec, idle_sec)
SELECT
  ws.id, ws.va_id, 'work', NULL, NULL,
  ws.started_at,
  COALESCE(ws.ended_at, now()),
  COALESCE(ws.active_sec, 0),
  COALESCE(ws.idle_sec, 0)
FROM public.work_sessions ws
WHERE NOT EXISTS (
  SELECT 1 FROM public.session_segments ss WHERE ss.session_id = ws.id
);