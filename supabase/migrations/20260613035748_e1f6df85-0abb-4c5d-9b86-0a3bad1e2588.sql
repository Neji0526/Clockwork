
CREATE TABLE public.app_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  screenshot_retention_days int NOT NULL DEFAULT 30 CHECK (screenshot_retention_days >= 1 AND screenshot_retention_days <= 3650),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.app_config TO authenticated;
GRANT ALL ON public.app_config TO service_role;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read app_config"
  ON public.app_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can update app_config"
  ON public.app_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
