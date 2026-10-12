-- Retire legacy or trigger-only SECURITY DEFINER RPCs; the current manual-invoice flow does not call them.
revoke execute on function public.confirm_booking_completion(uuid,text) from public, anon, authenticated;
revoke execute on function public.prepare_payment(uuid) from public, anon, authenticated;
revoke execute on function public.set_booking_price(uuid,numeric) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.has_role(public.app_role) from public, anon, authenticated;
