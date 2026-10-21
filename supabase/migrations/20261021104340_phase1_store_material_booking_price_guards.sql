-- Phase 1 remediations: make terminal installation materials immutable through
-- both RPC and direct table writes, and reject invalid manual-booking prices.

-- This trigger is the last-line invariant for RPC, dashboard, and any other
-- authenticated INSERT/UPDATE path into product_order_materials.
CREATE OR REPLACE FUNCTION public.guard_product_order_material_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  order_row public.product_orders;
  job_status text;
BEGIN
  SELECT * INTO order_row
  FROM public.product_orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF order_row.id IS NULL OR NOT order_row.installation_requested THEN
    RAISE EXCEPTION 'installation_order_not_found';
  END IF;
  IF order_row.status IN ('completed', 'cancelled')
     OR order_row.installation_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'installation_job_terminal';
  END IF;

  -- Also honor a terminal job row if legacy/admin data has diverged.
  SELECT status INTO job_status
  FROM public.product_installation_jobs
  WHERE order_id = NEW.order_id
  FOR UPDATE;
  IF job_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'installation_job_terminal';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_product_order_material_open()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_product_order_material_open ON public.product_order_materials;
CREATE TRIGGER guard_product_order_material_open
BEFORE INSERT OR UPDATE ON public.product_order_materials
FOR EACH ROW EXECUTE FUNCTION public.guard_product_order_material_open();

-- The RPC additionally locks and authorizes the order before insert. The trigger
-- above enforces the same terminal-state invariant for direct table operations.
CREATE OR REPLACE FUNCTION public.add_product_order_material(
  p_order_id uuid,
  p_material_name text,
  p_quantity numeric,
  p_unit_cost numeric DEFAULT 0,
  p_product_id uuid DEFAULT NULL
)
RETURNS public.product_order_materials
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created public.product_order_materials;
  order_row public.product_orders;
  is_admin_user boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;
  is_admin_user := public.is_admin();
  IF NOT is_admin_user AND NOT public.has_role('provider'::public.app_role) THEN
    RAISE EXCEPTION 'installation_access_required';
  END IF;

  SELECT * INTO order_row
  FROM public.product_orders
  WHERE id = p_order_id AND installation_requested
  FOR UPDATE;
  IF order_row.id IS NULL THEN
    RAISE EXCEPTION 'installation_order_not_found';
  END IF;
  IF order_row.status IN ('completed', 'cancelled')
     OR order_row.installation_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'installation_job_terminal';
  END IF;
  IF order_row.provider_id IS NULL
     OR (order_row.provider_id <> auth.uid() AND NOT is_admin_user) THEN
    RAISE EXCEPTION 'installation_access_required';
  END IF;

  IF NOT is_admin_user THEN
    PERFORM 1
    FROM public.provider_profiles pp
    JOIN public.profiles pr ON pr.id = pp.user_id
    WHERE pp.user_id = auth.uid()
      AND pp.approval_status = 'approved'
      AND pr.is_active = true
    FOR SHARE OF pp, pr;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider_not_approved_or_inactive';
    END IF;
  END IF;

  IF char_length(trim(coalesce(p_material_name, ''))) NOT BETWEEN 1 AND 200
     OR p_quantity IS NULL OR p_quantity <= 0
     OR p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'invalid_material';
  END IF;

  INSERT INTO public.product_order_materials(
    order_id, product_id, material_name, quantity, unit_cost, source, recorded_by
  )
  VALUES (
    p_order_id, p_product_id, left(trim(p_material_name), 200), p_quantity,
    p_unit_cost, CASE WHEN p_product_id IS NULL THEN 'manual' ELSE 'catalog' END,
    auth.uid()
  )
  RETURNING * INTO created;
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.add_product_order_material(uuid, text, numeric, numeric, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_product_order_material(uuid, text, numeric, numeric, uuid)
  TO authenticated;

-- Preserve NULL as the existing "price not set yet" flow; reject negative and
-- special numeric values before creating the booking.
CREATE OR REPLACE FUNCTION public.admin_create_manual_booking(
  p_customer_id uuid,
  p_service_id uuid,
  p_provider_id uuid DEFAULT NULL,
  p_city text DEFAULT '',
  p_district text DEFAULT '',
  p_address_text text DEFAULT '',
  p_issue_description text DEFAULT '',
  p_urgency text DEFAULT 'normal',
  p_scheduled_date date DEFAULT NULL,
  p_scheduled_slot text DEFAULT NULL,
  p_price numeric DEFAULT NULL
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created public.bookings;
  target_status public.booking_status;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_price IS NOT NULL
     AND (p_price < 0 OR p_price::text IN ('NaN', 'Infinity', '-Infinity')) THEN
    RAISE EXCEPTION 'invalid_booking_price';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_customer_id AND role = 'customer'
  ) THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.services WHERE id = p_service_id AND is_active
  ) THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;
  IF p_provider_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    JOIN public.profiles pr ON pr.id = pp.user_id
    WHERE pp.user_id = p_provider_id
      AND pp.approval_status = 'approved'
      AND pr.is_active = true
  ) THEN
    RAISE EXCEPTION 'provider_not_approved_or_inactive';
  END IF;

  target_status := CASE
    WHEN p_provider_id IS NULL THEN 'pending'::public.booking_status
    ELSE 'assigned'::public.booking_status
  END;
  INSERT INTO public.bookings(
    customer_id, service_id, provider_id, city, district, address_text,
    issue_description, urgency, scheduled_date, scheduled_slot, status,
    price_snapshot, location_source
  )
  VALUES (
    p_customer_id, p_service_id, p_provider_id,
    left(trim(p_city), 120), left(trim(p_district), 160),
    left(trim(p_address_text), 500), left(trim(p_issue_description), 2000),
    CASE WHEN p_urgency = 'urgent' THEN 'urgent' ELSE 'normal' END,
    p_scheduled_date, left(trim(coalesce(p_scheduled_slot, '')), 80),
    target_status, p_price, 'none'
  )
  RETURNING * INTO created;

  INSERT INTO public.booking_status_history(booking_id, to_status, changed_by, note)
  VALUES (created.id, target_status, auth.uid(), 'أنشأته الإدارة نيابة عن العميل.');
  IF p_provider_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    VALUES (p_provider_id, 'طلب جديد من الإدارة', 'تم إسناد طلب جديد لك مباشرة من لوحة الإدارة.', 'booking_assigned', '/provider/work-queue');
  END IF;
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (p_customer_id, 'تم إنشاء طلبك', 'أنشأت الإدارة طلب خدمة بالنيابة عنك.', 'booking_created', '/customer/orders');
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_manual_booking(uuid, uuid, uuid, text, text, text, text, text, date, text, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_manual_booking(uuid, uuid, uuid, text, text, text, text, text, date, text, numeric)
  TO authenticated;
