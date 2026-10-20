-- Allow one private JPEG attachment per booking message, using the existing private bucket.
-- The storage object is only readable after a message references it; orphan uploads can be removed by their uploader.
ALTER TABLE public.booking_messages
  DROP CONSTRAINT IF EXISTS booking_messages_body_check;
ALTER TABLE public.booking_messages
  DROP CONSTRAINT IF EXISTS booking_messages_body_or_attachment_check;
ALTER TABLE public.booking_messages
  ADD CONSTRAINT booking_messages_body_or_attachment_check
  CHECK (
    (length(trim(body)) BETWEEN 1 AND 4000)
    OR (attachment_path IS NOT NULL AND length(trim(body)) = 0)
  );
ALTER TABLE public.booking_messages
  DROP CONSTRAINT IF EXISTS booking_messages_attachment_path_shape_check;
ALTER TABLE public.booking_messages
  ADD CONSTRAINT booking_messages_attachment_path_shape_check
  CHECK (
    attachment_path IS NULL
    OR attachment_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/chat/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
  );

CREATE OR REPLACE FUNCTION public.validate_booking_message_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.attachment_path IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'message_attachment_auth_required';
  END IF;
  IF NEW.sender_id <> v_actor THEN
    RAISE EXCEPTION 'message_attachment_sender_mismatch';
  END IF;
  IF NEW.attachment_path !~ (
    '^' || v_actor::text || '/' || NEW.booking_id::text || '/chat/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
  ) THEN
    RAISE EXCEPTION 'message_attachment_path_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = NEW.booking_id
      AND (b.customer_id = v_actor OR b.provider_id = v_actor OR public.is_admin())
  ) THEN
    RAISE EXCEPTION 'message_attachment_booking_forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'booking-attachments'
      AND o.name = NEW.attachment_path
      AND o.metadata->>'mimetype' = 'image/jpeg'
      AND coalesce(o.metadata->>'size' ~ '^[0-9]+$', false)
  ) THEN
    RAISE EXCEPTION 'message_attachment_object_missing_or_invalid';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_booking_message_attachment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS validate_booking_message_attachment ON public.booking_messages;
CREATE TRIGGER validate_booking_message_attachment
  BEFORE INSERT OR UPDATE OF attachment_path, sender_id, booking_id
  ON public.booking_messages
  FOR EACH ROW EXECUTE FUNCTION public.validate_booking_message_attachment();

-- Chat UI does not currently mutate messages after sending. Prevent participants from editing message bodies or paths.
REVOKE UPDATE ON public.booking_messages FROM authenticated;
REVOKE UPDATE (id, booking_id, sender_id, body, attachment_path, read_at, created_at) ON public.booking_messages FROM authenticated;
DROP POLICY IF EXISTS "participants mark booking messages read" ON public.booking_messages;

DROP POLICY IF EXISTS "booking chat attachments private read" ON storage.objects;
CREATE POLICY "booking chat attachments private read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'booking-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.booking_messages m
      JOIN public.bookings b ON b.id = m.booking_id
      WHERE m.attachment_path = storage.objects.name
        AND (public.is_admin() OR b.customer_id = auth.uid() OR b.provider_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "booking chat participants upload attachment" ON storage.objects;
CREATE POLICY "booking chat participants upload attachment" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'booking-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND cardinality(storage.foldername(name)) = 3
    AND array_length(string_to_array(name, '/'), 1) = 4
    AND split_part(name, '/', 3) = 'chat'
    AND split_part(name, '/', 4) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    AND metadata->>'mimetype' = 'image/jpeg'
    AND coalesce(metadata->>'size' ~ '^[0-9]+$', false)
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = split_part(name, '/', 2)
        AND (b.customer_id = auth.uid() OR b.provider_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "booking chat attachment orphan cleanup" ON storage.objects;
CREATE POLICY "booking chat attachment orphan cleanup" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'booking-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND cardinality(storage.foldername(name)) = 3
    AND array_length(string_to_array(name, '/'), 1) = 4
    AND split_part(name, '/', 3) = 'chat'
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_messages m WHERE m.attachment_path = storage.objects.name
    )
  );
