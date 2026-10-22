CREATE OR REPLACE FUNCTION public.register_booking_attachment_safe(
  p_booking_id uuid, p_storage_path text, p_file_size_bytes bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE a public.booking_attachments; o storage.objects; attachment_count integer; object_size text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer'::public.app_role) THEN RAISE EXCEPTION 'customer_account_required'; END IF;
  PERFORM 1 FROM public.bookings b WHERE b.id=p_booking_id AND b.customer_id=auth.uid() AND b.status IN ('pending','quoted','accepted','assigned','on_the_way','arrived') AND b.payment_status<>'paid' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_attachable'; END IF;
  IF p_file_size_bytes IS NULL OR p_file_size_bytes<=0 OR p_file_size_bytes>5242880 THEN RAISE EXCEPTION 'invalid_attachment_size'; END IF;
  IF p_storage_path IS NULL OR p_storage_path !~ ('^'||auth.uid()::text||'/'||p_booking_id::text||'/[a-f0-9]{64}\.jpg$') THEN RAISE EXCEPTION 'invalid_attachment_path'; END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='booking-attachments' AND name=p_storage_path;
  IF o.id IS NULL OR coalesce(o.metadata->>'mimetype','')<>'image/jpeg' THEN RAISE EXCEPTION 'attachment_metadata_mismatch'; END IF;
  object_size:=o.metadata->>'size';
  IF object_size IS NOT NULL AND (object_size !~ '^[0-9]+$' OR object_size::bigint<>p_file_size_bytes) THEN RAISE EXCEPTION 'attachment_metadata_mismatch'; END IF;
  SELECT * INTO a FROM public.booking_attachments WHERE storage_path=p_storage_path;
  IF FOUND THEN
    IF a.booking_id<>p_booking_id OR a.uploader_id<>auth.uid() THEN RAISE EXCEPTION 'attachment_path_already_used'; END IF;
    RETURN jsonb_build_object('id',a.id,'booking_id',a.booking_id,'storage_path',a.storage_path,'file_size_bytes',a.file_size_bytes);
  END IF;
  SELECT count(*) INTO attachment_count FROM public.booking_attachments WHERE booking_id=p_booking_id;
  IF attachment_count>=3 THEN RAISE EXCEPTION 'attachment_limit_reached'; END IF;
  INSERT INTO public.booking_attachments(booking_id,uploader_id,storage_path,mime_type,file_size_bytes) VALUES(p_booking_id,auth.uid(),p_storage_path,'image/jpeg',p_file_size_bytes) RETURNING * INTO a;
  RETURN jsonb_build_object('id',a.id,'booking_id',a.booking_id,'storage_path',a.storage_path,'file_size_bytes',a.file_size_bytes);
END; $$;
REVOKE ALL ON FUNCTION public.register_booking_attachment_safe(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_booking_attachment_safe(uuid,text,bigint) TO authenticated;
