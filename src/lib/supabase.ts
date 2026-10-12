import { createClient, type Session, type User } from '@supabase/supabase-js'
import type { BookingDraft, Role, Service, ServiceCategory } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('your-project'))

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null


export async function getLiveCatalog(): Promise<{ categories: ServiceCategory[]; services: Service[] }> {
  if (!supabase) throw new Error('الكتالوج المباشر غير متاح في وضع المعاينة.')
  const [categoryResult, serviceResult] = await Promise.all([
    supabase.from('service_categories').select('id,slug,name_ar,description,icon,color,is_featured,display_order').eq('is_active', true).order('display_order'),
    supabase.from('services').select('id,category_id,slug,name_ar,description,pricing_type,base_price,is_featured,display_order').eq('is_active', true).order('display_order'),
  ])
  if (categoryResult.error) throw new Error(categoryResult.error.message || 'تعذر تحميل أقسام الخدمات.')
  if (serviceResult.error) throw new Error(serviceResult.error.message || 'تعذر تحميل الخدمات.')

  const colors: Record<string, string> = { plumbing: '#2bb8aa', electrical: '#f3b84b', ac: '#75aee8', cleaning: '#c78ce0', appliance: '#e58567', carpentry: '#c58a52', painting: '#ea8eae', moving: '#7892d8', 'pest-control': '#82b77d', locks: '#9b9bb5', general: '#5bb4c8' }
  const rows = categoryResult.data ?? []
  const slugById = new Map(rows.map((row) => [row.id, row.slug]))
  const activeCategoryDatabaseIds = new Set(rows.map((row) => row.id))
  const serviceRows = (serviceResult.data ?? []).filter((row) => activeCategoryDatabaseIds.has(row.category_id))
  const featuredServiceIds = new Set(serviceRows.some((row) => row.is_featured) ? serviceRows.filter((row) => row.is_featured).map((row) => row.id) : serviceRows.slice(0, 4).map((row) => row.id))
  const liveServices: Service[] = serviceRows.map((row) => ({
    id: row.slug,
    categoryId: slugById.get(row.category_id) ?? '',
    name: row.name_ar,
    shortDescription: row.description ?? 'تفاصيل الخدمة يحددها الفني بعد مراجعة الطلب.',
    description: row.description ?? '',
    duration: '',
    priceLabel: row.pricing_type === 'fixed' && row.base_price !== null ? `${Number(row.base_price).toLocaleString('ar-SA')} ر.س` : 'يحدده الفني بعد التنفيذ',
    pricingType: row.pricing_type as Service['pricingType'],
    basePrice: row.base_price === null ? null : Number(row.base_price),
    featured: featuredServiceIds.has(row.id),
  }))
  const activeCategoryIds = new Set(liveServices.map((service) => service.categoryId))
  const categoryRows = rows.filter((row) => activeCategoryIds.has(row.slug))
  const featuredCategoryIds = new Set(categoryRows.some((row) => row.is_featured) ? categoryRows.filter((row) => row.is_featured).map((row) => row.slug) : categoryRows.slice(0, 4).map((row) => row.slug))
  const liveCategories: ServiceCategory[] = categoryRows.map((row) => ({
    id: row.slug,
    name: row.name_ar,
    description: row.description ?? '',
    icon: row.icon ?? 'wrench',
    color: row.color || colors[row.slug] || '#5bb4c8',
    featured: featuredCategoryIds.has(row.slug),
  }))
  return { categories: liveCategories, services: liveServices }
}

export type AuthState = { session: Session | null; user: User | null }
export type AppNotification = { id: string; title: string; body: string; notification_type: string; target_path: string | null; is_read: boolean; created_at: string }

export async function subscribeToMyNotifications(onInsert: (notification: AppNotification) => void) {
  if (!supabase) return () => undefined
  const { data } = await supabase.auth.getUser()
  if (!data.user) return () => undefined
  const channel = supabase.channel(`notifications:${data.user.id}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${data.user.id}` }, (payload) => onInsert(payload.new as AppNotification))
    .subscribe()
  return () => { void supabase?.removeChannel(channel) }
}

function authMessage(error: { message?: string }) {
  const message = error.message?.toLowerCase() ?? ''
  if (message.includes('invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  if (message.includes('email not confirmed')) return 'لم يكتمل تفعيل البريد الإلكتروني. تحقق من بريدك ثم حاول مجددًا.'
  if (message.includes('provider is not enabled') || message.includes('unsupported provider')) return 'الدخول بحساب Google غير متاح الآن. استخدم البريد الإلكتروني أو حاول لاحقًا.'
  if (message.includes('already registered')) return 'هذا البريد مسجل مسبقًا. جرّب تسجيل الدخول.'
  if (message.includes('password should be')) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'
  if (message.includes('rate limit')) return 'تم تجاوز عدد المحاولات. انتظر قليلًا ثم حاول.'
  return 'تعذر إتمام تسجيل الدخول. تحقق من بياناتك وحاول مرة أخرى.'
}

export async function getAuthState(): Promise<AuthState> {
  if (!supabase) return { session: null, user: null }
  const { data } = await supabase.auth.getSession()
  return { session: data.session, user: data.session?.user ?? null }
}

export async function getMyRole(): Promise<Role | null> {
  if (!supabase) return null
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return null
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message || 'تعذر التحقق من صلاحيات الحساب.')
  return (data?.role as Role | undefined) ?? null
}

export function onAuthStateChange(callback: (state: AuthState) => void) {
  if (!supabase) return { unsubscribe: () => undefined }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback({ session, user: session?.user ?? null }))
  return data.subscription
}

export async function signInAccount(email: string, password: string) {
  if (!supabase) throw new Error('تعذر تفعيل تسجيل الدخول.')
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(authMessage(error))
  return data
}

export async function signUpAccount(input: { email: string; password: string; fullName: string; phone: string; role: Extract<Role, 'customer' | 'provider'> }) {
  if (!supabase) throw new Error('تعذر تفعيل إنشاء الحساب.')
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { full_name: input.fullName.trim(), phone: input.phone.trim(), requested_role: input.role } },
  })
  if (error) throw new Error(authMessage(error))
  return data
}

export async function finishOAuthSignIn(requestedRole: Extract<Role, 'customer' | 'provider'>): Promise<Role> {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(authMessage(error))
  if (!data.session?.user) throw new Error('تعذر استعادة جلسة Google. أعد المحاولة من صفحة الدخول.')
  if (requestedRole === 'provider') await ensureProviderProfile('provider')
  const role = await getMyRole()
  if (!role) throw new Error('تعذر تجهيز صلاحيات الحساب. تواصل مع الإدارة إذا استمرت المشكلة.')
  try { sessionStorage.removeItem('homefix-google-role') } catch { /* تجاهل تعذر التخزين */ }
  return role
}

export async function signOutAccount() {
  if (supabase) await supabase.auth.signOut()
}

export async function createBookingFromDraft(draft: BookingDraft, serviceSlug: string, policyAccepted = false) {
  if (!policyAccepted) throw new Error('يرجى تأكيد الموافقة على سياسة الطلب قبل الإرسال.')
  if (!supabase) throw new Error('تعذر إنشاء الطلب الآن. حاول مرة أخرى لاحقًا.')
  const { data: service, error: serviceError } = await supabase.from('services').select('id').eq('slug', serviceSlug).eq('is_active', true).maybeSingle()
  if (serviceError) throw serviceError
  if (!service) throw new Error('الخدمة غير متاحة حاليًا')
  const { data, error } = await supabase.rpc('create_booking_with_consent', {
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
    p_policy_accepted: policyAccepted,
    p_policy_version: 'home-booking-terms-v1',
  })
  if (error) throw new Error(error.message || 'تعذر إنشاء الطلب')
  return { mode: 'live' as const, data }
}

export async function getMyBookings() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('bookings').select('id, booking_number, status, payment_status, city, district, address_text, latitude, longitude, issue_description, scheduled_date, scheduled_slot, price_snapshot, created_at, services(name_ar, slug), payments(id,invoice_number,amount,status,payment_method,receipt_reference,review_note)').order('created_at', { ascending: false }).limit(50)
}


export async function signInWithGoogle(role: Extract<Role, 'customer' | 'provider'> = 'customer', nextPath?: string) {
  if (!supabase) throw new Error('تعذر تفعيل الدخول بحساب Google.')
  try { sessionStorage.setItem('homefix-google-role', role) } catch { /* لا نوقف OAuth إذا منع المتصفح التخزين */ }
  const callback = new URL('/auth/callback', window.location.origin)
  callback.searchParams.set('role', role)
  if (nextPath?.startsWith('/') && !nextPath.startsWith('//')) callback.searchParams.set('next', nextPath)
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback.toString() } })
  if (error) throw new Error(authMessage(error))
}

export async function getMyNotifications() {
  if (!supabase) return { data: null, error: new Error('الخدمة غير متاحة الآن.') }
  return supabase.from('notifications').select('id,title,body,notification_type,target_path,is_read,created_at').order('created_at', { ascending: false }).limit(10)
}

export async function markNotificationRead(notificationId: string) {
  if (!supabase) throw new Error('الخدمة غير متاحة الآن.')
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId)
  if (error) throw new Error(error.message || 'تعذر تعليم الإشعار كمقروء.')
}

export async function getMyProviderProfile() {
  if (!supabase) return { data: null, error: new Error('الخدمة غير متاحة الآن.') }
  const userId = (await supabase.auth.getUser()).data.user?.id
  if (!userId) return { data: null, error: new Error('تسجيل الدخول مطلوب.') }
  return supabase.from('provider_profiles').select('approval_status,years_experience,service_description,onboarding_completed,default_commission_rate,profiles(full_name,phone,city)').eq('user_id', userId).maybeSingle()
}

export async function getProviderWorkQueue() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('bookings').select('id,booking_number,status,city,district,address_text,access_notes,latitude,longitude,issue_description,scheduled_date,scheduled_slot,price_snapshot,provider_amount_snapshot,created_at,services(name_ar,pricing_type,base_price),profiles!bookings_customer_id_fkey(full_name,phone),booking_quotes(id,amount,note,status,created_at)').eq('provider_id', (await supabase.auth.getUser()).data.user?.id ?? '').order('created_at', { ascending: false }).limit(50)
}

export async function getProviderLedger() {
  if (!supabase) return { data: [], error: null }
  const userId = (await supabase.auth.getUser()).data.user?.id
  return supabase.from('provider_ledger_entries').select('id,entry_type,amount,note,booking_id,created_at').eq('provider_id', userId ?? '').order('created_at', { ascending: false }).limit(100)
}

export async function getAdminProviderApplications() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('provider_profiles').select('user_id,approval_status,years_experience,service_description,professional_bio,onboarding_completed,default_commission_rate,created_at,profiles(full_name,phone,city),provider_documents(id,document_type,status,storage_path,created_at,is_current),provider_services(service_id,is_active,services(name_ar))').order('created_at', { ascending: false }).limit(100)
}

const providerDocumentMimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const providerDocumentExtensionByMime: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

function providerDocumentMime(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const inferred = providerDocumentMimeByExtension[extension]
  if (inferred) {
    if (!file.type || file.type === 'application/octet-stream' || file.type === 'binary/octet-stream') return inferred
    return file.type === inferred ? inferred : ''
  }
  return file.type
}

function providerDocumentExtension(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (providerDocumentMimeByExtension[extension]) return extension
  return providerDocumentExtensionByMime[providerDocumentMime(file)] ?? ''
}

export async function submitProviderOnboarding(input: { fullName: string; yearsExperience: number; serviceDescription: string; phone: string; city: string; serviceIds: string[]; identityFront: File; identityBack: File; cv: File }) {
  if (!supabase) throw new Error('تعذر إرسال الملف الآن.')
  const userId = (await supabase.auth.getUser()).data.user?.id
  if (!userId) throw new Error('سجّل الدخول لإكمال ملفك المهني.')
  if (input.fullName.trim().length < 2 || input.fullName.trim().length > 160) throw new Error('أدخل الاسم الكامل بحروف تتراوح بين 2 و160 حرفًا.')
  if (!input.serviceIds.length) throw new Error('اختر خدمة واحدة على الأقل.')
  for (const [label, file] of [['وجه الهوية', input.identityFront], ['ظهر الهوية', input.identityBack]] as const) {
    if (file.size > 5 * 1024 * 1024) throw new Error(`حجم ${label} يجب ألا يتجاوز 5 ميجابايت.`)
    if (!['image/jpeg', 'image/png'].includes(providerDocumentMime(file))) throw new Error(`ارفع ${label} بصيغة JPG أو PNG؛ النوع المستلم: ${file.type || 'غير محدد'}.`)
  }
  const cvTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  if (!input.cv) throw new Error('أرفق السيرة الذاتية لإكمال ملف الاعتماد.')
  if (input.cv.size === 0 || input.cv.size > 10 * 1024 * 1024 || !cvTypes.includes(providerDocumentMime(input.cv))) throw new Error('السيرة الذاتية: PDF أو DOC أو DOCX وبحجم من 1 بايت إلى 10 ميجابايت.')
  const upload = async (bucket: string, file: File, prefix: string) => {
    const extension = providerDocumentExtension(file)
    if (!extension) throw new Error('تعذر قراءة امتداد الملف. أعد حفظه بصيغة JPG أو PNG أو PDF أو DOC أو DOCX ثم اختره مجددًا.')
    const mimeType = providerDocumentMime(file)
    const path = `${userId}/${prefix}-${crypto.randomUUID()}.${extension}`
    const { error } = await supabase!.storage.from(bucket).upload(path, file, { contentType: mimeType, upsert: false })
    if (error) throw new Error(`تعذر رفع المستند إلى مساحة ${bucket}: ${error.message}. تحقق من اتصالك وصلاحية الحساب ونوع الملف ثم أعد المحاولة.`)
    return path
  }
  const uploaded: { bucket: string; path: string }[] = []
  try {
    const front = await upload('identity-documents', input.identityFront, 'identity-front')
    uploaded.push({ bucket: 'identity-documents', path: front })
    const back = await upload('identity-documents', input.identityBack, 'identity-back')
    uploaded.push({ bucket: 'identity-documents', path: back })
    const cv = await upload('provider-cvs', input.cv, 'cv')
    uploaded.push({ bucket: 'provider-cvs', path: cv })
    const { error } = await supabase.rpc('provider_submit_onboarding', {
      p_full_name: input.fullName.trim(), p_years: input.yearsExperience, p_description: input.serviceDescription.trim(), p_phone: input.phone.trim(), p_city: input.city.trim(),
      p_identity_front_path: front, p_identity_back_path: back, p_cv_path: cv, p_service_ids: input.serviceIds,
    })
    if (error) {
      const code = error.message.toLowerCase()
      if (code.includes('provider_required') || code.includes('authentication_required')) throw new Error('انتهت جلسة الدخول أو أن الحساب ليس حساب فني. سجّل الدخول من صفحة الفنيين ثم أعد المحاولة.')
      if (code.includes('invalid_full_name')) throw new Error('أدخل الاسم الكامل بحروف تتراوح بين 2 و160 حرفًا.')
      if (code.includes('provider_onboarding_already_submitted')) throw new Error('تم إرسال ملفك بالفعل وهو قيد المراجعة أو معتمد؛ لا حاجة لإعادة الإرسال.')
      if (code.includes('identity_front_document_missing') || code.includes('identity_back_document_missing') || code.includes('cv_document_missing')) throw new Error('لم يصل أحد الملفات كاملًا. اختر ملفات الهوية والسيرة مجددًا ثم أعد الإرسال.')
      if (code.includes('invalid_identity_front_path') || code.includes('invalid_identity_back_path')) throw new Error('تعذر التحقق من مسار صورة الهوية. أعد اختيار صور JPG أو PNG ثم أرسلها مجددًا.')
      if (code.includes('invalid_cv_path')) throw new Error('تعذر التحقق من ملف السيرة؛ أعد اختياره بصيغة PDF أو DOC أو DOCX.')
      if (code.includes('at_least_one_service_required')) throw new Error('اختر خدمة واحدة على الأقل.')
      if (code.includes('service_unavailable')) throw new Error('تغيّرت قائمة الخدمات. حدّث الصفحة واختر الخدمات المتاحة.')
      if (code.includes('invalid_experience_years')) throw new Error('أدخل سنوات خبرة صحيحة بين 0 و70.')
      if (code.includes('invalid_service_description')) throw new Error('أضف نبذة مهنية لا تقل عن 10 أحرف.')
      if (code.includes('invalid_phone')) throw new Error('أدخل رقم جوال صحيحًا.')
      if (code.includes('invalid_city')) throw new Error('أدخل مدينة تقديم الخدمة.')
      console.error('[provider-onboarding] save failed', { code: error.code, message: error.message, details: error.details, hint: error.hint })
      throw new Error(`تعذر حفظ الملف: ${error.message || 'خطأ غير معروف'}${error.code ? ` (رمز ${error.code})` : ''}`)
    }
  } catch (error) {
    await Promise.all(uploaded.map(({ bucket, path }) => supabase!.storage.from(bucket).remove([path])))
    throw error
  }
}

export async function getAdminAccounts(search = '', role: 'all' | 'customer' | 'provider' = 'all') {
  if (!supabase) throw new Error('تعذر تحميل الحسابات الآن.')
  const { data, error } = await supabase.rpc('admin_list_accounts', { p_search: search.trim() || null, p_role: role })
  if (error) throw new Error(error.message.includes('admin_required') ? 'يلزم حساب إداري لعرض الحسابات.' : 'تعذر تحميل الحسابات. حاول مرة أخرى.')
  return (data ?? []) as Array<{ user_id: string; email: string; role: 'customer' | 'provider'; full_name: string; phone: string | null; city: string | null; is_active: boolean; created_at: string; years_experience: number | null; approval_status: string | null; service_description: string | null }>
}

export async function updateAdminAccount(input: { userId: string; fullName: string; phone: string; city: string; yearsExperience?: number | null; serviceDescription?: string }) {
  if (!supabase) throw new Error('تعذر حفظ بيانات الحساب الآن.')
  const { error } = await supabase.rpc('admin_update_account', {
    p_user_id: input.userId, p_full_name: input.fullName, p_phone: input.phone || null,
    p_city: input.city || null, p_years_experience: input.yearsExperience ?? null,
    p_service_description: input.serviceDescription ?? null,
  })
  if (error) {
    const code = error.message.toLowerCase()
    if (code.includes('admin_required')) throw new Error('يلزم حساب إداري لتعديل الحسابات.')
    if (code.includes('account_not_found')) throw new Error('الحساب غير موجود أو ليس من نوع عميل أو فني.')
    if (code.includes('invalid_full_name')) throw new Error('أدخل اسمًا من حرفين إلى 160 حرفًا.')
    if (code.includes('invalid_phone')) throw new Error('رقم الجوال أطول من الحد المسموح.')
    if (code.includes('invalid_city')) throw new Error('اسم المدينة أطول من الحد المسموح.')
    if (code.includes('invalid_experience_years')) throw new Error('سنوات الخبرة يجب أن تكون بين 0 و70.')
    throw new Error(`تعذر حفظ التغييرات: ${error.message}`)
  }
}

export async function setAdminAccountActive(userId: string, active: boolean) {
  if (!supabase) throw new Error('تعذر تغيير حالة الحساب الآن.')
  const { error } = await supabase.rpc('admin_set_account_active', { p_user_id: userId, p_is_active: active })
  if (!error) return
  const message = error.message.toLowerCase()
  if (message.includes('admin_required')) throw new Error('يلزم حساب إداري لتغيير حالة الحساب.')
  if (message.includes('account_not_found')) throw new Error('الحساب غير موجود أو لا يمكن إيقافه من هذه الشاشة.')
  throw new Error(`تعذر تغيير حالة الحساب: ${error.message}`)
}

export async function deleteAdminAccount(userId: string) {
  if (!supabase) throw new Error('تعذر حذف الحساب الآن.')
  const { error } = await supabase.rpc('admin_delete_account', { p_user_id: userId })
  if (!error) return
  const message = error.message.toLowerCase()
  if (message.includes('admin_required')) throw new Error('يلزم حساب إداري لحذف الحسابات.')
  if (message.includes('account_has_history')) throw new Error('لا يمكن حذف حساب مرتبط بطلبات أو سجلات مالية؛ أوقف الحساب بدلًا من حذف تاريخه.')
  if (message.includes('account_has_company')) throw new Error('لا يمكن حذف حساب مالك لشركة؛ انقل الملكية أو أوقف الحساب أولًا.')
  if (message.includes('account_not_found')) throw new Error('الحساب غير موجود أو ليس حساب عميل/فني.')
  throw new Error(`تعذر حذف الحساب: ${error.message}`)
}

export async function updateAdminProviderSpecialties(providerId: string, serviceIds: string[]) {
  if (!supabase) throw new Error('تعذر تحديث خدمات الفني الآن.')
  const { error } = await supabase.rpc('admin_set_provider_specialties', { p_provider_id: providerId, p_service_ids: serviceIds })
  if (!error) return
  const message = error.message.toLowerCase()
  if (message.includes('admin_required')) throw new Error('يلزم حساب إداري لتعديل خدمات الفني.')
  if (message.includes('at_least_one_service_required')) throw new Error('اختر خدمة واحدة على الأقل.')
  if (message.includes('service_unavailable')) throw new Error('تغيّرت قائمة الخدمات. حدّث الصفحة ثم حاول مجددًا.')
  throw new Error('تعذر تحديث خدمات الفني. حاول مرة أخرى.')
}

export async function getAdminAccountRecords(userId: string) {
  if (!supabase) throw new Error('تعذر تحميل سجل الحساب الآن.')
  const [profile, role, bookings, provider, ledger] = await Promise.all([
    supabase.from('profiles').select('id,full_name,phone,city,is_active,created_at').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
    supabase.from('bookings').select('id,booking_number,status,payment_status,city,district,address_text,issue_description,scheduled_date,created_at,price_snapshot,services(name_ar),payments(invoice_number,amount,status,payment_method)').or(`customer_id.eq.${userId},provider_id.eq.${userId}`).order('created_at', { ascending: false }).limit(100),
    supabase.from('provider_profiles').select('years_experience,service_description,professional_bio,approval_status,onboarding_completed,provider_documents(id,document_type,storage_path,status,created_at,is_current),provider_services(service_id,is_active,services(name_ar,service_categories(name_ar)))').eq('user_id', userId).maybeSingle(),
    supabase.from('provider_ledger_entries').select('id,entry_type,amount,note,booking_id,created_at').eq('provider_id', userId).order('created_at', { ascending: false }).limit(100),
  ])
  for (const result of [profile, role, bookings, provider, ledger]) if (result.error) throw new Error('تعذر تحميل سجل الحساب. حاول مرة أخرى.')
  return { profile: profile.data, role: role.data?.role ?? null, bookings: bookings.data ?? [], provider: provider.data, ledger: ledger.data ?? [] }
}

export async function getAdminDocumentUrl(documentType: string, path: string, download = false) {
  if (!supabase) throw new Error('تعذر فتح المستند الآن.')
  const bucket = documentType === 'cv' ? 'provider-cvs' : 'identity-documents'
  const extension = path.split('.').pop()?.toLowerCase()
  const typeLabel = documentType === 'cv' ? 'السيرة-الذاتية' : documentType === 'identity_front' ? 'الهوية-الوجه-الأمامي' : 'الهوية-الوجه-الخلفي'
  const filename = `${typeLabel}${extension && extension !== path ? `.${extension}` : ''}`
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300, download ? { download: filename } : {})
  if (error) throw new Error('المستند غير متاح أو لا تملك صلاحية عرضه.')
  return data.signedUrl
}

export async function getAdminOperations() {
  if (!supabase) return { recent: [], assignable: [], providers: [] }
  const [recentResult, assignableResult, providerResult] = await Promise.all([
    supabase.from('bookings').select('id,booking_number,service_id,status,city,district,address_text,latitude,longitude,issue_description,created_at,services(name_ar),profiles!bookings_customer_id_fkey(full_name,phone)').order('created_at', { ascending: false }).limit(20),
    supabase.from('bookings').select('id,booking_number,service_id,status,city,district,address_text,latitude,longitude,issue_description,created_at,services(name_ar),profiles!bookings_customer_id_fkey(full_name,phone)').is('provider_id', null).in('status', ['pending', 'quoted', 'accepted']).order('created_at', { ascending: true }).limit(100),
    supabase.from('provider_profiles').select('user_id,profiles(full_name),provider_services(service_id,is_active,services(id,name_ar,category_id))').eq('approval_status', 'approved').order('created_at', { ascending: true }).limit(100),
  ])
  if (recentResult.error) throw recentResult.error
  if (assignableResult.error) throw assignableResult.error
  if (providerResult.error) throw providerResult.error
  return { recent: recentResult.data ?? [], assignable: assignableResult.data ?? [], providers: providerResult.data ?? [] }
}

export async function getAdminOverview() {
  if (!supabase) return { bookings: 0, approvedProviders: 0, paidAmount: 0, openComplaints: 0 }
  const [bookings, providers, payments] = await Promise.all([
    supabase.from('bookings').select('id', { count: 'exact', head: true }),
    supabase.from('provider_profiles').select('user_id', { count: 'exact', head: true }).eq('approval_status', 'approved'),
    supabase.from('payments').select('amount').eq('status', 'paid').limit(500),
  ])
  if (bookings.error) throw bookings.error
  if (providers.error) throw providers.error
  if (payments.error) throw payments.error
  return { bookings: bookings.count ?? 0, approvedProviders: providers.count ?? 0, paidAmount: (payments.data ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0), openComplaints: 0 }
}

export async function reviewProviderVerification(providerId: string, status: 'approved' | 'rejected') {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('review_provider_verification', { p_provider_id: providerId, p_status: status, p_note: status === 'approved' ? 'تم اعتماد ملف الفني من الإدارة' : 'تم رفض الملف من الإدارة' })
  if (error) throw new Error(error.message || 'تعذر تحديث حالة اعتماد الفني.')
  return data
}

export async function assignBookingToProvider(bookingId: string, providerId: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('assign_booking', { p_booking_id: bookingId, p_provider_id: providerId })
  if (error) throw new Error(error.message || 'تعذر إسناد الطلب.')
  return data
}

export async function addProviderLedgerEntry(providerId: string, bookingId: string | null, entryType: 'earning' | 'late_penalty' | 'adjustment' | 'payout', amount: number, note: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('add_provider_ledger_entry', { p_provider_id: providerId, p_booking_id: bookingId, p_entry_type: entryType, p_amount: amount, p_note: note })
  if (error) throw new Error(error.message || 'تعذر حفظ القيد المالي.')
  return data
}

export async function ensureProviderProfile(explicitRole?: 'provider') {
  if (!supabase) return
  let requestedRole: string | null = explicitRole ?? null
  if (!requestedRole) try { requestedRole = sessionStorage.getItem('homefix-google-role') } catch { return }
  if (requestedRole !== 'provider') return
  const { error } = await supabase.rpc('ensure_provider_profile')
  if (error) throw new Error(error.message || 'تعذر تجهيز ملف الفني.')
  try { sessionStorage.removeItem('homefix-google-role') } catch { /* تجاهل تعذر التخزين */ }
}


export async function advanceProviderBooking(bookingId: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('provider_advance_booking', { p_booking_id: bookingId })
  if (error) throw new Error(error.message || 'تعذر تحديث حالة المهمة.')
  return data
}

export async function submitProviderQuote(bookingId: string, amount: number, note: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('provider_submit_quote', { p_booking_id: bookingId, p_amount: amount, p_note: note })
  if (error) throw new Error(error.message || 'تعذر إرسال السعر إلى الإدارة.')
  return data
}

export async function finishFixedPriceBooking(bookingId: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('provider_finish_fixed_booking', { p_booking_id: bookingId })
  if (error) throw new Error(error.message || 'تعذر إنهاء المهمة وإصدار الفاتورة.')
  return data
}

export async function getAdminQuotes() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('booking_quotes').select('id,booking_id,provider_id,amount,note,status,created_at,bookings(booking_number,city,district,address_text,latitude,longitude,issue_description,services(name_ar),profiles!bookings_customer_id_fkey(full_name,phone)),provider_profiles(profiles(full_name,phone),default_commission_rate)').eq('status', 'pending').order('created_at', { ascending: true }).limit(100)
}

export async function acceptProviderQuote(quoteId: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('admin_accept_booking_quote', { p_quote_id: quoteId })
  if (error) throw new Error(error.message || 'تعذر اعتماد السعر وإصدار الفاتورة.')
  return data
}

export async function getAdminPayments() {
  if (!supabase) return { data: [], error: null }
  return supabase.from('payments').select('id,invoice_number,booking_id,amount,status,payment_method,receipt_reference,review_note,created_at,bookings(booking_number,city,profiles!bookings_customer_id_fkey(full_name,phone))').in('status', ['unpaid','pending','failed']).order('created_at', { ascending: false }).limit(100)
}

export async function reviewInvoicePayment(paymentId: string, paid: boolean, note = '') {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('admin_review_invoice_payment', { p_payment_id: paymentId, p_paid: paid, p_note: note })
  if (error) throw new Error(error.message || 'تعذر تحديث حالة الفاتورة.')
  return data
}

export async function chooseInvoicePayment(paymentId: string, method: 'cash' | 'bank_transfer') {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('customer_select_invoice_payment', { p_payment_id: paymentId, p_method: method })
  if (error) throw new Error(error.message || 'تعذر حفظ وسيلة الدفع.')
  return data
}

export async function submitTransferReference(paymentId: string, reference: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('customer_submit_transfer_reference', { p_payment_id: paymentId, p_reference: reference })
  if (error) throw new Error(error.message || 'تعذر إرسال مرجع التحويل.')
  return data
}

export async function setProviderCommission(providerId: string, rate: number) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('admin_set_provider_commission', { p_provider_id: providerId, p_rate: rate })
  if (error) throw new Error(error.message || 'تعذر حفظ نسبة العمولة.')
  return data
}

export async function getPlatformSettings() {
  if (!supabase) return { data: null, error: new Error('الخدمة غير متاحة الآن.') }
  return supabase.from('platform_settings').select('id,default_commission_rate,bank_name,bank_account_name,iban').eq('id', 1).maybeSingle()
}

export async function saveDefaultCommission(rate: number) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('admin_set_default_commission', { p_rate: rate })
  if (error) throw new Error(error.message || 'تعذر حفظ العمولة الافتراضية.')
  return data
}

export async function savePaymentSettings(bankName: string, accountName: string, iban: string) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('admin_update_payment_settings', { p_bank_name: bankName, p_account_name: accountName, p_iban: iban })
  if (error) throw new Error(error.message || 'تعذر حفظ معلومات التحويل.')
  return data
}

export async function getAdminCatalog() {
  if (!supabase) return { categories: [], services: [] }
  const [categoriesResult, servicesResult] = await Promise.all([
    supabase.from('service_categories').select('id,slug,name_ar,description,icon,color,is_active,is_featured,display_order').order('display_order'),
    supabase.from('services').select('id,category_id,slug,name_ar,description,pricing_type,base_price,is_active,is_featured,display_order').order('display_order'),
  ])
  if (categoriesResult.error) throw new Error(categoriesResult.error.message)
  if (servicesResult.error) throw new Error(servicesResult.error.message)
  return { categories: categoriesResult.data ?? [], services: servicesResult.data ?? [] }
}

export async function saveAdminCategory(input: { id?: string; slug: string; name_ar: string; description: string; icon: string; color: string; is_active: boolean; is_featured: boolean }) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { id, ...values } = input
  const result = id ? await supabase.from('service_categories').update(values).eq('id', id).select().single() : await supabase.from('service_categories').insert(values).select().single()
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function saveAdminService(input: { id?: string; category_id: string; slug: string; name_ar: string; description: string; pricing_type: 'fixed' | 'provider_quote'; base_price: number | null; is_active: boolean; is_featured: boolean }) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  if (input.pricing_type === 'fixed' && (!input.base_price || input.base_price <= 0)) throw new Error('أدخل سعرًا ثابتًا أكبر من صفر.')
  const { id, ...values } = input
  const result = id ? await supabase.from('services').update(values).eq('id', id).select().single() : await supabase.from('services').insert(values).select().single()
  if (result.error) throw new Error(result.error.message)
  return result.data
}


export async function getProviderSpecialtyOptions() {
  if (!supabase) return { data: [], error: new Error('الخدمة غير متاحة الآن.') }
  return supabase.from('services').select('id,name_ar,service_categories(name_ar)').eq('is_active', true).order('name_ar').limit(200)
}

export async function getProviderSpecialties() {
  if (!supabase) return { data: [], error: new Error('الخدمة غير متاحة الآن.') }
  return supabase.rpc('provider_get_specialties')
}

export async function saveProviderSpecialties(serviceIds: string[]) {
  if (!supabase) throw new Error('تعذر إتمام العملية الآن.')
  const { data, error } = await supabase.rpc('provider_set_specialties', { p_service_ids: serviceIds })
  if (error) throw new Error(error.message || 'تعذر حفظ تخصصات الفني.')
  return data
}
