create or replace function public.customer_change_invoice_payment(p_payment_id uuid,p_method text) returns public.payments language plpgsql security definer set search_path=public as $$
declare changed public.payments;
begin
 if p_method not in ('cash','bank_transfer') then raise exception 'invalid_payment_method'; end if;
 update public.payments p set payment_method=p_method,provider=p_method,status='unpaid',receipt_reference=null,review_note=null from public.bookings b where p.id=p_payment_id and b.id=p.booking_id and b.customer_id=auth.uid() and p.status in ('unpaid','failed','pending') returning p.* into changed;
 if changed.id is null then raise exception 'payment_change_not_allowed'; end if;
 update public.bookings set payment_status='unpaid',updated_at=now() where id=changed.booking_id;
 return changed;
end; $$;
revoke all on function public.customer_change_invoice_payment(uuid,text) from public,anon; grant execute on function public.customer_change_invoice_payment(uuid,text) to authenticated;
