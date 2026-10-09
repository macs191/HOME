// @ts-ignore Supabase Edge Runtime resolves remote imports at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeSecret) return json({ error: 'payment_provider_not_configured', message: 'بوابة الدفع غير مهيأة بعد.' }, 503)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'authentication_required' }, 401)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(supabaseUrl, serviceRole)
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'authentication_required' }, 401)
  const { payment_id: paymentId } = await req.json()
  if (!paymentId) return json({ error: 'payment_id_required' }, 400)
  const { data: payment, error: paymentError } = await admin.from('payments').select('id, booking_id, amount, status, bookings!inner(customer_id, status)').eq('id', paymentId).maybeSingle()
  if (paymentError || !payment || payment.bookings.customer_id !== authData.user.id) return json({ error: 'payment_not_found' }, 404)
  if (payment.bookings.status !== 'completed') return json({ error: 'service_not_completed' }, 409)
  if (!['unpaid', 'pending'].includes(payment.status) || Number(payment.amount) <= 0) return json({ error: 'payment_not_ready' }, 409)
  const origin = req.headers.get('origin') || Deno.env.get('PUBLIC_APP_URL')
  if (!origin) return json({ error: 'public_app_url_required' }, 500)
  const params = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/customer?payment=success`,
    cancel_url: `${origin}/customer?payment=cancelled`,
    customer_email: authData.user.email || '',
    client_reference_id: payment.booking_id,
    'metadata[payment_id]': payment.id,
    'metadata[user_id]': authData.user.id,
    'line_items[0][price_data][currency]': 'sar',
    'line_items[0][price_data][product_data][name]': 'خدمة منزلية مكتملة',
    'line_items[0][price_data][unit_amount]': String(Math.round(Number(payment.amount) * 100)),
    'line_items[0][quantity]': '1',
    allow_promotion_codes: 'true',
  })
  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${stripeSecret}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params })
  const stripeData = await stripeResponse.json()
  if (!stripeResponse.ok) return json({ error: 'checkout_creation_failed' }, 502)
  await admin.from('payments').update({ provider: 'stripe', status: 'pending', external_reference: stripeData.id }).eq('id', payment.id)
  return json({ url: stripeData.url, session_id: stripeData.id })
})
