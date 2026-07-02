CREATE OR REPLACE FUNCTION public.end_break(
  p_va_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  b          record;
  v_ended_at timestamptz := now();
  dur        integer;
BEGIN
  IF auth.uid() IS NOT NULL AND p_va_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_break_owner';
  END IF;

  SELECT id, session_id, started_at INTO b
    FROM public.break_segments
   WHERE va_id = p_va_id AND ended_at IS NULL
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  dur := GREATEST(0, EXTRACT(EPOCH FROM (v_ended_at - b.started_at))::int);

  UPDATE public.break_segments
     SET ended_at = v_ended_at, duration_sec = dur
   WHERE id = b.id;

  PERFORM public.close_open_session_segment(b.session_id, v_ended_at, true);

  RETURN dur;
END;
$$;