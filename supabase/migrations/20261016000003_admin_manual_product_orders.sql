create or replace function public.admin_create_manual_product_order(p_customer_id uuid,p_product_ids uuid[],p_provider_id uuid default null,p_installation_requested boolean default false,p_city text default '',p_district text default '',p_address_text text default '',p_notes text default '') returns public.product_orders language plpgsql security definer set search_path=public as $$
declare created public.product_orders; item record; v_subtotal numeric:=0; v_discount numeric:=0; v_line numeric;
begin
 if not public.is_admin() then raise exception 'admin_required'; end if;
 if coalesce(array_length(p_product_ids,1),0)=0 then raise exception 'products_required'; end if;
 if not exists(select 1 from public.user_roles where user_id=p_customer_id and role='customer') then raise exception 'customer_not_found'; end if;
 if p_provider_id is not null and not exists(select 1 from public.provider_profiles where user_id=p_provider_id and approval_status='approved') then raise exception 'provider_not_approved_or_inactive'; end if;
 insert into public.product_orders(customer_id,status,installation_requested,installation_status,provider_id,city,district,address_text,notes,subtotal,discount_amount,total_amount) values(p_customer_id,case when p_installation_requested and p_provider_id is not null then 'assigned' else 'pending' end,p_installation_requested,case when p_installation_requested and p_provider_id is not null then 'assigned' else 'not_requested' end,p_provider_id,left(trim(p_city),120),left(trim(p_district),160),left(trim(p_address_text),500),left(trim(p_notes),2000),0,0,0) returning * into created;
 for item in select pr.* from public.products pr where pr.id=any(p_product_ids) and pr.is_active loop
  v_line:=item.price; v_subtotal:=v_subtotal+v_line; v_discount:=v_discount+(v_line*item.discount_percent/100);
  insert into public.product_order_items(order_id,product_id,product_name_snapshot,unit_price,discount_percent_snapshot,quantity,line_total) values(created.id,item.id,item.name_ar,item.price,item.discount_percent,1,v_line-(v_line*item.discount_percent/100));
 end loop;
 if v_subtotal=0 then raise exception 'products_not_found'; end if;
 update public.product_orders po set subtotal=v_subtotal,discount_amount=v_discount,total_amount=v_subtotal-v_discount where po.id=created.id returning po.* into created;
 if p_provider_id is not null then insert into public.notifications(user_id,title,body,notification_type,target_path) values(p_provider_id,'تركيب منتج جديد','تم إسناد طلب منتج لك من الإدارة.','product_order_assigned','/provider/work-queue'); end if;
 insert into public.notifications(user_id,title,body,notification_type,target_path) values(p_customer_id,'تم تسجيل طلب المنتج','أضافت الإدارة طلب المنتج بالنيابة عنك.','product_order_created','/customer/store-orders'); return created;
end; $$;
revoke all on function public.admin_create_manual_product_order(uuid,uuid[],uuid,boolean,text,text,text,text) from public,anon; grant execute on function public.admin_create_manual_product_order(uuid,uuid[],uuid,boolean,text,text,text,text) to authenticated;
