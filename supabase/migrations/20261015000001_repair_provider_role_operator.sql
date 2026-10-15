-- Repair the live provider bootstrap function.
-- The historical production migration was recorded as applied while the function
-- still used the reserved PL/pgSQL identifier `current_role`, which PostgreSQL
-- resolved as the session role (type name), causing `name = app_role`.
CREATE OR REPLACE FUNCTION public.ensure_provider_profile()
RETURNS public.provider_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created public.provider_profiles;
  v_existing_app_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (auth.uid(), 'provider'::public.app_role)
  ON CONFLICT (user_id) DO UPDATE
    SET role = 'provider'::public.app_role
    WHERE public.user_roles.role = 'customer'::public.app_role;

  SELECT ur.role INTO v_existing_app_role
  FROM public.user_roles AS ur
  WHERE ur.user_id = auth.uid();

  IF v_existing_app_role IS DISTINCT FROM 'provider'::public.app_role THEN
    RAISE EXCEPTION 'provider_role_conflict';
  END IF;

  INSERT INTO public.provider_profiles(user_id, approval_status, onboarding_completed)
  VALUES (auth.uid(), 'pending', false)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_created
  FROM public.provider_profiles AS pp
  WHERE pp.user_id = auth.uid();

  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_provider_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_provider_profile() TO authenticated;
