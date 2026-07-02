
CREATE TABLE public.capture_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','failed','expired')),
  reason text,
  screenshot_id uuid REFERENCES public.screenshots(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 seconds')
);

CREATE INDEX capture_requests_va_status_idx ON public.capture_requests(va_id, status);

GRANT SELECT, INSERT, UPDATE ON public.capture_requests TO authenticated;
GRANT ALL ON public.capture_requests TO service_role;

ALTER TABLE public.capture_requests ENABLE ROW LEVEL SECURITY;

-- Admins can create capture requests for any VA
CREATE POLICY "capreq admin insert"
  ON public.capture_requests FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND requested_by = auth.uid());

-- Admins can read all requests; VAs can read their own
CREATE POLICY "capreq read"
  ON public.capture_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR va_id = auth.uid());

-- Target VA can update their own pending requests (to fulfill/fail)
CREATE POLICY "capreq va update"
  ON public.capture_requests FOR UPDATE
  TO authenticated
  USING (va_id = auth.uid())
  WITH CHECK (va_id = auth.uid());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.capture_requests;
ALTER TABLE public.capture_requests REPLICA IDENTITY FULL;
