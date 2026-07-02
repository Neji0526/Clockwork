
-- Set search_path on touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Restrict EXECUTE on security definer functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
-- has_role still callable by authenticated (used inside policies; needed by client too is fine)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Storage policies for va-screenshots bucket
-- path layout: <va_id>/<session_id>/<ts>.jpg
CREATE POLICY "va-screenshots self read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'va-screenshots' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "va-screenshots admin read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'va-screenshots' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "va-screenshots self write" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'va-screenshots' AND (auth.uid())::text = (storage.foldername(name))[1]);
