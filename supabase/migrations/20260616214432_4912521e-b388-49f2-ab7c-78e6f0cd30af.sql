
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM authenticated;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can generate invoice numbers';
  END IF;
  RETURN 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
END;
$$;

GRANT USAGE, UPDATE ON SEQUENCE public.invoice_number_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated;
