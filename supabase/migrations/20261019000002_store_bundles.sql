create table if not exists public.product_bundles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  name_ar text not null check (char_length(trim(name_ar)) between 2 and 160),
  description text not null default '',
  image_url text,
  price numeric(12,2) not null check (price >= 0),
  is_active boolean not null default true,
  is_featured boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.product_bundle_items (
  bundle_id uuid not null references public.product_bundles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 50),
  primary key (bundle_id, product_id)
);
alter table public.product_bundles enable row level security;
alter table public.product_bundle_items enable row level security;
drop policy if exists "public read active product bundles" on public.product_bundles;
create policy "public read active product bundles" on public.product_bundles for select using (is_active = true or public.is_admin());
drop policy if exists "admins manage product bundles" on public.product_bundles;
create policy "admins manage product bundles" on public.product_bundles for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "public read active bundle items" on public.product_bundle_items;
create policy "public read active bundle items" on public.product_bundle_items for select using (exists (select 1 from public.product_bundles b where b.id = bundle_id and (b.is_active = true or public.is_admin())));
drop policy if exists "admins manage bundle items" on public.product_bundle_items;
create policy "admins manage bundle items" on public.product_bundle_items for all using (public.is_admin()) with check (public.is_admin());

alter table public.product_order_items add column if not exists bundle_id uuid references public.product_bundles(id) on delete set null;
create index if not exists bundle_items_product_idx on public.product_bundle_items(product_id);

create or replace function public.admin_save_product_bundle(p_id uuid, p_slug text, p_name_ar text, p_description text, p_image_url text, p_price numeric, p_is_active boolean, p_is_featured boolean, p_display_order integer, p_items jsonb)
returns public.product_bundles language plpgsql security definer set search_path = public, pg_temp as $$
declare bundle public.product_bundles; item jsonb; product_id_value uuid; qty integer;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if trim(coalesce(p_slug,'')) !~ '^[a-z0-9-]+$' then raise exception 'invalid_bundle_slug'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then raise exception 'bundle_items_required'; end if;
  if p_id is null then insert into public.product_bundles(slug,name_ar,description,image_url,price,is_active,is_featured,display_order) values(lower(trim(p_slug)),left(trim(p_name_ar),160),left(coalesce(p_description,''),2000),nullif(trim(p_image_url),''),p_price,coalesce(p_is_active,true),coalesce(p_is_featured,false),coalesce(p_display_order,0)) returning * into bundle;
  else update public.product_bundles set slug=lower(trim(p_slug)),name_ar=left(trim(p_name_ar),160),description=left(coalesce(p_description,''),2000),image_url=nullif(trim(p_image_url),''),price=p_price,is_active=coalesce(p_is_active,true),is_featured=coalesce(p_is_featured,false),display_order=coalesce(p_display_order,0),updated_at=now() where id=p_id returning * into bundle; end if;
  if bundle.id is null then raise exception 'bundle_not_found'; end if;
  delete from public.product_bundle_items where bundle_id = bundle.id;
  for item in select value from jsonb_array_elements(p_items) loop
    product_id_value := (item->>'product_id')::uuid; qty := greatest(1,least(50,coalesce((item->>'quantity')::integer,1)));
    if not exists(select 1 from public.products where id=product_id_value and is_active) then raise exception 'bundle_product_not_available'; end if;
    insert into public.product_bundle_items(bundle_id,product_id,quantity) values(bundle.id,product_id_value,qty);
  end loop;
  return bundle;
end; $$;
revoke all on function public.admin_save_product_bundle(uuid,text,text,text,text,numeric,boolean,boolean,integer,jsonb) from public, anon;
grant execute on function public.admin_save_product_bundle(uuid,text,text,text,text,numeric,boolean,boolean,integer,jsonb) to authenticated;

create or replace function public.create_product_order_v2(p_items jsonb, p_coupon_code text default '', p_installation_requested boolean default false, p_city text default '', p_district text default '', p_address_text text default '', p_notes text default '')
returns public.product_orders language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; product_row public.products; bundle_row public.product_bundles; component record; new_order public.product_orders; coupon_row public.coupons; qty integer; component_qty integer; gross numeric := 0; product_discount numeric := 0; coupon_discount numeric := 0; final_total numeric := 0; normalized_code text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then raise exception 'invalid_product_items'; end if;
  normalized_code := nullif(upper(trim(coalesce(p_coupon_code,''))), '');
  insert into public.product_orders(customer_id,installation_requested,installation_status,city,district,address_text,notes) values (auth.uid(),coalesce(p_installation_requested,false),case when p_installation_requested then 'requested' else 'not_requested' end,left(trim(coalesce(p_city,'')),120),left(trim(coalesce(p_district,'')),160),left(trim(coalesce(p_address_text,'')),500),left(trim(coalesce(p_notes,'')),1000)) returning * into new_order;
  for item in select value from jsonb_array_elements(p_items) loop
    qty := greatest(1,least(50,coalesce((item->>'quantity')::integer,1)));
    if nullif(item->>'bundle_id','') is not null then
      select * into bundle_row from public.product_bundles where id=(item->>'bundle_id')::uuid and is_active for update;
      if bundle_row.id is null then raise exception 'bundle_not_available'; end if;
      for component in select p.*, bi.quantity as bundle_quantity from public.product_bundle_items bi join public.products p on p.id=bi.product_id where bi.bundle_id=bundle_row.id for update loop
        component_qty := component.bundle_quantity * qty;
        if component.stock_quantity < component_qty then raise exception 'insufficient_stock'; end if;
        update public.products set stock_quantity=stock_quantity-component_qty,reserved_quantity=reserved_quantity+component_qty,updated_at=now() where id=component.id and stock_quantity >= component_qty;
        if not found then raise exception 'insufficient_stock'; end if;
        insert into public.product_order_items(order_id,product_id,bundle_id,product_name_snapshot,unit_price,discount_percent_snapshot,quantity,line_total) values(new_order.id,component.id,bundle_row.id,bundle_row.name_ar||' — '||component.name_ar,component.price,component.discount_percent,component_qty,(bundle_row.price * qty * component.bundle_quantity / greatest(1,(select sum(x.quantity) from public.product_bundle_items x where x.bundle_id=bundle_row.id))));
      end loop;
      gross := gross + bundle_row.price * qty;
    else
      select * into product_row from public.products where id=(item->>'product_id')::uuid and is_active for update;
      if product_row.id is null then raise exception 'product_not_available'; end if;
      if product_row.stock_quantity < qty then raise exception 'insufficient_stock'; end if;
      update public.products set stock_quantity=stock_quantity-qty,reserved_quantity=reserved_quantity+qty,updated_at=now() where id=product_row.id and stock_quantity >= qty;
      if not found then raise exception 'insufficient_stock'; end if;
      gross := gross + product_row.price * qty; product_discount := product_discount + (product_row.price * product_row.discount_percent / 100) * qty;
      insert into public.product_order_items(order_id,product_id,product_name_snapshot,unit_price,discount_percent_snapshot,quantity,line_total) values(new_order.id,product_row.id,product_row.name_ar,product_row.price,product_row.discount_percent,qty,(product_row.price*(1-product_row.discount_percent/100))*qty);
    end if;
  end loop;
  if normalized_code is not null then
    select * into coupon_row from public.coupons where upper(code)=normalized_code and is_active and now() between starts_at and ends_at for update;
    if coupon_row.id is null then raise exception 'coupon_invalid_or_expired'; end if;
    if coupon_row.max_uses is not null and coupon_row.used_count >= coupon_row.max_uses then raise exception 'coupon_usage_limit_reached'; end if;
    if coupon_row.min_order_amount is not null and (gross-product_discount) < coupon_row.min_order_amount then raise exception 'coupon_minimum_not_met'; end if;
    if coupon_row.once_per_customer and exists(select 1 from public.product_order_coupons poc join public.product_orders po on po.id=poc.order_id where poc.coupon_id=coupon_row.id and po.customer_id=auth.uid()) then raise exception 'coupon_already_used'; end if;
    coupon_discount := public.store_coupon_discount(coupon_row,p_items,gross-product_discount); if coupon_discount <= 0 then raise exception 'coupon_not_applicable'; end if;
    update public.coupons set used_count=used_count+1 where id=coupon_row.id;
    insert into public.product_order_coupons(order_id,coupon_id,code_snapshot,discount_amount) values(new_order.id,coupon_row.id,coupon_row.code,coupon_discount);
  end if;
  final_total := greatest(0,gross-product_discount-coupon_discount);
  update public.product_orders set subtotal=gross,discount_amount=product_discount,total_amount=final_total,coupon_id=case when coupon_row.id is null then null else coupon_row.id end,coupon_code_snapshot=case when coupon_row.id is null then null else coupon_row.code end,coupon_discount_amount=coupon_discount,updated_at=now() where id=new_order.id returning * into new_order;
  insert into public.notifications(user_id,title,body,notification_type,target_path) select user_id,'طلب متجر جديد','وصل طلب منتجات جديد ويحتاج إلى المتابعة.','product_order_new','/admin/products' from public.user_roles where role in ('admin','sub_admin');
  return new_order;
end; $$;
revoke all on function public.create_product_order_v2(jsonb,text,boolean,text,text,text,text) from public, anon;
grant execute on function public.create_product_order_v2(jsonb,text,boolean,text,text,text,text) to authenticated;
