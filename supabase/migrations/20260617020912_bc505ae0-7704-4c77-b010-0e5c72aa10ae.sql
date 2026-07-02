-- 1) Re-scope profiles self update policy to 'authenticated' explicitly
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2) Hide per-client billing rate/currency from non-admin authenticated users.
--    Admin reads of these columns are routed through the SECURITY DEFINER RPC below.
REVOKE SELECT (bill_rate_cents, bill_currency) ON public.clients FROM authenticated;
REVOKE SELECT (bill_rate_cents, bill_currency) ON public.clients FROM anon;
GRANT  SELECT (bill_rate_cents, bill_currency) ON public.clients TO service_role;

-- 3) Hide billing configuration columns on app_config from non-admin authenticated users.
REVOKE SELECT (
  billing_business_name, billing_address, billing_email,
  billing_logo_url, billing_payment_notes, billing_default_currency
) ON public.app_config FROM authenticated;
REVOKE SELECT (
  billing_business_name, billing_address, billing_email,
  billing_logo_url, billing_payment_notes, billing_default_currency
) ON public.app_config FROM anon;
GRANT SELECT (
  billing_business_name, billing_address, billing_email,
  billing_logo_url, billing_payment_notes, billing_default_currency
) ON public.app_config TO service_role;

-- 4) Admin-only RPC: read billing configuration (used by admin Settings → Billing page).
CREATE OR REPLACE FUNCTION public.admin_get_billing_config()
RETURNS TABLE (
  billing_business_name text,
  billing_address text,
  billing_email text,
  billing_logo_url text,
  billing_payment_notes text,
  billing_default_currency text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can read billing configuration';
  END IF;
  RETURN QUERY
  SELECT
    c.billing_business_name,
    c.billing_address,
    c.billing_email,
    c.billing_logo_url,
    c.billing_payment_notes,
    c.billing_default_currency
  FROM public.app_config c
  WHERE c.id = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_billing_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_billing_config() TO authenticated;

-- 5) Admin-only RPC: list clients with their billing rates (used by admin Clients & Invoicing pages).
CREATE OR REPLACE FUNCTION public.admin_list_clients_with_billing()
RETURNS TABLE (
  id uuid,
  name text,
  archived boolean,
  created_at timestamptz,
  bill_rate_cents integer,
  bill_currency text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can read client billing rates';
  END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.archived, c.created_at, c.bill_rate_cents, c.bill_currency
  FROM public.clients c
  ORDER BY c.archived, c.name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_clients_with_billing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_clients_with_billing() TO authenticated;