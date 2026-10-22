-- Device registration is scoped to the authenticated owner. A server-side
-- push provider can later consume these tokens without exposing service keys.
CREATE TABLE IF NOT EXISTS public.push_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL CHECK (length(trim(token)) BETWEEN 20 AND 4096),
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, token)
);
CREATE INDEX IF NOT EXISTS push_device_tokens_user_idx ON public.push_device_tokens(user_id, last_seen_at DESC);
ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_device_tokens_owner_select ON public.push_device_tokens;
CREATE POLICY push_device_tokens_owner_select ON public.push_device_tokens FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS push_device_tokens_owner_insert ON public.push_device_tokens;
CREATE POLICY push_device_tokens_owner_insert ON public.push_device_tokens FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS push_device_tokens_owner_update ON public.push_device_tokens;
CREATE POLICY push_device_tokens_owner_update ON public.push_device_tokens FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS push_device_tokens_owner_delete ON public.push_device_tokens;
CREATE POLICY push_device_tokens_owner_delete ON public.push_device_tokens FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.register_push_device(p_token text, p_platform text, p_app_version text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_platform NOT IN ('android','ios','web') THEN RAISE EXCEPTION 'invalid_push_platform'; END IF;
  INSERT INTO public.push_device_tokens(user_id, token, platform, app_version, last_seen_at)
  VALUES (auth.uid(), trim(p_token), p_platform, nullif(trim(coalesce(p_app_version,'')), ''), now())
  ON CONFLICT (user_id, token) DO UPDATE SET platform = excluded.platform, app_version = excluded.app_version, last_seen_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  DELETE FROM public.push_device_tokens WHERE user_id = auth.uid() AND token = trim(p_token);
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_device(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.unregister_push_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;
