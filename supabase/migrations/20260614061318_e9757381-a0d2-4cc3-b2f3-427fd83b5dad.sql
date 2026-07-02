
-- 1) app_config: configurable idle threshold + max break warning
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS idle_threshold_sec INTEGER NOT NULL DEFAULT 300 CHECK (idle_threshold_sec BETWEEN 60 AND 3600),
  ADD COLUMN IF NOT EXISTS max_break_sec INTEGER NOT NULL DEFAULT 3600 CHECK (max_break_sec BETWEEN 300 AND 14400);

-- 2) profiles: pay rate
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pay_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (pay_rate_cents >= 0),
  ADD COLUMN IF NOT EXISTS pay_currency TEXT NOT NULL DEFAULT 'USD';

-- 3) Projects (under a client)
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_client_idx ON public.projects(client_id) WHERE archived = false;
GRANT SELECT ON public.projects TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "projects read" ON public.projects;
CREATE POLICY "projects read" ON public.projects FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "projects admin write" ON public.projects;
CREATE POLICY "projects admin write" ON public.projects FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) work_sessions: project_id
ALTER TABLE public.work_sessions
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS work_sessions_project_idx ON public.work_sessions(project_id);

-- 5) SOP versions (snapshots before edits)
CREATE TABLE IF NOT EXISTS public.sop_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id UUID NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  steps JSONB NOT NULL,
  edited_by UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sop_id, version)
);
CREATE INDEX IF NOT EXISTS sop_versions_sop_idx ON public.sop_versions(sop_id, version DESC);
GRANT SELECT, INSERT ON public.sop_versions TO authenticated;
GRANT ALL ON public.sop_versions TO service_role;
ALTER TABLE public.sop_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sop_versions admin" ON public.sop_versions;
CREATE POLICY "sop_versions admin" ON public.sop_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "sop_versions read own sop" ON public.sop_versions;
CREATE POLICY "sop_versions read own sop" ON public.sop_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sops s WHERE s.id = sop_id AND (s.generated_for_va = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- 6) SOP completions (training tracking)
CREATE TABLE IF NOT EXISTS public.sop_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id UUID NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signature_name TEXT,
  UNIQUE (sop_id, user_id)
);
CREATE INDEX IF NOT EXISTS sop_completions_sop_idx ON public.sop_completions(sop_id);
CREATE INDEX IF NOT EXISTS sop_completions_user_idx ON public.sop_completions(user_id);
GRANT SELECT, INSERT, DELETE ON public.sop_completions TO authenticated;
GRANT ALL ON public.sop_completions TO service_role;
ALTER TABLE public.sop_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sop_completions self" ON public.sop_completions;
CREATE POLICY "sop_completions self" ON public.sop_completions FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- 7) SOP share tokens (public links)
CREATE TABLE IF NOT EXISTS public.sop_share_tokens (
  token TEXT PRIMARY KEY,
  sop_id UUID NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sop_share_tokens_sop_idx ON public.sop_share_tokens(sop_id);
GRANT SELECT ON public.sop_share_tokens TO authenticated;
GRANT ALL ON public.sop_share_tokens TO service_role;
ALTER TABLE public.sop_share_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "share_tokens admin" ON public.sop_share_tokens;
CREATE POLICY "share_tokens admin" ON public.sop_share_tokens FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
