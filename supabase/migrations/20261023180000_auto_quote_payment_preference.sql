ALTER TABLE public.booking_quotes ADD COLUMN IF NOT EXISTS payment_method_preference text;

CREATE OR REPLACE FUNCTION public.provider_submit_quote_auto(p_booking_id uuid, p_amount numeric, p_note text DEFAULT NULL, p_payment_method text DEFAULT 'cash')
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quote public.booking_quotes; v_booking public.bookings; v_rate numeric; v_commission numeric; v_net numeric; v_invoice public.payments; v_method text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('provider'::public.app_role) THEN RAISE EXCEPTION 'provider_account_required'; END IF;
  IF p_payment_method NOT IN ('cash','bank_transfer') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;
  v_method := p_payment_method;
  v_quote := public.provider_submit_quote(p_booking_id, p_amount, p_note);
  UPDATE public.booking_quotes SET payment_method_preference = v_method WHERE id = v_quote.id RETURNING * INTO v_quote;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND provider_id = auth.uid() FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_assigned'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = v_booking.id) THEN RAISE EXCEPTION 'invoice_already_exists'; END IF;
  SELECT coalesce(pp.default_commission_rate, ps.default_commission_rate) INTO v_rate
  FROM public.provider_profiles pp CROSS JOIN public.platform_settings ps
  WHERE pp.user_id = auth.uid() AND ps.id = 1;
  IF v_rate IS NULL OR v_rate < 0 OR v_rate > 100 THEN RAISE EXCEPTION 'commission_rate_not_configured'; END IF;
  v_commission := round(v_quote.amount * v_rate / 100, 2); v_net := v_quote.amount - v_commission;
  UPDATE public.booking_quotes SET status = 'accepted', admin_review_note = 'اعتماد تلقائي بعد إرسال الفني للسعر' WHERE id = v_quote.id;
  UPDATE public.booking_quotes SET status = 'expired' WHERE booking_id = v_booking.id AND id <> v_quote.id AND status = 'pending';
  UPDATE public.bookings SET price_snapshot = v_quote.amount, commission_rate_snapshot = v_rate, commission_amount_snapshot = v_commission, provider_amount_snapshot = v_net, payment_status = 'unpaid', updated_at = now() WHERE id = v_booking.id;
  INSERT INTO public.payments(booking_id, provider, payment_method, amount, status, idempotency_key) VALUES (v_booking.id, 'manual_invoice', v_method, v_quote.amount, 'unpaid', 'invoice:' || v_booking.id::text) RETURNING * INTO v_invoice;
  INSERT INTO public.notifications(user_id,title,body,notification_type,target_path) VALUES
    (v_booking.customer_id,'صدرت فاتورة طلبك','تم اعتماد سعر الفني تلقائيًا. طريقة الدفع المختارة: ' || CASE WHEN v_method='cash' THEN 'نقدًا' ELSE 'تحويل بنكي' END || '.','invoice_issued','/customer/orders'),
    (v_booking.provider_id,'تم اعتماد السعر تلقائيًا','تم اعتماد السعر وإصدار الفاتورة. سيُضاف صافي مستحقك إلى سجل الرصيد بعد تأكيد التحصيل.','quote_approved','/provider/ledger');
  RETURN v_invoice;
END; $$;

CREATE OR REPLACE FUNCTION public.provider_submit_quote_auto_safe(p_booking_id uuid, p_amount numeric, p_note text, p_payment_method text DEFAULT 'cash')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE x public.payments;
BEGIN
  IF NOT public.has_role('provider') OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 OR p_payment_method NOT IN ('cash','bank_transfer') THEN RAISE EXCEPTION 'invalid_quote'; END IF;
  IF length(trim(coalesce(p_note,''))) > 2000 THEN RAISE EXCEPTION 'quote_note_too_long'; END IF;
  x := public.provider_submit_quote_auto(p_booking_id,p_amount,p_note,p_payment_method);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'invoice_number',x.invoice_number,'amount',x.amount,'status',x.status,'payment_method',x.payment_method);
END; $$;
REVOKE ALL ON FUNCTION public.provider_submit_quote_auto(uuid,numeric,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_submit_quote_auto_safe(uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_submit_quote_auto_safe(uuid,numeric,text,text) TO authenticated;
