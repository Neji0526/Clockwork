
-- 1. Restrict SOPs SELECT
DROP POLICY IF EXISTS "sops read all auth" ON public.sops;
CREATE POLICY "sops read own or admin" ON public.sops
  FOR SELECT TO authenticated
  USING (generated_for_va = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 2. Storage policies for va-screenshots: owner or admin can update/delete
CREATE POLICY "va-screenshots self update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'va-screenshots' AND ((auth.uid())::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')))
  WITH CHECK (bucket_id = 'va-screenshots' AND ((auth.uid())::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "va-screenshots self delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'va-screenshots' AND ((auth.uid())::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));

-- 3. admin_actions audit log
CREATE TABLE public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid,
  target_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_created_at_idx ON public.admin_actions (created_at DESC);
CREATE INDEX admin_actions_actor_idx ON public.admin_actions (actor_id);

GRANT SELECT ON public.admin_actions TO authenticated;
GRANT ALL ON public.admin_actions TO service_role;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_actions admin read" ON public.admin_actions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- No INSERT/UPDATE/DELETE policy: writes only via service_role from edge functions.

-- 4. rate_limits table (backend-only)
CREATE TABLE public.rate_limits (
  key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_started_at)
);
CREATE INDEX rate_limits_window_idx ON public.rate_limits (window_started_at);
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS; nobody else can touch it.
