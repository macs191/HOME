CREATE OR REPLACE FUNCTION public.admin_accept_booking_quote(p_quote_id uuid)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_quote public.booking_quotes; v_booking public.bookings; v_rate numeric; v_commission numeric; v_net numeric; v_invoice public.payments;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT * INTO v_quote FROM public.booking_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL OR v_quote.status <> 'pending' THEN RAISE EXCEPTION 'quote_not_pending'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_quote.booking_id FOR UPDATE;
  IF v_booking.id IS NULL OR v_booking.status <> 'completed' OR v_booking.provider_id <> v_quote.provider_id THEN
    RAISE EXCEPTION 'booking_not_completed_or_provider_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = v_booking.id) THEN RAISE EXCEPTION 'invoice_already_exists'; END IF;
  SELECT coalesce(pp.default_commission_rate, ps.default_commission_rate) INTO v_rate
  FROM public.provider_profiles pp CROSS JOIN public.platform_settings ps
  WHERE pp.user_id = v_quote.provider_id AND ps.id = 1;
  IF v_rate IS NULL OR v_rate < 0 OR v_rate > 100 THEN RAISE EXCEPTION 'commission_rate_not_configured'; END IF;
  v_commission := round(v_quote.amount * v_rate / 100, 2);
  v_net := v_quote.amount - v_commission;
  UPDATE public.booking_quotes SET status = 'accepted', admin_review_note = NULL WHERE id = v_quote.id;
  UPDATE public.booking_quotes SET status = 'expired' WHERE booking_id = v_quote.booking_id AND id <> v_quote.id AND status = 'pending';
  UPDATE public.bookings
  SET price_snapshot = v_quote.amount, commission_rate_snapshot = v_rate,
      commission_amount_snapshot = v_commission, provider_amount_snapshot = v_net,
      payment_status = 'unpaid', updated_at = now()
  WHERE id = v_booking.id;
  INSERT INTO public.payments(booking_id, provider, amount, status, idempotency_key)
  VALUES (v_booking.id, 'manual_invoice', v_quote.amount, 'unpaid', 'invoice:' || v_booking.id::text)
  RETURNING * INTO v_invoice;
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_booking.customer_id, 'صدرت فاتورة طلبك', 'اعتمدت الإدارة سعر الفني. اختر وسيلة الدفع من طلباتك.', 'invoice_issued', '/customer/orders'),
    (v_quote.provider_id, 'اعتمدت الإدارة السعر', 'تم اعتماد سعر الطلب، ويُسجّل صافي مستحقك عند تأكيد التحصيل.', 'quote_approved', '/provider/ledger');
  RETURN v_invoice;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_accept_booking_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_accept_booking_quote(uuid) TO authenticated;

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
    IF v_payment.amount <= 0 OR v_booking.price_snapshot IS DISTINCT FROM v_payment.amount THEN RAISE EXCEPTION 'invoice_amount_mismatch'; END IF;
    UPDATE public.payments SET status = 'paid', settled_at = coalesce(settled_at, now()), review_note = nullif(trim(p_note), '')
    WHERE id = p_payment_id RETURNING * INTO v_changed;
    UPDATE public.bookings SET payment_status = 'paid', updated_at = now() WHERE id = v_booking.id;
    IF v_booking.provider_id IS NOT NULL AND coalesce(v_booking.provider_amount_snapshot, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.provider_ledger_entries WHERE booking_id = v_booking.id AND entry_type = 'earning') THEN
      INSERT INTO public.provider_ledger_entries(provider_id, booking_id, entry_type, amount, note, created_by)
      VALUES (v_booking.provider_id, v_booking.id, 'earning', v_booking.provider_amount_snapshot,
        'مستحق بعد تحصيل الفاتورة ' || v_payment.invoice_number, auth.uid());
    END IF;
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    VALUES (v_booking.customer_id, 'تم تسجيل الدفع', 'تم تأكيد دفع الفاتورة رقم ' || v_payment.invoice_number || '.', 'payment_paid', '/customer/orders');
  ELSE
    IF v_payment.status <> 'pending' OR v_payment.payment_method <> 'bank_transfer'
       OR nullif(trim(coalesce(v_payment.receipt_reference, '')), '') IS NULL THEN
      RAISE EXCEPTION 'transfer_not_rejectable';
    END IF;
    IF length(trim(coalesce(p_note, ''))) < 3 THEN RAISE EXCEPTION 'payment_rejection_reason_required'; END IF;
    UPDATE public.payments SET status = 'failed', review_note = trim(p_note)
    WHERE id = p_payment_id RETURNING * INTO v_changed;
    UPDATE public.bookings SET payment_status = 'unpaid', updated_at = now() WHERE id = v_booking.id;
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    VALUES (v_booking.customer_id, 'تعذر اعتماد التحويل', 'راجع سبب الرفض في فاتورتك ثم أرسل مرجعًا جديدًا.', 'payment_rejected', '/customer/orders');
  END IF;
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_invoice_payment(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_invoice_payment(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_provider_ledger_entry(
  p_provider_id uuid,
  p_booking_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS public.provider_ledger_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_provider public.provider_profiles; v_booking public.bookings; v_balance numeric; v_amount numeric; v_entry public.provider_ledger_entries;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_entry_type NOT IN ('earning', 'late_penalty', 'adjustment', 'payout') THEN RAISE EXCEPTION 'invalid_entry_type'; END IF;
  IF p_entry_type = 'earning' THEN RAISE EXCEPTION 'earning_entries_are_system_only'; END IF;
  IF p_amount IS NULL OR p_amount = 0 OR abs(p_amount) > 1000000 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF length(trim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'ledger_note_required'; END IF;
  SELECT * INTO v_provider FROM public.provider_profiles WHERE user_id = p_provider_id FOR UPDATE;
  IF v_provider.user_id IS NULL THEN RAISE EXCEPTION 'provider_not_found'; END IF;
  IF p_booking_id IS NOT NULL THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
    IF v_booking.id IS NULL OR v_booking.provider_id IS DISTINCT FROM p_provider_id THEN RAISE EXCEPTION 'booking_provider_mismatch'; END IF;
  END IF;
  IF p_entry_type = 'payout' THEN
    IF p_booking_id IS NOT NULL OR p_amount < 0 THEN RAISE EXCEPTION 'payout_amount_must_be_positive_and_unlinked'; END IF;
    SELECT coalesce(sum(amount), 0) INTO v_balance FROM public.provider_ledger_entries WHERE provider_id = p_provider_id;
    IF v_balance < p_amount THEN RAISE EXCEPTION 'payout_exceeds_available_balance'; END IF;
    v_amount := -abs(p_amount);
  ELSIF p_entry_type = 'late_penalty' THEN
    IF p_amount < 0 THEN RAISE EXCEPTION 'penalty_amount_must_be_positive_input'; END IF;
    v_amount := -abs(p_amount);
  ELSE
    v_amount := p_amount;
  END IF;
  INSERT INTO public.provider_ledger_entries(provider_id, booking_id, entry_type, amount, note, created_by)
  VALUES (p_provider_id, p_booking_id, p_entry_type, v_amount, trim(p_note), auth.uid())
  RETURNING * INTO v_entry;
  RETURN v_entry;
END;
$$;
REVOKE ALL ON FUNCTION public.add_provider_ledger_entry(uuid, uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_provider_ledger_entry(uuid, uuid, text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_stripe_payment(
  p_payment_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_amount_minor bigint,
  p_currency text
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_payment public.payments; v_booking public.bookings; v_changed public.payments;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF nullif(trim(coalesce(p_session_id, '')), '') IS NULL OR nullif(trim(coalesce(p_payment_intent_id, '')), '') IS NULL
     OR p_amount_minor IS NULL OR p_amount_minor <= 0 OR lower(coalesce(p_currency, '')) <> 'sar' THEN
    RAISE EXCEPTION 'stripe_event_invalid';
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF v_payment.id IS NULL OR v_payment.provider <> 'stripe' THEN RAISE EXCEPTION 'stripe_invoice_not_found'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF v_booking.id IS NULL OR v_booking.status <> 'completed' THEN RAISE EXCEPTION 'service_not_completed'; END IF;
  IF round(v_payment.amount * 100)::bigint <> p_amount_minor THEN RAISE EXCEPTION 'stripe_amount_mismatch'; END IF;
  IF v_payment.status = 'paid' THEN
    IF v_payment.external_reference IS DISTINCT FROM p_session_id OR (v_payment.stripe_payment_intent_id IS NOT NULL AND v_payment.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id) THEN
      RAISE EXCEPTION 'stripe_replay_mismatch';
    END IF;
    RETURN v_payment;
  END IF;
  IF v_payment.status <> 'pending' OR v_payment.external_reference IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'stripe_session_mismatch';
  END IF;
  UPDATE public.payments
  SET status = 'paid', payment_method = 'card', settled_at = coalesce(settled_at, now()),
      stripe_payment_intent_id = p_payment_intent_id
  WHERE id = p_payment_id RETURNING * INTO v_changed;
  UPDATE public.bookings SET payment_status = 'paid', updated_at = now() WHERE id = v_booking.id;
  IF v_booking.provider_id IS NOT NULL AND coalesce(v_booking.provider_amount_snapshot, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.provider_ledger_entries WHERE booking_id = v_booking.id AND entry_type = 'earning') THEN
    INSERT INTO public.provider_ledger_entries(provider_id, booking_id, entry_type, amount, note, created_by)
    VALUES (v_booking.provider_id, v_booking.id, 'earning', v_booking.provider_amount_snapshot,
      'مستحق بعد تحصيل الفاتورة ' || v_payment.invoice_number || ' عبر البطاقة', NULL);
  END IF;
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (v_booking.customer_id, 'تم تسجيل الدفع الإلكتروني', 'تم تأكيد دفع الفاتورة رقم ' || v_payment.invoice_number || '.', 'payment_paid', '/customer/orders');
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_stripe_payment(uuid, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_stripe_payment(uuid, text, text, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_dashboard_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  RETURN jsonb_build_object(
    'bookings', (SELECT count(*) FROM public.bookings),
    'approvedProviders', (SELECT count(*) FROM public.provider_profiles WHERE approval_status = 'approved'),
    'paidAmount', (SELECT coalesce(sum(amount), 0) FROM public.payments WHERE status = 'paid'),
    'openInvoices', (SELECT count(*) FROM public.payments WHERE status IN ('unpaid', 'pending', 'failed')),
    'pendingQuotes', (SELECT count(*) FROM public.booking_quotes WHERE status = 'pending'),
    'unassignedBookings', (SELECT count(*) FROM public.bookings WHERE provider_id IS NULL AND status IN ('pending', 'quoted', 'accepted'))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_dashboard_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_metrics() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_operational_report(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_from date; v_to date; v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF (p_from IS NULL) <> (p_to IS NULL) THEN RAISE EXCEPTION 'both_report_dates_required'; END IF;
  v_from := coalesce(p_from, current_date - 29);
  v_to := coalesce(p_to, current_date);
  IF v_to < v_from OR v_to - v_from > 365 THEN RAISE EXCEPTION 'invalid_report_date_range'; END IF;
  SELECT jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'bookings_total', (SELECT count(*) FROM public.bookings b WHERE b.created_at >= v_from::timestamptz AND b.created_at < (v_to + 1)::timestamptz),
    'paid_amount', (SELECT coalesce(sum(p.amount), 0) FROM public.payments p WHERE p.status = 'paid' AND coalesce(p.settled_at, p.created_at) >= v_from::timestamptz AND coalesce(p.settled_at, p.created_at) < (v_to + 1)::timestamptz),
    'paid_count', (SELECT count(*) FROM public.payments p WHERE p.status = 'paid' AND coalesce(p.settled_at, p.created_at) >= v_from::timestamptz AND coalesce(p.settled_at, p.created_at) < (v_to + 1)::timestamptz),
    'open_invoices', (SELECT count(*) FROM public.payments p WHERE p.status IN ('unpaid', 'pending', 'failed') AND p.created_at >= v_from::timestamptz AND p.created_at < (v_to + 1)::timestamptz),
    'pending_quotes', (SELECT count(*) FROM public.booking_quotes q WHERE q.status = 'pending' AND q.created_at >= v_from::timestamptz AND q.created_at < (v_to + 1)::timestamptz),
    'bookings_by_status', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.cnt) ORDER BY s.status), '[]'::jsonb)
      FROM (
        SELECT b.status::text AS status, count(*) AS cnt FROM public.bookings b
        WHERE b.created_at >= v_from::timestamptz AND b.created_at < (v_to + 1)::timestamptz
        GROUP BY b.status
      ) s
    ),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'bookings', coalesce(b.n, 0), 'paid_amount', coalesce(p.amount, 0)) ORDER BY d.day), '[]'::jsonb)
      FROM generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') AS d(day)
      LEFT JOIN LATERAL (
        SELECT count(*) AS n FROM public.bookings b
        WHERE b.created_at >= d.day AND b.created_at < d.day + interval '1 day'
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT coalesce(sum(p.amount), 0) AS amount FROM public.payments p
        WHERE p.status = 'paid' AND coalesce(p.settled_at, p.created_at) >= d.day AND coalesce(p.settled_at, p.created_at) < d.day + interval '1 day'
      ) p ON true
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_operational_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_operational_report(date, date) TO authenticated;


-- Final security layer: storage/table grants are deny-by-default and all state changes use safe wrappers.
ALTER TABLE public.booking_attachments ADD COLUMN IF NOT EXISTS bucket_id text NOT NULL DEFAULT 'booking-attachments';
CREATE INDEX IF NOT EXISTS booking_attachments_bucket_path_idx ON public.booking_attachments(bucket_id, storage_path);
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_invoice_per_booking_uidx ON public.payments(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_ledger_one_earning_per_booking_uidx
  ON public.provider_ledger_entries(booking_id) WHERE entry_type = 'earning';
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_stripe_intent_uidx
  ON public.payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_provider_slot_uidx
  ON public.bookings(provider_id, scheduled_date, scheduled_slot)
  WHERE provider_id IS NOT NULL AND scheduled_date IS NOT NULL AND scheduled_slot IS NOT NULL
    AND status IN ('assigned','on_the_way','arrived','in_progress');
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash','bank_transfer','card'));

