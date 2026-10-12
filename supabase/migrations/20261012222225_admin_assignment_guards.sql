-- Restore server-side assignment invariants. The RPC signature remains unchanged for the deployed UI.
CREATE OR REPLACE FUNCTION public.assign_booking(p_booking_id uuid, p_provider_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed public.bookings;
  current_booking public.bookings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT * INTO current_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF current_booking.id IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  IF current_booking.provider_id IS NOT NULL
     OR current_booking.status NOT IN ('pending', 'quoted', 'accepted') THEN
    RAISE EXCEPTION 'booking_not_assignable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    JOIN public.profiles p ON p.id = pp.user_id
    WHERE pp.user_id = p_provider_id
      AND pp.approval_status = 'approved'
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'provider_not_approved_or_inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_services ps
    WHERE ps.provider_id = p_provider_id
      AND ps.service_id = current_booking.service_id
      AND ps.is_active = true
  ) THEN
    RAISE EXCEPTION 'provider_not_qualified_for_service';
  END IF;

  UPDATE public.bookings
  SET provider_id = p_provider_id, status = 'assigned', updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO changed;

  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, current_booking.status, 'assigned', auth.uid(), 'تم إسناد الطلب من لوحة الإدارة');

  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (p_provider_id, 'طلب جديد مسند إليك', 'تم إسناد الطلب رقم ' || changed.booking_number || ' إليك. افتح صندوق الطلبات لمراجعته.', 'booking_assigned', '/provider/work-queue'),
    (changed.customer_id, 'تم إسناد فني لطلبك', 'أُسند الطلب رقم ' || changed.booking_number || ' إلى أحد الفنيين.', 'booking_status', '/customer/orders');

  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_booking(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assign_booking(uuid, uuid) TO authenticated;
