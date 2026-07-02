CREATE OR REPLACE FUNCTION public.guard_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only admins can change role';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only admins can change status';
    END IF;
    IF NEW.pay_rate_cents IS DISTINCT FROM OLD.pay_rate_cents THEN
      RAISE EXCEPTION 'Only admins can change pay_rate_cents';
    END IF;
    IF NEW.pay_currency IS DISTINCT FROM OLD.pay_currency THEN
      RAISE EXCEPTION 'Only admins can change pay_currency';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;