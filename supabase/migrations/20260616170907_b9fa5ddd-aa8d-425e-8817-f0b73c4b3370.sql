-- Admin invite tokens: shareable links that promote the redeemer to admin.
CREATE TABLE public.admin_invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1 AND max_uses <= 100),
  uses integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_invite_tokens_token_idx ON public.admin_invite_tokens (token);
CREATE INDEX admin_invite_tokens_created_by_idx ON public.admin_invite_tokens (created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_invite_tokens TO authenticated;
GRANT ALL ON public.admin_invite_tokens TO service_role;

ALTER TABLE public.admin_invite_tokens ENABLE ROW LEVEL SECURITY;

-- Only admins can read or manage invite tokens through the Data API.
-- Token redemption itself runs through a SECURITY DEFINER server fn using
-- the service role client, so unauthenticated/anon access is not needed.
CREATE POLICY "Admins can view admin invites"
  ON public.admin_invite_tokens
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create admin invites"
  ON public.admin_invite_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND created_by = auth.uid());

CREATE POLICY "Admins can update admin invites"
  ON public.admin_invite_tokens
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete admin invites"
  ON public.admin_invite_tokens
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));