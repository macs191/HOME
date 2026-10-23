CREATE OR REPLACE FUNCTION public.get_booking_call_participants(p_booking_id uuid)
RETURNS TABLE(user_id uuid, display_name text, participant_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_customer uuid; v_provider uuid;
BEGIN
  SELECT b.customer_id, b.provider_id INTO v_customer, v_provider FROM public.bookings b WHERE b.id = p_booking_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF auth.uid() <> v_customer AND (v_provider IS NULL OR auth.uid() <> v_provider) AND NOT public.is_admin() THEN RAISE EXCEPTION 'booking_call_forbidden'; END IF;
  RETURN QUERY SELECT p.id, coalesce(nullif(trim(p.full_name), ''), 'العميل'), 'customer'::text FROM public.profiles p WHERE p.id = v_customer;
  IF v_provider IS NOT NULL THEN RETURN QUERY SELECT p.id, coalesce(nullif(trim(p.full_name), ''), 'الفني'), 'provider'::text FROM public.profiles p WHERE p.id = v_provider; END IF;
  RETURN QUERY SELECT p.id, coalesce(nullif(trim(p.full_name), ''), 'الإدارة'), 'admin'::text FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id WHERE r.role::text IN ('admin','sub_admin') AND p.is_active = true LIMIT 10;
END; $$;
REVOKE ALL ON FUNCTION public.get_booking_call_participants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_call_participants(uuid) TO authenticated;
