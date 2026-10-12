-- Notify the provider and customer atomically when an administrator assigns a booking.
CREATE OR REPLACE FUNCTION public.assign_booking(p_booking_id uuid, p_provider_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed public.bookings;
  previous_status public.booking_status;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_profiles
    WHERE user_id = p_provider_id AND approval_status = 'approved'
  ) THEN RAISE EXCEPTION 'provider_not_approved'; END IF;
  SELECT status INTO previous_status FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF previous_status IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  UPDATE public.bookings
  SET provider_id = p_provider_id, status = 'assigned', updated_at = now()
  WHERE id = p_booking_id RETURNING * INTO changed;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, previous_status, 'assigned', auth.uid(), 'تم إسناد الطلب من لوحة الإدارة');
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (p_provider_id, 'طلب جديد مسند إليك', 'تم إسناد الطلب رقم ' || changed.booking_number || ' إليك. افتح صندوق الطلبات لمراجعته.', 'booking_assigned', '/provider/work-queue'),
    (changed.customer_id, 'تم إسناد فني لطلبك', 'أُسند الطلب رقم ' || changed.booking_number || ' إلى أحد الفنيين.', 'booking_status', '/customer/orders');
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_booking(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assign_booking(uuid, uuid) TO authenticated;

-- Notify every administrator when a customer submits a new service request.
CREATE OR REPLACE FUNCTION public.notify_admin_booking_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  SELECT user_id, 'طلب خدمة جديد', 'وصل طلب خدمة جديد برقم ' || NEW.booking_number || ' ويحتاج إلى المتابعة.', 'booking_new', '/admin/operations'
  FROM public.user_roles WHERE role IN ('admin', 'sub_admin');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_admin_booking_created() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS notify_admin_booking_created ON public.bookings;
CREATE TRIGGER notify_admin_booking_created
AFTER INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_booking_created();

-- Notify administrators when a provider first submits an application or resubmits after rejection.
CREATE OR REPLACE FUNCTION public.notify_admin_provider_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.onboarding_completed AND NEW.approval_status = 'pending'
     AND (TG_OP = 'INSERT' OR NOT OLD.onboarding_completed OR OLD.approval_status IS DISTINCT FROM 'pending') THEN
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    SELECT user_id, 'طلب اعتماد فني جديد', 'وصل ملف مهني جديد أو محدّث ويحتاج إلى مراجعة الإدارة.', 'provider_application', '/admin/applications'
    FROM public.user_roles WHERE role IN ('admin', 'sub_admin');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_admin_provider_submission() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS notify_admin_provider_submission ON public.provider_profiles;
CREATE TRIGGER notify_admin_provider_submission
AFTER INSERT OR UPDATE OF onboarding_completed, approval_status ON public.provider_profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_provider_submission();
