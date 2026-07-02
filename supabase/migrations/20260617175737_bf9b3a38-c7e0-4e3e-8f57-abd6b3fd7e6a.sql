ALTER TABLE public.break_segments
  ADD COLUMN break_type text;

ALTER TABLE public.break_segments
  ADD CONSTRAINT break_segments_break_type_check
  CHECK (break_type IS NULL OR break_type IN ('short_break','lunch'));

ALTER TABLE public.session_segments
  ADD COLUMN break_type text;

ALTER TABLE public.session_segments
  ADD CONSTRAINT session_segments_break_type_check
  CHECK (
    (kind = 'work'  AND break_type IS NULL)
    OR (kind = 'break' AND (break_type IS NULL OR break_type IN ('short_break','lunch')))
  );

CREATE OR REPLACE FUNCTION public.start_break(
  p_session_id uuid,
  p_reason text,
  p_break_type text DEFAULT 'short_break'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  ws_va    uuid;
  break_id uuid;
BEGIN
  IF p_break_type NOT IN ('short_break','lunch') THEN
    RAISE EXCEPTION 'invalid_break_type: %', p_break_type;
  END IF;

  SELECT va_id INTO ws_va FROM public.work_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF ws_va IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF auth.uid() IS NOT NULL AND ws_va <> auth.uid() THEN
    RAISE EXCEPTION 'not_session_owner';
  END IF;

  UPDATE public.break_segments SET ended_at = now()
   WHERE va_id = ws_va AND ended_at IS NULL;

  INSERT INTO public.break_segments (va_id, session_id, started_at, reason, break_type)
  VALUES (ws_va, p_session_id, now(), p_reason, p_break_type)
  RETURNING id INTO break_id;

  PERFORM public.close_open_session_segment(p_session_id, now(), false);

  BEGIN
    INSERT INTO public.session_segments (session_id, va_id, kind, started_at, break_type)
    VALUES (p_session_id, ws_va, 'break', now(), p_break_type);
  EXCEPTION WHEN unique_violation THEN
    PERFORM public.close_open_session_segment(p_session_id, now(), false);
    INSERT INTO public.session_segments (session_id, va_id, kind, started_at, break_type)
    VALUES (p_session_id, ws_va, 'break', now(), p_break_type);
  END;

  RETURN break_id;
END;
$function$;