// @ts-ignore Supabase Edge Runtime resolves remote imports at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Agora documents this package as the AccessToken2 builder for RTC channels.
import { RtcTokenBuilder, RtcRole } from 'npm:agora-token@2.0.7'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const allowedOrigins = new Set([
  'https://home-macs191.vercel.app',
  'https://home-five-dusky.vercel.app',
  'https://home-git-main-macs191.vercel.app',
  'http://localhost:5173',
])
const cors = (origin: string | null) => ({ ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' })
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } })
const forbidden = () => new Response(JSON.stringify({ error: 'origin_not_allowed' }), { status: 403, headers: { 'Content-Type': 'application/json', Vary: 'Origin' } })

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  if (origin && !allowedOrigins.has(origin)) return forbidden()
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (request.method !== 'POST') return json(origin, { error: 'method_not_allowed' }, 405)

  const authHeader = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const appId = Deno.env.get('AGORA_APP_ID')
  const appCertificate = Deno.env.get('AGORA_APP_CERTIFICATE')
  if (!authHeader) return json(origin, { error: 'authentication_required' }, 401)
  if (!supabaseUrl || !anonKey || !appId || !appCertificate) return json(origin, { error: 'agora_not_configured' }, 503)

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json(origin, { error: 'authentication_required' }, 401)

  let body: { channelName?: unknown; uid?: unknown }
  try { body = await request.json() } catch { return json(origin, { error: 'invalid_json' }, 400) }
  const channelName = typeof body.channelName === 'string' ? body.channelName.trim() : ''
  const uid = Number(body.uid)
  if (!/^[a-zA-Z0-9!#$%&()+\-:;<=.?@\[\]^_{}|~,]{1,64}$/.test(channelName)) return json(origin, { error: 'invalid_channel_name' }, 400)
  if (!Number.isSafeInteger(uid) || uid <= 0 || uid > 2147483647) return json(origin, { error: 'invalid_uid' }, 400)

  const ttl = 3600
  const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, RtcRole.PUBLISHER, ttl, ttl)
  return json(origin, { appId, token, channelName, uid, expiresIn: ttl, userId: authData.user.id })
})
