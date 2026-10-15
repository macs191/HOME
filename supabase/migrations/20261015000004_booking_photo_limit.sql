-- Requests show at most three issue photos, enforced in the safe RPC as well as the UI.
CREATE OR REPLACE FUNCTION public.register_booking_attachment_safe(p_booking_id uuid,p_storage_path text,p_file_size_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE a public.booking_attachments; o storage.objects; attachment_count integer;
BEGIN
  SELECT count(*) INTO attachment_count FROM public.booking_attachments WHERE booking_id=p_booking_id;
  IF attachment_count >= 3 THEN RAISE EXCEPTION 'attachment_limit_reached'; END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='booking-attachments' AND name=p_storage_path;
  IF o.id IS NULL OR o.metadata->>'mimetype' <> 'image/jpeg' OR o.metadata->>'size' !~ '^[0-9]+$' OR (o.metadata->>'size')::bigint <> p_file_size_bytes THEN RAISE EXCEPTION 'attachment_metadata_mismatch'; END IF;
  SELECT * INTO a FROM public.register_booking_attachment(p_booking_id,p_storage_path,p_file_size_bytes);
  RETURN jsonb_build_object('id',a.id,'booking_id',a.booking_id,'storage_path',a.storage_path,'file_size_bytes',a.file_size_bytes);
END $$;
REVOKE ALL ON FUNCTION public.register_booking_attachment_safe(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_booking_attachment_safe(uuid,text,bigint) TO authenticated;
