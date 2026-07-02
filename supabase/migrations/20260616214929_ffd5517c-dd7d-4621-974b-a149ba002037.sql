
CREATE TABLE IF NOT EXISTS public.productivity_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text NOT NULL,
  rating text NOT NULL CHECK (rating IN ('productive','unproductive','neutral')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS productivity_rules_pattern_lower_idx
  ON public.productivity_rules (lower(pattern));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.productivity_rules TO authenticated;
GRANT ALL ON public.productivity_rules TO service_role;

ALTER TABLE public.productivity_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed-in can read rules"
ON public.productivity_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage rules"
ON public.productivity_rules FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.productivity_rules (pattern, rating) VALUES
  ('docs.google.com','productive'),
  ('sheets.google.com','productive'),
  ('notion.so','productive'),
  ('*.atlassian.net','productive'),
  ('github.com','productive'),
  ('mail.google.com','productive'),
  ('youtube.com','unproductive'),
  ('facebook.com','unproductive'),
  ('instagram.com','unproductive'),
  ('reddit.com','unproductive'),
  ('x.com','unproductive'),
  ('tiktok.com','unproductive'),
  ('netflix.com','unproductive')
ON CONFLICT DO NOTHING;
