CREATE TABLE public.client_share_tokens (
  token       text PRIMARY KEY,
  va_id       uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  label       text,
  created_by  uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  revoked_at  timestamptz
);
CREATE INDEX client_share_tokens_va_idx ON public.client_share_tokens(va_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_share_tokens TO authenticated;
GRANT ALL ON public.client_share_tokens TO service_role;
ALTER TABLE public.client_share_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_share_tokens admin"
  ON public.client_share_tokens FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));