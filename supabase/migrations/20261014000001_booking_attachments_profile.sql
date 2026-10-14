-- HOME operations hardening and customer/provider self-service.
-- All sensitive transitions remain server-side; no direct client writes to financial or booking state.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.booking_quotes
  ADD COLUMN IF NOT EXISTS admin_review_note text;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

CREATE TABLE IF NOT EXISTS public.booking_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES public.profiles(id),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'image/jpeg'),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_attachments_booking_created_idx
  ON public.booking_attachments (booking_id, created_at);
ALTER TABLE public.booking_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking attachment participants read" ON public.booking_attachments;
CREATE POLICY "booking attachment participants read" ON public.booking_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.has_role('customer'::public.app_role) AND uploader_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_attachments.booking_id
        AND ((public.has_role('customer'::public.app_role) AND b.customer_id = auth.uid())
          OR (public.has_role('provider'::public.app_role) AND b.provider_id = auth.uid()))
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.booking_attachments FROM anon, authenticated;
GRANT SELECT ON public.booking_attachments TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('booking-attachments', 'booking-attachments', false, 5242880, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO NOTHING;
DO $$
DECLARE v_bucket storage.buckets;
BEGIN
  SELECT * INTO v_bucket FROM storage.buckets WHERE id = 'booking-attachments';
  IF v_bucket.id IS NULL OR v_bucket.name <> 'booking-attachments' OR v_bucket.public IS DISTINCT FROM false
     OR v_bucket.file_size_limit IS DISTINCT FROM 5242880
     OR v_bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg']::text[] THEN
    RAISE EXCEPTION 'booking_attachments_bucket_configuration_invalid';
  END IF;
END $$;

DROP POLICY IF EXISTS "booking attachments private read" ON storage.objects;
CREATE POLICY "booking attachments private read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'booking-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.booking_attachments a
      JOIN public.bookings b ON b.id = a.booking_id
      WHERE a.storage_path = storage.objects.name
        AND (public.is_admin()
          OR (public.has_role('customer'::public.app_role) AND b.customer_id = auth.uid())
          OR (public.has_role('provider'::public.app_role) AND b.provider_id = auth.uid()))
    )
  );
DROP POLICY IF EXISTS "booking attachments customer upload" ON storage.objects;
CREATE POLICY "booking attachments customer upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'booking-attachments'
    AND public.has_role('customer'::public.app_role)
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND cardinality(storage.foldername(name)) = 2
    AND array_length(string_to_array(name, '/'), 1) = 3
    AND split_part(name, '/', 3) ~ '^[a-f0-9]{64}[.]jpg$'
    AND metadata->>'mimetype' = 'image/jpeg'
    AND metadata->>'size' ~ '^[0-9]+$'
    AND (metadata->>'size')::bigint BETWEEN 1 AND 5242880
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = (storage.foldername(name))[2]
        AND b.customer_id = auth.uid()
        AND b.status IN ('pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived')
        AND b.payment_status <> 'paid'
    )
  );


CREATE OR REPLACE FUNCTION public.register_booking_attachment(
  p_booking_id uuid,
  p_storage_path text,
  p_file_size_bytes bigint
)
RETURNS public.booking_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.booking_attachments;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN
    RAISE EXCEPTION 'customer_account_required';
  END IF;
  IF p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 5242880 THEN
    RAISE EXCEPTION 'invalid_attachment_size';
  END IF;
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) <> auth.uid()::text
     OR split_part(p_storage_path, '/', 2) <> p_booking_id::text
     OR p_storage_path !~ ('^' || auth.uid()::text || '/' || p_booking_id::text || '/[a-f0-9]{64}\.jpg$') THEN
    RAISE EXCEPTION 'invalid_attachment_path';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'booking-attachments' AND o.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'attachment_object_missing';
  END IF;
  PERFORM 1 FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.customer_id = auth.uid()
    AND b.status IN ('pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived')
    AND b.payment_status <> 'paid'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_attachable'; END IF;

  SELECT * INTO v_row FROM public.booking_attachments
  WHERE storage_path = p_storage_path;
  IF FOUND THEN
    IF v_row.booking_id <> p_booking_id OR v_row.uploader_id <> auth.uid() THEN
      RAISE EXCEPTION 'attachment_path_already_used';
    END IF;
    RETURN v_row;
  END IF;

  SELECT count(*) INTO v_count FROM public.booking_attachments WHERE booking_id = p_booking_id;
  IF v_count >= 5 THEN RAISE EXCEPTION 'attachment_limit_reached'; END IF;
  INSERT INTO public.booking_attachments(booking_id, uploader_id, storage_path, mime_type, file_size_bytes)
  VALUES (p_booking_id, auth.uid(), p_storage_path, 'image/jpeg', p_file_size_bytes)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.register_booking_attachment(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_booking_attachment(uuid, text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_my_account_profile(
  p_full_name text,
  p_phone text,
  p_city text,
  p_years integer DEFAULT NULL,
  p_service_description text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.profiles;
  v_provider public.provider_profiles;
  v_digits text;
  v_description text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF nullif(trim(p_full_name), '') IS NULL OR length(trim(p_full_name)) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'invalid_full_name';
  END IF;
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) NOT BETWEEN 8 AND 15 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF length(trim(coalesce(p_city, ''))) > 120 THEN RAISE EXCEPTION 'invalid_city'; END IF;

  IF public.has_role('provider'::public.app_role) THEN
    v_description := trim(coalesce(p_service_description, ''));
    IF p_years IS NULL OR p_years NOT BETWEEN 0 AND 70 THEN RAISE EXCEPTION 'invalid_experience_years'; END IF;
    IF length(v_description) NOT BETWEEN 10 AND 3000 THEN RAISE EXCEPTION 'invalid_service_description'; END IF;
    SELECT * INTO v_provider FROM public.provider_profiles WHERE user_id = auth.uid() FOR UPDATE;
    IF v_provider.user_id IS NULL THEN RAISE EXCEPTION 'provider_profile_missing'; END IF;
    UPDATE public.provider_profiles
    SET years_experience = p_years,
        service_description = v_description,
        approval_status = CASE
          WHEN years_experience IS DISTINCT FROM p_years OR service_description IS DISTINCT FROM v_description
            THEN 'pending'
          ELSE approval_status
        END,
        updated_at = now()
    WHERE user_id = auth.uid();
  ELSIF public.has_role('customer'::public.app_role) THEN
    IF p_years IS NOT NULL OR p_service_description IS NOT NULL THEN RAISE EXCEPTION 'invalid_account_role'; END IF;
  ELSE
    RAISE EXCEPTION 'account_role_not_editable';
  END IF;

  UPDATE public.profiles
  SET full_name = trim(p_full_name), phone = trim(p_phone), city = nullif(trim(p_city), ''), updated_at = now()
  WHERE id = auth.uid()
  RETURNING * INTO v_profile;
  IF v_profile.id IS NULL THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  RETURN v_profile;
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_account_profile(text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_account_profile(text, text, text, integer, text) TO authenticated;

-- Client-visible tables are read-only; mutations go through role-checked RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.bookings, public.booking_quotes, public.payments,
  public.provider_profiles, public.provider_services, public.provider_ledger_entries,
  public.booking_status_history FROM anon, authenticated;
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.bookings, public.booking_quotes, public.payments, public.provider_profiles,
  public.provider_services, public.provider_ledger_entries, public.booking_status_history,
  public.profiles TO authenticated;

DO $$
DECLARE v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_booking'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function);
  END LOOP;
END;
$$;
