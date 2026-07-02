
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'va');
CREATE TYPE public.profile_status AS ENUM ('active', 'invited', 'disabled');
CREATE TYPE public.session_status AS ENUM ('active', 'ended');
CREATE TYPE public.sop_status AS ENUM ('auto', 'reviewed', 'archived');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role public.app_role NOT NULL DEFAULT 'va',
  status public.profile_status NOT NULL DEFAULT 'active',
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- security-definer role check
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "profiles admin read all" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "profiles admin update all" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Auto-create profile on signup; first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _is_first BOOLEAN;
BEGIN
  SELECT NOT EXISTS(SELECT 1 FROM public.profiles) INTO _is_first;
  INSERT INTO public.profiles (user_id, display_name, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN _is_first THEN 'admin'::public.app_role ELSE 'va'::public.app_role END,
    'active'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ WORK SESSIONS ============
CREATE TABLE public.work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status public.session_status NOT NULL DEFAULT 'active',
  active_sec INT NOT NULL DEFAULT 0,
  idle_sec INT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'extension'
);
CREATE INDEX work_sessions_va_started_idx ON public.work_sessions(va_id, started_at DESC);
CREATE INDEX work_sessions_active_idx ON public.work_sessions(status) WHERE status = 'active';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_sessions TO authenticated;
GRANT ALL ON public.work_sessions TO service_role;
ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws self all" ON public.work_sessions FOR ALL TO authenticated
  USING (va_id = auth.uid()) WITH CHECK (va_id = auth.uid());
CREATE POLICY "ws admin read" ON public.work_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ ACTIVITY EVENTS ============
CREATE TABLE public.activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.work_sessions(id) ON DELETE CASCADE,
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  app TEXT,
  title TEXT,
  url TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_sec INT NOT NULL DEFAULT 0
);
CREATE INDEX activity_events_session_idx ON public.activity_events(session_id, started_at DESC);
CREATE INDEX activity_events_va_idx ON public.activity_events(va_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_events TO authenticated;
GRANT ALL ON public.activity_events TO service_role;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ae self all" ON public.activity_events FOR ALL TO authenticated
  USING (va_id = auth.uid()) WITH CHECK (va_id = auth.uid());
CREATE POLICY "ae admin read" ON public.activity_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ IDLE SEGMENTS ============
CREATE TABLE public.idle_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.work_sessions(id) ON DELETE CASCADE,
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_sec INT NOT NULL DEFAULT 0
);
CREATE INDEX idle_segments_session_idx ON public.idle_segments(session_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.idle_segments TO authenticated;
GRANT ALL ON public.idle_segments TO service_role;
ALTER TABLE public.idle_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "is self all" ON public.idle_segments FOR ALL TO authenticated
  USING (va_id = auth.uid()) WITH CHECK (va_id = auth.uid());
CREATE POLICY "is admin read" ON public.idle_segments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ SCREENSHOTS ============
CREATE TABLE public.screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.work_sessions(id) ON DELETE CASCADE,
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  storage_path TEXT NOT NULL
);
CREATE INDEX screenshots_session_idx ON public.screenshots(session_id, captured_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screenshots TO authenticated;
GRANT ALL ON public.screenshots TO service_role;
ALTER TABLE public.screenshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ss self all" ON public.screenshots FOR ALL TO authenticated
  USING (va_id = auth.uid()) WITH CHECK (va_id = auth.uid());
CREATE POLICY "ss admin read" ON public.screenshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ WORKFLOW STEPS ============
CREATE TABLE public.workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.work_sessions(id) ON DELETE CASCADE,
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  step_index INT NOT NULL DEFAULT 0,
  label TEXT,
  tag TEXT,
  url TEXT,
  rect JSONB,
  dpr REAL,
  viewport JSONB,
  screenshot_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflow_steps_session_idx ON public.workflow_steps(session_id, step_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_steps TO authenticated;
GRANT ALL ON public.workflow_steps TO service_role;
ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wfs self all" ON public.workflow_steps FOR ALL TO authenticated
  USING (va_id = auth.uid()) WITH CHECK (va_id = auth.uid());
CREATE POLICY "wfs admin read" ON public.workflow_steps FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ WORKFLOW SIGNATURES ============
CREATE TABLE public.workflow_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_sop_id UUID,
  UNIQUE (va_id, signature)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_signatures TO authenticated;
GRANT ALL ON public.workflow_signatures TO service_role;
ALTER TABLE public.workflow_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sig self all" ON public.workflow_signatures FOR ALL TO authenticated
  USING (va_id = auth.uid()) WITH CHECK (va_id = auth.uid());
CREATE POLICY "sig admin read" ON public.workflow_signatures FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ SOPS ============
CREATE TABLE public.sops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'auto',
  generated_from_signature TEXT,
  generated_for_va UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  status public.sop_status NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sops_status_idx ON public.sops(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sops TO authenticated;
GRANT ALL ON public.sops TO service_role;
ALTER TABLE public.sops ENABLE ROW LEVEL SECURITY;
-- VAs read all SOPs; admins read/write all
CREATE POLICY "sops read all auth" ON public.sops FOR SELECT TO authenticated USING (true);
CREATE POLICY "sops admin write" ON public.sops FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER sops_touch BEFORE UPDATE ON public.sops FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ CONSENT RECORDS ============
CREATE TABLE public.consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_records TO authenticated;
GRANT ALL ON public.consent_records TO service_role;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cr self all" ON public.consent_records FOR ALL TO authenticated
  USING (va_id = auth.uid()) WITH CHECK (va_id = auth.uid());
CREATE POLICY "cr admin read" ON public.consent_records FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
