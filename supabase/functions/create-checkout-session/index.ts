// @ts-ignore Supabase Edge Runtime resolves remote imports at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const stripeCall = async (secret: string, path: string, init: RequestInit = {}) => fetch(`https://api.stripe.com/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${secret}`, ...(init.headers || {}) } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeSecret) return json({ error: 'payment_provider_not_configured', message: 'بوابة الدفع غير مهيأة بعد.' }, 503)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'authentication_required' }, 401)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anon || !serviceRole) return json({ error: 'server_not_configured' }, 503)
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(supabaseUrl, serviceRole)
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'authentication_required' }, 401)
  let body: { payment_id?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const paymentId = body.payment_id
  if (!paymentId) return json({ error: 'payment_id_required' }, 400)
  const { data: payment, error: paymentError } = await admin.from('payments')
    .select('id,booking_id,amount,status,provider,external_reference,payment_method,bookings!inner(id,customer_id,status,price_snapshot)')
    .eq('id', paymentId).maybeSingle()
  if (paymentError || !payment || payment.bookings.customer_id !== authData.user.id) return json({ error: 'payment_not_found' }, 404)
  if (payment.bookings.status !== 'completed') return json({ error: 'service_not_completed' }, 409)
  const amount = Number(payment.amount)
  if (!Number.isFinite(amount) || amount <= 0 || Number(payment.bookings.price_snapshot) !== amount) return json({ error: 'invoice_amount_mismatch' }, 409)
  if (payment.status === 'pending' && payment.provider !== 'stripe') return json({ error: 'payment_provider_not_stripe' }, 409)
  if (!['unpaid', 'pending'].includes(payment.status)) return json({ error: 'payment_not_ready' }, 409)
  const existingSession = payment.provider === 'stripe' && payment.status === 'pending' && payment.external_reference
  if (existingSession) {
    const existingResponse = await stripeCall(stripeSecret, `checkout/sessions/${encodeURIComponent(payment.external_reference)}`)
    const existing = await existingResponse.json()
    if (existingResponse.ok && existing.url) return json({ url: existing.url, session_id: existing.id })
  }
  const origin = req.headers.get('origin') || Deno.env.get('PUBLIC_APP_URL')
  if (!origin) return json({ error: 'public_app_url_required' }, 500)
  const amountMinor = Math.round(amount * 100)
  const params = new URLSearchParams({
    mode: 'payment', success_url: `${origin}/customer?payment=success`, cancel_url: `${origin}/customer?payment=cancelled`,
    customer_email: authData.user.email || '', client_reference_id: payment.booking_id,
    'metadata[payment_id]': payment.id, 'metadata[user_id]': authData.user.id, 'metadata[booking_id]': payment.booking_id,
    'line_items[0][price_data][currency]': 'sar', 'line_items[0][price_data][product_data][name]': 'خدمة منزلية مكتملة',
    'line_items[0][price_data][unit_amount]': String(amountMinor), 'line_items[0][quantity]': '1',
  })
  const stripeResponse = await stripeCall(stripeSecret, 'checkout/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `home-checkout-${payment.id}` }, body: params,
  })
  const stripeData = await stripeResponse.json()
  if (!stripeResponse.ok || !stripeData.id || !stripeData.url) return json({ error: 'checkout_creation_failed' }, 502)
  const { data: updated, error: updateError } = await admin.from('payments').update({ provider: 'stripe', status: 'pending', external_reference: stripeData.id, payment_method: null })
    .eq('id', payment.id).in('status', ['unpaid', 'pending']).is('external_reference', null).select('id').maybeSingle()
  if (updateError || !updated) {
    await stripeCall(stripeSecret, `checkout/sessions/${encodeURIComponent(stripeData.id)}/expire`, { method: 'POST' }).catch(() => undefined)
    const { data: current } = await admin.from('payments').select('provider,status,external_reference').eq('id', payment.id).maybeSingle()
    if (current?.provider === 'stripe' && current.status === 'pending' && current.external_reference) {
      const response = await stripeCall(stripeSecret, `checkout/sessions/${encodeURIComponent(current.external_reference)}`)
      const session = await response.json()
      if (response.ok && session.url) return json({ url: session.url, session_id: session.id })
    }
    return json({ error: 'payment_state_update_failed' }, 409)
  }
  return json({ url: stripeData.url, session_id: stripeData.id })
})
