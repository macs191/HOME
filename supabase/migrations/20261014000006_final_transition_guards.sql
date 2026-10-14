CREATE OR REPLACE FUNCTION public.provider_advance_booking(p_booking_id uuid)
RETURNS public.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_booking public.bookings; v_next public.booking_status; v_changed public.bookings; v_label text;
BEGIN
  IF NOT public.has_role('provider'::public.app_role) THEN RAISE EXCEPTION 'provider_account_required'; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id=p_booking_id AND provider_id=auth.uid() FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_assigned'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_profiles pp JOIN public.profiles p ON p.id=pp.user_id WHERE pp.user_id=auth.uid() AND pp.approval_status IN ('approved','pending') AND p.is_active=true) THEN RAISE EXCEPTION 'provider_not_active'; END IF;
  v_next := CASE v_booking.status WHEN 'assigned' THEN 'on_the_way'::public.booking_status WHEN 'on_the_way' THEN 'arrived'::public.booking_status WHEN 'arrived' THEN 'in_progress'::public.booking_status ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'invalid_provider_transition'; END IF;
  v_label := CASE v_next WHEN 'on_the_way' THEN 'الفني في الطريق' WHEN 'arrived' THEN 'وصل الفني' ELSE 'بدأ تنفيذ العمل' END;
  UPDATE public.bookings SET status=v_next,updated_at=now() WHERE id=p_booking_id RETURNING * INTO v_changed;
  INSERT INTO public.booking_status_history(booking_id,from_status,to_status,changed_by,note) VALUES (p_booking_id,v_booking.status,v_next,auth.uid(),v_label);
  INSERT INTO public.notifications(user_id,title,body,notification_type,target_path) VALUES (v_changed.customer_id,v_label,'تم تحديث حالة طلبك رقم '||v_changed.booking_number||'.','booking_status','/customer/orders');
  RETURN v_changed;
END $$;

CREATE OR REPLACE FUNCTION public.admin_assign_booking_safe(p_booking_id uuid,p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_booking_id IS NULL OR p_provider_id IS NULL THEN RAISE EXCEPTION 'booking_and_provider_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_profiles pp JOIN public.profiles p ON p.id=pp.user_id JOIN public.user_roles ur ON ur.user_id=pp.user_id WHERE pp.user_id=p_provider_id AND pp.approval_status='approved' AND p.is_active=true AND ur.role='provider'::public.app_role) THEN RAISE EXCEPTION 'provider_not_approved_or_active'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.provider_id IS NOT NULL OR x.status NOT IN ('pending','quoted','accepted') THEN RAISE EXCEPTION 'booking_not_assignable'; END IF;
  x := public.assign_booking(p_booking_id,p_provider_id);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'provider_id',x.provider_id);
END $$;
CREATE OR REPLACE FUNCTION public.admin_reassign_booking_safe(p_booking_id uuid,p_provider_id uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 OR p_provider_id IS NULL THEN RAISE EXCEPTION 'reason_and_provider_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_profiles pp JOIN public.profiles p ON p.id=pp.user_id JOIN public.user_roles ur ON ur.user_id=pp.user_id WHERE pp.user_id=p_provider_id AND pp.approval_status='approved' AND p.is_active=true AND ur.role='provider'::public.app_role) THEN RAISE EXCEPTION 'provider_not_approved_or_active'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.provider_id IS NULL OR x.provider_id=p_provider_id OR x.status NOT IN ('assigned','on_the_way','arrived') OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id=x.id) THEN RAISE EXCEPTION 'booking_not_reassignable'; END IF;
  x := public.admin_reassign_booking(p_booking_id,p_provider_id,p_note);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'provider_id',x.provider_id);
END $$;
CREATE OR REPLACE FUNCTION public.admin_unassign_booking_safe(p_booking_id uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.provider_id IS NULL OR x.status NOT IN ('assigned','on_the_way','arrived') OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id=x.id) THEN RAISE EXCEPTION 'booking_not_unassignable'; END IF;
  x := public.admin_unassign_booking(p_booking_id,p_note);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'provider_id',x.provider_id);
END $$;
CREATE OR REPLACE FUNCTION public.customer_cancel_booking_safe(p_booking_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN RAISE EXCEPTION 'customer_account_required'; END IF;
  IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id AND customer_id=auth.uid() FOR UPDATE;
  IF x.id IS NULL OR x.status NOT IN ('pending','quoted','accepted','assigned') OR x.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id=x.id) THEN RAISE EXCEPTION 'booking_not_customer_cancellable'; END IF;
  x := public.customer_cancel_booking(p_booking_id,p_reason);
  UPDATE public.booking_quotes SET status='expired' WHERE booking_id=x.id AND status='pending';
  RETURN jsonb_build_object('id',x.id,'status',x.status,'cancellation_reason',x.cancellation_reason);
END $$;
CREATE OR REPLACE FUNCTION public.admin_cancel_booking_safe(p_booking_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.status NOT IN ('pending','quoted','accepted','assigned','on_the_way','arrived') OR x.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id=x.id) THEN RAISE EXCEPTION 'booking_not_admin_cancellable'; END IF;
  x := public.admin_cancel_booking(p_booking_id,p_reason);
  UPDATE public.booking_quotes SET status='expired' WHERE booking_id=x.id AND status='pending';
  RETURN jsonb_build_object('id',x.id,'status',x.status,'cancellation_reason',x.cancellation_reason);
END $$;
CREATE OR REPLACE FUNCTION public.customer_select_invoice_payment_safe(p_payment_id uuid,p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.payments; x public.payments;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN RAISE EXCEPTION 'customer_account_required'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=p_payment_id AND status IN ('unpaid','failed') FOR UPDATE;
  IF p.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.booking_id AND b.customer_id=auth.uid() AND b.status='completed') THEN RAISE EXCEPTION 'invoice_not_selectable'; END IF;
  IF p_method NOT IN ('cash','bank_transfer') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;
  x := public.customer_select_invoice_payment(p_payment_id,p_method);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'amount',x.amount,'status',x.status,'payment_method',x.payment_method);
END $$;
CREATE OR REPLACE FUNCTION public.customer_submit_transfer_reference_safe(p_payment_id uuid,p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.payments; x public.payments;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN RAISE EXCEPTION 'customer_account_required'; END IF;
  IF length(trim(coalesce(p_reference,''))) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'transfer_reference_required'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=p_payment_id AND status='pending' AND payment_method='bank_transfer' FOR UPDATE;
  IF p.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.booking_id AND b.customer_id=auth.uid() AND b.status='completed') THEN RAISE EXCEPTION 'transfer_not_submittable'; END IF;
  x := public.customer_submit_transfer_reference(p_payment_id,p_reference);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'status',x.status,'receipt_reference',x.receipt_reference);
END $$;
CREATE OR REPLACE FUNCTION public.update_my_account_profile_safe(p_full_name text,p_phone text,p_city text,p_years integer,p_service_description text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.profiles; v_approval text; v_old_years integer; v_old_description text; v_review_required boolean := false;
BEGIN
  IF public.has_role('provider'::public.app_role) THEN
    SELECT years_experience,service_description INTO v_old_years,v_old_description FROM public.provider_profiles WHERE user_id=auth.uid() FOR UPDATE;
  END IF;
  SELECT * INTO x FROM public.update_my_account_profile(p_full_name,p_phone,p_city,p_years,p_service_description);
  IF public.has_role('provider'::public.app_role) THEN
    SELECT approval_status,(years_experience IS DISTINCT FROM v_old_years OR service_description IS DISTINCT FROM v_old_description) INTO v_approval,v_review_required FROM public.provider_profiles WHERE user_id=auth.uid();
  END IF;
  RETURN jsonb_build_object('id',x.id,'full_name',x.full_name,'phone',x.phone,'city',x.city,'approval_status',v_approval,'review_required',coalesce(v_review_required,false));
END $$;
CREATE OR REPLACE FUNCTION public.provider_set_specialties_review_safe(p_service_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old uuid[]; v_new uuid[]; v_count integer; v_changed boolean; v_status text; v_approval text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('provider'::public.app_role) THEN RAISE EXCEPTION 'provider_account_required'; END IF;
  IF p_service_ids IS NULL OR cardinality(p_service_ids)<1 OR cardinality(p_service_ids)>20 THEN RAISE EXCEPTION 'invalid_specialty_count'; END IF;
  SELECT approval_status::text INTO v_status FROM public.provider_profiles pp JOIN public.profiles p ON p.id=pp.user_id WHERE pp.user_id=auth.uid() AND p.is_active=true FOR UPDATE OF pp;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_profile_required'; END IF;
  IF v_status='suspended' THEN RAISE EXCEPTION 'provider_profile_suspended'; END IF;
  SELECT coalesce(array_agg(service_id ORDER BY service_id),'{}'::uuid[]) INTO v_old FROM public.provider_services WHERE provider_id=auth.uid() AND is_active;
  SELECT coalesce(array_agg(DISTINCT service_id ORDER BY service_id),'{}'::uuid[]) INTO v_new FROM unnest(p_service_ids) AS service_id;
  v_changed := v_old IS DISTINCT FROM v_new;
  v_count := public.provider_set_specialties(p_service_ids);
  IF v_changed THEN
    IF v_status IN ('approved','rejected') THEN UPDATE public.provider_profiles SET approval_status='pending',updated_at=now() WHERE user_id=auth.uid(); END IF;
    INSERT INTO public.notifications(user_id,title,body,notification_type,target_path)
      SELECT ur.user_id,'طلبت مراجعة تخصصات الفني','حدّث فني تخصصاته؛ راجع الملف قبل إسناد أعمال جديدة.','provider_review','/admin/providers'
      FROM public.user_roles ur JOIN public.profiles pr ON pr.id=ur.user_id AND pr.is_active WHERE ur.role='admin';
    INSERT INTO public.notifications(user_id,title,body,notification_type,target_path)
      VALUES (auth.uid(),'تخصصاتك قيد المراجعة','حُفظت التخصصات، وسيُراجعها فريق الإدارة قبل استقبال أعمال جديدة.','provider_review','/provider/settings');
  END IF;
  SELECT approval_status INTO v_approval FROM public.provider_profiles WHERE user_id=auth.uid();
  RETURN jsonb_build_object('saved_count',v_count,'approval_status',v_approval,'changed',v_changed);
END $$;

REVOKE ALL ON FUNCTION public.provider_set_specialties(uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.provider_set_specialties_review_safe(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.provider_set_specialties_review_safe(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_assign_booking_safe(uuid,uuid), public.admin_reassign_booking_safe(uuid,uuid,text), public.admin_unassign_booking_safe(uuid,text), public.customer_cancel_booking_safe(uuid,text), public.admin_cancel_booking_safe(uuid,text), public.provider_advance_booking_safe(uuid), public.provider_submit_quote_safe(uuid,numeric,text), public.provider_finish_fixed_booking_safe(uuid), public.admin_reject_booking_quote_safe(uuid,text), public.admin_accept_booking_quote_safe(uuid), public.admin_review_invoice_payment_safe(uuid,boolean,text), public.add_provider_ledger_entry_safe(uuid,uuid,text,numeric,text), public.customer_select_invoice_payment_safe(uuid,text), public.customer_submit_transfer_reference_safe(uuid,text), public.update_my_account_profile_safe(text,text,text,integer,text), public.register_booking_attachment_safe(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_booking_safe(uuid,uuid), public.admin_reassign_booking_safe(uuid,uuid,text), public.admin_unassign_booking_safe(uuid,text), public.customer_cancel_booking_safe(uuid,text), public.admin_cancel_booking_safe(uuid,text), public.provider_advance_booking_safe(uuid), public.provider_submit_quote_safe(uuid,numeric,text), public.provider_finish_fixed_booking_safe(uuid), public.admin_reject_booking_quote_safe(uuid,text), public.admin_accept_booking_quote_safe(uuid), public.admin_review_invoice_payment_safe(uuid,boolean,text), public.add_provider_ledger_entry_safe(uuid,uuid,text,numeric,text), public.customer_select_invoice_payment_safe(uuid,text), public.customer_submit_transfer_reference_safe(uuid,text), public.update_my_account_profile_safe(text,text,text,integer,text), public.register_booking_attachment_safe(uuid,text,bigint) TO authenticated;
