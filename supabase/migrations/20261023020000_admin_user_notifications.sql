-- Admin-only user notifications. Recipients are selected server-side so the client
-- cannot forge sender identity or write notifications for arbitrary accounts.
CREATE OR REPLACE FUNCTION public.admin_send_user_notification(
  p_user_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_target_path text DEFAULT '/customer/notifications'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer := 0;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_target text := coalesce(nullif(btrim(p_target_path), ''), '/customer/notifications');
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF length(v_title) < 2 OR length(v_title) > 160 OR v_title ~ E'[\\r\\n]' THEN
    RAISE EXCEPTION 'invalid_notification_title' USING ERRCODE = '22023';
  END IF;
  IF length(v_body) < 2 OR length(v_body) > 2000 THEN
    RAISE EXCEPTION 'invalid_notification_body' USING ERRCODE = '22023';
  END IF;
  IF v_target !~ '^/[A-Za-z0-9_/?=&%#.-]{1,240}$' THEN
    RAISE EXCEPTION 'invalid_notification_target' USING ERRCODE = '22023';
  END IF;

  IF p_user_id IS NULL THEN
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    SELECT p.id, v_title, v_body, 'admin_message', v_target
    FROM public.profiles p
    WHERE p.is_active = true;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_active = true) THEN
      RAISE EXCEPTION 'recipient_not_found' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.notifications(user_id, title, body, notification_type, target_path)
    VALUES (p_user_id, v_title, v_body, 'admin_message', v_target);
    v_count := 1;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor,
    'admin_user_notification_sent',
    'notification',
    coalesce(p_user_id::text, 'broadcast'),
    jsonb_build_object('recipient_mode', CASE WHEN p_user_id IS NULL THEN 'all_active_users' ELSE 'single_user' END, 'recipient_count', v_count, 'title', v_title, 'target_path', v_target)
  );
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_user_notification(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_user_notification(uuid, text, text, text) TO authenticated;
