-- Inventory is tracked as currently available units plus units reserved by open orders.
alter table public.products
  add column if not exists stock_quantity integer not null default 0 check (stock_quantity >= 0),
  add column if not exists reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  add column if not exists low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0);

create index if not exists products_inventory_idx on public.products(is_active, stock_quantity, reserved_quantity);

create or replace function public.release_product_reservation_on_status_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare item record;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and old.status <> 'completed' then
    for item in select product_id, quantity from public.product_order_items where order_id = new.id loop
      update public.products set stock_quantity = stock_quantity + item.quantity, reserved_quantity = greatest(0, reserved_quantity - item.quantity), updated_at = now() where id = item.product_id;
    end loop;
  elsif new.status = 'completed' and old.status <> 'completed' then
    for item in select product_id, quantity from public.product_order_items where order_id = new.id loop
      update public.products set reserved_quantity = greatest(0, reserved_quantity - item.quantity), updated_at = now() where id = item.product_id;
    end loop;
  end if;
  return new;
end; $$;

drop trigger if exists release_product_reservation_on_status_change on public.product_orders;
create trigger release_product_reservation_on_status_change after update of status on public.product_orders for each row execute function public.release_product_reservation_on_status_change();

create or replace function public.create_product_order(p_items jsonb, p_installation_requested boolean default false, p_city text default '', p_district text default '', p_address_text text default '', p_notes text default '')
returns public.product_orders language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; product_row public.products; new_order public.product_orders; qty integer; gross numeric := 0; discount numeric := 0;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then raise exception 'invalid_product_items'; end if;
  insert into public.product_orders(customer_id,installation_requested,installation_status,city,district,address_text,notes) values (auth.uid(),coalesce(p_installation_requested,false),case when p_installation_requested then 'requested' else 'not_requested' end,left(trim(coalesce(p_city,'')),120),left(trim(coalesce(p_district,'')),160),left(trim(coalesce(p_address_text,'')),500),left(trim(coalesce(p_notes,'')),1000)) returning * into new_order;
  for item in select value from jsonb_array_elements(p_items) loop
    qty := greatest(1,least(50,coalesce((item->>'quantity')::integer,1)));
    select * into product_row from public.products where id = (item->>'product_id')::uuid and is_active = true for update;
    if product_row.id is null then raise exception 'product_not_available'; end if;
    if product_row.stock_quantity < qty then raise exception 'insufficient_stock'; end if;
    update public.products set stock_quantity = stock_quantity - qty, reserved_quantity = reserved_quantity + qty, updated_at = now() where id = product_row.id and stock_quantity >= qty;
    if not found then raise exception 'insufficient_stock'; end if;
    gross := gross + product_row.price * qty;
    discount := discount + (product_row.price * product_row.discount_percent / 100) * qty;
    insert into public.product_order_items(order_id,product_id,product_name_snapshot,unit_price,discount_percent_snapshot,quantity,line_total) values (new_order.id,product_row.id,product_row.name_ar,product_row.price,product_row.discount_percent,qty,(product_row.price*(1-product_row.discount_percent/100))*qty);
  end loop;
  update public.product_orders set subtotal=gross,discount_amount=discount,total_amount=gross-discount,updated_at=now() where id=new_order.id returning * into new_order;
  insert into public.notifications(user_id,title,body,notification_type,target_path) select user_id,'طلب متجر جديد','وصل طلب منتجات جديد ويحتاج إلى المتابعة.','product_order_new','/admin/products' from public.user_roles where role in ('admin','sub_admin');
  return new_order;
end; $$;

create or replace function public.admin_create_manual_product_order(p_customer_id uuid, p_product_ids uuid[], p_provider_id uuid default null, p_installation_requested boolean default false, p_city text default '', p_district text default '', p_address_text text default '', p_notes text default '')
returns public.product_orders language plpgsql security definer set search_path = public, pg_temp as $$
declare created public.product_orders; item record; v_subtotal numeric:=0; v_discount numeric:=0; v_line numeric;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if coalesce(array_length(p_product_ids,1),0)=0 then raise exception 'products_required'; end if;
  if not exists(select 1 from public.user_roles where user_id=p_customer_id and role='customer') then raise exception 'customer_not_found'; end if;
  if p_provider_id is not null and not exists(select 1 from public.provider_profiles where user_id=p_provider_id and approval_status='approved') then raise exception 'provider_not_approved_or_inactive'; end if;
  insert into public.product_orders(customer_id,status,installation_requested,installation_status,provider_id,city,district,address_text,notes,subtotal,discount_amount,total_amount) values(p_customer_id,case when p_installation_requested and p_provider_id is not null then 'assigned' else 'pending' end,p_installation_requested,case when p_installation_requested and p_provider_id is not null then 'assigned' else 'not_requested' end,p_provider_id,left(trim(p_city),120),left(trim(p_district),160),left(trim(p_address_text),500),left(trim(p_notes),2000),0,0,0) returning * into created;
  for item in select pr.* from public.products pr where pr.id=any(p_product_ids) and pr.is_active for update loop
    if item.stock_quantity < 1 then raise exception 'insufficient_stock'; end if;
    update public.products set stock_quantity = stock_quantity - 1, reserved_quantity = reserved_quantity + 1, updated_at = now() where id=item.id and stock_quantity >= 1;
    if not found then raise exception 'insufficient_stock'; end if;
    v_line:=item.price; v_subtotal:=v_subtotal+v_line; v_discount:=v_discount+(v_line*item.discount_percent/100);
    insert into public.product_order_items(order_id,product_id,product_name_snapshot,unit_price,discount_percent_snapshot,quantity,line_total) values(created.id,item.id,item.name_ar,item.price,item.discount_percent,1,v_line-(v_line*item.discount_percent/100));
  end loop;
  if v_subtotal=0 then raise exception 'products_not_found'; end if;
  update public.product_orders set subtotal=v_subtotal,discount_amount=v_discount,total_amount=v_subtotal-v_discount where id=created.id returning * into created;
  if p_provider_id is not null then insert into public.notifications(user_id,title,body,notification_type,target_path) values(p_provider_id,'تركيب منتج جديد','تم إسناد طلب منتج لك من الإدارة.','product_order_assigned','/provider/work-queue'); end if;
  insert into public.notifications(user_id,title,body,notification_type,target_path) values(p_customer_id,'تم تسجيل طلب المنتج','أضافت الإدارة طلب المنتج بالنيابة عنك.','product_order_created','/customer/store-orders'); return created;
end; $$;

revoke all on function public.create_product_order(jsonb, boolean, text, text, text, text) from public, anon;
grant execute on function public.create_product_order(jsonb, boolean, text, text, text, text) to authenticated;
revoke all on function public.admin_create_manual_product_order(uuid, uuid[], uuid, boolean, text, text, text, text) from public, anon;
grant execute on function public.admin_create_manual_product_order(uuid, uuid[], uuid, boolean, text, text, text, text) to authenticated;
