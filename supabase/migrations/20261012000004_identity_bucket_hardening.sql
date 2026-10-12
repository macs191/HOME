-- Keep provider identity files private, small, and limited to supported document types.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'identity-documents') THEN
    RAISE EXCEPTION 'identity_documents_bucket_missing';
  END IF;
END $$;

UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
WHERE id = 'identity-documents';

DROP POLICY IF EXISTS "provider identity delete" ON storage.objects;
CREATE POLICY "provider identity delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'identity-documents'
  AND (((storage.foldername(name))[1] = (auth.uid())::text) OR public.is_admin())
);
