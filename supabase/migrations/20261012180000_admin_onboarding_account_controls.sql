-- Require each onboarding document to exist in its private bucket before committing pointers.
CREATE OR REPLACE FUNCTION public.provider_submit_onboarding(
  p_years integer,
  p_description text,
  p_phone text,
  p_city text,
  p_identity_front_path text,
  p_identity_back_path text,
  p_cv_path text,
  p_service_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_provider_id uuid := auth.uid();
  selected_count integer;
  item record;
  v_onboarding_completed boolean := false;
  v_approval_status text;
BEGIN
  IF v_provider_id IS NULL OR NOT public.has_role('provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider_required';
  END IF;
  SELECT onboarding_completed, approval_status INTO v_onboarding_completed, v_approval_status
  FROM public.provider_profiles WHERE user_id = v_provider_id FOR UPDATE;
  IF COALESCE(v_onboarding_completed, false) AND COALESCE(v_approval_status, 'pending') <> 'rejected' THEN
    RAISE EXCEPTION 'provider_onboarding_already_submitted';
  END IF;
  IF p_years IS NULL OR p_years < 0 OR p_years > 70 THEN RAISE EXCEPTION 'invalid_experience_years'; END IF;
  IF length(trim(coalesce(p_description,''))) < 10 OR length(trim(p_description)) > 3000 THEN RAISE EXCEPTION 'invalid_service_description'; END IF;
  IF length(trim(coalesce(p_phone,''))) < 6 OR length(trim(p_phone)) > 32 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF length(trim(coalesce(p_city,''))) < 2 OR length(trim(p_city)) > 120 THEN RAISE EXCEPTION 'invalid_city'; END IF;
  IF coalesce(cardinality(p_service_ids),0) < 1 OR cardinality(p_service_ids) > 50 THEN RAISE EXCEPTION 'at_least_one_service_required'; END IF;
  IF p_identity_front_path IS NULL OR p_identity_front_path !~ ('^' || v_provider_id::text || '/identity-front-[0-9a-f-]{36}\.(jpg|jpeg|png)$') THEN RAISE EXCEPTION 'invalid_identity_front_path'; END IF;
  IF p_identity_back_path IS NULL OR p_identity_back_path !~ ('^' || v_provider_id::text || '/identity-back-[0-9a-f-]{36}\.(jpg|jpeg|png)$') THEN RAISE EXCEPTION 'invalid_identity_back_path'; END IF;
  IF p_cv_path IS NULL OR p_cv_path !~ ('^' || v_provider_id::text || '/cv-[0-9a-f-]{36}\.(pdf|doc|docx)$') THEN RAISE EXCEPTION 'invalid_cv_path'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'identity-documents' AND name = p_identity_front_path) THEN RAISE EXCEPTION 'identity_front_document_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'identity-documents' AND name = p_identity_back_path) THEN RAISE EXCEPTION 'identity_back_document_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'provider-cvs' AND name = p_cv_path) THEN RAISE EXCEPTION 'cv_document_missing'; END IF;
  SELECT count(distinct s.id) INTO selected_count FROM public.services s WHERE s.id = ANY(p_service_ids) AND s.is_active;
  IF selected_count <> cardinality(p_service_ids) THEN RAISE EXCEPTION 'service_unavailable'; END IF;

  UPDATE public.profiles SET phone = trim(p_phone), city = trim(p_city), updated_at = now() WHERE id = v_provider_id;
  INSERT INTO public.provider_profiles(user_id, years_experience, service_description, professional_bio, national_id_last4, onboarding_completed, approval_status, updated_at)
  VALUES (v_provider_id, p_years, trim(p_description), trim(p_description), null, true, 'pending', now())
  ON CONFLICT (user_id) DO UPDATE SET years_experience = excluded.years_experience, service_description = excluded.service_description,
    professional_bio = excluded.professional_bio, national_id_last4 = null, onboarding_completed = true, approval_status = 'pending', updated_at = now();
  DELETE FROM public.provider_services WHERE provider_id = v_provider_id;
  INSERT INTO public.provider_services(provider_id, service_id, is_active)
  SELECT v_provider_id, s.id, true FROM public.services s WHERE s.id = ANY(p_service_ids) AND s.is_active;
  FOR item IN SELECT * FROM (VALUES
    ('identity_front'::text, p_identity_front_path), ('identity_back'::text, p_identity_back_path), ('cv'::text, p_cv_path)
  ) AS docs(document_type, storage_path)
  LOOP
    UPDATE public.provider_documents SET is_current = false WHERE provider_id = v_provider_id AND document_type = item.document_type AND is_current;
    INSERT INTO public.provider_documents(provider_id, document_type, storage_path, status, is_current)
    VALUES (v_provider_id, item.document_type, item.storage_path, 'pending', true);
  END LOOP;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_provider_id, 'provider_onboarding_submitted', 'provider_profile', v_provider_id::text,
          jsonb_build_object('services_count', selected_count, 'has_cv', true, 'documents_verified_in_storage', true));
END;
$$;
REVOKE ALL ON FUNCTION public.provider_submit_onboarding(integer,text,text,text,text,text,text,uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.provider_submit_onboarding(integer,text,text,text,text,text,text,uuid[]) TO authenticated;

-- Remove the legacy single-document RPC so it cannot bypass the complete onboarding requirements.
REVOKE ALL ON FUNCTION public.provider_submit_verification(integer,text,text,text) FROM public, anon, authenticated;

-- Role helpers deny all application RPC access for administratively deactivated profiles.
CREATE OR REPLACE FUNCTION public.has_role(required_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid() AND r.role = required_role AND p.is_active
  );
$$;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid() AND r.role IN ('admin','sub_admin') AND p.is_active
  );
$$;
REVOKE ALL ON FUNCTION public.has_role(public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_role(public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Inactive users cannot update their own profile or reactivate themselves through direct table access.
DROP POLICY IF EXISTS "users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "users update own active profile" ON public.profiles;
CREATE POLICY "users update own active profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() AND is_active)
  WITH CHECK (id = auth.uid() AND is_active);

-- Reversible account deactivation revokes refreshable sessions and blocks role-guarded RPCs.
CREATE OR REPLACE FUNCTION public.admin_set_account_active(p_user_id uuid, p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE target_role public.app_role;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_is_active IS NULL THEN RAISE EXCEPTION 'active_status_required'; END IF;
  SELECT role INTO target_role FROM public.user_roles WHERE user_id = p_user_id;
  IF target_role IS NULL OR target_role NOT IN ('customer'::public.app_role,'provider'::public.app_role) THEN RAISE EXCEPTION 'account_not_found'; END IF;
  UPDATE public.profiles SET is_active = p_is_active, updated_at = now() WHERE id = p_user_id;
  UPDATE auth.users SET banned_until = CASE WHEN p_is_active THEN NULL ELSE '9999-12-31 23:59:59+00'::timestamptz END WHERE id = p_user_id;
  IF NOT p_is_active THEN DELETE FROM auth.sessions WHERE user_id = p_user_id; END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN p_is_active THEN 'admin_account_activated' ELSE 'admin_account_deactivated' END,
          'account', p_user_id::text, jsonb_build_object('role', target_role::text));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_account_active(uuid,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_active(uuid,boolean) TO authenticated;

-- Permanent deletion is only allowed for accounts without bookings or financial history.
-- Accounts with operational history must be deactivated instead so invoices/audit trails remain intact.
CREATE OR REPLACE FUNCTION public.admin_delete_account(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, storage, pg_temp AS $$
DECLARE target_role public.app_role; has_company boolean := false;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT role INTO target_role FROM public.user_roles WHERE user_id = p_user_id FOR UPDATE;
  IF target_role IS NULL OR target_role NOT IN ('customer'::public.app_role,'provider'::public.app_role) THEN RAISE EXCEPTION 'account_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = p_user_id OR provider_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.provider_ledger_entries WHERE provider_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.booking_quotes WHERE provider_id = p_user_id) THEN
    RAISE EXCEPTION 'account_has_history';
  END IF;
  IF to_regclass('public.companies') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.companies WHERE owner_id = $1)' INTO has_company USING p_user_id;
    IF has_company THEN RAISE EXCEPTION 'account_has_company'; END IF;
  END IF;
  UPDATE public.booking_status_history SET changed_by = NULL WHERE changed_by = p_user_id;
  UPDATE public.provider_documents SET reviewed_by = NULL WHERE reviewed_by = p_user_id;
  UPDATE public.provider_ledger_entries SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.user_roles SET granted_by = NULL WHERE granted_by = p_user_id;
  UPDATE public.platform_settings SET updated_by = NULL WHERE updated_by = p_user_id;
  UPDATE public.audit_logs SET actor_id = NULL WHERE actor_id = p_user_id;
  DELETE FROM storage.objects WHERE bucket_id IN ('identity-documents','provider-cvs') AND name LIKE p_user_id::text || '/%';
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'admin_account_deleted', 'account', p_user_id::text, jsonb_build_object('role', target_role::text));
  DELETE FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'account_not_found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_account(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_account(uuid) TO authenticated;
