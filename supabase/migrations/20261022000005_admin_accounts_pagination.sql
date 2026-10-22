-- Server-side pagination for the admin account directory.
CREATE OR REPLACE FUNCTION public.admin_list_accounts_page(
  p_search text DEFAULT NULL,
  p_role text DEFAULT 'all',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id uuid, email text, role text, full_name text, phone text, city text,
  is_active boolean, created_at timestamptz, years_experience integer,
  approval_status text, service_description text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF coalesce(p_role, 'all') NOT IN ('all','customer','provider') THEN RAISE EXCEPTION 'invalid_role_filter'; END IF;
  IF coalesce(p_offset, 0) < 0 THEN RAISE EXCEPTION 'invalid_offset'; END IF;
  RETURN QUERY
  SELECT p.id, u.email::text, ur.role::text, p.full_name, p.phone, p.city, p.is_active, p.created_at,
         pp.years_experience, pp.approval_status, coalesce(pp.service_description, pp.professional_bio)
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.provider_profiles pp ON pp.user_id = p.id
  WHERE ur.role IN ('customer'::public.app_role, 'provider'::public.app_role)
    AND (coalesce(p_role, 'all') = 'all' OR ur.role::text = p_role)
    AND (nullif(trim(p_search), '') IS NULL OR p.full_name ILIKE '%' || trim(p_search) || '%'
      OR coalesce(p.phone, '') ILIKE '%' || trim(p_search) || '%'
      OR coalesce(u.email, '') ILIKE '%' || trim(p_search) || '%')
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT v_limit + 1 OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_accounts_page(text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_accounts_page(text,text,integer,integer) TO authenticated;
