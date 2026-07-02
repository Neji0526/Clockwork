DROP POLICY IF EXISTS "profiles self update" ON public.profiles;

CREATE POLICY "profiles self update"
  ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        role           IS NOT DISTINCT FROM (SELECT p.role           FROM public.profiles p WHERE p.user_id = auth.uid())
        AND status         IS NOT DISTINCT FROM (SELECT p.status         FROM public.profiles p WHERE p.user_id = auth.uid())
        AND pay_rate_cents IS NOT DISTINCT FROM (SELECT p.pay_rate_cents FROM public.profiles p WHERE p.user_id = auth.uid())
        AND pay_currency   IS NOT DISTINCT FROM (SELECT p.pay_currency   FROM public.profiles p WHERE p.user_id = auth.uid())
      )
    )
  );