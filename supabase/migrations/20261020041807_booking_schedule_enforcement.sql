-- Translate the current customer-facing slot labels into local wall-clock times.
-- Unknown labels intentionally return no row so a configured schedule cannot be bypassed by free text.
CREATE OR REPLACE FUNCTION public.booking_slot_bounds(p_slot text)
RETURNS TABLE(slot_start time, slot_end time)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot text := replace(replace(replace(trim(coalesce(p_slot, '')), ' ', ''), '–', '-'), '—', '-');
BEGIN
  CASE v_slot
    WHEN '9:00ص-12:00م' THEN slot_start := time '09:00'; slot_end := time '12:00';
    WHEN '12:00م-3:00م' THEN slot_start := time '12:00'; slot_end := time '15:00';
    WHEN '4:00م-7:00م' THEN slot_start := time '16:00'; slot_end := time '19:00';
    WHEN '7:00م-9:00م' THEN slot_start := time '19:00'; slot_end := time '21:00';
    WHEN '09:00-12:00' THEN slot_start := time '09:00'; slot_end := time '12:00';
    WHEN '12:00-15:00' THEN slot_start := time '12:00'; slot_end := time '15:00';
    WHEN '16:00-19:00' THEN slot_start := time '16:00'; slot_end := time '19:00';
    WHEN '19:00-21:00' THEN slot_start := time '19:00'; slot_end := time '21:00';
    ELSE RETURN;
  END CASE;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_slot_bounds(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_slots_overlap(p_slot_a text, p_slot_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.booking_slot_bounds(p_slot_a) a
    CROSS JOIN public.booking_slot_bounds(p_slot_b) b
    WHERE a.slot_start < b.slot_end AND b.slot_start < a.slot_end
  );
$$;
REVOKE ALL ON FUNCTION public.booking_slots_overlap(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_schedule_allows_booking(
  p_provider_id uuid,
  p_scheduled_date date,
  p_scheduled_slot text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weekday smallint;
  v_day_start time;
  v_day_end time;
  v_day_enabled boolean;
  v_slot_start time;
  v_slot_end time;
BEGIN
  IF p_provider_id IS NULL THEN RETURN false; END IF;
  IF p_scheduled_date IS NULL THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM public.provider_time_off off
    WHERE off.provider_id = p_provider_id
      AND p_scheduled_date BETWEEN off.starts_on AND off.ends_on
  ) THEN RETURN false; END IF;

  -- Preserve compatibility for providers who have not configured a weekly schedule yet.
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_weekly_availability a WHERE a.provider_id = p_provider_id
  ) THEN RETURN true; END IF;

  v_weekday := extract(dow FROM p_scheduled_date)::smallint;
  SELECT a.start_time, a.end_time, a.is_enabled
    INTO v_day_start, v_day_end, v_day_enabled
  FROM public.provider_weekly_availability a
  WHERE a.provider_id = p_provider_id AND a.weekday = v_weekday;
  IF NOT FOUND OR NOT coalesce(v_day_enabled, false) THEN RETURN false; END IF;
  IF nullif(trim(coalesce(p_scheduled_slot, '')), '') IS NULL THEN RETURN false; END IF;

  SELECT bounds.slot_start, bounds.slot_end
    INTO v_slot_start, v_slot_end
  FROM public.booking_slot_bounds(p_scheduled_slot) bounds;
  IF NOT FOUND OR v_slot_start IS NULL OR v_slot_end IS NULL THEN RETURN false; END IF;
  RETURN v_slot_start >= v_day_start AND v_slot_end <= v_day_end AND v_slot_end > v_slot_start;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_schedule_allows_booking(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- Enforce provider qualification and schedule at the table boundary so manual, automatic,
-- and future assignment paths share the same guard.
CREATE OR REPLACE FUNCTION public.enforce_booking_provider_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id AND
     NEW.scheduled_date IS NOT DISTINCT FROM OLD.scheduled_date AND
     NEW.scheduled_slot IS NOT DISTINCT FROM OLD.scheduled_slot AND
     NEW.service_id IS NOT DISTINCT FROM OLD.service_id THEN
    RETURN NEW;
  END IF;
  IF NEW.provider_id IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    JOIN public.profiles p ON p.id = pp.user_id
    JOIN public.user_roles r ON r.user_id = pp.user_id
    WHERE pp.user_id = NEW.provider_id
      AND pp.approval_status = 'approved'
      AND p.is_active
      AND r.role = 'provider'::public.app_role
  ) THEN
    RAISE EXCEPTION 'provider_not_approved_or_active';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_services ps
    WHERE ps.provider_id = NEW.provider_id
      AND ps.service_id = NEW.service_id
      AND ps.is_active
  ) THEN
    RAISE EXCEPTION 'provider_not_qualified_for_service';
  END IF;
  IF NOT public.provider_schedule_allows_booking(NEW.provider_id, NEW.scheduled_date, NEW.scheduled_slot) THEN
    RAISE EXCEPTION 'provider_schedule_unavailable';
  END IF;

  IF NEW.scheduled_date IS NOT NULL
     AND nullif(trim(coalesce(NEW.scheduled_slot, '')), '') IS NOT NULL
     AND NEW.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.provider_id::text || '|' || NEW.scheduled_date::text || '|daily', 0
    ));
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id <> NEW.id
        AND b.provider_id = NEW.provider_id
        AND b.scheduled_date = NEW.scheduled_date
        AND (
          b.scheduled_slot = NEW.scheduled_slot
          OR public.booking_slots_overlap(b.scheduled_slot, NEW.scheduled_slot)
        )
        AND b.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress')
    ) THEN
      RAISE EXCEPTION 'provider_schedule_conflict';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_booking_provider_schedule() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_booking_provider_schedule ON public.bookings;
CREATE TRIGGER enforce_booking_provider_schedule
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_provider_schedule();

-- Automatic dispatch must skip providers whose working hours do not contain the requested slot.
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
  v_previous_status public.bookings.status%TYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.provider_id IS NOT NULL OR v_booking.status NOT IN ('pending', 'quoted', 'accepted') THEN RETURN v_booking; END IF;

  WITH candidates AS (
    SELECT pp.user_id,
      CASE
        WHEN v_booking.latitude IS NULL OR v_booking.longitude IS NULL THEN
          CASE WHEN lower(coalesce(pr.city, '')) = lower(coalesce(v_booking.city, '')) THEN 0 ELSE 1 END
        ELSE 6371 * 2 * asin(sqrt(
          power(sin(radians((pl.latitude - v_booking.latitude) / 2)), 2)
          + cos(radians(v_booking.latitude)) * cos(radians(pl.latitude))
          * power(sin(radians((pl.longitude - v_booking.longitude) / 2)), 2)
        ))
      END AS distance_km,
      pl.captured_at
    FROM public.provider_profiles pp
    JOIN public.profiles pr ON pr.id = pp.user_id AND pr.is_active
    JOIN public.user_roles ur ON ur.user_id = pp.user_id AND ur.role = 'provider'::public.app_role
    JOIN public.provider_services ps ON ps.provider_id = pp.user_id AND ps.service_id = v_booking.service_id AND ps.is_active
    JOIN public.provider_locations pl ON pl.provider_id = pp.user_id
    WHERE pp.approval_status = 'approved'
      AND pp.availability_status = 'available'
      AND pp.location_sharing_enabled
      AND pl.expires_at > now()
      AND public.provider_schedule_allows_booking(pp.user_id, v_booking.scheduled_date, v_booking.scheduled_slot)
      AND NOT EXISTS (
        SELECT 1 FROM public.bookings busy
        WHERE busy.provider_id = pp.user_id
          AND busy.status IN ('assigned', 'on_the_way', 'arrived', 'in_progress')
          AND v_booking.scheduled_date IS NOT NULL
          AND busy.scheduled_date = v_booking.scheduled_date
          AND (coalesce(busy.scheduled_slot, '') = coalesce(v_booking.scheduled_slot, '') OR public.booking_slots_overlap(busy.scheduled_slot, v_booking.scheduled_slot))
      )
    ORDER BY distance_km ASC, pl.captured_at DESC
    LIMIT 1 FOR UPDATE OF pp SKIP LOCKED
  )
  SELECT user_id, distance_km INTO v_provider, v_distance FROM candidates;

  IF v_provider IS NULL THEN RETURN v_booking; END IF;
  v_previous_status := v_booking.status;
  UPDATE public.bookings
  SET provider_id = v_provider, status = 'assigned', updated_at = now()
  WHERE id = p_booking_id RETURNING * INTO v_booking;
  INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  VALUES (p_booking_id, v_previous_status, 'assigned', NULL,
          'تمت المطابقة التلقائية مع أقرب فني متاح على بعد ' || round(v_distance, 1) || ' كم');
  INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
  VALUES
    (v_provider, 'طلب جديد قريب منك', 'تم ترشيحك تلقائيًا لطلب مناسب لتخصصك وموقعك. افتح صندوق الطلبات لمراجعة التفاصيل.', 'booking_assigned', '/provider/work-queue'),
    (v_booking.customer_id, 'تم ترشيح فني لطلبك', 'تم العثور على أقرب فني متاح مناسب للخدمة، ويمكنك متابعة حالة الطلب من حسابك.', 'booking_assigned', '/customer/orders');
  RETURN v_booking;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_assign_nearest_provider(uuid) FROM PUBLIC, anon, authenticated;
