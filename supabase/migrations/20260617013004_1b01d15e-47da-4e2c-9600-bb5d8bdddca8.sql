
-- Add platform/source tagging columns
ALTER TABLE public.work_sessions ADD COLUMN IF NOT EXISTS platform text DEFAULT 'chrome';
ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS platform text DEFAULT 'chrome';
ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS source text DEFAULT 'extension';
ALTER TABLE public.screenshots ADD COLUMN IF NOT EXISTS platform text DEFAULT 'chrome';
ALTER TABLE public.screenshots ADD COLUMN IF NOT EXISTS source text DEFAULT 'extension';
ALTER TABLE public.workflow_steps ADD COLUMN IF NOT EXISTS platform text DEFAULT 'chrome';
ALTER TABLE public.workflow_steps ADD COLUMN IF NOT EXISTS source text DEFAULT 'extension';
ALTER TABLE public.engagement_samples ADD COLUMN IF NOT EXISTS platform text DEFAULT 'chrome';
ALTER TABLE public.engagement_samples ADD COLUMN IF NOT EXISTS source text DEFAULT 'extension';

-- Backfill any null values from existing rows
UPDATE public.work_sessions SET platform = 'chrome' WHERE platform IS NULL;
UPDATE public.work_sessions SET source = 'extension' WHERE source IS NULL;
UPDATE public.activity_events SET platform = 'chrome' WHERE platform IS NULL;
UPDATE public.activity_events SET source = 'extension' WHERE source IS NULL;
UPDATE public.screenshots SET platform = 'chrome' WHERE platform IS NULL;
UPDATE public.screenshots SET source = 'extension' WHERE source IS NULL;
UPDATE public.workflow_steps SET platform = 'chrome' WHERE platform IS NULL;
UPDATE public.workflow_steps SET source = 'extension' WHERE source IS NULL;
UPDATE public.engagement_samples SET platform = 'chrome' WHERE platform IS NULL;
UPDATE public.engagement_samples SET source = 'extension' WHERE source IS NULL;

-- device_tokens: agent auth credentials minted by admins for VAs
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  va_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('macos','windows','linux')),
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;
GRANT ALL ON public.device_tokens TO service_role;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage device tokens"
  ON public.device_tokens FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "VAs view their own devices"
  ON public.device_tokens FOR SELECT
  TO authenticated
  USING (va_id = auth.uid());

CREATE INDEX IF NOT EXISTS device_tokens_va_idx ON public.device_tokens(va_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS device_tokens_hash_idx ON public.device_tokens(token_hash) WHERE revoked_at IS NULL;
