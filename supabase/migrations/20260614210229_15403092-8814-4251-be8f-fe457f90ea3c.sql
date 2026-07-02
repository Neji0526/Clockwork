
ALTER TABLE public.sop_comments ADD COLUMN IF NOT EXISTS is_question boolean NOT NULL DEFAULT false;
ALTER TABLE public.sops ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS sops_needs_review_idx ON public.sops (needs_review) WHERE needs_review;

CREATE OR REPLACE FUNCTION public.flag_sop_needs_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_question THEN
    UPDATE public.sops SET needs_review = true WHERE id = NEW.sop_id AND needs_review = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sop_comments_flag_review ON public.sop_comments;
CREATE TRIGGER sop_comments_flag_review
AFTER INSERT ON public.sop_comments
FOR EACH ROW EXECUTE FUNCTION public.flag_sop_needs_review();
