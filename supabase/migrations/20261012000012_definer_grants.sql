-- No SECURITY DEFINER RPC in the exposed public schema is meant for anonymous callers.
-- Keep the signed-in workflow RPCs callable by authenticated users; each function still enforces its role/ownership checks.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated', fn.signature);
  end loop;
end;
$$;
