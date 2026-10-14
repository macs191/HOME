CREATE OR REPLACE FUNCTION public.assign_booking(p_booking_id uuid, p_provider_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_changed public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.provider_id IS NOT NULL OR v_booking.status NOT IN ('pending', 'quoted', 'accepted') THEN
    RAISE EXCEPTION 'booking_not_assignable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_profiles pp JOIN public.profiles p ON p.id = pp.user_id
    WHERE pp.user_id = p_provider_id AND pp.approval_status = 'approved' AND p.is_active = true
  ) THEN RAISE EXCEPTION 'provider_not_approved_or_inactive'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_services ps
    WHERE ps.provider_id = p_provider_id AND ps.service_id = v_booking.service_id AND ps.is_active = true
  ) THEN RAISE EXCEPTION 'provider_not_qualified_for_service'; END IF;
  IF v_booking.scheduled_date IS NOT NULL AND v_booking.scheduled_slot IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id::text || '|' || v_booking.scheduled_date::text || '|' || v_booking.scheduled_slot, 0));
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id <> p_booking_id AND b.provider_id = p_provider_id
        AND b.scheduled_date = v_booking.scheduled_date AND b.scheduled_slot = v_booking.scheduled_slot
        AND b.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress')
    ) THEN RAISE EXCEPTION 'provider_schedule_conflict'; END IF;
  END IF;
  UPDATE public.bookings SET provider_id = p_provider_id, status = 'assigned', updated_at = now()
  WHERE id = p_booking_id RETURNING * INTO v_changed;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_booking.status, 'assigned', auth.uid(), 'تم إسناد الطلب من لوحة الإدارة');
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (p_provider_id, 'طلب جديد مسند إليك', 'تم إسناد الطلب رقم ' || v_changed.booking_number || ' إليك. افتح صندوق الطلبات لمراجعته.', 'booking_assigned', '/provider/work-queue'),
    (v_changed.customer_id, 'تم إسناد فني لطلبك', 'أُسند الطلب رقم ' || v_changed.booking_number || ' إلى أحد الفنيين.', 'booking_status', '/customer/orders');
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_booking(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_booking(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reassign_booking(p_booking_id uuid, p_provider_id uuid, p_note text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_booking public.bookings; v_changed public.bookings; v_old_provider uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.id IS NULL OR v_booking.provider_id IS NULL THEN RAISE EXCEPTION 'booking_not_assigned'; END IF;
  IF v_booking.status NOT IN ('assigned', 'on_the_way', 'arrived') OR v_booking.payment_status = 'paid' THEN
    RAISE EXCEPTION 'booking_not_reassignable';
  END IF;
  IF p_provider_id = v_booking.provider_id THEN RAISE EXCEPTION 'provider_unchanged'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_profiles pp JOIN public.profiles p ON p.id = pp.user_id
    WHERE pp.user_id = p_provider_id AND pp.approval_status = 'approved' AND p.is_active = true
  ) THEN RAISE EXCEPTION 'provider_not_approved_or_inactive'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_services ps
    WHERE ps.provider_id = p_provider_id AND ps.service_id = v_booking.service_id AND ps.is_active = true
  ) THEN RAISE EXCEPTION 'provider_not_qualified_for_service'; END IF;
  IF v_booking.scheduled_date IS NOT NULL AND v_booking.scheduled_slot IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id::text || '|' || v_booking.scheduled_date::text || '|' || v_booking.scheduled_slot, 0));
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id <> p_booking_id AND b.provider_id = p_provider_id
        AND b.scheduled_date = v_booking.scheduled_date AND b.scheduled_slot = v_booking.scheduled_slot
        AND b.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress')
    ) THEN RAISE EXCEPTION 'provider_schedule_conflict'; END IF;
  END IF;
  v_old_provider := v_booking.provider_id;
  UPDATE public.bookings SET provider_id = p_provider_id, status = 'assigned', updated_at = now()
  WHERE id = p_booking_id RETURNING * INTO v_changed;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_booking.status, 'assigned', auth.uid(), trim(p_note));
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_old_provider, 'نُقل إسناد الطلب', 'نُقل الطلب رقم ' || v_changed.booking_number || ' إلى فني آخر.', 'booking_unassigned', '/provider/work-queue'),
    (p_provider_id, 'طلب جديد مسند إليك', 'تم إسناد الطلب رقم ' || v_changed.booking_number || ' إليك.', 'booking_assigned', '/provider/work-queue'),
    (v_changed.customer_id, 'تم تحديث إسناد طلبك', 'حدّثت الإدارة الفني المسند للطلب رقم ' || v_changed.booking_number || '.', 'booking_status', '/customer/orders');
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reassign_booking(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reassign_booking(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unassign_booking(p_booking_id uuid, p_note text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_booking public.bookings; v_changed public.bookings; v_old_provider uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.id IS NULL OR v_booking.provider_id IS NULL THEN RAISE EXCEPTION 'booking_not_assigned'; END IF;
  IF v_booking.status NOT IN ('assigned', 'on_the_way', 'arrived') OR v_booking.payment_status = 'paid' THEN
    RAISE EXCEPTION 'booking_not_unassignable';
  END IF;
  v_old_provider := v_booking.provider_id;
  UPDATE public.bookings SET provider_id = NULL, status = 'pending', updated_at = now()
  WHERE id = p_booking_id RETURNING * INTO v_changed;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_booking.status, 'pending', auth.uid(), trim(p_note));
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_old_provider, 'أزيل إسناد الطلب', 'أزالت الإدارة إسناد الطلب رقم ' || v_changed.booking_number || '.', 'booking_unassigned', '/provider/work-queue'),
    (v_changed.customer_id, 'أُعيد طلبك لقائمة الإسناد', 'تراجع الإدارة الإسناد وستختار فنيًا مناسبًا لطلبك رقم ' || v_changed.booking_number || '.', 'booking_status', '/customer/orders');
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unassign_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unassign_booking(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.customer_cancel_booking(p_booking_id uuid, p_reason text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_booking public.bookings; v_changed public.bookings; v_old_provider uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN RAISE EXCEPTION 'customer_account_required'; END IF;
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND customer_id = auth.uid() FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status NOT IN ('pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived') THEN RAISE EXCEPTION 'booking_not_cancellable'; END IF;
  IF v_booking.payment_status = 'paid' OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = p_booking_id AND p.status = 'paid') THEN
    RAISE EXCEPTION 'paid_booking_requires_admin_review';
  END IF;
  v_old_provider := v_booking.provider_id;
  UPDATE public.bookings SET status = 'cancelled', provider_id = NULL, cancellation_reason = trim(p_reason), updated_at = now()
  WHERE id = p_booking_id RETURNING * INTO v_changed;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_booking.status, 'cancelled', auth.uid(), trim(p_reason));
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (auth.uid(), 'تم إلغاء الطلب', 'تم إلغاء الطلب رقم ' || v_changed.booking_number || ' قبل بدء التنفيذ.', 'booking_cancelled', '/customer/orders');
  IF v_old_provider IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    VALUES (v_old_provider, 'أُلغي الطلب المسند', 'أُلغي الطلب رقم ' || v_changed.booking_number || ' وأزيل من قائمة مهامك.', 'booking_cancelled', '/provider/work-queue');
  END IF;
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.customer_cancel_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_cancel_booking(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_booking(p_booking_id uuid, p_reason text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_booking public.bookings; v_changed public.bookings; v_old_provider uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status NOT IN ('pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived') THEN RAISE EXCEPTION 'booking_not_cancellable'; END IF;
  IF v_booking.payment_status = 'paid' OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = p_booking_id AND p.status = 'paid') THEN
    RAISE EXCEPTION 'paid_booking_requires_refund_workflow';
  END IF;
  v_old_provider := v_booking.provider_id;
  UPDATE public.bookings SET status = 'cancelled', provider_id = NULL, cancellation_reason = trim(p_reason), updated_at = now()
  WHERE id = p_booking_id RETURNING * INTO v_changed;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_booking.status, 'cancelled', auth.uid(), trim(p_reason));
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (v_changed.customer_id, 'ألغت الإدارة الطلب', 'أُغلق الطلب رقم ' || v_changed.booking_number || '. السبب: ' || trim(p_reason), 'booking_cancelled', '/customer/orders');
  IF v_old_provider IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    VALUES (v_old_provider, 'أُغلق الطلب المسند', 'أُغلق الطلب رقم ' || v_changed.booking_number || ' وأزيل من قائمة مهامك.', 'booking_cancelled', '/provider/work-queue');
  END IF;
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cancel_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_booking(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_advance_booking(p_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_booking public.bookings; v_next public.booking_status; v_changed public.bookings; v_label text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND provider_id = auth.uid() FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_assigned'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_profiles pp JOIN public.profiles p ON p.id = pp.user_id
    WHERE pp.user_id = auth.uid() AND pp.approval_status = 'approved' AND p.is_active = true
  ) THEN RAISE EXCEPTION 'provider_not_active'; END IF;
  v_next := CASE v_booking.status
    WHEN 'assigned' THEN 'on_the_way'::public.booking_status
    WHEN 'on_the_way' THEN 'arrived'::public.booking_status
    WHEN 'arrived' THEN 'in_progress'::public.booking_status
    ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'invalid_provider_transition'; END IF;
  v_label := CASE v_next WHEN 'on_the_way' THEN 'الفني في الطريق' WHEN 'arrived' THEN 'وصل الفني' ELSE 'بدأ تنفيذ العمل' END;
  UPDATE public.bookings SET status = v_next, updated_at = now() WHERE id = p_booking_id RETURNING * INTO v_changed;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_booking.status, v_next, auth.uid(), v_label);
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (v_changed.customer_id, v_label, 'تم تحديث حالة طلبك رقم ' || v_changed.booking_number || '.', 'booking_status', '/customer/orders');
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_advance_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_advance_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_submit_quote(p_booking_id uuid, p_amount numeric, p_note text DEFAULT NULL)
RETURNS public.booking_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_booking public.bookings; v_service_type text; v_created public.booking_quotes; v_is_resubmission boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('provider'::public.app_role) THEN RAISE EXCEPTION 'provider_account_required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN RAISE EXCEPTION 'quote_amount_required'; END IF;
  IF length(trim(coalesce(p_note, ''))) > 2000 THEN RAISE EXCEPTION 'quote_note_too_long'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND provider_id = auth.uid() FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_assigned'; END IF;
  v_is_resubmission := v_booking.status = 'completed' AND EXISTS (
    SELECT 1 FROM public.booking_quotes q
    WHERE q.booking_id = p_booking_id AND q.provider_id = auth.uid() AND q.status = 'rejected'
      AND q.created_at = (SELECT max(q2.created_at) FROM public.booking_quotes q2 WHERE q2.booking_id = p_booking_id)
  );
  IF v_booking.status <> 'in_progress' AND NOT v_is_resubmission THEN RAISE EXCEPTION 'work_or_rejected_quote_required'; END IF;
  SELECT pricing_type INTO v_service_type FROM public.services WHERE id = v_booking.service_id;
  IF v_service_type = 'fixed' THEN RAISE EXCEPTION 'fixed_price_service'; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_quotes WHERE booking_id = p_booking_id AND status IN ('pending', 'accepted')) THEN
    RAISE EXCEPTION 'quote_already_pending_or_accepted';
  END IF;
  INSERT INTO public.booking_quotes(booking_id, provider_id, amount, note, status)
  VALUES (p_booking_id, auth.uid(), p_amount, nullif(trim(p_note), ''), 'pending') RETURNING * INTO v_created;
  IF NOT v_is_resubmission THEN
    UPDATE public.bookings SET status = 'completed', updated_at = now() WHERE id = p_booking_id;
    INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
    VALUES (p_booking_id, 'in_progress', 'completed', auth.uid(), 'أنهى الفني العمل وأرسل السعر لمراجعة الإدارة');
  END IF;
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (v_booking.customer_id, 'السعر قيد المراجعة', 'أرسل الفني سعرًا محدّثًا للطلب رقم ' || v_booking.booking_number || '. ستصلك الفاتورة بعد اعتماد الإدارة.', 'quote_submitted', '/customer/orders');
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  SELECT user_id, 'سعر فني بانتظار الاعتماد', 'أرسل الفني سعرًا للطلب رقم ' || v_booking.booking_number || '.', 'quote_review', '/admin/quotes'
  FROM public.user_roles WHERE role IN ('admin', 'sub_admin');
  RETURN v_created;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_submit_quote(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_submit_quote(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_booking_quote(p_quote_id uuid, p_note text)
RETURNS public.booking_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_quote public.booking_quotes; v_booking public.bookings; v_changed public.booking_quotes;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_note, ''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'quote_rejection_reason_required'; END IF;
  SELECT * INTO v_quote FROM public.booking_quotes WHERE id = p_quote_id FOR UPDATE;
  IF v_quote.id IS NULL OR v_quote.status <> 'pending' THEN RAISE EXCEPTION 'quote_not_pending'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_quote.booking_id FOR UPDATE;
  IF v_booking.id IS NULL OR v_booking.status <> 'completed' OR v_booking.provider_id <> v_quote.provider_id THEN
    RAISE EXCEPTION 'quote_booking_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = v_booking.id AND p.status IN ('paid', 'pending')) THEN
    RAISE EXCEPTION 'invoice_already_started';
  END IF;
  UPDATE public.booking_quotes SET status = 'rejected', admin_review_note = trim(p_note)
  WHERE id = p_quote_id RETURNING * INTO v_changed;
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_quote.provider_id, 'يلزم تعديل عرض السعر', 'رُفض عرض الطلب رقم ' || v_booking.booking_number || '. السبب: ' || trim(p_note) || '. يمكنك إرسال عرض جديد.', 'quote_rejected', '/provider/work-queue'),
    (v_booking.customer_id, 'عرض السعر قيد التعديل', 'طلبت الإدارة تعديل عرض السعر للطلب رقم ' || v_booking.booking_number || '.', 'quote_rejected', '/customer/orders');
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reject_booking_quote(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_booking_quote(uuid, text) TO authenticated;

