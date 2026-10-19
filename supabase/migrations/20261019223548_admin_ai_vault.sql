-- Store the optional OpenAI key in Supabase Vault; never expose it through PostgREST.
CREATE TABLE IF NOT EXISTS public.home_ai_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

ALTER TABLE public.home_ai_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.home_ai_rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.home_ai_actor_is_admin(p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = p_actor
      AND r.role = 'admin'::public.app_role
      AND p.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.home_ai_secret_status(p_actor uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT public.home_ai_actor_is_admin(p_actor) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM vault.secrets
    WHERE name = 'home_openai_api_key'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.home_ai_secret_save(p_actor uuid, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  IF NOT public.home_ai_actor_is_admin(p_actor) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_secret IS NULL OR length(btrim(p_secret)) < 20 OR length(btrim(p_secret)) > 512 OR p_secret ~ E'[\\r\\n]' THEN
    RAISE EXCEPTION 'invalid_secret' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('home_openai_api_key', 0));
  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = 'home_openai_api_key'
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(btrim(p_secret), 'home_openai_api_key', 'HOME assistant OpenAI API key', NULL);
  ELSE
    PERFORM vault.update_secret(v_secret_id, btrim(p_secret), 'home_openai_api_key', 'HOME assistant OpenAI API key', NULL);
  END IF;

  -- Repair any historical duplicates so status and assistant reads cannot disagree.
  DELETE FROM vault.secrets
  WHERE name = 'home_openai_api_key' AND id <> v_secret_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_actor, 'ai_provider_key_saved', 'platform_secret', 'openai', '{"provider":"openai","secret_present":true}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.home_ai_secret_clear(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT public.home_ai_actor_is_admin(p_actor) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('home_openai_api_key', 0));
  DELETE FROM vault.secrets WHERE name = 'home_openai_api_key';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_actor, 'ai_provider_key_removed', 'platform_secret', 'openai', '{"provider":"openai","secret_present":false}'::jsonb);
  END IF;
END;
$$;

-- Atomically apply the per-user quota before decrypting the Vault key.
-- The returned plaintext is restricted to service_role and is consumed only by Edge Functions.
CREATE OR REPLACE FUNCTION public.home_ai_consume_and_get_secret(p_actor uuid)
RETURNS TABLE(api_key text, allowed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_count integer;
  v_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = p_actor
      AND r.role IN ('customer'::public.app_role, 'company'::public.app_role)
      AND p.is_active
  ) THEN
    RAISE EXCEPTION 'active_customer_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.home_ai_rate_limits (user_id, window_started_at, request_count)
  VALUES (p_actor, now(), 1)
  ON CONFLICT (user_id) DO UPDATE SET
    window_started_at = CASE
      WHEN public.home_ai_rate_limits.window_started_at <= now() - interval '1 hour' THEN now()
      ELSE public.home_ai_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN public.home_ai_rate_limits.window_started_at <= now() - interval '1 hour' THEN 1
      ELSE public.home_ai_rate_limits.request_count + 1
    END
  RETURNING request_count INTO v_count;

  IF v_count > 12 THEN
    RETURN QUERY SELECT NULL::text, false;
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'home_openai_api_key'
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;

  RETURN QUERY SELECT v_key, true;
END;
$$;

REVOKE ALL ON FUNCTION public.home_ai_actor_is_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.home_ai_secret_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.home_ai_secret_save(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.home_ai_secret_clear(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.home_ai_consume_and_get_secret(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.home_ai_actor_is_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.home_ai_secret_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.home_ai_secret_save(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.home_ai_secret_clear(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.home_ai_consume_and_get_secret(uuid) TO service_role;
