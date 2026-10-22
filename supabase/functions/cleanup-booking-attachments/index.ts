// Scheduled server-side retention cleanup for issue photos only.
// Chat attachments are intentionally excluded because they are not rows in booking_attachments.
// @ts-ignore Supabase Edge Runtime resolves remote imports at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }

const CLEANUP_TOKEN = 'HOME_CLEANUP_20261022_9f5f2d6f7f2e4f5d9d4e3c2b1a0f8e7d'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (req.headers.get('x-cleanup-token') !== CLEANUP_TOKEN) return json({ error: 'forbidden' }, 403)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_not_configured' }, 503)
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: rows, error: lookupError } = await admin
    .from('booking_attachments')
    .select('id,booking_id,storage_path,created_at')
    .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(500)
  if (lookupError) return json({ error: 'lookup_failed' }, 503)
  if (!rows?.length) return json({ removed: 0, candidates: 0 })

  const paths = rows.map((row) => row.storage_path)
  const { error: storageError } = await admin.storage.from('booking-attachments').remove(paths)
  if (storageError) return json({ error: 'storage_delete_failed', candidates: rows.length }, 503)

  const ids = rows.map((row) => row.id)
  const { error: metadataError } = await admin.from('booking_attachments').delete().in('id', ids)
  if (metadataError) return json({ error: 'metadata_delete_failed', removed_from_storage: rows.length }, 503)

  const { error: auditError } = await admin.from('audit_logs').insert(rows.map((row) => ({
    actor_id: null,
    action: 'cleanup_expired_booking_attachment',
    entity_type: 'booking_attachment',
    entity_id: row.id,
    metadata: { booking_id: row.booking_id, storage_path: row.storage_path, retention_days: 30 },
  })))
  if (auditError) return json({ removed: rows.length, audit_logged: false }, 200)
  return json({ removed: rows.length, audit_logged: true }, 200)
})
