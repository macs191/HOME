-- Least privilege for SECURITY DEFINER functions exposed through the public API.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
END $$;

-- The functions below enforce their own user/role checks and are called by the app.
GRANT EXECUTE ON FUNCTION public.add_provider_ledger_entry(uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_booking(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_completion(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, text, text, text, text, numeric, numeric, public.location_source, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_provider_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_provider_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_booking_price(uuid, numeric) TO authenticated;

-- Providers can inspect their own offered-service mappings; only admins can manage all mappings.
DROP POLICY IF EXISTS "providers read own provider services" ON public.provider_services;
CREATE POLICY "providers read own provider services" ON public.provider_services
FOR SELECT TO authenticated
USING (provider_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "admins manage provider services" ON public.provider_services;
CREATE POLICY "admins manage provider services" ON public.provider_services
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
