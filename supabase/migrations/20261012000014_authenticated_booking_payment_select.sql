-- Table privileges are separate from RLS policies. Grant authenticated users SELECT
-- so PostgREST can evaluate row-scoped policies; do not grant anonymous access.
grant select on table public.bookings, public.payments to authenticated;
revoke select on table public.bookings, public.payments from anon;
