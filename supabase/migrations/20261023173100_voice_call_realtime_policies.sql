CREATE OR REPLACE FUNCTION public.can_access_booking_call_topic(p_topic text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_booking uuid; v_customer uuid; v_provider uuid;
BEGIN
  IF split_part(p_topic, ':', 1) <> 'voice-call' THEN RETURN false; END IF;
  BEGIN
    v_booking := split_part(p_topic, ':', 2)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  SELECT b.customer_id, b.provider_id INTO v_customer, v_provider FROM public.bookings b WHERE b.id = v_booking;
  IF v_customer IS NULL THEN RETURN false; END IF;
  RETURN auth.uid() = v_customer OR auth.uid() = v_provider OR public.is_admin();
END; $$;
REVOKE ALL ON FUNCTION public.can_access_booking_call_topic(text) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname = 'voice_call_select_participants') THEN
    CREATE POLICY voice_call_select_participants ON realtime.messages FOR SELECT TO authenticated USING (public.can_access_booking_call_topic(topic));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname = 'voice_call_insert_participants') THEN
    CREATE POLICY voice_call_insert_participants ON realtime.messages FOR INSERT TO authenticated WITH CHECK (public.can_access_booking_call_topic(topic));
  END IF;
END $$;
