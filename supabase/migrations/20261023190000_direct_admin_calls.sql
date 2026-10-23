CREATE OR REPLACE FUNCTION public.get_active_admin_call_participants()
RETURNS TABLE(user_id uuid, display_name text, participant_role text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p.id, coalesce(nullif(trim(p.full_name), ''), 'الإدارة'), 'admin'::text
  FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id
  WHERE r.role::text IN ('admin','sub_admin') AND p.is_active=true ORDER BY p.full_name NULLS LAST LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.get_active_admin_call_participants() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_active_admin_call_participants() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_direct_admin_call_topic(p_topic text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_target uuid; v_admin uuid;
BEGIN
  IF split_part(p_topic, ':', 1) <> 'voice-direct' THEN RETURN false; END IF;
  BEGIN v_target := split_part(p_topic, ':', 2)::uuid; v_admin := split_part(p_topic, ':', 3)::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  IF v_target IS NULL OR v_admin IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_admin AND role::text IN ('admin','sub_admin')) THEN RETURN false; END IF;
  RETURN (auth.uid() = v_target) OR (auth.uid() = v_admin AND public.is_admin());
END; $$;
REVOKE ALL ON FUNCTION public.can_access_direct_admin_call_topic(text) FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='direct_admin_call_select') THEN
    CREATE POLICY direct_admin_call_select ON realtime.messages FOR SELECT TO authenticated USING (public.can_access_direct_admin_call_topic(topic));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='direct_admin_call_insert') THEN
    CREATE POLICY direct_admin_call_insert ON realtime.messages FOR INSERT TO authenticated WITH CHECK (public.can_access_direct_admin_call_topic(topic));
  END IF;
END $$;
