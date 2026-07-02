ALTER TABLE public.work_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.activity_events REPLICA IDENTITY FULL;
ALTER TABLE public.screenshots REPLICA IDENTITY FULL;
ALTER TABLE public.workflow_steps REPLICA IDENTITY FULL;
ALTER TABLE public.break_segments REPLICA IDENTITY FULL;
ALTER TABLE public.idle_segments REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.work_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.screenshots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_steps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.break_segments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.idle_segments;