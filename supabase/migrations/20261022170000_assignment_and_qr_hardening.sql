-- Final assignment hardening: one authoritative guard for manual and automatic assignment.
CREATE OR REPLACE FUNCTION public.admin_assign_booking_safe(p_booking_id uuid, p_provider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  x public.bookings;
  v_previous_status public.booking_status;
  v_service_name text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_booking_id IS NULL OR p_provider_id IS NULL THEN RAISE EXCEPTION 'booking_and_provider_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.provider_id IS NOT NULL OR x.status NOT IN ('pending','quoted','accepted') THEN
    RAISE EXCEPTION 'booking_not_assignable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_profiles pp
    JOIN public.profiles p ON p.id = pp.user_id
    JOIN public.user_roles r ON r.user_id = pp.user_id AND r.role = 'provider'::public.app_role
    WHERE pp.user_id = p_provider_id AND pp.approval_status = 'approved' AND p.is_active = true
  ) THEN RAISE EXCEPTION 'provider_not_approved_or_active'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_services ps
    WHERE ps.provider_id = p_provider_id AND ps.service_id = x.service_id AND ps.is_active = true
  ) THEN RAISE EXCEPTION 'provider_not_qualified_for_service'; END IF;
  IF NOT public.provider_schedule_allows_booking(p_provider_id, x.scheduled_date, x.scheduled_slot) THEN
    RAISE EXCEPTION 'provider_schedule_unavailable';
  END IF;
  IF x.scheduled_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id <> x.id AND b.provider_id = p_provider_id
      AND b.scheduled_date = x.scheduled_date
      AND b.status IN ('assigned','on_the_way','arrived','in_progress')
      AND public.booking_slots_overlap(b.scheduled_slot, x.scheduled_slot)
  ) THEN RAISE EXCEPTION 'provider_schedule_conflict'; END IF;
  v_previous_status := x.status;
  SELECT name_ar INTO v_service_name FROM public.services WHERE id = x.service_id;
  UPDATE public.bookings SET provider_id = p_provider_id, status = 'assigned', updated_at = now()
    WHERE id = x.id RETURNING * INTO x;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
    VALUES (x.id, v_previous_status, 'assigned', auth.uid(), 'تم إسناد الطلب يدويًا بعد التحقق من التخصص والتوفر');
  INSERT INTO public.notifications(user_id,title,body,notification_type,target_path) VALUES
    (p_provider_id, 'طلب جديد أُسند إليك', 'تم إسناد ' || coalesce(v_service_name,'خدمة منزلية') || ' إليك. افتح لوحة الفني لمراجعة الطلب.', 'booking_assigned', '/provider/work-queue'),
    (x.customer_id, 'تم إسناد فني لطلبك', 'تم إسناد فني لطلبك رقم ' || x.booking_number || '.', 'booking_assigned', '/customer/orders');
  RETURN jsonb_build_object('id',x.id,'status',x.status,'provider_id',x.provider_id);
END $$;

-- Allow the app to start a Stripe checkout from a scanned invoice link.
-- The Edge Function remains the only component that talks to Stripe.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash','bank_transfer','card'));
