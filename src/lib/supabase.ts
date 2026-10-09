import { createClient } from '@supabase/supabase-js'
import type { BookingDraft } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('your-project'))

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export const dataModeLabel = isSupabaseConfigured ? 'إعدادات Supabase موجودة — تحقق من المصدر' : 'وضع المعاينة — اربط Supabase'

export async function createBookingFromDraft(draft: BookingDraft, serviceSlug: string) {
  if (!supabase) return { mode: 'preview' as const, data: null }
  const { data: service, error: serviceError } = await supabase.from('services').select('id').eq('slug', serviceSlug).eq('is_active', true).maybeSingle()
  if (serviceError) throw serviceError
  if (!service) throw new Error('الخدمة غير متاحة حاليًا')
  const { data, error } = await supabase.rpc('create_booking', {
    p_service_id: service.id,
    p_city: draft.city,
    p_district: draft.district,
    p_address_text: draft.address,
    p_access_notes: draft.accessNotes,
    p_latitude: draft.latitude ?? null,
    p_longitude: draft.longitude ?? null,
    p_location_source: draft.locationSource,
    p_issue_description: draft.issue,
    p_urgency: draft.urgency,
    p_scheduled_date: draft.scheduledDate || null,
    p_scheduled_slot: draft.scheduledSlot || null,
  })
  if (error) throw error
  return { mode: 'live' as const, data }
}
