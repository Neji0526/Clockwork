CREATE TABLE public.timesheet_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  total_active_sec integer NOT NULL DEFAULT 0,
  total_idle_sec integer NOT NULL DEFAULT 0,
  notes text,
  approved_by uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (va_id, week_start)
);
CREATE INDEX timesheet_approvals_va_week_idx ON public.timesheet_approvals (va_id, week_start DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheet_approvals TO authenticated;
GRANT ALL ON public.timesheet_approvals TO service_role;

ALTER TABLE public.timesheet_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approvals admin all" ON public.timesheet_approvals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "approvals va read own" ON public.timesheet_approvals
  FOR SELECT TO authenticated
  USING (va_id = auth.uid());