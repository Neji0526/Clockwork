
-- 1) app_config: hide billing_* columns from non-admins via column privileges.
REVOKE SELECT ON public.app_config FROM authenticated;
GRANT SELECT (
  id, session_timeout_minutes, heartbeat_sec, screenshot_retention_days,
  idle_threshold_sec, updated_at, max_break_sec, low_engagement_minutes
) ON public.app_config TO authenticated;

-- 2) clients: hide bill_rate_cents / bill_currency from non-admins.
REVOKE SELECT ON public.clients FROM authenticated;
GRANT SELECT (id, name, archived, created_at) ON public.clients TO authenticated;

-- 3) session_commands: drop the broad va-insert policy; provide a
--    SECURITY DEFINER RPC that only lets a member issue self-hint commands.
DROP POLICY IF EXISTS "sesscmd va insert" ON public.session_commands;

CREATE OR REPLACE FUNCTION public.issue_self_session_command(
  p_session_id uuid,
  p_command text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ws_va uuid;
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_command NOT IN ('clock_out','break_start','break_end') THEN
    RAISE EXCEPTION 'invalid_command: %', p_command;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT va_id INTO ws_va FROM public.work_sessions WHERE id = p_session_id;
    IF ws_va IS NULL OR ws_va <> auth.uid() THEN
      RAISE EXCEPTION 'not_session_owner';
    END IF;
  END IF;

  INSERT INTO public.session_commands (va_id, issued_by, session_id, command)
  VALUES (auth.uid(), auth.uid(), p_session_id, p_command)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.issue_self_session_command(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_self_session_command(uuid, text) TO authenticated;

-- 4) Revoke EXECUTE from anon on SECURITY DEFINER functions that aren't
--    intended for public use. The public share function stays callable.
REVOKE EXECUTE ON FUNCTION public.admin_invoice_preview(uuid, date, date, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_invoice(uuid, timestamptz, text, text, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_segment_day_slices(date, date, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_break(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_break(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.end_break(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bridge_session_idle_and_close(uuid, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_open_session_segment(uuid, timestamptz, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_stale_sessions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.open_session_segment(uuid, text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.switch_session_client(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_clients_with_billing() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_billing_config() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_invoice(uuid, timestamptz, text, text, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
