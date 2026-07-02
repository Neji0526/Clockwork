CREATE OR REPLACE FUNCTION public.admin_invoice_preview(
  p_client_id     uuid,
  p_period_start  date,
  p_period_end    date,
  p_rate_cents    int
)
RETURNS TABLE (
  va_id        uuid,
  va_name      text,
  active_sec   int,
  hours        numeric,
  amount_cents int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH slices AS (
    SELECT s.va_id, s.client_id, s.active_sec
    FROM public.report_segment_day_slices(p_period_start, p_period_end, NULL) s
    WHERE s.kind = 'work'
  ),
  billed AS (
    -- Per-VA billable seconds for this client, from segment-level client_id
    -- (NOT work_sessions.client_id), Eastern-bucketed and pro-rated by the
    -- reporting RPC. Excludes break + idle by construction.
    SELECT sl.va_id,
           COALESCE(p.display_name, 'Unknown') AS va_name,
           SUM(sl.active_sec)::int AS active_sec
    FROM slices sl
    LEFT JOIN public.profiles p ON p.user_id = sl.va_id
    WHERE sl.client_id = p_client_id
    GROUP BY sl.va_id, p.display_name
    HAVING SUM(sl.active_sec) > 0
  ),
  unattributed AS (
    -- Work segments with no client tag, scoped to VAs who billed this client
    -- in this period (so the warning is relevant to this invoice's people).
    SELECT NULL::uuid AS va_id,
           'Unattributed work (no client tag)'::text AS va_name,
           COALESCE(SUM(sl.active_sec), 0)::int AS active_sec
    FROM slices sl
    WHERE sl.client_id IS NULL
      AND sl.va_id IN (SELECT b.va_id FROM billed b)
    HAVING COALESCE(SUM(sl.active_sec), 0) > 0
  )
  SELECT b.va_id,
         b.va_name,
         b.active_sec,
         ROUND(b.active_sec::numeric / 3600, 2) AS hours,
         -- Amount computed from raw seconds — no compounding rounding loss.
         ROUND(b.active_sec::numeric * p_rate_cents / 3600)::int AS amount_cents
  FROM billed b
  UNION ALL
  SELECT u.va_id,
         u.va_name,
         u.active_sec,
         ROUND(u.active_sec::numeric / 3600, 2) AS hours,
         0 AS amount_cents
  FROM unattributed u
  ORDER BY 1 NULLS LAST, 3 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invoice_preview(uuid, date, date, int) TO authenticated;