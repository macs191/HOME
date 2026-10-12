-- The old generic state/payment RPCs bypassed the new quote and invoice workflow.
do $$ begin
  if to_regprocedure('public.transition_booking_status(uuid,public.booking_status,text)') is not null then
    execute 'revoke all on function public.transition_booking_status(uuid, public.booking_status, text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.confirm_booking_completion(uuid,text)') is not null then
    execute 'revoke all on function public.confirm_booking_completion(uuid, text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.prepare_payment(uuid)') is not null then
    execute 'revoke all on function public.prepare_payment(uuid) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.set_booking_price(uuid,numeric)') is not null then
    execute 'revoke all on function public.set_booking_price(uuid, numeric) from public, anon, authenticated';
  end if;
end $$;

create or replace function public.customer_select_invoice_payment(p_payment_id uuid, p_method text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare changed public.payments;
begin
  if p_method not in ('cash','bank_transfer') then raise exception 'invalid_payment_method'; end if;
  update public.payments p set payment_method = p_method, provider = p_method, status = 'unpaid', review_note = null
    from public.bookings b where p.id = p_payment_id and b.id = p.booking_id and b.customer_id = auth.uid() and p.status in ('unpaid','failed') returning p.* into changed;
  if changed.id is null then raise exception 'invoice_not_selectable'; end if;
  update public.bookings set payment_status = 'unpaid' where id = changed.booking_id;
  return changed;
end; $$;
revoke all on function public.customer_select_invoice_payment(uuid,text) from public, anon;
grant execute on function public.customer_select_invoice_payment(uuid,text) to authenticated;
