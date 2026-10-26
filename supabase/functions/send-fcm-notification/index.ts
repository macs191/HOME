import { createClient } from 'npm:@supabase/supabase-js@2'
import { GoogleAuth } from 'npm:google-auth-library@10'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

type NotificationRecord = { id: string; user_id: string; title: string; body: string; target_path: string | null; notification_type: string }
type WebhookPayload = { type: 'INSERT'; table: 'notifications'; record: NotificationRecord; schema: 'public' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRole) return json({ error: 'supabase_not_configured' }, 503)
  const projectId = Deno.env.get('FCM_PROJECT_ID')
  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL')
  const privateKey = Deno.env.get('FCM_PRIVATE_KEY')?.replace(/\\n/g, '\n')
  if (!supabaseUrl || !serviceRole || !projectId || !clientEmail || !privateKey) return json({ error: 'fcm_not_configured' }, 503)

  let payload: WebhookPayload
  try { payload = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const record = payload?.record
  if (!record?.id || !record.user_id || !record.title || !record.body) return json({ error: 'invalid_notification' }, 400)

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: devices, error: deviceError } = await admin.from('push_device_tokens')
    .select('id,token')
    .eq('user_id', record.user_id)
    .eq('platform', 'android')
    .limit(20)
  if (deviceError) return json({ error: 'device_lookup_failed' }, 503)
  if (!devices?.length) return json({ sent: 0, reason: 'no_android_devices' })

  const auth = new GoogleAuth({ credentials: { client_email: clientEmail, private_key: privateKey, project_id: projectId }, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })
  const accessToken = await auth.getAccessToken()
  if (!accessToken) return json({ error: 'fcm_auth_failed' }, 503)

  let sent = 0
  const invalidIds: string[] = []
  for (const device of devices) {
    const isCall = record.notification_type === 'voice_call'
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message: {
        token: device.token,
        ...(isCall ? {} : { notification: { title: record.title, body: record.body } }),
        data: { notification_id: record.id, notification_type: record.notification_type || 'general', title: record.title, body: record.body, target_path: record.target_path || '/customer/notifications' },
        android: { priority: 'high', ...(isCall ? {} : { notification: { channel_id: 'home-service-incoming-v2', sound: 'home_ring', default_sound: false, default_vibrate_timings: false } }) },
      } }),
    })
    if (response.ok) sent += 1
    else {
      const errorText = await response.text()
      if (/UNREGISTERED|INVALID_ARGUMENT/i.test(errorText)) invalidIds.push(device.id)
    }
  }
  if (invalidIds.length) await admin.from('push_device_tokens').delete().in('id', invalidIds)
  return json({ sent, devices: devices.length, removed_invalid_tokens: invalidIds.length })
})
