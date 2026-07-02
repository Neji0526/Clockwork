
DROP FUNCTION IF EXISTS public.admin_save_invoice(
  uuid, timestamptz, text, text, date, date, bigint, bigint, jsonb
);

CREATE OR REPLACE FUNCTION public.admin_save_invoice(
  p_invoice_id uuid,
  p_expected_updated_at timestamptz,
  p_number text,
  p_notes text,
  p_issued_at date,
  p_due_date date,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cur_updated timestamptz;
  new_updated timestamptz := now();
  v_subtotal  bigint;
  v_total     bigint;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT updated_at INTO cur_updated
    FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF cur_updated IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF cur_updated IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'conflict',
      'currentUpdatedAt', cur_updated
    );
  END IF;

  -- Authoritative line-item write. amount_cents is recomputed from
  -- hours * rate_cents on the server; any amount_cents from the client is
  -- ignored. rate_cents is taken verbatim from the payload -- we do NOT
  -- consult clients.bill_rate_cents here, so existing lines keep the rate
  -- they were issued at even if the client's current rate has changed.
  DELETE FROM public.invoice_line_items WHERE invoice_id = p_invoice_id;

  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.invoice_line_items
      (invoice_id, description, va_id, hours, rate_cents, amount_cents, sort)
    SELECT
      p_invoice_id,
      COALESCE(l->>'description', ''),
      NULLIF(l->>'va_id', '')::uuid,
      COALESCE((l->>'hours')::numeric, 0),
      COALESCE((l->>'rate_cents')::bigint, 0),
      ROUND(COALESCE((l->>'hours')::numeric, 0)
            * COALESCE((l->>'rate_cents')::bigint, 0))::bigint,
      COALESCE((l->>'sort')::int, (ord - 1)::int)
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(l, ord);
  END IF;

  -- Subtotal = sum of server-recomputed line amounts. Total = subtotal
  -- today (no tax/discount). When tax/discount is added, change it HERE --
  -- this is the single authoritative place.
  SELECT COALESCE(SUM(amount_cents), 0)::bigint
    INTO v_subtotal
    FROM public.invoice_line_items
   WHERE invoice_id = p_invoice_id;
  v_total := v_subtotal;

  UPDATE public.invoices SET
    number         = p_number,
    notes          = p_notes,
    issued_at      = p_issued_at,
    due_date       = p_due_date,
    subtotal_cents = v_subtotal,
    total_cents    = v_total,
    updated_at     = new_updated
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true,
    'updatedAt', new_updated,
    'subtotalCents', v_subtotal,
    'totalCents', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_invoice(
  uuid, timestamptz, text, text, date, date, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_invoice(
  uuid, timestamptz, text, text, date, date, jsonb
) TO authenticated;
