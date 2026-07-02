-- 1) Engagement bump: gate to interacted = true only.
CREATE OR REPLACE FUNCTION public.bump_session_heartbeat_engagement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ts timestamptz;
BEGIN
  -- Only REAL user input keeps a session "live". Passive samples
  -- (interacted=false) fire every 60s regardless of presence and must NOT
  -- bump last_activity_at, or walked-away sessions never go stale and
  -- close_stale_sessions never fires.
  IF NEW.session_id IS NULL OR NEW.interacted IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  ts := LEAST(COALESCE(NEW.sampled_at, now()), now());
  UPDATE public.work_sessions
     SET last_activity_at = GREATEST(last_activity_at, ts)
   WHERE id = NEW.session_id AND status = 'active';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heartbeat_engagement ON public.engagement_samples;
CREATE TRIGGER trg_heartbeat_engagement
AFTER INSERT ON public.engagement_samples
FOR EACH ROW EXECUTE FUNCTION public.bump_session_heartbeat_engagement();

-- 2) Screenshots: stop bumping entirely. Screenshots fire on a server-driven
--    cadence regardless of presence; bumping on capture is the same
--    passive-polluter bug as the heartbeat. Idle-bridging now correctly
--    credits any unaccounted span as idle, so dropping the bump is safe.
DROP TRIGGER IF EXISTS trg_heartbeat_screenshot ON public.screenshots;

-- Note: triggers on activity_events, idle_segments, break_segments are left
-- intact. These represent (mostly) human-action signals:
--   activity_events  - tab/window focus or url change (human nav)
--   idle_segments    - end of an idle period (human came back from idle)
--   break_segments   - explicit start_break/end_break RPC calls
