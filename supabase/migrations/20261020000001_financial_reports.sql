create or replace function public.admin_get_financial_report(p_from date default null,p_to date default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_from date:=coalesce(p_from,current_date-29); v_to date:=coalesce(p_to,current_date); result jsonb;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if v_from>v_to or v_to-v_from>366 then raise exception 'invalid_report_date_range'; end if;
  result:=jsonb_build_object(
    'from',v_from,'to',v_to,
    'service',jsonb_build_object(
      'paid_amount',coalesce((select sum(amount) from public.payments where status='paid' and created_at>=v_from and created_at<(v_to+1)),0),
      'paid_count',coalesce((select count(*) from public.payments where status='paid' and created_at>=v_from and created_at<(v_to+1)),0),
      'open_amount',coalesce((select sum(amount) from public.payments where status in ('unpaid','pending') and created_at>=v_from and created_at<(v_to+1)),0),
      'open_count',coalesce((select count(*) from public.payments where status in ('unpaid','pending') and created_at>=v_from and created_at<(v_to+1)),0)
    ),
    'store',jsonb_build_object(
      'orders_count',coalesce((select count(*) from public.product_orders where created_at>=v_from and created_at<(v_to+1)),0),
      'sales_amount',coalesce((select sum(total_amount) from public.product_orders where status<>'cancelled' and created_at>=v_from and created_at<(v_to+1)),0),
      'refund_amount',coalesce((select sum(refund_amount) from public.product_orders where refund_status='processed' and updated_at>=v_from and updated_at<(v_to+1)),0),
      'materials_cost',coalesce((select sum(quantity*unit_cost) from public.product_order_materials where created_at>=v_from and created_at<(v_to+1)),0)
    ),
    'providers',coalesce((select jsonb_agg(row_to_json(x)) from (select ple.provider_id,p.full_name,sum(case when ple.entry_type='earning' then ple.amount else 0 end) as earnings,sum(case when ple.entry_type='payout' then ple.amount else 0 end) as payouts,sum(ple.amount) as balance from public.provider_ledger_entries ple join public.profiles p on p.id=ple.provider_id where ple.created_at>=v_from and ple.created_at<(v_to+1) group by ple.provider_id,p.full_name order by balance desc limit 200) x),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(row_to_json(x) order by x.day) from (select d.day,coalesce((select sum(amount) from public.payments where status='paid' and created_at>=d.day and created_at<d.day+1),0) as service_paid,coalesce((select sum(total_amount) from public.product_orders where status<>'cancelled' and created_at>=d.day and created_at<d.day+1),0) as store_sales,coalesce((select sum(refund_amount) from public.product_orders where refund_status='processed' and updated_at>=d.day and updated_at<d.day+1),0) as refunds from generate_series(v_from,v_to,interval '1 day') d(day)) x),'[]'::jsonb)
  );
  return result;
end; $$;
revoke all on function public.admin_get_financial_report(date,date) from public,anon;
grant execute on function public.admin_get_financial_report(date,date) to authenticated;
