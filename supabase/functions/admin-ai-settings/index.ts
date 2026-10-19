// @ts-ignore Supabase Edge Runtime resolves remote imports at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const allowedOrigins = new Set([
  'https://home-macs191.vercel.app',
  'https://home-five-dusky.vercel.app',
  'https://home-git-main-macs191.vercel.app',
])
const corsHeaders = (origin: string | null) => ({
  ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
})
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
const forbiddenOrigin = () => new Response(JSON.stringify({ error: 'origin_not_allowed' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Vary': 'Origin' } })

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (origin && !allowedOrigins.has(origin)) return forbiddenOrigin()
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json(origin, { error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authHeader) return json(origin, { error: 'authentication_required' }, 401)
  if (!supabaseUrl || !anonKey || !serviceRole) return json(origin, { error: 'server_not_configured' }, 503)

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json(origin, { error: 'authentication_required' }, 401)

  const [{ data: roleRow, error: roleError }, { data: profile, error: profileError }] = await Promise.all([
    admin.from('user_roles').select('role').eq('user_id', authData.user.id).eq('role', 'admin').limit(1).maybeSingle(),
    admin.from('profiles').select('is_active').eq('id', authData.user.id).maybeSingle(),
  ])
  if (roleError || profileError) return json(origin, { error: 'authorization_check_failed' }, 503)
  if (roleRow?.role !== 'admin' || profile?.is_active !== true) return json(origin, { error: 'primary_admin_required' }, 403)

  let body: { action?: string; apiKey?: string }
  try { body = await req.json() } catch { return json(origin, { error: 'invalid_json' }, 400) }

  if (body.action === 'status') {
    const { data, error } = await admin.rpc('home_ai_secret_status', { p_actor: authData.user.id })
    if (error) return json(origin, { error: 'settings_unavailable' }, 503)
    return json(origin, { configured: data === true })
  }

  if (body.action === 'save') {
    if (typeof body.apiKey !== 'string') return json(origin, { error: 'api_key_required' }, 400)
    const apiKey = body.apiKey.trim()
    if (apiKey.length < 20 || apiKey.length > 512 || /[\r\n]/.test(apiKey)) return json(origin, { error: 'invalid_api_key' }, 400)
    const { error } = await admin.rpc('home_ai_secret_save', { p_actor: authData.user.id, p_secret: apiKey })
    if (error) return json(origin, { error: error.message?.includes('invalid_secret') ? 'invalid_api_key' : 'save_failed' }, error.message?.includes('invalid_secret') ? 400 : 503)
    return json(origin, { configured: true })
  }

  if (body.action === 'clear') {
    const { error } = await admin.rpc('home_ai_secret_clear', { p_actor: authData.user.id })
    if (error) return json(origin, { error: 'clear_failed' }, 503)
    return json(origin, { configured: false })
  }

  return json(origin, { error: 'invalid_action' }, 400)
})
