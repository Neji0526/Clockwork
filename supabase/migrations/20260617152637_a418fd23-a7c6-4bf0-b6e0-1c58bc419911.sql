CREATE OR REPLACE FUNCTION public.admin_save_invoice(
  p_invoice_id          uuid,
  p_expected_updated_at timestamptz,
  p_number              text,
  p_notes               text,
  p_issued_at           date,
  p_due_date            date,
  p_subtotal_cents      bigint,
  p_total_cents         bigint,
  p_lines               jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_updated timestamptz;
  new_updated timestamptz := now();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Row lock + load current version for the optimistic-concurrency check.
  SELECT updated_at INTO cur_updated
    FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF cur_updated IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  -- If the row moved since the editor loaded it, reject. Caller must reload.
  IF cur_updated IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'conflict',
      'currentUpdatedAt', cur_updated
    );
  END IF;

  -- All three writes run inside this function's implicit transaction,
  -- so any failure rolls every part back — no partial wipe of line items.
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
      COALESCE((l->>'amount_cents')::bigint, 0),
      COALESCE((l->>'sort')::int, (ord - 1)::int)
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(l, ord);
  END IF;

  -- NOTE: subtotal/total still come from the caller (provisional).
  -- Item 5 will move both to server-side recompute and drop these args.
  UPDATE public.invoices SET
    number         = p_number,
    notes          = p_notes,
    issued_at      = p_issued_at,
    due_date       = p_due_date,
    subtotal_cents = p_subtotal_cents,
    total_cents    = p_total_cents,
    updated_at     = new_updated
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object('ok', true, 'updatedAt', new_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_invoice(uuid, timestamptz, text, text, date, date, bigint, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_invoice(uuid, timestamptz, text, text, date, date, bigint, bigint, jsonb) TO authenticated;