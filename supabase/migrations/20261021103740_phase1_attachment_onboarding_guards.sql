-- Phase 1 audit remediations: prevent bypassing mandatory provider base location
-- and serialize the three-photo attachment cap with the booking row lock.

-- The 12-argument wrapper validates the provider's service coordinates before
-- invoking this legacy 10-argument implementation as its SECURITY DEFINER owner.
-- Keep the old overload for that internal call, but remove it as a client entry point.
REVOKE ALL ON FUNCTION public.provider_submit_onboarding_with_certificate(
  text, integer, text, text, text, text, text, text, text, uuid[]
) FROM PUBLIC, anon, authenticated;

-- Keep the lower-level function callable only by its SECURITY DEFINER wrapper.
REVOKE ALL ON FUNCTION public.register_booking_attachment(uuid, text, bigint)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_booking_attachment_safe(
  p_booking_id uuid,
  p_storage_path text,
  p_file_size_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  a public.booking_attachments;
  o storage.objects;
  attachment_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN
    RAISE EXCEPTION 'customer_account_required';
  END IF;

  -- Serialize uploads for this booking before counting; the inner registration
  -- RPC takes the same row lock, preventing concurrent calls from exceeding 3.
  PERFORM 1
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.customer_id = auth.uid()
    AND b.status IN ('pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived')
    AND b.payment_status <> 'paid'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_attachable';
  END IF;

  IF p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 5242880 THEN
    RAISE EXCEPTION 'invalid_attachment_size';
  END IF;
  IF p_storage_path IS NULL
     OR p_storage_path !~ ('^' || auth.uid()::text || '/' || p_booking_id::text || '/[a-f0-9]{64}\.jpg$') THEN
    RAISE EXCEPTION 'invalid_attachment_path';
  END IF;

  SELECT * INTO o
  FROM storage.objects
  WHERE bucket_id = 'booking-attachments'
    AND name = p_storage_path;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'attachment_metadata_mismatch';
  END IF;
  IF coalesce(o.metadata->>'mimetype', '') <> 'image/jpeg' THEN
    RAISE EXCEPTION 'attachment_metadata_mismatch';
  END IF;
  IF coalesce(o.metadata->>'size', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'attachment_metadata_mismatch';
  END IF;
  IF (o.metadata->>'size')::bigint <> p_file_size_bytes THEN
    RAISE EXCEPTION 'attachment_metadata_mismatch';
  END IF;

  -- Preserve idempotent retries for an attachment already registered by this user.
  SELECT * INTO a
  FROM public.booking_attachments
  WHERE storage_path = p_storage_path;
  IF FOUND THEN
    IF a.booking_id <> p_booking_id OR a.uploader_id <> auth.uid() THEN
      RAISE EXCEPTION 'attachment_path_already_used';
    END IF;
    RETURN jsonb_build_object(
      'id', a.id,
      'booking_id', a.booking_id,
      'storage_path', a.storage_path,
      'file_size_bytes', a.file_size_bytes
    );
  END IF;

  SELECT count(*) INTO attachment_count
  FROM public.booking_attachments
  WHERE booking_id = p_booking_id;
  IF attachment_count >= 3 THEN
    RAISE EXCEPTION 'attachment_limit_reached';
  END IF;

  SELECT * INTO a
  FROM public.register_booking_attachment(p_booking_id, p_storage_path, p_file_size_bytes);
  RETURN jsonb_build_object(
    'id', a.id,
    'booking_id', a.booking_id,
    'storage_path', a.storage_path,
    'file_size_bytes', a.file_size_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_booking_attachment_safe(uuid, text, bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_booking_attachment_safe(uuid, text, bigint)
  TO authenticated;
