-- Geographic dispatch for HOME SERVICE.
-- Matching uses a Haversine distance calculation without PostGIS so it works
-- with the existing latitude/longitude columns and keeps the provider location private.

CREATE TABLE IF NOT EXISTS public.provider_locations (
  provider_id uuid PRIMARY KEY REFERENCES public.provider_profiles(user_id) ON DELETE CASCADE,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters numeric(10,2),
  captured_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  sharing_context text CHECK (sharing_context IN ('work', 'assigned_booking'))
);

CREATE INDEX IF NOT EXISTS provider_locations_freshness_idx
  ON public.provider_locations (captured_at DESC, expires_at);

ALTER TABLE public.provider_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "providers read own location" ON public.provider_locations;
CREATE POLICY "providers read own location"
  ON public.provider_locations FOR SELECT TO authenticated
  USING (provider_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "admins read provider locations" ON public.provider_locations;
CREATE POLICY "admins read provider locations"
  ON public.provider_locations FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.provider_update_location(
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric DEFAULT NULL
)
RETURNS public.provider_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location public.provider_locations;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider_account_required';
  END IF;
  IF p_latitude IS NULL OR p_latitude < -90 OR p_latitude > 90 THEN
    RAISE EXCEPTION 'invalid_latitude';
  END IF;
  IF p_longitude IS NULL OR p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'invalid_longitude';
  END IF;
  IF p_accuracy_meters IS NOT NULL AND (p_accuracy_meters < 0 OR p_accuracy_meters > 10000) THEN
    RAISE EXCEPTION 'invalid_location_accuracy';
  END IF;

  INSERT INTO public.provider_locations (
    provider_id, latitude, longitude, accuracy_meters, captured_at, expires_at, sharing_context
  ) VALUES (
    auth.uid(), p_latitude, p_longitude, p_accuracy_meters, now(), now() + interval '15 minutes', 'work'
  )
  ON CONFLICT (provider_id) DO UPDATE SET
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_meters = excluded.accuracy_meters,
    captured_at = excluded.captured_at,
    expires_at = excluded.expires_at,
    sharing_context = excluded.sharing_context
  RETURNING * INTO v_location;

  UPDATE public.provider_profiles
  SET location_sharing_enabled = true,
      availability_status = 'available',
      updated_at = now()
  WHERE user_id = auth.uid();

  RETURN v_location;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_set_availability(p_status text)
RETURNS public.provider_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.provider_profiles;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider_account_required';
  END IF;
  IF p_status NOT IN ('available', 'busy', 'offline') THEN
    RAISE EXCEPTION 'invalid_availability_status';
  END IF;

  UPDATE public.provider_profiles
  SET availability_status = p_status,
      location_sharing_enabled = p_status = 'available',
      updated_at = now()
  WHERE user_id = auth.uid()
  RETURNING * INTO v_profile;

  IF v_profile.user_id IS NULL THEN
    RAISE EXCEPTION 'provider_profile_missing';
  END IF;
  RETURN v_profile;
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
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;
  IF v_booking.provider_id IS NOT NULL OR v_booking.status NOT IN ('pending', 'quoted', 'accepted') THEN
    RETURN v_booking;
  END IF;

  WITH candidates AS (
    SELECT
      pp.user_id,
      CASE
        WHEN v_booking.latitude IS NULL OR v_booking.longitude IS NULL THEN
          CASE WHEN lower(coalesce(pr.city, '')) = lower(coalesce(v_booking.city, '')) THEN 0 ELSE 1 END
        ELSE 6371 * 2 * asin(sqrt(
          power(sin(radians((pl.latitude - v_booking.latitude) / 2)), 2) +
          cos(radians(v_booking.latitude)) * cos(radians(pl.latitude)) *
          power(sin(radians((pl.longitude - v_booking.longitude) / 2)), 2)
        ))
      END AS distance_km,
      pl.captured_at
    FROM public.provider_profiles pp
    JOIN public.profiles pr ON pr.id = pp.user_id AND pr.is_active
    JOIN public.provider_services ps ON ps.provider_id = pp.user_id AND ps.service_id = v_booking.service_id AND ps.is_active
    JOIN public.provider_locations pl ON pl.provider_id = pp.user_id
    WHERE pp.approval_status = 'approved'
      AND pp.availability_status = 'available'
      AND pp.location_sharing_enabled
      AND pl.expires_at > now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings busy
        WHERE busy.provider_id = pp.user_id
          AND busy.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress')
          AND v_booking.scheduled_date IS NOT NULL
          AND busy.scheduled_date = v_booking.scheduled_date
          AND coalesce(busy.scheduled_slot, '') = coalesce(v_booking.scheduled_slot, '')
      )
    ORDER BY distance_km ASC, pl.captured_at DESC
    LIMIT 1
    FOR UPDATE OF pp SKIP LOCKED
  )
  SELECT user_id, distance_km INTO v_provider, v_distance FROM candidates;

  IF v_provider IS NULL THEN
    RETURN v_booking;
  END IF;

  UPDATE public.bookings
  SET provider_id = v_provider,
      status = 'assigned',
      updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  INSERT INTO public.booking_status_history (
    booking_id, from_status, to_status, changed_by, note
  ) VALUES (
    p_booking_id, 'pending', 'assigned', NULL,
    'تمت المطابقة التلقائية مع أقرب فني متاح على بعد ' || round(v_distance, 1) || ' كم'
  );

  INSERT INTO public.notifications (user_id, title, body, notification_type, target_path)
  VALUES
    (v_provider, 'طلب جديد قريب منك', 'تم ترشيحك تلقائيًا لطلب مناسب لتخصصك وموقعك. افتح صندوق الطلبات لمراجعة التفاصيل.', 'booking_assigned', '/provider/work-queue'),
    (v_booking.customer_id, 'تم ترشيح فني لطلبك', 'تم العثور على أقرب فني متاح مناسب للخدمة، ويمكنك متابعة حالة الطلب من حسابك.', 'booking_assigned', '/customer/orders');

  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_auto_assign_nearest_booking(p_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  RETURN public.auto_assign_nearest_provider(p_booking_id);
END;
$$;

-- Rebuild the consent-aware create RPC so each new request enters dispatch immediately.
CREATE OR REPLACE FUNCTION public.create_booking_with_consent(
  p_service_id uuid,
  p_city text,
  p_district text,
  p_address_text text,
  p_access_notes text,
  p_latitude numeric,
  p_longitude numeric,
  p_location_source public.location_source,
  p_issue_description text,
  p_urgency text,
  p_scheduled_date date,
  p_scheduled_slot text,
  p_policy_accepted boolean,
  p_policy_version text
) RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_booking public.bookings;
  selected_service public.services;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN
    RAISE EXCEPTION 'customer_account_required';
  END IF;
  IF p_policy_accepted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'policy_acceptance_required';
  END IF;
  IF p_policy_version IS DISTINCT FROM 'home-booking-terms-v1' THEN
    RAISE EXCEPTION 'policy_version_invalid';
  END IF;

  SELECT * INTO selected_service FROM public.services WHERE id = p_service_id AND is_active = true;
  IF selected_service.id IS NULL THEN RAISE EXCEPTION 'service_unavailable'; END IF;
  IF selected_service.pricing_type = 'fixed' AND (selected_service.base_price IS NULL OR selected_service.base_price <= 0) THEN
    RAISE EXCEPTION 'fixed_price_not_configured';
  END IF;
  IF nullif(trim(p_city), '') IS NULL OR nullif(trim(p_address_text), '') IS NULL OR nullif(trim(p_issue_description), '') IS NULL THEN
    RAISE EXCEPTION 'booking_details_required';
  END IF;
  IF p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90) THEN RAISE EXCEPTION 'invalid_latitude'; END IF;
  IF p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180) THEN RAISE EXCEPTION 'invalid_longitude'; END IF;

  INSERT INTO public.bookings (
    customer_id, service_id, city, district, address_text, access_notes,
    latitude, longitude, location_source, location_captured_at,
    issue_description, urgency, scheduled_date, scheduled_slot,
    status, price_snapshot, policy_accepted_at, policy_version
  ) VALUES (
    auth.uid(), p_service_id, trim(p_city), nullif(trim(p_district), ''), trim(p_address_text), nullif(trim(p_access_notes), ''),
    p_latitude, p_longitude, p_location_source, CASE WHEN p_location_source = 'gps' THEN now() ELSE NULL END,
    trim(p_issue_description), CASE WHEN p_urgency = 'urgent' THEN 'urgent' ELSE 'normal' END,
    p_scheduled_date, nullif(trim(p_scheduled_slot), ''), 'pending',
    CASE WHEN selected_service.pricing_type = 'fixed' THEN selected_service.base_price ELSE NULL END,
    now(), p_policy_version
  ) RETURNING * INTO new_booking;

  INSERT INTO public.booking_status_history(booking_id, to_status, changed_by, note)
  VALUES (new_booking.id, 'pending', auth.uid(), 'تم إنشاء الطلب بعد تأكيد العميل سياسة الطلب');

  new_booking := public.auto_assign_nearest_provider(new_booking.id);
  RETURN new_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_update_location(numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_update_location(numeric, numeric, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.provider_set_availability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_set_availability(text) TO authenticated;
REVOKE ALL ON FUNCTION public.auto_assign_nearest_provider(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_auto_assign_nearest_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_auto_assign_nearest_booking(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_booking_with_consent(uuid, text, text, text, text, numeric, numeric, public.location_source, text, text, date, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_with_consent(uuid, text, text, text, text, numeric, numeric, public.location_source, text, text, date, text, boolean, text) TO authenticated;
