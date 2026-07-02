-- Phase 1: session_segments table
-- One row per continuous stint within a work session.
-- kind is 'work' or 'break'; idle is not a segment kind, it's rolled up
-- inside a work segment via idle_sec.

CREATE TABLE public.session_segments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.work_sessions(id) ON DELETE CASCADE,
  va_id        uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('work','break')),
  client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  active_sec   integer NOT NULL DEFAULT 0,
  idle_sec     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_segments_session_idx ON public.session_segments(session_id);
CREATE INDEX session_segments_va_day_idx  ON public.session_segments(va_id, started_at);
CREATE INDEX session_segments_open_idx    ON public.session_segments(session_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_segments TO authenticated;
GRANT ALL ON public.session_segments TO service_role;

ALTER TABLE public.session_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "segments self all"
  ON public.session_segments
  FOR ALL
  USING (va_id = auth.uid())
  WITH CHECK (va_id = auth.uid());

CREATE POLICY "segments admin read"
  ON public.session_segments
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));