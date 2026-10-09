// @ts-ignore Supabase Edge Runtime resolves remote imports at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
async function validSignature(payload: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=')))
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`))
  return hex(new Uint8Array(digest)) === parts.v1
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })
  const raw = await req.text()
  const signature = req.headers.get('stripe-signature')
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!signature || !secret || !(await validSignature(raw, signature, secret))) return new Response('invalid_signature', { status: 400 })
  const event = JSON.parse(raw)
  if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') return new Response('ok', { status: 200 })
  const object = event.data.object
  const paymentId = object.metadata?.payment_id
  if (!paymentId) return new Response('ok', { status: 200 })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: payment } = await supabase.from('payments').select('id, booking_id, status').eq('id', paymentId).maybeSingle()
  if (!payment || payment.status === 'paid') return new Response('ok', { status: 200 })
  await supabase.from('payments').update({ status: 'paid', external_reference: object.payment_intent || object.id, settled_at: new Date().toISOString() }).eq('id', payment.id)
  await supabase.from('bookings').update({ payment_status: 'paid', updated_at: new Date().toISOString() }).eq('id', payment.booking_id)
  return new Response('ok', { status: 200 })
})
