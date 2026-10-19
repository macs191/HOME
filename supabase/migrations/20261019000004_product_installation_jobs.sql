create table if not exists public.product_installation_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.product_orders(id) on delete cascade,
  provider_id uuid references public.provider_profiles(user_id),
  status text not null default 'pending' check (status in ('pending','assigned','in_progress','completed','cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completion_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_installation_jobs_provider_idx on public.product_installation_jobs(provider_id,status);
alter table public.product_installation_jobs enable row level security;
drop policy if exists "participants read installation jobs" on public.product_installation_jobs;
create policy "participants read installation jobs" on public.product_installation_jobs for select using (public.is_admin() or provider_id=auth.uid() or exists(select 1 from public.product_orders o where o.id=order_id and o.customer_id=auth.uid()));
drop policy if exists "admins manage installation jobs" on public.product_installation_jobs;
create policy "admins manage installation jobs" on public.product_installation_jobs for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.ensure_product_installation_job()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.installation_requested then
    insert into public.product_installation_jobs(order_id,provider_id,status)
    values(new.id,new.provider_id,case when new.provider_id is null then 'pending' else 'assigned' end)
    on conflict(order_id) do update set provider_id=excluded.provider_id,updated_at=now();
  end if;
  return new;
end; $$;
drop trigger if exists ensure_product_installation_job on public.product_orders;
create trigger ensure_product_installation_job after insert or update of installation_requested,provider_id on public.product_orders for each row execute function public.ensure_product_installation_job();

create table if not exists public.product_order_materials (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.product_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  material_name text not null check (char_length(trim(material_name)) between 1 and 200),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  source text not null default 'manual' check (source in ('catalog','manual')),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists product_order_materials_order_idx on public.product_order_materials(order_id,created_at);
alter table public.product_order_materials enable row level security;
drop policy if exists "participants read used materials" on public.product_order_materials;
create policy "participants read used materials" on public.product_order_materials for select using (public.is_admin() or recorded_by=auth.uid() or exists(select 1 from public.product_orders o where o.id=order_id and (o.customer_id=auth.uid() or o.provider_id=auth.uid())));
drop policy if exists "admins manage used materials" on public.product_order_materials;
create policy "admins manage used materials" on public.product_order_materials for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_assign_product_order(p_order_id uuid,p_provider_id uuid)
returns public.product_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare changed public.product_orders;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if not exists(select 1 from public.provider_profiles where user_id=p_provider_id and approval_status='approved') then raise exception 'provider_not_approved_or_inactive'; end if;
  update public.product_orders set provider_id=p_provider_id,status='assigned',installation_status=case when installation_requested then 'assigned' else installation_status end,updated_at=now() where id=p_order_id and installation_requested returning * into changed;
  if changed.id is null then raise exception 'product_order_not_found_or_installation_not_requested'; end if;
  insert into public.product_installation_jobs(order_id,provider_id,status) values(changed.id,p_provider_id,'assigned') on conflict(order_id) do update set provider_id=excluded.provider_id,status='assigned',updated_at=now();
  insert into public.notifications(user_id,title,body,notification_type,target_path) values(changed.provider_id,'طلب تركيب منتج','تم إسناد طلب متجر إليك. راجع المنتجات وسجل المواد المستخدمة.','product_installation_assigned','/provider/work-queue');
  return changed;
end; $$;

create or replace function public.provider_update_product_order_status(p_order_id uuid,p_status text)
returns public.product_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare changed public.product_orders;
begin
  if p_status not in ('assigned','installing','completed','cancelled') then raise exception 'invalid_product_order_status'; end if;
  update public.product_orders set status=p_status,installation_status=case when p_status='assigned' then 'assigned' when p_status='installing' then 'in_progress' when p_status='completed' then 'completed' else 'cancelled' end,updated_at=now() where id=p_order_id and provider_id=auth.uid() and installation_requested returning * into changed;
  if changed.id is null then raise exception 'product_order_not_found'; end if;
  insert into public.product_installation_jobs(order_id,provider_id,status,started_at,completed_at,updated_at) values(changed.id,auth.uid(),case when p_status='installing' then 'in_progress' else p_status end,case when p_status='installing' then now() else null end,case when p_status='completed' then now() else null end,now()) on conflict(order_id) do update set status=excluded.status,started_at=coalesce(product_installation_jobs.started_at,excluded.started_at),completed_at=excluded.completed_at,updated_at=now();
  return changed;
end; $$;

create or replace function public.add_product_order_material(p_order_id uuid,p_material_name text,p_quantity numeric,p_unit_cost numeric default 0,p_product_id uuid default null)
returns public.product_order_materials language plpgsql security definer set search_path=public,pg_temp as $$
declare created public.product_order_materials; order_provider uuid;
begin
  select provider_id into order_provider from public.product_orders where id=p_order_id and installation_requested;
  if order_provider is null or (order_provider<>auth.uid() and not public.is_admin()) then raise exception 'installation_access_required'; end if;
  if char_length(trim(coalesce(p_material_name,''))) not between 1 and 200 or p_quantity is null or p_quantity<=0 or p_unit_cost is null or p_unit_cost<0 then raise exception 'invalid_material'; end if;
  insert into public.product_order_materials(order_id,product_id,material_name,quantity,unit_cost,source,recorded_by) values(p_order_id,p_product_id,left(trim(p_material_name),200),p_quantity,p_unit_cost,case when p_product_id is null then 'manual' else 'catalog' end,auth.uid()) returning * into created;
  return created;
end; $$;

revoke all on function public.admin_assign_product_order(uuid,uuid),public.provider_update_product_order_status(uuid,text),public.add_product_order_material(uuid,text,numeric,numeric,uuid) from public,anon;
grant execute on function public.admin_assign_product_order(uuid,uuid),public.provider_update_product_order_status(uuid,text),public.add_product_order_material(uuid,text,numeric,numeric,uuid) to authenticated;
