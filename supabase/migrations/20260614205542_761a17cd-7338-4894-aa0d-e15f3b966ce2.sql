CREATE TABLE public.sop_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id uuid NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  step_index int,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.sop_comments TO authenticated;
GRANT ALL ON public.sop_comments TO service_role;
ALTER TABLE public.sop_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read all comments" ON public.sop_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert own comment" ON public.sop_comments FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "author or admin delete comment" ON public.sop_comments FOR DELETE TO authenticated USING (author_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX sop_comments_sop_created_idx ON public.sop_comments(sop_id, created_at DESC);