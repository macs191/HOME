CREATE OR REPLACE FUNCTION public.provider_confirm_cash_payment(p_payment_id uuid, p_received_amount numeric)
RETURNS public.payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_payment public.payments; current_booking public.bookings; changed public.payments;
BEGIN
  IF p_received_amount IS NULL OR p_received_amount <= 0 THEN RAISE EXCEPTION 'cash_amount_invalid'; END IF;
  SELECT p.* INTO current_payment FROM public.payments p WHERE p.id=p_payment_id FOR UPDATE;
  IF current_payment.id IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  SELECT b.* INTO current_booking FROM public.bookings b WHERE b.id=current_payment.booking_id FOR UPDATE;
  IF current_booking.provider_id <> auth.uid() THEN RAISE EXCEPTION 'provider_required'; END IF;
  IF current_payment.payment_method <> 'cash' THEN RAISE EXCEPTION 'cash_payment_required'; END IF;
  IF current_payment.status = 'paid' THEN RETURN current_payment; END IF;
  IF current_booking.status <> 'completed' THEN RAISE EXCEPTION 'booking_not_completed'; END IF;
  IF abs(p_received_amount - current_payment.amount) > 0.01 THEN RAISE EXCEPTION 'cash_amount_mismatch'; END IF;
  UPDATE public.payments SET status='paid', cash_received_amount=round(p_received_amount,2), settled_at=coalesce(settled_at,now()), review_note='أكد الفني استلام المبلغ نقدًا' WHERE id=p_payment_id RETURNING * INTO changed;
  UPDATE public.bookings SET payment_status='paid', updated_at=now() WHERE id=current_booking.id;
  IF coalesce(current_booking.provider_amount_snapshot,0) > 0 AND NOT EXISTS (SELECT 1 FROM public.provider_ledger_entries WHERE booking_id=current_booking.id AND entry_type='earning') THEN
    INSERT INTO public.provider_ledger_entries(provider_id,booking_id,entry_type,amount,note,created_by) VALUES(current_booking.provider_id,current_booking.id,'earning',current_booking.provider_amount_snapshot,'مستحق بعد تأكيد الفني لتحصيل الفاتورة '||current_payment.invoice_number,auth.uid());
  END IF;
  INSERT INTO public.notifications(user_id,title,body,notification_type,target_path) VALUES
    (current_booking.customer_id,'تم تأكيد الدفع النقدي','أكد الفني استلام مبلغ '||to_char(p_received_amount,'FM999999990.00')||' ر.س نقدًا. الفاتورة مدفوعة ومكتملة.','cash_payment_confirmed','/customer/orders'),
    (current_booking.provider_id,'تمت إضافة مستحق إلى رصيدك','تم تسجيل صافي مستحق قدره '||to_char(coalesce(current_booking.provider_amount_snapshot,0),'FM999999990.00')||' ر.س في سجل رصيدك بعد تحصيل الفاتورة رقم '||current_payment.invoice_number||'.','provider_earning','/provider/ledger');
  INSERT INTO public.notifications(user_id,title,body,notification_type,target_path)
  SELECT user_id,'تم تحصيل فاتورة','تم تأكيد الدفع النقدي للفواتير المرتبطة بالطلب رقم '||current_booking.booking_number||'.','payment_paid','/admin#payments' FROM public.user_roles WHERE role IN ('admin','sub_admin');
  RETURN changed;
END; $$;
REVOKE ALL ON FUNCTION public.provider_confirm_cash_payment(uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.provider_confirm_cash_payment(uuid,numeric) TO authenticated;
