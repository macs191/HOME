alter table public.product_orders
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists refund_status text not null default 'not_requested' check (refund_status in ('not_requested','pending','approved','processed','rejected')),
  add column if not exists refund_amount numeric(12,2) not null default 0 check (refund_amount >= 0),
  add column if not exists refund_method text,
  add column if not exists refund_reference text;

create table if not exists public.product_order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.product_orders(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount >= 0),
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','processed','rejected')),
  method text,
  external_reference text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.product_order_refunds enable row level security;
drop policy if exists "participants read product refunds" on public.product_order_refunds;
create policy "participants read product refunds" on public.product_order_refunds for select using (public.is_admin() or requested_by = auth.uid() or exists(select 1 from public.product_orders o where o.id=order_id and o.customer_id=auth.uid()));
drop policy if exists "admins manage product refunds" on public.product_order_refunds;
create policy "admins manage product refunds" on public.product_order_refunds for all using (public.is_admin()) with check (public.is_admin());
create index if not exists product_refunds_status_idx on public.product_order_refunds(status,created_at);

create or replace function public.admin_cancel_product_order_safe(p_order_id uuid,p_reason text,p_request_refund boolean default true)
returns public.product_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare order_row public.product_orders; refund_value numeric;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'cancellation_reason_required'; end if;
  select * into order_row from public.product_orders where id=p_order_id for update;
  if order_row.id is null then raise exception 'product_order_not_found'; end if;
  if order_row.status in ('cancelled','completed') then raise exception 'invalid_order_transition'; end if;
  refund_value := greatest(0, order_row.total_amount);
  update public.product_orders set status='cancelled', cancellation_reason=left(trim(p_reason),1000), cancelled_at=now(), refund_amount=case when p_request_refund then refund_value else 0 end, refund_status=case when p_request_refund and refund_value > 0 then 'pending' else 'not_requested' end, updated_at=now() where id=p_order_id returning * into order_row;
  if p_request_refund and refund_value > 0 then
    insert into public.product_order_refunds(order_id,requested_by,amount,reason) values(p_order_id,auth.uid(),refund_value,left(trim(p_reason),1000)) on conflict(order_id) do update set amount=excluded.amount,reason=excluded.reason,status='pending',updated_at=now();
  end if;
  if order_row.coupon_id is not null then update public.coupons set used_count=greatest(0,used_count-1) where id=order_row.coupon_id; end if;
  return order_row;
end; $$;

create or replace function public.admin_process_product_refund_safe(p_order_id uuid,p_method text,p_reference text default '')
returns public.product_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare order_row public.product_orders; refund_row public.product_order_refunds;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if trim(coalesce(p_method,'')) not in ('cash','bank_transfer','stripe','wallet') then raise exception 'refund_method_required'; end if;
  select * into order_row from public.product_orders where id=p_order_id for update;
  if order_row.id is null then raise exception 'product_order_not_found'; end if;
  if order_row.refund_status not in ('pending','approved') then raise exception 'invalid_refund_transition'; end if;
  select * into refund_row from public.product_order_refunds where order_id=p_order_id for update;
  if refund_row.id is null then raise exception 'refund_request_not_found'; end if;
  update public.product_order_refunds set status='processed',method=trim(p_method),external_reference=nullif(left(trim(coalesce(p_reference,'')),200),''),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=refund_row.id;
  update public.product_orders set refund_status='processed',refund_method=trim(p_method),refund_reference=nullif(left(trim(coalesce(p_reference,'')),200),''),updated_at=now() where id=p_order_id returning * into order_row;
  return order_row;
end; $$;

create or replace function public.admin_reject_product_refund_safe(p_order_id uuid,p_reason text)
returns public.product_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare order_row public.product_orders;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'refund_reason_required'; end if;
  update public.product_order_refunds set status='rejected',reason=left(trim(p_reason),1000),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where order_id=p_order_id and status in ('pending','approved');
  if not found then raise exception 'refund_request_not_found'; end if;
  update public.product_orders set refund_status='rejected',updated_at=now() where id=p_order_id returning * into order_row;
  return order_row;
end; $$;

revoke all on function public.admin_cancel_product_order_safe(uuid,text,boolean),public.admin_process_product_refund_safe(uuid,text,text),public.admin_reject_product_refund_safe(uuid,text) from public,anon;
grant execute on function public.admin_cancel_product_order_safe(uuid,text,boolean),public.admin_process_product_refund_safe(uuid,text,text),public.admin_reject_product_refund_safe(uuid,text) to authenticated;
