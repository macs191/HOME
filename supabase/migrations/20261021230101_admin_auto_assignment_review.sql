-- Safe server-side actions backing the admin auto-assignment review cards.
-- Only bookings whose latest assignment event is the recorded automatic dispatch are eligible.

CREATE OR REPLACE FUNCTION public.admin_confirm_auto_assignment_safe(
  p_booking_id uuid,
  p_assignment_history_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_latest_event_id uuid;
  v_latest_note text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_booking_id IS NULL OR p_assignment_history_id IS NULL THEN
    RAISE EXCEPTION 'booking_and_assignment_event_required';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'assigned' OR v_booking.provider_id IS NULL THEN
    RAISE EXCEPTION 'auto_assignment_no_longer_pending';
  END IF;

  SELECT h.id, h.note INTO v_latest_event_id, v_latest_note
  FROM public.booking_status_history h
  WHERE h.booking_id = p_booking_id AND h.to_status = 'assigned'
  ORDER BY h.created_at DESC, h.id DESC
  LIMIT 1;
  IF v_latest_event_id IS DISTINCT FROM p_assignment_history_id
     OR coalesce(v_latest_note, '') NOT LIKE 'تمت المطابقة التلقائية%' THEN
    RAISE EXCEPTION 'auto_assignment_no_longer_pending';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.audit_logs a
    WHERE a.action = 'admin_auto_assignment_confirmed'
      AND a.entity_type = 'booking'
      AND a.entity_id = p_booking_id::text
      AND a.metadata->>'assignment_history_id' = p_assignment_history_id::text
  ) THEN
    RAISE EXCEPTION 'auto_assignment_already_reviewed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    JOIN public.profiles p ON p.id = pp.user_id
    JOIN public.user_roles ur ON ur.user_id = pp.user_id
    JOIN public.provider_services ps ON ps.provider_id = pp.user_id
    WHERE pp.user_id = v_booking.provider_id
      AND pp.approval_status = 'approved'
      AND p.is_active
      AND ur.role = 'provider'::public.app_role
      AND ps.service_id = v_booking.service_id
      AND ps.is_active
  ) THEN
    RAISE EXCEPTION 'provider_not_approved_or_active';
  END IF;

  IF NOT public.provider_schedule_allows_booking(
    v_booking.provider_id, v_booking.scheduled_date, v_booking.scheduled_slot
  ) THEN
    RAISE EXCEPTION 'provider_schedule_unavailable';
  END IF;
  IF v_booking.scheduled_date IS NOT NULL
     AND nullif(trim(coalesce(v_booking.scheduled_slot, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.bookings b
       WHERE b.id <> v_booking.id
         AND b.provider_id = v_booking.provider_id
         AND b.scheduled_date = v_booking.scheduled_date
         AND (b.scheduled_slot = v_booking.scheduled_slot
              OR public.booking_slots_overlap(b.scheduled_slot, v_booking.scheduled_slot))
         AND b.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress')
     ) THEN
    RAISE EXCEPTION 'provider_schedule_conflict';
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(), 'admin_auto_assignment_confirmed', 'booking', p_booking_id::text,
    jsonb_build_object(
      'assignment_history_id', p_assignment_history_id::text,
      'provider_id', v_booking.provider_id::text,
      'booking_number', v_booking.booking_number
    )
  );

  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_booking.customer_id, 'اعتمدت الإدارة الفني المرشح', 'راجعت الإدارة الإسناد التلقائي واعتمدت الفني الحالي. يمكنك متابعة الطلب من حسابك.', 'booking_assignment_reviewed', '/customer/orders'),
    (v_booking.provider_id, 'اعتمدت الإدارة إسناد الطلب', 'راجعت الإدارة إسنادك لهذا الطلب. افتح صندوق العمل للاطلاع على التفاصيل.', 'booking_assignment_reviewed', '/provider/work-queue');

  RETURN jsonb_build_object(
    'id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'status', v_booking.status,
    'provider_id', v_booking.provider_id,
    'assignment_history_id', p_assignment_history_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_auto_assigned_booking_safe(
  p_booking_id uuid,
  p_assignment_history_id uuid,
  p_issue_description text,
  p_urgency text,
  p_city text,
  p_district text,
  p_address_text text,
  p_access_notes text,
  p_scheduled_date date,
  p_scheduled_slot text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_latest_event_id uuid;
  v_latest_note text;
  v_issue text := trim(coalesce(p_issue_description, ''));
  v_urgency text := trim(coalesce(p_urgency, ''));
  v_city text := trim(coalesce(p_city, ''));
  v_district text := nullif(trim(coalesce(p_district, '')), '');
  v_address text := trim(coalesce(p_address_text, ''));
  v_access_notes text := nullif(trim(coalesce(p_access_notes, '')), '');
  v_slot text := nullif(trim(coalesce(p_scheduled_slot, '')), '');
  v_reason text := trim(coalesce(p_reason, ''));
  v_changed_fields text[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_booking_id IS NULL OR p_assignment_history_id IS NULL THEN
    RAISE EXCEPTION 'booking_and_assignment_event_required';
  END IF;
  IF length(v_issue) NOT BETWEEN 10 AND 2000
     OR length(v_city) NOT BETWEEN 2 AND 120
     OR length(coalesce(v_district, '')) > 120
     OR length(v_address) NOT BETWEEN 3 AND 500
     OR length(coalesce(v_access_notes, '')) > 1000
     OR v_urgency NOT IN ('normal', 'urgent')
     OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid_booking_details';
  END IF;
  IF p_scheduled_date IS NULL AND v_slot IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_booking_schedule';
  END IF;
  IF v_slot IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.booking_slot_bounds(v_slot)
  ) THEN
    RAISE EXCEPTION 'invalid_booking_schedule';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'assigned' OR v_booking.provider_id IS NULL THEN
    RAISE EXCEPTION 'auto_assignment_no_longer_pending';
  END IF;
  IF p_scheduled_date IS DISTINCT FROM v_booking.scheduled_date
     AND p_scheduled_date IS NOT NULL
     AND p_scheduled_date < current_date THEN
    RAISE EXCEPTION 'booking_date_in_past';
  END IF;

  SELECT h.id, h.note INTO v_latest_event_id, v_latest_note
  FROM public.booking_status_history h
  WHERE h.booking_id = p_booking_id AND h.to_status = 'assigned'
  ORDER BY h.created_at DESC, h.id DESC
  LIMIT 1;
  IF v_latest_event_id IS DISTINCT FROM p_assignment_history_id
     OR coalesce(v_latest_note, '') NOT LIKE 'تمت المطابقة التلقائية%' THEN
    RAISE EXCEPTION 'auto_assignment_no_longer_pending';
  END IF;

  v_changed_fields := array_remove(ARRAY[
    CASE WHEN v_booking.issue_description IS DISTINCT FROM v_issue THEN 'issue_description' END,
    CASE WHEN v_booking.urgency IS DISTINCT FROM v_urgency THEN 'urgency' END,
    CASE WHEN v_booking.city IS DISTINCT FROM v_city THEN 'city' END,
    CASE WHEN v_booking.district IS DISTINCT FROM v_district THEN 'district' END,
    CASE WHEN v_booking.address_text IS DISTINCT FROM v_address THEN 'address_text' END,
    CASE WHEN v_booking.access_notes IS DISTINCT FROM v_access_notes THEN 'access_notes' END,
    CASE WHEN v_booking.scheduled_date IS DISTINCT FROM p_scheduled_date THEN 'scheduled_date' END,
    CASE WHEN v_booking.scheduled_slot IS DISTINCT FROM v_slot THEN 'scheduled_slot' END
  ]::text[], NULL);
  IF cardinality(v_changed_fields) = 0 THEN RAISE EXCEPTION 'no_booking_changes'; END IF;

  UPDATE public.bookings
  SET issue_description = v_issue,
      urgency = v_urgency,
      city = v_city,
      district = v_district,
      address_text = v_address,
      access_notes = v_access_notes,
      scheduled_date = p_scheduled_date,
      scheduled_slot = v_slot,
      updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(), 'admin_auto_assignment_details_updated', 'booking', p_booking_id::text,
    jsonb_build_object(
      'assignment_history_id', p_assignment_history_id::text,
      'changed_fields', to_jsonb(v_changed_fields),
      'reason', v_reason
    )
  );

  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_booking.customer_id, 'تم تحديث تفاصيل الطلب', 'حدّثت الإدارة بعض تفاصيل الطلب أو موعده. راجع التفاصيل من حسابك.', 'booking_updated', '/customer/orders'),
    (v_booking.provider_id, 'تم تحديث تفاصيل الطلب', 'حدّثت الإدارة بعض تفاصيل الطلب أو موعده. راجع التفاصيل من صندوق العمل.', 'booking_updated', '/provider/work-queue');

  RETURN jsonb_build_object(
    'id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'status', v_booking.status,
    'provider_id', v_booking.provider_id,
    'changed_fields', to_jsonb(v_changed_fields)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_confirm_auto_assignment_safe(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_auto_assigned_booking_safe(uuid, uuid, text, text, text, text, text, text, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_auto_assignment_safe(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_auto_assigned_booking_safe(uuid, uuid, text, text, text, text, text, text, date, text, text) TO authenticated;
