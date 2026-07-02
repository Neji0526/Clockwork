CREATE TABLE public.session_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.work_sessions(id) ON DELETE CASCADE,
  command text NOT NULL CHECK (command IN ('clock_out','break_start','break_end')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','expired')),
  issued_by uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '120 seconds')
);

CREATE INDEX session_commands_va_status_idx ON public.session_commands(va_id, status);

GRANT SELECT, INSERT, UPDATE ON public.session_commands TO authenticated;
GRANT ALL ON public.session_commands TO service_role;

ALTER TABLE public.session_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sesscmd va insert"
  ON public.session_commands FOR INSERT
  TO authenticated
  WITH CHECK (va_id = auth.uid() AND issued_by = auth.uid());

CREATE POLICY "sesscmd admin insert"
  ON public.session_commands FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND issued_by = auth.uid());

CREATE POLICY "sesscmd read"
  ON public.session_commands FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR va_id = auth.uid());

CREATE POLICY "sesscmd va update"
  ON public.session_commands FOR UPDATE
  TO authenticated
  USING (va_id = auth.uid())
  WITH CHECK (va_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.session_commands;
ALTER TABLE public.session_commands REPLICA IDENTITY FULL;