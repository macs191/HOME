// @ts-ignore Supabase Edge Runtime resolves remote imports at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const constantTimeEqual = (a: string, b: string) => {
  const aa = a.toLowerCase(); const bb = b.toLowerCase();
  let diff = aa.length ^ bb.length
  const length = Math.max(aa.length, bb.length)
  for (let i = 0; i < length; i += 1) diff |= (aa.charCodeAt(i) || 0) ^ (bb.charCodeAt(i) || 0)
  return diff === 0
}
async function validSignature(payload: string, signature: string, secret: string) {
  const parts = signature.split(',').reduce<Record<string, string[]>>((acc, part) => {
    const [key, ...rest] = part.split('='); if (key && rest.length) (acc[key] ||= []).push(rest.join('=')); return acc
  }, {})
  const timestamp = Number(parts.t?.[0])
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1?.length) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))))
  return parts.v1.some((candidate) => constantTimeEqual(digest, candidate))
}
const response = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return response('method_not_allowed', 405)
  const raw = await req.text()
  const signature = req.headers.get('stripe-signature')
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!signature || !secret || !(await validSignature(raw, signature, secret))) return response('invalid_signature', 400)
  let event: any
  try { event = JSON.parse(raw) } catch { return response('invalid_json', 400) }
  if (event?.type !== 'checkout.session.completed') return response('ok', 200)
  const object = event?.data?.object
  if (!object || object.object !== 'checkout.session' || object.status !== 'complete' || object.payment_status !== 'paid') return response('invalid_checkout_session', 400)
  const paymentId = typeof object.metadata?.payment_id === 'string' ? object.metadata.payment_id : ''
  const userId = typeof object.metadata?.user_id === 'string' ? object.metadata.user_id : ''
  const bookingId = typeof object.client_reference_id === 'string' ? object.client_reference_id : ''
  const intentId = typeof object.payment_intent === 'string' ? object.payment_intent : ''
  const amountMinor = Number(object.amount_total)
  if (!paymentId || !userId || !bookingId || object.metadata?.booking_id !== bookingId || !object.id || !intentId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || String(object.currency || '').toLowerCase() !== 'sar') return response('invalid_checkout_metadata', 400)
  const supabaseUrl = Deno.env.get('SUPABASE_URL'); const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRole) return response('server_not_configured', 500)
  const supabase = createClient(supabaseUrl, serviceRole)
  const { data: payment, error: paymentError } = await supabase.from('payments').select('id,booking_id,provider,status,external_reference,bookings!inner(customer_id,status)').eq('id', paymentId).maybeSingle()
  if (paymentError) return response('payment_lookup_failed', 500)
  if (!payment || payment.booking_id !== bookingId || payment.provider !== 'stripe' || payment.external_reference !== object.id || payment.bookings.customer_id !== userId || payment.bookings.status !== 'completed' || !['pending', 'paid'].includes(payment.status)) return response('payment_metadata_mismatch', 400)
  const { error: settlementError } = await supabase.rpc('settle_stripe_payment_safe', {
    p_payment_id: paymentId, p_session_id: object.id, p_payment_intent_id: intentId, p_amount_minor: amountMinor, p_currency: 'sar',
  })
  if (settlementError) return response('settlement_failed', 500)
  return response('ok', 200)
})
