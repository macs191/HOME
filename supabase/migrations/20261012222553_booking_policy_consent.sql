-- Persist the customer's explicit booking-policy acknowledgement without removing the legacy RPC.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS policy_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS policy_version text;

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

  SELECT * INTO selected_service
  FROM public.services
  WHERE id = p_service_id AND is_active = true;

  IF selected_service.id IS NULL THEN
    RAISE EXCEPTION 'service_unavailable';
  END IF;

  IF selected_service.pricing_type = 'fixed'
     AND (selected_service.base_price IS NULL OR selected_service.base_price <= 0) THEN
    RAISE EXCEPTION 'fixed_price_not_configured';
  END IF;

  IF nullif(trim(p_city), '') IS NULL
     OR nullif(trim(p_address_text), '') IS NULL
     OR nullif(trim(p_issue_description), '') IS NULL THEN
    RAISE EXCEPTION 'booking_details_required';
  END IF;

  IF p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90) THEN
    RAISE EXCEPTION 'invalid_latitude';
  END IF;

  IF p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180) THEN
    RAISE EXCEPTION 'invalid_longitude';
  END IF;

  INSERT INTO public.bookings (
    customer_id, service_id, city, district, address_text, access_notes,
    latitude, longitude, location_source, location_captured_at,
    issue_description, urgency, scheduled_date, scheduled_slot,
    status, price_snapshot, policy_accepted_at, policy_version
  ) VALUES (
    auth.uid(), p_service_id, trim(p_city), nullif(trim(p_district), ''),
    trim(p_address_text), nullif(trim(p_access_notes), ''), p_latitude, p_longitude,
    p_location_source, CASE WHEN p_location_source = 'gps' THEN now() ELSE NULL END,
    trim(p_issue_description), CASE WHEN p_urgency = 'urgent' THEN 'urgent' ELSE 'normal' END,
    p_scheduled_date, nullif(trim(p_scheduled_slot), ''), 'pending',
    CASE WHEN selected_service.pricing_type = 'fixed' THEN selected_service.base_price ELSE NULL END,
    now(), p_policy_version
  ) RETURNING * INTO new_booking;

  INSERT INTO public.booking_status_history(booking_id, to_status, changed_by, note)
  VALUES (new_booking.id, 'pending', auth.uid(), 'تم إنشاء الطلب بعد تأكيد العميل سياسة الطلب');

  RETURN new_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_with_consent(uuid, text, text, text, text, numeric, numeric, public.location_source, text, text, date, text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_with_consent(uuid, text, text, text, text, numeric, numeric, public.location_source, text, text, date, text, boolean, text) TO authenticated;
