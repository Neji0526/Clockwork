
REVOKE ALL ON FUNCTION public.close_stale_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_session_heartbeat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_stale_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_session_heartbeat() TO service_role;
