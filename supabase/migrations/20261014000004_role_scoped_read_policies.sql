DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname='public' AND tablename IN
    ('bookings','booking_quotes','payments','provider_profiles','provider_services','provider_ledger_entries','booking_status_history','profiles','booking_attachments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bookings, public.booking_quotes, public.payments, public.provider_profiles,
  public.provider_services, public.provider_ledger_entries, public.booking_status_history,
  public.profiles, public.booking_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bookings, public.booking_quotes, public.payments, public.provider_profiles,
  public.provider_services, public.provider_ledger_entries, public.booking_status_history,
  public.profiles, public.booking_attachments TO authenticated;

-- Final role-scoped policy definitions.
-- Final hardening: role-scoped reads, private RPCs, and review-safe specialty edits.
DROP POLICY IF EXISTS booking_participants_select ON public.bookings;
DROP POLICY IF EXISTS quote_participants_select ON public.booking_quotes;
DROP POLICY IF EXISTS payment_customer_admin_select ON public.payments;
DROP POLICY IF EXISTS provider_profile_owner_admin_select ON public.provider_profiles;
DROP POLICY IF EXISTS provider_service_owner_admin_select ON public.provider_services;
DROP POLICY IF EXISTS ledger_owner_admin_select ON public.provider_ledger_entries;
DROP POLICY IF EXISTS status_history_participants_select ON public.booking_status_history;
DROP POLICY IF EXISTS profile_owner_admin_select ON public.profiles;
DROP POLICY IF EXISTS attachment_participants_select ON public.booking_attachments;
DROP POLICY IF EXISTS booking_attachments_storage_read ON storage.objects;
DROP POLICY IF EXISTS booking_attachments_storage_insert ON storage.objects;
DROP POLICY IF EXISTS booking_attachments_storage_delete_orphan ON storage.objects;
DROP POLICY IF EXISTS "booking attachments private read" ON storage.objects;
DROP POLICY IF EXISTS "booking attachments customer upload" ON storage.objects;

CREATE POLICY booking_participants_select ON public.bookings FOR SELECT TO authenticated USING
  (public.is_admin()
   OR (public.has_role('customer'::public.app_role) AND customer_id=auth.uid())
   OR (public.has_role('provider'::public.app_role) AND provider_id=auth.uid()));
CREATE POLICY quote_participants_select ON public.booking_quotes FOR SELECT TO authenticated USING
  (public.is_admin()
   OR (public.has_role('provider'::public.app_role) AND provider_id=auth.uid())
   OR (public.has_role('customer'::public.app_role) AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=booking_quotes.booking_id AND b.customer_id=auth.uid())));
CREATE POLICY payment_customer_admin_select ON public.payments FOR SELECT TO authenticated USING
  (public.is_admin() OR (public.has_role('customer'::public.app_role) AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=payments.booking_id AND b.customer_id=auth.uid())));
CREATE POLICY provider_profile_owner_admin_select ON public.provider_profiles FOR SELECT TO authenticated USING
  (public.is_admin() OR (public.has_role('provider'::public.app_role) AND user_id=auth.uid()));
CREATE POLICY provider_service_owner_admin_select ON public.provider_services FOR SELECT TO authenticated USING
  (public.is_admin() OR (public.has_role('provider'::public.app_role) AND provider_id=auth.uid()));
CREATE POLICY ledger_owner_admin_select ON public.provider_ledger_entries FOR SELECT TO authenticated USING
  (public.is_admin() OR (public.has_role('provider'::public.app_role) AND provider_id=auth.uid()));
CREATE POLICY status_history_participants_select ON public.booking_status_history FOR SELECT TO authenticated USING
  (public.is_admin() OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=booking_status_history.booking_id AND ((public.has_role('customer'::public.app_role) AND b.customer_id=auth.uid()) OR (public.has_role('provider'::public.app_role) AND b.provider_id=auth.uid()))));
CREATE POLICY profile_owner_admin_select ON public.profiles FOR SELECT TO authenticated USING
  (public.is_admin() OR id=auth.uid() OR (public.has_role('provider'::public.app_role) AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id=profiles.id AND b.provider_id=auth.uid())));
CREATE POLICY attachment_participants_select ON public.booking_attachments FOR SELECT TO authenticated USING
  (public.is_admin() OR (public.has_role('customer'::public.app_role) AND uploader_id=auth.uid()) OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=booking_attachments.booking_id AND ((public.has_role('customer'::public.app_role) AND b.customer_id=auth.uid()) OR (public.has_role('provider'::public.app_role) AND b.provider_id=auth.uid()))));

CREATE POLICY booking_attachments_storage_read ON storage.objects FOR SELECT TO authenticated USING
  (bucket_id='booking-attachments' AND EXISTS (SELECT 1 FROM public.booking_attachments a JOIN public.bookings b ON b.id=a.booking_id WHERE a.bucket_id='booking-attachments' AND a.storage_path=name AND (public.is_admin() OR (public.has_role('customer'::public.app_role) AND b.customer_id=auth.uid()) OR (public.has_role('provider'::public.app_role) AND b.provider_id=auth.uid()))));
CREATE POLICY booking_attachments_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK
  (bucket_id='booking-attachments' AND public.has_role('customer'::public.app_role) AND (storage.foldername(name))[1]=auth.uid()::text
   AND cardinality(storage.foldername(name))=2 AND array_length(string_to_array(name,'/'),1)=3
   AND split_part(name,'/',3) ~ '^[a-f0-9]{64}[.]jpg$'
   AND metadata->>'mimetype'='image/jpeg' AND metadata->>'size' ~ '^[0-9]+$' AND (metadata->>'size')::bigint BETWEEN 1 AND 5242880
   AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id::text=(storage.foldername(name))[2] AND b.customer_id=auth.uid() AND b.status IN ('pending','quoted','accepted','assigned','on_the_way','arrived') AND b.payment_status <> 'paid'));
CREATE POLICY booking_attachments_storage_delete_orphan ON storage.objects FOR DELETE TO authenticated USING
  (bucket_id='booking-attachments' AND public.has_role('customer'::public.app_role) AND (storage.foldername(name))[1]=auth.uid()::text
   AND NOT EXISTS (SELECT 1 FROM public.booking_attachments a WHERE a.bucket_id='booking-attachments' AND a.storage_path=name));
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
