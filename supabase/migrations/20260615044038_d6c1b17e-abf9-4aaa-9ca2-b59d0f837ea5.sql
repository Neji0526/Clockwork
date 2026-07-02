
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update"
ON public.profiles
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND role = (SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid())
  AND status = (SELECT p.status FROM public.profiles p WHERE p.user_id = auth.uid())
  AND pay_rate_cents = (SELECT p.pay_rate_cents FROM public.profiles p WHERE p.user_id = auth.uid())
  AND pay_currency = (SELECT p.pay_currency FROM public.profiles p WHERE p.user_id = auth.uid())
);

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.flag_sop_needs_review() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "internal_secrets no client access" ON public.internal_secrets;
CREATE POLICY "internal_secrets no client access"
ON public.internal_secrets
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "rate_limits no client access" ON public.rate_limits;
CREATE POLICY "rate_limits no client access"
ON public.rate_limits
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
