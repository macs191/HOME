alter table public.payments add column if not exists cash_received_amount numeric(12,2);

create or replace function public.provider_confirm_cash_payment(p_payment_id uuid, p_received_amount numeric)
returns public.payments
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  current_payment public.payments;
  current_booking public.bookings;
  changed public.payments;
begin
  if p_received_amount is null or p_received_amount <= 0 then raise exception 'cash_amount_invalid'; end if;
  select p.* into current_payment from public.payments p where p.id=p_payment_id for update;
  if current_payment.id is null then raise exception 'payment_not_found'; end if;
  select b.* into current_booking from public.bookings b where b.id=current_payment.booking_id for update;
  if current_booking.provider_id <> auth.uid() then raise exception 'provider_required'; end if;
  if current_payment.payment_method <> 'cash' then raise exception 'cash_payment_required'; end if;
  if current_payment.status = 'paid' then return current_payment; end if;
  if current_booking.status <> 'completed' then raise exception 'booking_not_completed'; end if;
  if abs(p_received_amount - current_payment.amount) > 0.01 then raise exception 'cash_amount_mismatch'; end if;
  update public.payments set status='paid', cash_received_amount=round(p_received_amount,2), settled_at=coalesce(settled_at,now()), review_note='أكد الفني استلام المبلغ نقدًا' where id=p_payment_id returning * into changed;
  update public.bookings set payment_status='paid', updated_at=now() where id=current_booking.id;
  insert into public.notifications(user_id,title,body,notification_type,target_path)
  values(current_booking.customer_id,'تم تأكيد الدفع النقدي','أكد الفني استلام مبلغ '||to_char(p_received_amount,'FM999999990.00')||' ر.س نقدًا. الفاتورة مدفوعة ومكتملة.','cash_payment_confirmed','/customer/orders');
  return changed;
end;
$$;
revoke all on function public.provider_confirm_cash_payment(uuid,numeric) from public,anon;
grant execute on function public.provider_confirm_cash_payment(uuid,numeric) to authenticated;
