-- Store coupons: validated and consumed inside the order transaction.
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text not null check (discount_type in ('percentage','fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  min_order_amount numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.coupons enable row level security;
drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons for all using (public.is_admin()) with check (public.is_admin());

alter table public.coupons
  add column if not exists applies_to text not null default 'all' check (applies_to in ('all','product','category')),
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists category_id uuid references public.product_categories(id) on delete set null,
  add column if not exists once_per_customer boolean not null default false;

alter table public.product_orders
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
  add column if not exists coupon_code_snapshot text,
  add column if not exists coupon_discount_amount numeric(12,2) not null default 0 check (coupon_discount_amount >= 0);

create table if not exists public.product_order_coupons (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.product_orders(id) on delete cascade,
  coupon_id uuid not null references public.coupons(id),
  code_snapshot text not null,
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  created_at timestamptz not null default now()
);

alter table public.product_order_coupons enable row level security;
drop policy if exists "customers read own product coupons" on public.product_order_coupons;
create policy "customers read own product coupons" on public.product_order_coupons for select using (exists (select 1 from public.product_orders o where o.id = order_id and (o.customer_id = auth.uid() or public.is_admin())));
drop policy if exists "admins manage product coupons" on public.product_order_coupons;
create policy "admins manage product coupons" on public.product_order_coupons for all using (public.is_admin()) with check (public.is_admin());
create index if not exists coupons_active_window_idx on public.coupons(is_active, starts_at, ends_at);
create index if not exists product_order_coupons_coupon_idx on public.product_order_coupons(coupon_id);

create or replace function public.store_coupon_discount(p_coupon public.coupons, p_items jsonb, p_subtotal numeric)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare item jsonb; product_row public.products; eligible numeric := 0; result numeric := 0; qty integer;
begin
  if p_coupon.applies_to = 'all' then eligible := p_subtotal;
  else
    for item in select value from jsonb_array_elements(p_items) loop
      qty := greatest(1, least(50, coalesce((item->>'quantity')::integer, 1)));
      select * into product_row from public.products where id = (item->>'product_id')::uuid and is_active = true;
      if product_row.id is not null and ((p_coupon.applies_to = 'product' and product_row.id = p_coupon.product_id) or (p_coupon.applies_to = 'category' and product_row.category_id = p_coupon.category_id)) then
        eligible := eligible + product_row.price * qty * (1 - product_row.discount_percent / 100);
      end if;
    end loop;
  end if;
  if eligible <= 0 then return 0; end if;
  if p_coupon.discount_type = 'percentage' then result := eligible * p_coupon.discount_value / 100;
  else result := least(eligible, p_coupon.discount_value);
  end if;
  return greatest(0, least(eligible, round(result, 2)));
end; $$;

create or replace function public.create_product_order_v2(p_items jsonb, p_coupon_code text default '', p_installation_requested boolean default false, p_city text default '', p_district text default '', p_address_text text default '', p_notes text default '')
returns public.product_orders language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; product_row public.products; new_order public.product_orders; coupon_row public.coupons; qty integer; gross numeric := 0; product_discount numeric := 0; coupon_discount numeric := 0; final_total numeric := 0; normalized_code text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then raise exception 'invalid_product_items'; end if;
  normalized_code := nullif(upper(trim(coalesce(p_coupon_code,''))), '');
  insert into public.product_orders(customer_id,installation_requested,installation_status,city,district,address_text,notes) values (auth.uid(),coalesce(p_installation_requested,false),case when p_installation_requested then 'requested' else 'not_requested' end,left(trim(coalesce(p_city,'')),120),left(trim(coalesce(p_district,'')),160),left(trim(coalesce(p_address_text,'')),500),left(trim(coalesce(p_notes,'')),1000)) returning * into new_order;
  for item in select value from jsonb_array_elements(p_items) loop
    qty := greatest(1,least(50,coalesce((item->>'quantity')::integer,1)));
    select * into product_row from public.products where id = (item->>'product_id')::uuid and is_active = true for update;
    if product_row.id is null then raise exception 'product_not_available'; end if;
    if product_row.stock_quantity < qty then raise exception 'insufficient_stock'; end if;
    update public.products set stock_quantity = stock_quantity - qty, reserved_quantity = reserved_quantity + qty, updated_at = now() where id = product_row.id and stock_quantity >= qty;
    if not found then raise exception 'insufficient_stock'; end if;
    gross := gross + product_row.price * qty;
    product_discount := product_discount + (product_row.price * product_row.discount_percent / 100) * qty;
    insert into public.product_order_items(order_id,product_id,product_name_snapshot,unit_price,discount_percent_snapshot,quantity,line_total) values (new_order.id,product_row.id,product_row.name_ar,product_row.price,product_row.discount_percent,qty,(product_row.price*(1-product_row.discount_percent/100))*qty);
  end loop;
  if normalized_code is not null then
    select * into coupon_row from public.coupons where upper(code) = normalized_code and is_active and now() between starts_at and ends_at for update;
    if coupon_row.id is null then raise exception 'coupon_invalid_or_expired'; end if;
    if coupon_row.max_uses is not null and coupon_row.used_count >= coupon_row.max_uses then raise exception 'coupon_usage_limit_reached'; end if;
    if coupon_row.min_order_amount is not null and (gross - product_discount) < coupon_row.min_order_amount then raise exception 'coupon_minimum_not_met'; end if;
    if coupon_row.once_per_customer and exists (select 1 from public.product_order_coupons poc join public.product_orders po on po.id = poc.order_id where poc.coupon_id = coupon_row.id and po.customer_id = auth.uid()) then raise exception 'coupon_already_used'; end if;
    coupon_discount := public.store_coupon_discount(coupon_row, p_items, gross - product_discount);
    if coupon_discount <= 0 then raise exception 'coupon_not_applicable'; end if;
    update public.coupons set used_count = used_count + 1 where id = coupon_row.id;
    insert into public.product_order_coupons(order_id,coupon_id,code_snapshot,discount_amount) values(new_order.id,coupon_row.id,coupon_row.code,coupon_discount);
  end if;
  final_total := greatest(0, gross - product_discount - coupon_discount);
  update public.product_orders set subtotal=gross,discount_amount=product_discount,total_amount=final_total,coupon_id=case when coupon_row.id is null then null else coupon_row.id end,coupon_code_snapshot=case when coupon_row.id is null then null else coupon_row.code end,coupon_discount_amount=coupon_discount,updated_at=now() where id=new_order.id returning * into new_order;
  insert into public.notifications(user_id,title,body,notification_type,target_path) select user_id,'طلب متجر جديد','وصل طلب منتجات جديد ويحتاج إلى المتابعة.','product_order_new','/admin/products' from public.user_roles where role in ('admin','sub_admin');
  return new_order;
end; $$;

-- Keep the old client contract safe while routing it through the coupon-aware implementation.
create or replace function public.create_product_order(p_items jsonb, p_installation_requested boolean default false, p_city text default '', p_district text default '', p_address_text text default '', p_notes text default '')
returns public.product_orders language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.create_product_order_v2(p_items, '', p_installation_requested, p_city, p_district, p_address_text, p_notes);
end; $$;

revoke all on function public.create_product_order_v2(jsonb,text,boolean,text,text,text,text) from public, anon;
grant execute on function public.create_product_order_v2(jsonb,text,boolean,text,text,text,text) to authenticated;
revoke all on function public.create_product_order(jsonb,boolean,text,text,text,text) from public, anon;
grant execute on function public.create_product_order(jsonb,boolean,text,text,text,text) to authenticated;
