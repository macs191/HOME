alter table public.product_orders
  add column if not exists delivery_requested boolean not null default false,
  add column if not exists delivery_status text not null default 'not_requested';

do $$
begin
  alter table public.product_orders
    add constraint product_orders_delivery_status_check
    check (delivery_status in ('not_requested','pending','sent','in_transit','delivered','cancelled'));
exception when duplicate_object then null;
end $$;

create index if not exists product_orders_delivery_idx on public.product_orders(delivery_status, created_at desc);

create or replace function public.admin_dispatch_product_delivery(p_order_id uuid)
returns public.product_orders
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed public.product_orders;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  update public.product_orders
    set delivery_requested = true,
        delivery_status = 'sent',
        updated_at = now()
    where id = p_order_id
      and status not in ('cancelled','completed')
    returning * into changed;
  if changed.id is null then raise exception 'product_order_not_found_or_terminal'; end if;
  insert into public.notifications(user_id, title, body, notification_type, target_path)
  values (changed.customer_id, 'تم إرسال طلبك للتوصيل', 'تم إرسال طلب المنتجات إلى خدمة التوصيل. ستصلك التحديثات عند تحرك الطلب ووصوله.', 'delivery_sent', '/customer/store-orders');
  return changed;
end;
$$;
revoke all on function public.admin_dispatch_product_delivery(uuid) from public, anon;
grant execute on function public.admin_dispatch_product_delivery(uuid) to authenticated;

-- Keep admin dashboards live for operational and commerce changes.
do $$
begin
  begin alter publication supabase_realtime add table public.product_orders; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.provider_profiles; exception when duplicate_object then null; end;
exception when undefined_object then null;
end $$;
