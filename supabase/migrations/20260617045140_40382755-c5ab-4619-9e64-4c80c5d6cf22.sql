
-- 1) Lock down SECURITY DEFINER (and other) functions from anon/public
-- Trigger functions don't need user EXECUTE; admin/RPC functions are called via service role.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_session_heartbeat() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.flag_sop_needs_review() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_stale_sessions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_clients_with_billing() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_billing_config() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

-- has_role is used in RLS policies for authenticated users; keep that access.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
-- Admin RPCs invoked by authenticated admins via the Data API:
GRANT EXECUTE ON FUNCTION public.admin_list_clients_with_billing() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_billing_config() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated, service_role;

-- 2) Column-level revoke so VAs cannot UPDATE pay/role/status even if RLS allowed it.
-- The guard_profile_privileged_fields trigger already blocks these, but defense-in-depth.
REVOKE UPDATE (role, status, pay_rate_cents, pay_currency) ON public.profiles FROM authenticated, anon;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
GRANT UPDATE ON public.profiles TO service_role;
