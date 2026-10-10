import { createClient, type Session, type User } from '@supabase/supabase-js'
import type { BookingDraft, Role } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('your-project'))

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export const dataModeLabel = isSupabaseConfigured ? 'Supabase فعّال — تحقق من الصلاحيات' : 'وضع المعاينة — اربط Supabase'

export type AuthState = { session: Session | null; user: User | null }

function authMessage(error: { message?: string }) {
  const message = error.message?.toLowerCase() ?? ''
  if (message.includes('invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  if (message.includes('email not confirmed')) return 'أكد بريدك الإلكتروني من الرسالة المرسلة إليك قبل تسجيل الدخول.'
  if (message.includes('already registered')) return 'هذا البريد مسجل مسبقًا. جرّب تسجيل الدخول.'
  if (message.includes('password should be')) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'
  if (message.includes('rate limit')) return 'تم تجاوز عدد المحاولات. انتظر قليلًا ثم حاول.'
  return error.message || 'حدث خطأ في المصادقة، حاول مرة أخرى.'
}

export async function getAuthState(): Promise<AuthState> {
  if (!supabase) return { session: null, user: null }
  const { data } = await supabase.auth.getSession()
  return { session: data.session, user: data.session?.user ?? null }
}

export function onAuthStateChange(callback: (state: AuthState) => void) {
  if (!supabase) return { unsubscribe: () => undefined }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback({ session, user: session?.user ?? null }))
  return data.subscription
}

export async function signInAccount(email: string, password: string) {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا لتفعيل تسجيل الدخول.')
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(authMessage(error))
  return data
}

export async function signUpAccount(input: { email: string; password: string; fullName: string; phone: string; role: Extract<Role, 'customer' | 'provider'> }) {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا لتفعيل إنشاء الحساب.')
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { full_name: input.fullName.trim(), phone: input.phone.trim(), requested_role: input.role } },
  })
  if (error) throw new Error(authMessage(error))
  return data
}

export async function signOutAccount() {
  if (supabase) await supabase.auth.signOut()
}

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
  if (error) throw new Error(error.message || 'تعذر إنشاء الطلب')
  return { mode: 'live' as const, data }
}

export async function confirmBookingCompletion(bookingId: string) {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا.')
  const { data, error } = await supabase.rpc('confirm_booking_completion', { p_booking_id: bookingId, p_note: 'أكد الفني انتهاء المهمة من لوحة التنفيذ' })
  if (error) throw new Error(error.message || 'تعذر تأكيد انتهاء المهمة')
  return data
}

export async function getMyBookings() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('bookings').select('id, booking_number, status, payment_status, city, district, address_text, scheduled_date, scheduled_slot, price_snapshot, created_at, services(name_ar, slug)').order('created_at', { ascending: false }).limit(50)
}

export async function startPayment(bookingId: string) {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا.')
  const { data: payment, error: paymentError } = await supabase.rpc('prepare_payment', { p_booking_id: bookingId })
  if (paymentError) throw new Error(paymentError.message || 'الخدمة لم تصبح جاهزة للدفع بعد')
  const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { payment_id: payment.id } })
  if (error || !data?.url) throw new Error(data?.message || 'بوابة الدفع غير مهيأة بعد. أضف مفاتيح مزود الدفع من إعدادات Supabase.')
  window.open(data.url, '_blank', 'noopener,noreferrer')
  return data.url as string
}


export async function signInWithGoogle(role: Extract<Role, 'customer' | 'provider'> = 'customer') {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا لتفعيل الدخول بحساب Google.')
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/${role === 'provider' ? 'provider' : 'customer'}` } })
  if (error) throw new Error(authMessage(error))
}

export async function submitProviderVerification(input: { yearsExperience: number; serviceDescription: string; nationalIdLast4: string; identityFile: File }) {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا لتفعيل رفع مستند الهوية.')
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('سجّل الدخول قبل إرسال ملف الفني.')
  if (input.identityFile.size > 5 * 1024 * 1024) throw new Error('حجم صورة الهوية يجب ألا يتجاوز 5 ميجابايت.')
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(input.identityFile.type)) throw new Error('ارفع صورة JPG أو PNG أو ملف PDF فقط.')
  const safeName = input.identityFile.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`
  const { error: uploadError } = await supabase.storage.from('identity-documents').upload(path, input.identityFile, { contentType: input.identityFile.type, upsert: false })
  if (uploadError) throw new Error(uploadError.message || 'تعذر رفع صورة الهوية.')
  const { error: profileError } = await supabase.from('provider_profiles').update({ years_experience: input.yearsExperience, service_description: input.serviceDescription.trim(), national_id_last4: input.nationalIdLast4.slice(-4), onboarding_completed: true }).eq('user_id', userId)
  if (profileError) throw new Error(profileError.message || 'تعذر حفظ بيانات الفني.')
  const { error: documentError } = await supabase.from('provider_documents').insert({ provider_id: userId, document_type: 'national_id', storage_path: path, status: 'pending' })
  if (documentError) throw new Error(documentError.message || 'تعذر تسجيل مستند الهوية للمراجعة.')
}

export async function getProviderWorkQueue() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('bookings').select('id,booking_number,status,city,district,address_text,scheduled_date,scheduled_slot,price_snapshot,provider_amount_snapshot,created_at,services(name_ar)').eq('provider_id', (await supabase.auth.getUser()).data.user?.id ?? '').order('created_at', { ascending: false }).limit(50)
}

export async function getProviderLedger() {
  if (!supabase) return { data: [], error: null }
  const userId = (await supabase.auth.getUser()).data.user?.id
  return supabase.from('provider_ledger_entries').select('id,entry_type,amount,note,booking_id,created_at').eq('provider_id', userId ?? '').order('created_at', { ascending: false }).limit(100)
}

export async function getAdminProviderApplications() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('provider_profiles').select('user_id,approval_status,years_experience,service_description,onboarding_completed,created_at,profiles(full_name,phone),provider_documents(id,status,storage_path,created_at)').order('created_at', { ascending: false }).limit(100)
}

export async function assignBookingToProvider(bookingId: string, providerId: string) {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا.')
  const { data, error } = await supabase.rpc('assign_booking', { p_booking_id: bookingId, p_provider_id: providerId })
  if (error) throw new Error(error.message || 'تعذر إسناد الطلب.')
  return data
}

export async function addProviderLedgerEntry(providerId: string, bookingId: string | null, entryType: 'earning' | 'late_penalty' | 'adjustment' | 'payout', amount: number, note: string) {
  if (!supabase) throw new Error('أضف إعدادات Supabase أولًا.')
  const { data, error } = await supabase.rpc('add_provider_ledger_entry', { p_provider_id: providerId, p_booking_id: bookingId, p_entry_type: entryType, p_amount: amount, p_note: note })
  if (error) throw new Error(error.message || 'تعذر حفظ القيد المالي.')
  return data
}
