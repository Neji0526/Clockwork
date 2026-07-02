ALTER TABLE public.clients ALTER COLUMN bill_rate_cents DROP DEFAULT;
ALTER TABLE public.clients ALTER COLUMN bill_rate_cents DROP NOT NULL;
UPDATE public.clients SET bill_rate_cents = NULL WHERE bill_rate_cents = 0;