-- Stable provider service location. No background tracking is required.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS base_latitude numeric(9,6) CHECK (base_latitude BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS base_longitude numeric(9,6) CHECK (base_longitude BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS service_radius_km integer NOT NULL DEFAULT 50 CHECK (service_radius_km BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS base_location_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS provider_profiles_base_location_idx
  ON public.provider_profiles (approval_status, base_latitude, base_longitude);

-- Extend the existing onboarding RPC without changing the old signature.
CREATE OR REPLACE FUNCTION public.provider_submit_onboarding_with_certificate(
  p_full_name text,
  p_years integer,
  p_description text,
  p_phone text,
  p_city text,
  p_identity_front_path text,
  p_identity_back_path text,
  p_certificate_path text,
  p_cv_path text,
  p_service_ids uuid[],
  p_base_latitude numeric,
  p_base_longitude numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
BEGIN
  IF p_base_latitude IS NULL OR p_base_latitude < -90 OR p_base_latitude > 90 THEN
    RAISE EXCEPTION 'provider_base_latitude_required';
  END IF;
  IF p_base_longitude IS NULL OR p_base_longitude < -180 OR p_base_longitude > 180 THEN
    RAISE EXCEPTION 'provider_base_longitude_required';
  END IF;

  PERFORM public.provider_submit_onboarding_with_certificate(
    p_full_name, p_years, p_description, p_phone, p_city,
    p_identity_front_path, p_identity_back_path, p_certificate_path,
    p_cv_path, p_service_ids
  );

  UPDATE public.provider_profiles
  SET base_latitude = p_base_latitude,
      base_longitude = p_base_longitude,
      service_radius_km = 50,
      base_location_updated_at = now(),
      updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_assign_nearest_provider(p_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_provider uuid;
  v_distance numeric;
  v_previous_status public.booking_status;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.provider_id IS NOT NULL OR v_booking.status NOT IN ('pending', 'quoted', 'accepted') THEN RETURN v_booking; END IF;
  v_previous_status := v_booking.status;

  SELECT candidate.user_id, candidate.distance_km
    INTO v_provider, v_distance
  FROM (
    SELECT pp.user_id,
      6371 * 2 * asin(sqrt(
        power(sin(radians((pp.base_latitude - v_booking.latitude) / 2)), 2) +
        cos(radians(v_booking.latitude)) * cos(radians(pp.base_latitude)) *
        power(sin(radians((pp.base_longitude - v_booking.longitude) / 2)), 2)
      )) AS distance_km
    FROM public.provider_profiles pp
    JOIN public.profiles pr ON pr.id = pp.user_id AND pr.is_active
    JOIN public.provider_services ps ON ps.provider_id = pp.user_id AND ps.service_id = v_booking.service_id AND ps.is_active
    WHERE pp.approval_status = 'approved'
      AND pp.base_latitude IS NOT NULL AND pp.base_longitude IS NOT NULL
      AND v_booking.latitude IS NOT NULL AND v_booking.longitude IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.bookings busy
        WHERE busy.provider_id = pp.user_id
          AND busy.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress')
          AND v_booking.scheduled_date IS NOT NULL
          AND busy.scheduled_date = v_booking.scheduled_date
          AND coalesce(busy.scheduled_slot, '') = coalesce(v_booking.scheduled_slot, '')
      )
  ) candidate
  WHERE candidate.distance_km <= 50
  ORDER BY candidate.distance_km ASC
  LIMIT 1;

  IF v_provider IS NULL THEN RETURN v_booking; END IF;

  UPDATE public.bookings
  SET provider_id = v_provider, status = 'assigned', updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_previous_status, 'assigned', NULL,
          'تمت المطابقة التلقائية مع أقرب فني ضمن نطاق 50 كم وعلى بعد ' || round(v_distance, 1) || ' كم');

  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_provider, 'طلب جديد قريب منك', 'تم ترشيحك تلقائيًا لطلب مناسب لتخصصك وموقع خدمتك الأساسي.', 'booking_assigned', '/provider/overview'),
    (v_booking.customer_id, 'تم ترشيح فني لطلبك', 'تم العثور على أقرب فني معتمد ضمن نطاق 50 كم.', 'booking_assigned', '/customer/orders');

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_submit_onboarding_with_certificate(text, integer, text, text, text, text, text, text, text, uuid[], numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_submit_onboarding_with_certificate(text, integer, text, text, text, text, text, text, text, uuid[], numeric, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.auto_assign_nearest_provider(uuid) FROM PUBLIC, anon, authenticated;
