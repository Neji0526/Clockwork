DO $$
DECLARE sid uuid := '232d051f-c11a-4056-b185-c88a79a883e4';
BEGIN
  DELETE FROM public.activity_events    WHERE session_id = sid;
  DELETE FROM public.engagement_samples WHERE session_id = sid;
  DELETE FROM public.screenshots        WHERE session_id = sid;
  DELETE FROM public.idle_segments      WHERE session_id = sid;
  DELETE FROM public.session_segments   WHERE session_id = sid;
  DELETE FROM public.admin_actions      WHERE metadata->>'session_id' = sid::text;
  DELETE FROM public.work_sessions      WHERE id = sid;
END $$;