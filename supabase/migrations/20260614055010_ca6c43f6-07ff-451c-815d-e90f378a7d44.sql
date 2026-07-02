CREATE TABLE public.break_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.work_sessions(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_sec integer NOT NULL DEFAULT 0,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX break_segments_va_started_idx ON public.break_segments (va_id, started_at DESC);
CREATE UNIQUE INDEX break_segments_one_open_per_va ON public.break_segments (va_id) WHERE ended_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_segments TO authenticated;
GRANT ALL ON public.break_segments TO service_role;

ALTER TABLE public.break_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "breaks self all" ON public.break_segments
  FOR ALL TO authenticated
  USING (va_id = auth.uid())
  WITH CHECK (va_id = auth.uid());

CREATE POLICY "breaks admin read" ON public.break_segments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));