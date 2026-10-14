-- Existing broad-returning RPCs are private implementation details; wrappers expose minimal JSON only.
CREATE OR REPLACE FUNCTION public.admin_assign_booking_safe(p_booking_id uuid, p_provider_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_booking_id IS NULL OR p_provider_id IS NULL THEN RAISE EXCEPTION 'booking_and_provider_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.provider_id IS NOT NULL OR x.status NOT IN ('pending','quoted','accepted') THEN RAISE EXCEPTION 'booking_not_assignable'; END IF;
  x := public.assign_booking(p_booking_id,p_provider_id);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'provider_id',x.provider_id);
END $$;
CREATE OR REPLACE FUNCTION public.admin_reassign_booking_safe(p_booking_id uuid,p_provider_id uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.provider_id IS NULL OR x.status NOT IN ('assigned','on_the_way','arrived') THEN RAISE EXCEPTION 'booking_not_reassignable'; END IF;
  x := public.admin_reassign_booking(p_booking_id,p_provider_id,p_note);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'provider_id',x.provider_id);
END $$;
CREATE OR REPLACE FUNCTION public.admin_unassign_booking_safe(p_booking_id uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.provider_id IS NULL OR x.status <> 'assigned' THEN RAISE EXCEPTION 'booking_not_unassignable'; END IF;
  x := public.admin_unassign_booking(p_booking_id,p_note);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'provider_id',x.provider_id);
END $$;
CREATE OR REPLACE FUNCTION public.customer_cancel_booking_safe(p_booking_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role('customer') THEN RAISE EXCEPTION 'customer_account_required'; END IF;
  IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id AND customer_id=auth.uid() FOR UPDATE;
  IF x.id IS NULL OR x.status NOT IN ('pending','quoted','accepted','assigned') OR x.payment_status='paid' OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id=x.id AND p.status IN ('pending','paid')) THEN RAISE EXCEPTION 'booking_not_customer_cancellable'; END IF;
  x := public.customer_cancel_booking(p_booking_id,p_reason);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'cancellation_reason',x.cancellation_reason);
END $$;
CREATE OR REPLACE FUNCTION public.admin_cancel_booking_safe(p_booking_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF x.id IS NULL OR x.status IN ('completed','cancelled') OR x.payment_status='paid' THEN RAISE EXCEPTION 'booking_not_admin_cancellable'; END IF;
  x := public.admin_cancel_booking(p_booking_id,p_reason);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'cancellation_reason',x.cancellation_reason);
END $$;
CREATE OR REPLACE FUNCTION public.provider_advance_booking_safe(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id AND provider_id=auth.uid() FOR UPDATE;
  IF x.id IS NULL OR x.status NOT IN ('assigned','on_the_way','arrived') OR NOT public.has_role('provider') THEN RAISE EXCEPTION 'booking_not_advanceable'; END IF;
  x := public.provider_advance_booking(p_booking_id);
  RETURN jsonb_build_object('id',x.id,'status',x.status);
END $$;
CREATE OR REPLACE FUNCTION public.provider_submit_quote_safe(p_booking_id uuid,p_amount numeric,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.booking_quotes;
BEGIN
  IF NOT public.has_role('provider') OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN RAISE EXCEPTION 'invalid_quote'; END IF;
  IF length(trim(coalesce(p_note,''))) > 2000 THEN RAISE EXCEPTION 'quote_note_too_long'; END IF;
  x := public.provider_submit_quote(p_booking_id,p_amount,p_note);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'amount',x.amount,'status',x.status);
END $$;
CREATE OR REPLACE FUNCTION public.provider_finish_fixed_booking_safe(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.bookings;
BEGIN
  IF NOT public.has_role('provider') THEN RAISE EXCEPTION 'provider_account_required'; END IF;
  SELECT * INTO x FROM public.bookings WHERE id=p_booking_id AND provider_id=auth.uid() FOR UPDATE;
  IF x.id IS NULL OR x.status <> 'in_progress' THEN RAISE EXCEPTION 'booking_not_finishable'; END IF;
  x := public.provider_finish_fixed_booking(p_booking_id);
  RETURN jsonb_build_object('id',x.id,'status',x.status,'price_snapshot',x.price_snapshot);
END $$;
CREATE OR REPLACE FUNCTION public.admin_reject_booking_quote_safe(p_quote_id uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.booking_quotes;
BEGIN
  IF NOT public.is_admin() OR length(trim(coalesce(p_note,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'quote_rejection_reason_required'; END IF;
  SELECT * INTO x FROM public.booking_quotes WHERE id=p_quote_id AND status='pending' FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION 'quote_not_pending'; END IF;
  x := public.admin_reject_booking_quote(p_quote_id,p_note);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'status',x.status,'admin_review_note',x.admin_review_note);
END $$;
CREATE OR REPLACE FUNCTION public.admin_accept_booking_quote_safe(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q public.booking_quotes; x public.payments;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT * INTO q FROM public.booking_quotes WHERE id=p_quote_id AND status='pending' FOR UPDATE;
  IF q.id IS NULL OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id=q.booking_id) THEN RAISE EXCEPTION 'invoice_already_exists'; END IF;
  x := public.admin_accept_booking_quote(p_quote_id);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'invoice_number',x.invoice_number,'amount',x.amount,'status',x.status);
END $$;
CREATE OR REPLACE FUNCTION public.admin_review_invoice_payment_safe(p_payment_id uuid,p_paid boolean,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.payments; b public.bookings; x public.payments; method text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=p_payment_id FOR UPDATE;
  SELECT * INTO b FROM public.bookings WHERE id=p.booking_id FOR UPDATE;
  IF p.id IS NULL OR b.id IS NULL OR b.status <> 'completed' THEN RAISE EXCEPTION 'service_not_completed'; END IF;
  IF p.status='paid' THEN IF p_paid THEN RETURN jsonb_build_object('id',p.id,'status',p.status,'amount',p.amount); ELSE RAISE EXCEPTION 'paid_payment_cannot_be_reversed'; END IF; END IF;
  IF p_paid THEN
    method := CASE WHEN p.provider IN ('cash','bank_transfer') THEN p.provider ELSE NULL END;
    IF method IS NULL OR p.payment_method IS DISTINCT FROM method OR p.payment_method NOT IN ('cash','bank_transfer') OR p.amount IS DISTINCT FROM b.price_snapshot THEN RAISE EXCEPTION 'payment_provider_or_amount_mismatch'; END IF;
  ELSE
    IF p.status <> 'pending' OR p.payment_method <> 'bank_transfer' OR nullif(trim(coalesce(p.receipt_reference,'')), '') IS NULL THEN RAISE EXCEPTION 'transfer_not_rejectable'; END IF;
    IF length(trim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'payment_rejection_reason_required'; END IF;
  END IF;
  x := public.admin_review_invoice_payment(p_payment_id,p_paid,p_note);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'amount',x.amount,'status',x.status,'payment_method',x.payment_method);
END $$;
CREATE OR REPLACE FUNCTION public.add_provider_ledger_entry_safe(p_provider_id uuid,p_booking_id uuid,p_entry_type text,p_amount numeric,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.provider_ledger_entries;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_entry_type NOT IN ('payout','late_penalty','adjustment') OR p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'invalid_ledger_entry'; END IF;
  IF p_entry_type IN ('payout','late_penalty') AND p_amount < 0 THEN RAISE EXCEPTION 'ledger_amount_must_be_positive_input'; END IF;
  IF p_entry_type='adjustment' AND length(trim(coalesce(p_note,''))) < 3 THEN RAISE EXCEPTION 'adjustment_reason_required'; END IF;
  x := public.add_provider_ledger_entry(p_provider_id,p_booking_id,p_entry_type,p_amount,p_note);
  RETURN jsonb_build_object('id',x.id,'provider_id',x.provider_id,'booking_id',x.booking_id,'entry_type',x.entry_type,'amount',x.amount,'note',x.note);
END $$;
CREATE OR REPLACE FUNCTION public.customer_select_invoice_payment_safe(p_payment_id uuid,p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.payments; x public.payments;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id=p_payment_id AND status IN ('unpaid','failed') FOR UPDATE;
  IF p.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.booking_id AND b.customer_id=auth.uid() AND b.status='completed') THEN RAISE EXCEPTION 'invoice_not_selectable'; END IF;
  IF p_method NOT IN ('cash','bank_transfer') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;
  x := public.customer_select_invoice_payment(p_payment_id,p_method);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'amount',x.amount,'status',x.status,'payment_method',x.payment_method);
END $$;
CREATE OR REPLACE FUNCTION public.customer_submit_transfer_reference_safe(p_payment_id uuid,p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.payments; x public.payments;
BEGIN
  IF length(trim(coalesce(p_reference,''))) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'transfer_reference_required'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=p_payment_id AND status='pending' AND payment_method='bank_transfer' FOR UPDATE;
  IF p.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.booking_id AND b.customer_id=auth.uid() AND b.status='completed') THEN RAISE EXCEPTION 'transfer_not_submittable'; END IF;
  x := public.customer_submit_transfer_reference(p_payment_id,p_reference);
  RETURN jsonb_build_object('id',x.id,'booking_id',x.booking_id,'status',x.status,'receipt_reference',x.receipt_reference);
END $$;
CREATE OR REPLACE FUNCTION public.update_my_account_profile_safe(p_full_name text,p_phone text,p_city text,p_years integer,p_service_description text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x public.profiles;
BEGIN
  SELECT * INTO x FROM public.update_my_account_profile(p_full_name,p_phone,p_city,p_years,p_service_description);
  RETURN jsonb_build_object('id',x.id,'full_name',x.full_name,'phone',x.phone,'city',x.city);
END $$;
CREATE OR REPLACE FUNCTION public.register_booking_attachment_safe(p_booking_id uuid,p_storage_path text,p_file_size_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.booking_attachments; o storage.objects;
BEGIN
  SELECT * INTO o FROM storage.objects WHERE bucket_id='booking-attachments' AND name=p_storage_path;
  IF o.id IS NULL OR o.metadata->>'mimetype' <> 'image/jpeg' OR o.metadata->>'size' !~ '^[0-9]+$' OR (o.metadata->>'size')::bigint <> p_file_size_bytes THEN RAISE EXCEPTION 'attachment_metadata_mismatch'; END IF;
  SELECT * INTO a FROM public.register_booking_attachment(p_booking_id,p_storage_path,p_file_size_bytes);
  RETURN jsonb_build_object('id',a.id,'booking_id',a.booking_id,'storage_path',a.storage_path,'file_size_bytes',a.file_size_bytes);
END $$;

-- Atomic service-role-only Stripe settlement. It is intentionally separate from the old full-row RPC.
CREATE OR REPLACE FUNCTION public.settle_stripe_payment_safe(p_payment_id uuid,p_session_id text,p_payment_intent_id text,p_amount_minor bigint,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.payments; b public.bookings; c uuid; earning_id uuid;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_payment_id IS NULL OR nullif(trim(p_session_id),'') IS NULL OR nullif(trim(p_payment_intent_id),'') IS NULL OR p_amount_minor IS NULL OR p_amount_minor <= 0 OR lower(coalesce(p_currency,'')) <> 'sar' THEN RAISE EXCEPTION 'stripe_event_invalid'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=p_payment_id FOR UPDATE;
  IF p.id IS NULL OR p.provider <> 'stripe' THEN RAISE EXCEPTION 'stripe_invoice_not_found'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=p.booking_id FOR UPDATE;
  IF b.id IS NULL OR b.status <> 'completed' OR round(p.amount*100)::bigint <> p_amount_minor THEN RAISE EXCEPTION 'stripe_amount_or_booking_mismatch'; END IF;
  IF p.status='paid' THEN
    IF p.external_reference IS DISTINCT FROM p_session_id OR p.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id THEN RAISE EXCEPTION 'stripe_idempotency_mismatch'; END IF;
    RETURN jsonb_build_object('id',p.id,'booking_id',p.booking_id,'status',p.status,'amount',p.amount,'payment_intent_id',p.stripe_payment_intent_id);
  END IF;
  IF p.status <> 'pending' OR p.external_reference IS DISTINCT FROM p_session_id THEN RAISE EXCEPTION 'stripe_session_mismatch'; END IF;
  UPDATE public.payments SET status='paid', payment_method='card', settled_at=coalesce(settled_at,now()), stripe_payment_intent_id=p_payment_intent_id WHERE id=p.id RETURNING * INTO p;
  UPDATE public.bookings SET payment_status='paid',updated_at=now() WHERE id=b.id;
  IF b.provider_id IS NOT NULL AND coalesce(b.provider_amount_snapshot,0)>0 THEN
    INSERT INTO public.provider_ledger_entries(provider_id,booking_id,entry_type,amount,note,created_by)
    SELECT b.provider_id,b.id,'earning',b.provider_amount_snapshot,'مستحق بعد تحصيل الفاتورة '||p.invoice_number||' عبر البطاقة',NULL
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_ledger_entries WHERE booking_id=b.id AND entry_type='earning');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id=b.customer_id AND notification_type='payment_paid' AND body LIKE '%'||p.invoice_number::text||'%') THEN
    INSERT INTO public.notifications(user_id,title,body,notification_type,target_path) VALUES (b.customer_id,'تم تسجيل الدفع الإلكتروني','تم تأكيد دفع الفاتورة رقم '||p.invoice_number||'.','payment_paid','/customer/orders');
  END IF;
  RETURN jsonb_build_object('id',p.id,'booking_id',p.booking_id,'status',p.status,'amount',p.amount,'payment_intent_id',p.stripe_payment_intent_id);
END $$;
REVOKE ALL ON FUNCTION public.settle_stripe_payment(uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.settle_stripe_payment_safe(uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_stripe_payment_safe(uuid,text,text,bigint,text) TO service_role;

-- Financial invariants are enforced independently of RPC callers.
CREATE OR REPLACE FUNCTION public.validate_provider_ledger_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.bookings; p public.provider_profiles; balance numeric;
BEGIN
  SELECT * INTO p FROM public.provider_profiles WHERE user_id=NEW.provider_id FOR UPDATE;
  IF p.user_id IS NULL OR NEW.amount IS NULL OR NEW.amount=0 THEN RAISE EXCEPTION 'invalid_ledger_entry'; END IF;
  IF NEW.entry_type='earning' THEN
    IF NEW.amount <= 0 OR NEW.booking_id IS NULL THEN RAISE EXCEPTION 'earning_must_be_positive_and_booked'; END IF;
    SELECT * INTO b FROM public.bookings WHERE id=NEW.booking_id;
    IF b.id IS NULL OR b.provider_id<>NEW.provider_id OR b.status<>'completed' OR b.payment_status<>'paid' OR b.provider_amount_snapshot IS DISTINCT FROM NEW.amount THEN RAISE EXCEPTION 'earning_booking_payment_mismatch'; END IF;
  ELSIF NEW.entry_type IN ('payout','late_penalty') THEN
    IF NEW.amount >= 0 THEN RAISE EXCEPTION 'payout_or_penalty_must_be_negative'; END IF;
    IF NEW.entry_type='payout' THEN SELECT coalesce(sum(amount),0) INTO balance FROM public.provider_ledger_entries WHERE provider_id=NEW.provider_id; IF balance + NEW.amount < 0 THEN RAISE EXCEPTION 'payout_exceeds_available_balance'; END IF; END IF;
  ELSIF NEW.entry_type='adjustment' THEN
    IF length(trim(coalesce(NEW.note,''))) < 3 THEN RAISE EXCEPTION 'adjustment_reason_required'; END IF;
  ELSE RAISE EXCEPTION 'invalid_entry_type'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS provider_ledger_insert_validation ON public.provider_ledger_entries;
CREATE TRIGGER provider_ledger_insert_validation BEFORE INSERT ON public.provider_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.validate_provider_ledger_insert();
CREATE OR REPLACE FUNCTION public.prevent_provider_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger_is_immutable_use_adjustment'; END $$;
DROP TRIGGER IF EXISTS provider_ledger_immutable ON public.provider_ledger_entries;
CREATE TRIGGER provider_ledger_immutable BEFORE UPDATE OR DELETE ON public.provider_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.prevent_provider_ledger_mutation();

REVOKE ALL ON FUNCTION public.assign_booking(uuid,uuid), public.admin_reassign_booking(uuid,uuid,text), public.admin_unassign_booking(uuid,text), public.customer_cancel_booking(uuid,text), public.admin_cancel_booking(uuid,text), public.provider_advance_booking(uuid), public.provider_submit_quote(uuid,numeric,text), public.provider_finish_fixed_booking(uuid), public.admin_reject_booking_quote(uuid,text), public.admin_accept_booking_quote(uuid), public.admin_review_invoice_payment(uuid,boolean,text), public.add_provider_ledger_entry(uuid,uuid,text,numeric,text), public.customer_select_invoice_payment(uuid,text), public.customer_submit_transfer_reference(uuid,text), public.update_my_account_profile(text,text,text,integer,text), public.register_booking_attachment(uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_booking_safe(uuid,uuid), public.admin_reassign_booking_safe(uuid,uuid,text), public.admin_unassign_booking_safe(uuid,text), public.customer_cancel_booking_safe(uuid,text), public.admin_cancel_booking_safe(uuid,text), public.provider_advance_booking_safe(uuid), public.provider_submit_quote_safe(uuid,numeric,text), public.provider_finish_fixed_booking_safe(uuid), public.admin_reject_booking_quote_safe(uuid,text), public.admin_accept_booking_quote_safe(uuid), public.admin_review_invoice_payment_safe(uuid,boolean,text), public.add_provider_ledger_entry_safe(uuid,uuid,text,numeric,text), public.customer_select_invoice_payment_safe(uuid,text), public.customer_submit_transfer_reference_safe(uuid,text), public.update_my_account_profile_safe(text,text,text,integer,text), public.register_booking_attachment_safe(uuid,text,bigint) TO authenticated;


