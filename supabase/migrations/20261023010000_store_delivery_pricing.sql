alter table public.product_orders
  add column if not exists delivery_pricing_mode text not null default 'manual',
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists delivery_base_fee numeric(12,2) not null default 0,
  add column if not exists delivery_rate numeric(12,2) not null default 0,
  add column if not exists delivery_distance_km numeric(12,2),
  add column if not exists delivery_eta_minutes integer;

alter table public.product_orders drop constraint if exists product_orders_delivery_pricing_mode_check;
alter table public.product_orders add constraint product_orders_delivery_pricing_mode_check
  check (delivery_pricing_mode in ('manual','distance','time'));
alter table public.product_orders drop constraint if exists product_orders_delivery_fee_check;
alter table public.product_orders add constraint product_orders_delivery_fee_check
  check (delivery_fee >= 0 and delivery_base_fee >= 0 and delivery_rate >= 0);

create or replace function public.admin_set_product_delivery_pricing(
  p_order_id uuid,
  p_mode text,
  p_fee numeric default 0,
  p_base_fee numeric default 0,
  p_rate numeric default 0,
  p_distance_km numeric default null,
  p_eta_minutes integer default null
) returns public.product_orders
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed public.product_orders;
  v_mode text := lower(trim(coalesce(p_mode, 'manual')));
  v_fee numeric := greatest(coalesce(p_fee, 0), 0);
  v_base numeric := greatest(coalesce(p_base_fee, 0), 0);
  v_rate numeric := greatest(coalesce(p_rate, 0), 0);
begin
  if not public.is_admin() then raise exception 'admin_only'; end if;
  if v_mode not in ('manual','distance','time') then raise exception 'invalid_delivery_pricing_mode'; end if;
  if v_mode = 'distance' then
    if coalesce(p_distance_km, 0) < 0 then raise exception 'invalid_delivery_distance'; end if;
    v_fee := v_base + (coalesce(p_distance_km, 0) * v_rate);
  elsif v_mode = 'time' then
    if coalesce(p_eta_minutes, 0) < 0 then raise exception 'invalid_delivery_eta'; end if;
    v_fee := v_base + (coalesce(p_eta_minutes, 0) * v_rate);
  end if;
  update public.product_orders
    set delivery_pricing_mode = v_mode,
        delivery_fee = round(v_fee, 2),
        delivery_base_fee = round(v_base, 2),
        delivery_rate = round(v_rate, 2),
        delivery_distance_km = nullif(round(coalesce(p_distance_km, 0), 2), 0),
        delivery_eta_minutes = nullif(greatest(coalesce(p_eta_minutes, 0), 0), 0),
        total_amount = greatest(coalesce(subtotal, 0) - coalesce(discount_amount, 0), 0) + round(v_fee, 2),
        updated_at = now()
  where id = p_order_id and status <> 'cancelled'
  returning * into changed;
  if not found then raise exception 'product_order_not_found_or_terminal'; end if;
  return changed;
end; $$;

grant execute on function public.admin_set_product_delivery_pricing(uuid,text,numeric,numeric,numeric,numeric,integer) to authenticated;
