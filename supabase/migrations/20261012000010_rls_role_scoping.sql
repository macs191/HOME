-- Scope policies that call is_admin() to authenticated requests.
-- anon cannot execute is_admin(); broad public policies caused 401s on public catalog reads.
drop policy if exists "admins manage service categories" on public.service_categories;
create policy "admins manage service categories" on public.service_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage services" on public.services;
create policy "admins manage services" on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customers read own bookings" on public.bookings;
create policy "customers read own bookings" on public.bookings for select to authenticated using (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
drop policy if exists "participants read quotes" on public.booking_quotes;
create policy "participants read quotes" on public.booking_quotes for select to authenticated using (provider_id = auth.uid() or exists (select 1 from public.bookings b where b.id = booking_quotes.booking_id and b.customer_id = auth.uid()) or public.is_admin());
drop policy if exists "participants read booking history" on public.booking_status_history;
create policy "participants read booking history" on public.booking_status_history for select to authenticated using (exists (select 1 from public.bookings b where b.id = booking_status_history.booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid() or public.is_admin())));
drop policy if exists "participants read payments" on public.payments;
create policy "participants read payments" on public.payments for select to authenticated using (public.is_admin() or exists (select 1 from public.bookings b where b.id = payments.booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid())));

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "admins read profiles" on public.profiles for select to authenticated using (public.is_admin());
drop policy if exists "providers read assigned customer contact" on public.profiles;
create policy "providers read assigned customer contact" on public.profiles for select to authenticated using (exists (select 1 from public.bookings b where b.customer_id = profiles.id and b.provider_id = auth.uid()));
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "admins manage platform settings" on public.platform_settings;
create policy "admins manage platform settings" on public.platform_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "providers read own verification documents" on public.provider_documents;
create policy "providers read own verification documents" on public.provider_documents for select to authenticated using (provider_id = auth.uid() or public.is_admin());
drop policy if exists "admins manage verification documents" on public.provider_documents;
create policy "admins manage verification documents" on public.provider_documents for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "providers read own ledger" on public.provider_ledger_entries;
create policy "providers read own ledger" on public.provider_ledger_entries for select to authenticated using (provider_id = auth.uid() or public.is_admin());
drop policy if exists "admins manage provider ledger" on public.provider_ledger_entries;
create policy "admins manage provider ledger" on public.provider_ledger_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "providers read own profile" on public.provider_profiles;
create policy "providers read own profile" on public.provider_profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "users read own role" on public.user_roles;
create policy "users read own role" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
