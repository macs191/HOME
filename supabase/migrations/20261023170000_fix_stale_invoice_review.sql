-- Allow administrators to reject stale bank-transfer invoices that never received a receipt reference.
-- Keep approval strict: bank transfers still require a customer receipt reference.
CREATE OR REPLACE FUNCTION public.admin_review_invoice_payment(p_payment_id uuid, p_paid boolean, p_note text DEFAULT NULL)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_payment public.payments; v_booking public.bookings; v_changed public.payments;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF v_payment.id IS NULL THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF v_booking.id IS NULL OR v_booking.status <> 'completed' THEN RAISE EXCEPTION 'service_not_completed'; END IF;
  IF v_payment.status = 'paid' THEN
    IF p_paid THEN RETURN v_payment; END IF;
    RAISE EXCEPTION 'paid_payment_cannot_be_reversed';
  END IF;
  IF p_paid THEN
    IF v_payment.status NOT IN ('unpaid', 'pending') OR v_payment.payment_method NOT IN ('cash', 'bank_transfer') THEN
      RAISE EXCEPTION 'payment_not_ready';
    END IF;
    IF v_payment.payment_method = 'bank_transfer' AND nullif(trim(coalesce(v_payment.receipt_reference, '')), '') IS NULL THEN
      RAISE EXCEPTION 'transfer_reference_required';
    END IF;
    IF v_payment.amount <= 0 OR v_booking.price_snapshot IS DISTINCT FROM v_payment.amount THEN RAISE EXCEPTION 'invoice_amount_mismatch'; END IF;
    UPDATE public.payments SET status = 'paid', settled_at = coalesce(settled_at, now()), review_note = nullif(trim(p_note), '') WHERE id = p_payment_id RETURNING * INTO v_changed;
    UPDATE public.bookings SET payment_status = 'paid', updated_at = now() WHERE id = v_booking.id;
    IF v_booking.provider_id IS NOT NULL AND coalesce(v_booking.provider_amount_snapshot, 0) > 0 AND NOT EXISTS (SELECT 1 FROM public.provider_ledger_entries WHERE booking_id = v_booking.id AND entry_type = 'earning') THEN
      INSERT INTO public.provider_ledger_entries(provider_id, booking_id, entry_type, amount, note, created_by) VALUES (v_booking.provider_id, v_booking.id, 'earning', v_booking.provider_amount_snapshot, 'مستحق بعد تحصيل الفاتورة ' || v_payment.invoice_number, auth.uid());
    END IF;
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path) VALUES (v_booking.customer_id, 'تم تسجيل الدفع', 'تم تأكيد دفع الفاتورة رقم ' || v_payment.invoice_number || '.', 'payment_paid', '/customer/orders');
  ELSE
    IF v_payment.status NOT IN ('unpaid', 'pending') OR v_payment.payment_method <> 'bank_transfer' THEN RAISE EXCEPTION 'transfer_not_rejectable'; END IF;
    IF length(trim(coalesce(p_note, ''))) < 3 THEN RAISE EXCEPTION 'payment_rejection_reason_required'; END IF;
    UPDATE public.payments SET status = 'failed', review_note = trim(p_note) WHERE id = p_payment_id RETURNING * INTO v_changed;
    UPDATE public.bookings SET payment_status = 'unpaid', updated_at = now() WHERE id = v_booking.id;
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path) VALUES (v_booking.customer_id, 'تعذر اعتماد التحويل', 'راجع سبب الرفض في فاتورتك ثم أرسل مرجعًا جديدًا.', 'payment_rejected', '/customer/orders');
  END IF;
  RETURN v_changed;
END;
$$;
