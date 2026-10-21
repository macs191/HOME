-- HOME SERVICE completion hardening
-- This migration is intentionally additive and must be reviewed/applied separately
-- after matching the production migration history. It creates no business data.

-- Keep malformed legacy rows visible for remediation while enforcing all new writes.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_coordinates_pair_check,
  ADD CONSTRAINT bookings_coordinates_pair_check
    CHECK ((latitude IS NULL) = (longitude IS NULL)) NOT VALID;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_text_lengths_check,
  ADD CONSTRAINT bookings_text_lengths_check
    CHECK (
      char_length(trim(city)) BETWEEN 2 AND 120
      AND char_length(trim(address_text)) BETWEEN 5 AND 500
      AND char_length(trim(issue_description)) BETWEEN 10 AND 4000
      AND (district IS NULL OR char_length(trim(district)) <= 160)
      AND (access_notes IS NULL OR char_length(trim(access_notes)) <= 1000)
      AND (scheduled_slot IS NULL OR char_length(trim(scheduled_slot)) <= 100)
    ) NOT VALID;

-- Explicitly reject NULL consent instead of treating it as an implicit denial.
CREATE OR REPLACE FUNCTION public.customer_set_tracking_consent(
  p_booking_id uuid,
  p_consent boolean
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN
    RAISE EXCEPTION 'customer_account_required';
  END IF;
  IF p_booking_id IS NULL OR p_consent IS NULL THEN
    RAISE EXCEPTION 'tracking_consent_required';
  END IF;

  -- UPDATE obtains the booking row lock before changing consent. A concurrent
  -- provider location write therefore either commits before the revoke and is
  -- deleted below, or observes the revoked state and is rejected.
  UPDATE public.bookings
  SET tracking_consent_at = CASE
        WHEN p_consent THEN coalesce(tracking_consent_at, now())
        ELSE tracking_consent_at
      END,
      tracking_revoked_at = CASE WHEN p_consent THEN NULL ELSE now() END,
      updated_at = now()
  WHERE id = p_booking_id
    AND customer_id = auth.uid()
    AND provider_id IS NOT NULL
    AND status IN ('assigned','on_the_way','arrived','in_progress')
  RETURNING * INTO changed;

  IF changed.id IS NULL THEN
    RAISE EXCEPTION 'tracking_consent_not_allowed';
  END IF;

  IF NOT p_consent THEN
    DELETE FROM public.booking_tracking_locations
    WHERE booking_id = p_booking_id;
  END IF;
  RETURN changed;
END;
$$;

-- Turning availability off must not leave a reusable provider location behind.
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
  IF p_status IS NULL OR p_status NOT IN ('available', 'busy', 'offline') THEN
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

  IF p_status <> 'available' THEN
    DELETE FROM public.provider_locations WHERE provider_id = auth.uid();
  END IF;
  RETURN v_profile;
END;
$$;

-- Rebuild the customer payment selector with explicit NULL and ownership guards.
CREATE OR REPLACE FUNCTION public.customer_change_invoice_payment(
  p_payment_id uuid,
  p_method text
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed public.payments;
BEGIN
  IF auth.uid() IS NULL OR p_payment_id IS NULL OR p_method IS NULL THEN
    RAISE EXCEPTION 'payment_method_required';
  END IF;
  IF p_method NOT IN ('cash', 'bank_transfer') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  UPDATE public.payments p
  SET payment_method = p_method,
      provider = p_method,
      status = 'unpaid',
      receipt_reference = NULL,
      review_note = NULL
  FROM public.bookings b
  WHERE p.id = p_payment_id
    AND b.id = p.booking_id
    AND b.customer_id = auth.uid()
    AND p.status IN ('unpaid', 'failed', 'pending')
  RETURNING p.* INTO changed;

  IF changed.id IS NULL THEN
    RAISE EXCEPTION 'payment_change_not_allowed';
  END IF;

  UPDATE public.bookings
  SET payment_status = 'unpaid', updated_at = now()
  WHERE id = changed.booking_id;
  RETURN changed;
END;
$$;

-- Strengthen the consent-aware booking RPC without changing its public signature.
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
  IF p_service_id IS NULL OR nullif(trim(p_city), '') IS NULL
     OR nullif(trim(p_address_text), '') IS NULL
     OR nullif(trim(p_issue_description), '') IS NULL THEN
    RAISE EXCEPTION 'booking_details_required';
  END IF;
  IF char_length(trim(p_city)) NOT BETWEEN 2 AND 120
     OR char_length(trim(p_address_text)) NOT BETWEEN 5 AND 500
     OR char_length(trim(p_issue_description)) NOT BETWEEN 10 AND 4000
     OR char_length(coalesce(trim(p_district), '')) > 160
     OR char_length(coalesce(trim(p_access_notes), '')) > 1000
     OR char_length(coalesce(trim(p_scheduled_slot), '')) > 100 THEN
    RAISE EXCEPTION 'booking_input_too_long';
  END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'coordinates_must_be_provided_together';
  END IF;
  IF p_location_source IS NULL THEN
    RAISE EXCEPTION 'location_source_required';
  END IF;
  IF p_location_source = 'gps' AND p_latitude IS NULL THEN
    RAISE EXCEPTION 'gps_coordinates_required';
  END IF;
  IF p_location_source = 'none' AND p_latitude IS NOT NULL THEN
    RAISE EXCEPTION 'location_source_mismatch';
  END IF;
  IF p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90) THEN
    RAISE EXCEPTION 'invalid_latitude';
  END IF;
  IF p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180) THEN
    RAISE EXCEPTION 'invalid_longitude';
  END IF;
  IF p_scheduled_date IS NOT NULL AND p_scheduled_date < current_date THEN
    RAISE EXCEPTION 'scheduled_date_in_past';
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

  INSERT INTO public.bookings (
    customer_id, service_id, city, district, address_text, access_notes,
    latitude, longitude, location_source, location_captured_at,
    issue_description, urgency, scheduled_date, scheduled_slot,
    status, price_snapshot, policy_accepted_at, policy_version
  ) VALUES (
    auth.uid(), p_service_id, trim(p_city), nullif(trim(p_district), ''),
    trim(p_address_text), nullif(trim(p_access_notes), ''), p_latitude,
    p_longitude, p_location_source,
    CASE WHEN p_location_source = 'gps' THEN now() ELSE NULL END,
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

-- Service-role-only cleanup for abandoned private uploads. The grace period
-- prevents deleting a file while the client is still inserting its message.
CREATE OR REPLACE FUNCTION public.cleanup_orphan_private_attachments(
  p_grace_period interval DEFAULT interval '24 hours',
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  removed integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_grace_period IS NULL OR p_grace_period < interval '1 hour'
     OR p_grace_period > interval '30 days'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'cleanup_arguments_invalid';
  END IF;

  WITH candidates AS (
    SELECT o.id, o.bucket_id, o.name
    FROM storage.objects o
    WHERE o.bucket_id = 'booking-attachments'
      AND o.created_at < now() - p_grace_period
      AND NOT EXISTS (SELECT 1 FROM public.booking_attachments a WHERE a.storage_path = o.name)
      AND NOT EXISTS (SELECT 1 FROM public.booking_messages m WHERE m.attachment_path = o.name)
      AND o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(chat/)?[^/]+$'
    ORDER BY o.created_at
    LIMIT p_limit
  ), deleted AS (
    DELETE FROM storage.objects o
    USING candidates c
    WHERE o.id = c.id
    RETURNING o.bucket_id, o.name
  )
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  SELECT NULL, 'cleanup_orphan_private_attachment', 'storage_object', name,
         jsonb_build_object('bucket_id', bucket_id, 'grace_period', p_grace_period::text)
  FROM deleted;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_orphan_private_attachments(interval, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_private_attachments(interval, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.customer_set_tracking_consent(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_set_tracking_consent(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.provider_set_availability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_set_availability(text) TO authenticated;
REVOKE ALL ON FUNCTION public.customer_change_invoice_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_change_invoice_payment(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_booking_with_consent(uuid, text, text, text, text, numeric, numeric, public.location_source, text, text, date, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_with_consent(uuid, text, text, text, text, numeric, numeric, public.location_source, text, text, date, text, boolean, text) TO authenticated;
