-- Provider identity front/back remain mandatory. Professional certificate and CV are optional.
CREATE OR REPLACE FUNCTION public.provider_submit_onboarding_with_certificate(
  p_full_name text, p_years integer, p_description text, p_phone text, p_city text,
  p_identity_front_path text, p_identity_back_path text, p_certificate_path text,
  p_cv_path text, p_service_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, storage, pg_temp AS $$
DECLARE
  v_provider_id uuid := auth.uid();
  selected_count integer;
  item record;
  v_onboarding_completed boolean := false;
  v_approval_status text;
BEGIN
  IF v_provider_id IS NULL OR NOT public.has_role('provider'::public.app_role) THEN RAISE EXCEPTION 'provider_required'; END IF;
  SELECT onboarding_completed, approval_status INTO v_onboarding_completed, v_approval_status
  FROM public.provider_profiles WHERE user_id = v_provider_id FOR UPDATE;
  IF coalesce(v_onboarding_completed, false) AND coalesce(v_approval_status, 'pending') <> 'rejected' THEN RAISE EXCEPTION 'provider_onboarding_already_submitted'; END IF;
  IF length(trim(coalesce(p_full_name, ''))) < 2 OR length(trim(p_full_name)) > 160 THEN RAISE EXCEPTION 'invalid_full_name'; END IF;
  IF p_years IS NULL OR p_years < 0 OR p_years > 70 THEN RAISE EXCEPTION 'invalid_experience_years'; END IF;
  IF length(trim(coalesce(p_description, ''))) < 10 OR length(trim(p_description)) > 3000 THEN RAISE EXCEPTION 'invalid_service_description'; END IF;
  IF length(trim(coalesce(p_phone, ''))) < 6 OR length(trim(p_phone)) > 32 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF length(trim(coalesce(p_city, ''))) < 2 OR length(trim(p_city)) > 120 THEN RAISE EXCEPTION 'invalid_city'; END IF;
  IF coalesce(cardinality(p_service_ids), 0) < 1 OR cardinality(p_service_ids) > 50 THEN RAISE EXCEPTION 'at_least_one_service_required'; END IF;
  IF p_identity_front_path IS NULL OR p_identity_front_path !~ ('^' || v_provider_id::text || '/identity-front-[0-9a-f-]{36}\.(jpg|jpeg|png)$') THEN RAISE EXCEPTION 'invalid_identity_front_path'; END IF;
  IF p_identity_back_path IS NULL OR p_identity_back_path !~ ('^' || v_provider_id::text || '/identity-back-[0-9a-f-]{36}\.(jpg|jpeg|png)$') THEN RAISE EXCEPTION 'invalid_identity_back_path'; END IF;
  IF p_certificate_path IS NOT NULL AND p_certificate_path !~ ('^' || v_provider_id::text || '/certificate-[0-9a-f-]{36}\.(jpg|jpeg|png|pdf)$') THEN RAISE EXCEPTION 'invalid_certificate_path'; END IF;
  IF p_cv_path IS NOT NULL AND p_cv_path !~ ('^' || v_provider_id::text || '/cv-[0-9a-f-]{36}\.(pdf|doc|docx)$') THEN RAISE EXCEPTION 'invalid_cv_path'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'identity-documents' AND name = p_identity_front_path) THEN RAISE EXCEPTION 'identity_front_document_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'identity-documents' AND name = p_identity_back_path) THEN RAISE EXCEPTION 'identity_back_document_missing'; END IF;
  IF p_certificate_path IS NOT NULL AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'identity-documents' AND name = p_certificate_path) THEN RAISE EXCEPTION 'certificate_document_missing'; END IF;
  IF p_cv_path IS NOT NULL AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'provider-cvs' AND name = p_cv_path) THEN RAISE EXCEPTION 'cv_document_missing'; END IF;
  SELECT count(DISTINCT s.id) INTO selected_count FROM public.services s WHERE s.id = ANY(p_service_ids) AND s.is_active;
  IF selected_count <> cardinality(p_service_ids) THEN RAISE EXCEPTION 'service_unavailable'; END IF;
  INSERT INTO public.profiles (id, full_name, phone, city) VALUES (v_provider_id, trim(p_full_name), trim(p_phone), trim(p_city))
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone, city = excluded.city, updated_at = now();
  INSERT INTO public.provider_profiles (user_id, years_experience, service_description, professional_bio, national_id_last4, onboarding_completed, approval_status, updated_at)
  VALUES (v_provider_id, p_years, trim(p_description), trim(p_description), null, true, 'pending', now())
  ON CONFLICT (user_id) DO UPDATE SET years_experience = excluded.years_experience, service_description = excluded.service_description, professional_bio = excluded.professional_bio, national_id_last4 = null, onboarding_completed = true, approval_status = 'pending', updated_at = now();
  DELETE FROM public.provider_services WHERE provider_id = v_provider_id;
  INSERT INTO public.provider_services (provider_id, service_id, is_active) SELECT v_provider_id, s.id, true FROM public.services s WHERE s.id = ANY(p_service_ids) AND s.is_active;
  FOR item IN SELECT * FROM (VALUES ('identity_front'::text, p_identity_front_path), ('identity_back'::text, p_identity_back_path), ('certificate'::text, p_certificate_path), ('cv'::text, p_cv_path)) AS docs(document_type, storage_path) LOOP
    UPDATE public.provider_documents SET is_current = false WHERE provider_id = v_provider_id AND document_type = item.document_type AND is_current;
    IF item.storage_path IS NOT NULL THEN INSERT INTO public.provider_documents (provider_id, document_type, storage_path, status, is_current) VALUES (v_provider_id, item.document_type, item.storage_path, 'pending', true); END IF;
  END LOOP;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_provider_id, 'provider_onboarding_submitted', 'provider_profile', v_provider_id::text, jsonb_build_object('services_count', selected_count, 'has_cv', p_cv_path IS NOT NULL, 'has_certificate', p_certificate_path IS NOT NULL, 'documents_verified_in_storage', true));
END;
$$;
REVOKE ALL ON FUNCTION public.provider_submit_onboarding_with_certificate(text, integer, text, text, text, text, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_submit_onboarding_with_certificate(text, integer, text, text, text, text, text, text, text, uuid[]) TO authenticated;
