-- Provider-profile initialization must never promote a customer implicitly.
-- The role is chosen explicitly by complete_google_profile or email signup.
CREATE OR REPLACE FUNCTION public.ensure_provider_profile()
RETURNS public.provider_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created public.provider_profiles;
  current_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  SELECT role INTO current_role
  FROM public.user_roles
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF current_role IS DISTINCT FROM 'provider'::public.app_role THEN
    RAISE EXCEPTION 'provider_role_conflict';
  END IF;

  INSERT INTO public.provider_profiles(user_id, approval_status, onboarding_completed)
  VALUES (auth.uid(), 'pending', false)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO created
  FROM public.provider_profiles
  WHERE user_id = auth.uid();

  RETURN created;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_provider_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_provider_profile() TO authenticated;
