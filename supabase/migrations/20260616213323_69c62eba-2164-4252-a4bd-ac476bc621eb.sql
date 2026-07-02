CREATE TABLE public.engagement_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.work_sessions(id) ON DELETE CASCADE,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_sec INT NOT NULL DEFAULT 60,
  interacted BOOLEAN NOT NULL DEFAULT false,
  click_count INT NOT NULL DEFAULT 0,
  key_count INT NOT NULL DEFAULT 0,
  scroll_count INT NOT NULL DEFAULT 0
);
CREATE INDEX engagement_samples_va_idx ON public.engagement_samples(va_id, sampled_at DESC);
CREATE INDEX engagement_samples_session_idx ON public.engagement_samples(session_id, sampled_at DESC);

GRANT SELECT, INSERT ON public.engagement_samples TO authenticated;
GRANT ALL ON public.engagement_samples TO service_role;

ALTER TABLE public.engagement_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "es self insert" ON public.engagement_samples FOR INSERT TO authenticated
  WITH CHECK (va_id = auth.uid());
CREATE POLICY "es self read" ON public.engagement_samples FOR SELECT TO authenticated
  USING (va_id = auth.uid());
CREATE POLICY "es admin read" ON public.engagement_samples FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS low_engagement_minutes INT NOT NULL DEFAULT 10;

ALTER PUBLICATION supabase_realtime ADD TABLE public.engagement_samples;