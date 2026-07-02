
-- ============================================================
-- 1) app_config: hide sensitive billing columns from non-admins
-- ============================================================
-- Strategy: keep the existing "authenticated SELECT" policy (VAs need
-- operational fields like idle_threshold_sec / max_break_sec /
-- session_timeout_minutes / low_engagement_minutes), but use column-level
-- privileges to make billing_* columns admin-only. Admins read the
-- sensitive columns through the existing admin_get_billing_config()
-- SECURITY DEFINER RPC, which already self-checks has_role(...,'admin').

REVOKE SELECT ON public.app_config FROM authenticated;
GRANT SELECT (
  id,
  idle_threshold_sec,
  max_break_sec,
  session_timeout_minutes,
  low_engagement_minutes,
  screenshot_retention_days
) ON public.app_config TO authenticated;
-- service_role retains full access (ALL grant from initial table setup).

-- ============================================================
-- 2) session_segments: scope policies to authenticated, not public
-- ============================================================
DROP POLICY IF EXISTS "segments admin read" ON public.session_segments;
DROP POLICY IF EXISTS "segments self all"   ON public.session_segments;

CREATE POLICY "segments admin read"
  ON public.session_segments
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "segments self all"
  ON public.session_segments
  FOR ALL
  TO authenticated
  USING (va_id = auth.uid())
  WITH CHECK (va_id = auth.uid());

-- ============================================================
-- 3) SECURITY DEFINER functions: revoke broad EXECUTE
-- ============================================================
-- Default GRANT on a new function is EXECUTE TO PUBLIC, which lets anon
-- call SECURITY DEFINER functions directly. Revoke from PUBLIC across the
-- board, then grant back narrowly.

-- Trigger / internal-only (no client should call directly)
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.flag_sop_needs_review()                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_fields()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_insert()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_session_heartbeat()                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_open_default_work_segment()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_open_session_segment(uuid, timestamptz, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_stale_sessions()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)          FROM PUBLIC;

-- Admin-only RPCs (function self-checks has_role; revoke anon broad access)
REVOKE EXECUTE ON FUNCTION public.admin_get_billing_config()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_clients_with_billing()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_invoice_preview(uuid, date, date, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_billing_config()               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_clients_with_billing()        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_invoice_preview(uuid, date, date, integer) TO authenticated;

-- VA-callable session RPCs (function self-checks va ownership)
REVOKE EXECUTE ON FUNCTION public.open_session_segment(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.switch_session_client(uuid, uuid, uuid)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_break(uuid, text)                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.end_break(uuid)                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_segment_day_slices(date, date, uuid)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.open_session_segment(uuid, text, uuid, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.switch_session_client(uuid, uuid, uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.start_break(uuid, text)                      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.end_break(uuid)                              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.report_segment_day_slices(date, date, uuid)  TO authenticated;

-- Public share-link reader: intentionally callable by anon, gated by token.
REVOKE EXECUTE ON FUNCTION public.get_client_share_billable(text)              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_client_share_billable(text)              TO anon, authenticated;
