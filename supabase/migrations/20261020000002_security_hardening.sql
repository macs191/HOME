-- Security hardening: sensitive operational data is never readable by anon.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bookings','booking_attachments','booking_messages','booking_status_history','payments',
    'provider_profiles','provider_documents','provider_ledger_entries','provider_locations',
    'booking_tracking_locations','product_orders','product_order_items','product_order_refunds',
    'product_order_materials','product_installation_jobs','audit_logs'
  ] LOOP
    EXECUTE format('alter table public.%I enable row level security', t);
    EXECUTE format('revoke all on table public.%I from anon', t);
  END LOOP;
END $$;

DO $$
DECLARE bucket_public boolean;
BEGIN
  SELECT public INTO bucket_public FROM storage.buckets WHERE id = 'booking-attachments';
  IF bucket_public IS DISTINCT FROM false THEN RAISE EXCEPTION 'booking_attachments_bucket_must_be_private'; END IF;
  SELECT public INTO bucket_public FROM storage.buckets WHERE id = 'provider-cvs';
  IF bucket_public IS DISTINCT FROM false THEN RAISE EXCEPTION 'provider_cvs_bucket_must_be_private'; END IF;
  SELECT public INTO bucket_public FROM storage.buckets WHERE id = 'identity-documents';
  IF bucket_public IS DISTINCT FROM false THEN RAISE EXCEPTION 'identity_documents_bucket_must_be_private'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_financial_report(date,date) FROM anon;
REVOKE ALL ON FUNCTION public.assign_booking(uuid,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_review_invoice_payment(uuid,boolean,text) FROM anon;
REVOKE ALL ON FUNCTION public.register_booking_attachment_safe(uuid,text,bigint) FROM anon;
REVOKE ALL ON FUNCTION public.customer_set_tracking_consent(uuid,boolean) FROM anon;
REVOKE ALL ON FUNCTION public.provider_update_booking_location(uuid,numeric,numeric,numeric) FROM anon;
