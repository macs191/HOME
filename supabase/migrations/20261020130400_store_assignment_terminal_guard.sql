-- Prevent an admin reassignment from reopening a terminal store order.
-- Keep the existing RPC signature and grants; authorization remains server-side.
CREATE OR REPLACE FUNCTION public.admin_assign_product_order(p_order_id uuid, p_provider_id uuid)
RETURNS public.product_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed public.product_orders;
  existing_order public.product_orders;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT * INTO existing_order
  FROM public.product_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF existing_order.id IS NULL OR NOT existing_order.installation_requested THEN
    RAISE EXCEPTION 'product_order_not_found_or_installation_not_requested';
  END IF;

  IF existing_order.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_order_transition';
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

  UPDATE public.product_orders
  SET provider_id = p_provider_id,
      status = 'assigned',
      installation_status = 'assigned',
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO changed;

  INSERT INTO public.product_installation_jobs(order_id, provider_id, status)
  VALUES (changed.id, p_provider_id, 'assigned')
  ON CONFLICT (order_id) DO UPDATE
    SET provider_id = EXCLUDED.provider_id,
        status = 'assigned',
        updated_at = now();

  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (changed.provider_id, 'طلب تركيب منتج', 'تم إسناد طلب متجر إليك. راجع المنتجات وسجل المواد المستخدمة.', 'product_installation_assigned', '/provider/work-queue');

  RETURN changed;
END;
$$;

-- Apply the same terminal-state protection to provider status updates.
CREATE OR REPLACE FUNCTION public.provider_update_product_order_status(p_order_id uuid, p_status text)
RETURNS public.product_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed public.product_orders;
BEGIN
  IF p_status NOT IN ('assigned', 'installing', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_product_order_status';
  END IF;

  PERFORM 1
  FROM public.provider_profiles pp
  JOIN public.profiles p ON p.id = pp.user_id
  WHERE pp.user_id = auth.uid()
    AND pp.approval_status = 'approved'
    AND p.is_active = true
  FOR SHARE OF pp, p;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_approved_or_inactive'; END IF;

  UPDATE public.product_orders
  SET status = p_status,
      installation_status = CASE
        WHEN p_status = 'assigned' THEN 'assigned'
        WHEN p_status = 'installing' THEN 'in_progress'
        WHEN p_status = 'completed' THEN 'completed'
        ELSE 'cancelled'
      END,
      updated_at = now()
  WHERE id = p_order_id
    AND provider_id = auth.uid()
    AND installation_requested
    AND status NOT IN ('completed', 'cancelled')
  RETURNING * INTO changed;

  IF changed.id IS NULL THEN
    RAISE EXCEPTION 'product_order_not_found_or_terminal';
  END IF;

  INSERT INTO public.product_installation_jobs(order_id, provider_id, status, started_at, completed_at, updated_at)
  VALUES (
    changed.id,
    auth.uid(),
    CASE WHEN p_status = 'installing' THEN 'in_progress' ELSE p_status END,
    CASE WHEN p_status = 'installing' THEN now() ELSE NULL END,
    CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (order_id) DO UPDATE
    SET status = EXCLUDED.status,
        started_at = coalesce(product_installation_jobs.started_at, EXCLUDED.started_at),
        completed_at = EXCLUDED.completed_at,
        updated_at = now();

  RETURN changed;
END;
$$;

-- Manual admin-created product orders must not assign an inactive provider.
CREATE OR REPLACE FUNCTION public.admin_create_manual_product_order(
  p_customer_id uuid,
  p_product_ids uuid[],
  p_provider_id uuid DEFAULT NULL,
  p_installation_requested boolean DEFAULT false,
  p_city text DEFAULT '',
  p_district text DEFAULT '',
  p_address_text text DEFAULT '',
  p_notes text DEFAULT ''
)
RETURNS public.product_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created public.product_orders;
  item record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_line numeric;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF coalesce(array_length(p_product_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'products_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_customer_id AND role = 'customer') THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;
  IF p_provider_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.provider_profiles pp
    JOIN public.profiles p ON p.id = pp.user_id
    WHERE pp.user_id = p_provider_id AND pp.approval_status = 'approved' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'provider_not_approved_or_inactive';
  END IF;

  INSERT INTO public.product_orders(customer_id, status, installation_requested, installation_status, provider_id, city, district, address_text, notes, subtotal, discount_amount, total_amount)
  VALUES (
    p_customer_id,
    CASE WHEN p_installation_requested AND p_provider_id IS NOT NULL THEN 'assigned' ELSE 'pending' END,
    p_installation_requested,
    CASE WHEN p_installation_requested AND p_provider_id IS NOT NULL THEN 'assigned' ELSE 'not_requested' END,
    p_provider_id,
    left(trim(p_city), 120), left(trim(p_district), 160), left(trim(p_address_text), 500), left(trim(p_notes), 2000), 0, 0, 0
  ) RETURNING * INTO created;

  FOR item IN SELECT pr.* FROM public.products pr WHERE pr.id = ANY(p_product_ids) AND pr.is_active FOR UPDATE LOOP
    IF item.stock_quantity < 1 THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
    UPDATE public.products
    SET stock_quantity = stock_quantity - 1, reserved_quantity = reserved_quantity + 1, updated_at = now()
    WHERE id = item.id AND stock_quantity >= 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
    v_line := item.price;
    v_subtotal := v_subtotal + v_line;
    v_discount := v_discount + (v_line * item.discount_percent / 100);
    INSERT INTO public.product_order_items(order_id, product_id, product_name_snapshot, unit_price, discount_percent_snapshot, quantity, line_total)
    VALUES (created.id, item.id, item.name_ar, item.price, item.discount_percent, 1, v_line - (v_line * item.discount_percent / 100));
  END LOOP;

  IF v_subtotal = 0 THEN RAISE EXCEPTION 'products_not_found'; END IF;
  UPDATE public.product_orders po
  SET subtotal = v_subtotal, discount_amount = v_discount, total_amount = v_subtotal - v_discount
  WHERE po.id = created.id RETURNING po.* INTO created;

  IF p_provider_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    VALUES (p_provider_id, 'تركيب منتج جديد', 'تم إسناد طلب منتج لك من الإدارة.', 'product_order_assigned', '/provider/work-queue');
  END IF;
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES (p_customer_id, 'تم تسجيل طلب المنتج', 'أضافت الإدارة طلب المنتج بالنيابة عنك.', 'product_order_created', '/customer/store-orders');
  RETURN created;
END;
$$;

-- CREATE OR REPLACE preserves existing ACLs, but state the expected grants explicitly.
REVOKE ALL ON FUNCTION public.admin_assign_product_order(uuid, uuid),
  public.provider_update_product_order_status(uuid, text),
  public.admin_create_manual_product_order(uuid, uuid[], uuid, boolean, text, text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_product_order(uuid, uuid),
  public.provider_update_product_order_status(uuid, text),
  public.admin_create_manual_product_order(uuid, uuid[], uuid, boolean, text, text, text, text)
TO authenticated;
