-- 1) Internal helper/trigger functions are not RPC endpoints. Keep them callable only
-- by their owner so nested SECURITY DEFINER functions and table triggers continue to work.
REVOKE EXECUTE ON FUNCTION public.clear_finished_booking_tracking() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_product_installation_job() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_product_reservation_on_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.store_coupon_discount(public.coupons, jsonb, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_provider_ledger_insert() FROM PUBLIC, anon, authenticated;

-- This trigger function does not need an ambient caller-controlled search_path.
ALTER FUNCTION public.prevent_provider_ledger_mutation() SET search_path = public, pg_temp;

-- 2) Add bookings to the same Realtime publication used by the client subscriptions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
  END IF;
END;
$$;

-- 3) Capture a deliberately limited, privacy-conscious change set. Addresses, phone
-- numbers, identity documents, chat text and location coordinates are never copied.
CREATE OR REPLACE FUNCTION public.capture_sensitive_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_row jsonb := '{}'::jsonb;
  new_row jsonb := '{}'::jsonb;
  allowed_fields text[];
  field_name text;
  field_changes jsonb := '{}'::jsonb;
  entity_id_value text;
  action_value text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

  CASE TG_TABLE_NAME
    WHEN 'bookings' THEN
      allowed_fields := ARRAY['provider_id','status','price_snapshot','payment_status','commission_rate_snapshot','commission_amount_snapshot','provider_amount_snapshot'];
    WHEN 'services' THEN
      allowed_fields := ARRAY['name_ar','category_id','pricing_type','base_price','is_active','display_order'];
    WHEN 'products' THEN
      allowed_fields := ARRAY['name_ar','price','discount_percent','stock_quantity','reserved_quantity','is_active','category_id'];
    WHEN 'coupons' THEN
      allowed_fields := ARRAY['code','discount_type','discount_value','starts_at','ends_at','max_uses','is_active','applies_to','product_id','category_id'];
    WHEN 'profiles' THEN
      allowed_fields := ARRAY['is_active'];
    WHEN 'provider_profiles' THEN
      allowed_fields := ARRAY['approval_status','default_commission_rate','availability_status'];
    WHEN 'provider_documents' THEN
      allowed_fields := ARRAY['status','is_current'];
    WHEN 'payments' THEN
      allowed_fields := ARRAY['amount','status','payment_method'];
    WHEN 'booking_quotes' THEN
      allowed_fields := ARRAY['amount','visit_fee','status'];
    WHEN 'product_orders' THEN
      allowed_fields := ARRAY['provider_id','status','installation_status','subtotal','discount_amount','total_amount'];
    WHEN 'product_order_refunds' THEN
      allowed_fields := ARRAY['amount','status','method'];
    WHEN 'provider_ledger_entries' THEN
      allowed_fields := ARRAY['provider_id','booking_id','entry_type','amount'];
    ELSE
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
  END CASE;

  FOREACH field_name IN ARRAY allowed_fields LOOP
    IF old_row -> field_name IS DISTINCT FROM new_row -> field_name THEN
      field_changes := field_changes || jsonb_build_object(
        field_name,
        jsonb_build_object('before', old_row -> field_name, 'after', new_row -> field_name)
      );
    END IF;
  END LOOP;

  IF field_changes <> '{}'::jsonb THEN
    entity_id_value := COALESCE(
      new_row ->> 'id', old_row ->> 'id',
      new_row ->> 'user_id', old_row ->> 'user_id',
      new_row ->> 'provider_id', old_row ->> 'provider_id'
    );
    action_value := 'row_' || lower(TG_OP);
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      auth.uid(), action_value, TG_TABLE_NAME, entity_id_value,
      jsonb_build_object('source','database_trigger','changes',field_changes)
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_sensitive_audit_event() FROM PUBLIC, anon, authenticated;

-- Recreate only this migration's known triggers; no business rows are changed.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'bookings','services','products','coupons','profiles','provider_profiles',
    'provider_documents','payments','booking_quotes','product_orders',
    'product_order_refunds','provider_ledger_entries'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS capture_sensitive_audit_event ON public.%I', table_name);
      EXECUTE format(
        'CREATE TRIGGER capture_sensitive_audit_event AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_sensitive_audit_event()',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx ON public.audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_type_created_idx ON public.audit_logs(entity_type, created_at DESC);
