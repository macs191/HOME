import { useState } from 'react'
import { CalendarDays, Check, ChevronDown, Clock3, Edit3, Image as ImageIcon, MapPin, Save, ShieldCheck, UserRound, Wrench, X } from 'lucide-react'
import { AdminBookingActions } from './AdminBookingActions'
import { ActionConfirmDialog } from './ActionConfirmDialog'
import { BookingAttachmentsPanel } from './BookingAttachmentsPanel'
import { BookingChat } from './BookingChat'
import { BookingStatusTimeline } from './BookingStatusTimeline'
import { confirmAdminAutoAssignment, updateAutoAssignedBooking, type AdminAutoAssignmentEdit } from '../lib/supabase'

type Provider = {
  user_id: string
  approval_status?: string
  availability_status?: string
  base_latitude?: number | null
  base_longitude?: number | null
  service_radius_km?: number | null
  provider_services?: Array<{ service_id: string; is_active: boolean; services?: { name_ar?: string } | null }>
  profiles?: { full_name?: string | null; phone?: string | null; is_active?: boolean } | Array<{ full_name?: string | null; phone?: string | null; is_active?: boolean }> | null
}

type Booking = {
  id: string
  booking_number: number | string
  customer_id: string
  service_id: string
  provider_id: string
  status: string
  payment_status: string
  city: string
  district: string | null
  address_text: string
  access_notes: string | null
  latitude: number | null
  longitude: number | null
  location_source: string
  issue_description: string
  urgency: 'normal' | 'urgent'
  scheduled_date: string | null
  scheduled_slot: string | null
  price_snapshot: number | string | null
  created_at: string
  services?: { name_ar?: string | null; pricing_type?: string | null; base_price?: number | null } | null
  profiles?: { full_name?: string | null; phone?: string | null } | null
  provider_profiles?: Provider | Provider[] | null
  booking_status_history?: Array<{ id: string; from_status: string | null; to_status: string; note: string | null; created_at: string }>
  booking_attachments?: Array<{ id: string; storage_path: string; mime_type: string; file_size_bytes: number; created_at: string }>
  payments?: Array<{ id: string; invoice_number?: string | null; amount: number | string; status: string; payment_method?: string | null; receipt_reference?: string | null; review_note?: string | null; created_at: string }>
  booking_quotes?: Array<{ id: string; amount: number | string; note: string | null; status: string; created_at: string }>
  auto_assignment_history_id: string
  auto_assignment_note: string
}

type Props = {
  bookings: Booking[]
  providers: Provider[]
  busy?: boolean
  hasMore?: boolean
  onLoadMore?: () => Promise<unknown> | void
  onComplete: () => Promise<unknown> | void
}

const slots = ['9:00ص-12:00م', '12:00م-3:00م', '4:00م-7:00م', '7:00م-9:00م']
const paymentLabels: Record<string, string> = { unpaid: 'غير مدفوع', pending: 'قيد التحصيل', paid: 'مدفوع', failed: 'فشل الدفع', refunded: 'مسترد' }
const statusLabels: Record<string, string> = { pending: 'قيد المراجعة', quoted: 'بانتظار عرض السعر', accepted: 'مقبول', assigned: 'مسند للفني', on_the_way: 'الفني في الطريق', arrived: 'وصل الفني', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى' }

function providerProfile(provider?: Provider) {
  if (!provider?.profiles) return null
  return Array.isArray(provider.profiles) ? provider.profiles[0] ?? null : provider.profiles
}

function makeEdit(booking: Booking): AdminAutoAssignmentEdit {
  return {
    issue_description: booking.issue_description ?? '',
    urgency: booking.urgency === 'urgent' ? 'urgent' : 'normal',
    city: booking.city ?? '',
    district: booking.district ?? '',
    address_text: booking.address_text ?? '',
    access_notes: booking.access_notes ?? '',
    scheduled_date: booking.scheduled_date?.slice(0, 10) ?? '',
    scheduled_slot: booking.scheduled_slot ?? '',
  }
}

function formatMoney(value: number | string | null | undefined) {
  if (value == null || value === '') return 'غير محدد'
  const amount = Number(value)
  return Number.isFinite(amount) ? `${amount.toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س` : 'غير محدد'
}

function formatDate(value?: string | null) {
  if (!value) return 'لم يحدد'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long' }).format(date)
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير محدد'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function AdminAutoAssignmentReviewPanel({ bookings, providers, busy: parentBusy = false, hasMore = false, onLoadMore, onComplete }: Props) {
  return <section className="panel auto-assignment-review" aria-labelledby="auto-assignment-review-title">
    <div className="panel-heading auto-assignment-review-heading">
      <div>
        <span className="eyebrow"><ShieldCheck size={14} /> مراجعة الإسناد الآلي</span>
        <h2 id="auto-assignment-review-title">الإسنادات التلقائية بانتظار مراجعة الإدارة</h2>
        <p className="muted">هذه الطلبات أُسندت بالفعل آليًا وأُرسلت إشعاراتها؛ اعتماد البطاقة يوثّق مراجعة الإدارة. افتح البطاقة للتحقق من بيانات العميل والفني والصور والموعد، أو غيّر الفني وعدّل البيانات التشغيلية.</p>
      </div>
      <span className="status-pill">{bookings.length} بانتظار المراجعة</span>
    </div>
    {bookings.length ? <div className="auto-assignment-card-list">
      {bookings.map((booking) => <AutoAssignmentCard key={`${booking.id}:${booking.auto_assignment_history_id}`} booking={booking} providers={providers} busy={parentBusy} onComplete={onComplete} />)}
    </div> : <div className="auto-assignment-empty"><Check size={18} /><div><strong>{hasMore ? 'لا توجد إسنادات معلّقة في هذه الصفحة' : 'لا توجد إسنادات تلقائية معلّقة'}</strong><p>ستظهر هنا المطابقات التلقائية التي لم تعتمدها الإدارة بعد.</p></div></div>}
    {hasMore && <button type="button" className="button button-secondary button-small auto-assignment-load-more" disabled={parentBusy} onClick={() => void onLoadMore?.()}>{parentBusy ? 'جارٍ تحميل الطلبات…' : 'تحميل إسنادات أقدم'}</button>}
  </section>
}

function AutoAssignmentCard({ booking, providers, busy: parentBusy, onComplete }: { booking: Booking; providers: Provider[]; busy: boolean; onComplete: () => Promise<unknown> | void }) {
  const [expanded, setExpanded] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState<AdminAutoAssignmentEdit>(() => makeEdit(booking))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingAction, setPendingAction] = useState<'confirm' | 'save' | null>(null)
  const joinedProvider = Array.isArray(booking.provider_profiles) ? booking.provider_profiles[0] : booking.provider_profiles
  const provider = joinedProvider ?? providers.find((item) => item.user_id === booking.provider_id)
  const providerInfo = providerProfile(provider)
  const matchedServices = (provider?.provider_services ?? []).filter((service) => service.is_active)
  const latestPayment = [...(booking.payments ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const mapQuery = booking.latitude != null && booking.longitude != null
    ? `${booking.latitude},${booking.longitude}`
    : [booking.address_text, booking.district, booking.city].filter(Boolean).join(' ')
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`

  const updateField = <K extends keyof AdminAutoAssignmentEdit>(key: K, value: AdminAutoAssignmentEdit[K]) => setEdit((current) => ({ ...current, [key]: value }))
  const submit = async () => {
    if (!pendingAction || busy || parentBusy) return
    const action = pendingAction
    setBusy(true); setMessage('')
    try {
      if (action === 'confirm') {
        await confirmAdminAutoAssignment(booking.id, booking.auto_assignment_history_id)
        setMessage('تم اعتماد الفني الحالي وتوثيق المراجعة.')
      } else {
        await updateAutoAssignedBooking(booking.id, booking.auto_assignment_history_id, edit, reason)
        setEditOpen(false); setReason('')
        setMessage('تم حفظ التعديلات وإبلاغ العميل والفني.')
      }
      setPendingAction(null)
      await onComplete()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر إكمال المراجعة. حدّث البطاقة وحاول مرة أخرى.')
      setPendingAction(null)
    } finally {
      setBusy(false)
    }
  }

  const detailChanged = JSON.stringify(edit) !== JSON.stringify(makeEdit(booking))
  const canSave = detailChanged && reason.trim().length >= 3 && edit.issue_description.trim().length >= 10 && edit.city.trim().length >= 2 && edit.address_text.trim().length >= 3

  return <article className="auto-assignment-card">
    <details className="auto-assignment-details" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <span className="auto-assignment-summary-main">
          <span className="auto-assignment-number">طلب #{booking.booking_number}</span>
          <strong>{booking.services?.name_ar ?? 'خدمة منزلية'}</strong>
          <small>{booking.profiles?.full_name ?? 'عميل'} · {booking.profiles?.phone ?? 'لا يوجد رقم جوال'}</small>
        </span>
        <span className="auto-assignment-summary-meta">
          <span className="status-pill status-pill-review">بانتظار الاعتماد</span>
          <span><UserRound size={14} /> {providerInfo?.full_name ?? 'الفني الحالي غير ظاهر'}</span>
          <span><CalendarDays size={14} /> {formatDate(booking.scheduled_date)}</span>
          <span><ImageIcon size={14} /> {booking.booking_attachments?.length ?? 0} صور</span>
        </span>
        <ChevronDown size={18} className="auto-assignment-chevron" aria-hidden="true" />
      </summary>
      <div className="auto-assignment-card-body">
        <div className="auto-assignment-detail-grid">
          <section className="auto-assignment-detail-block">
            <h3><Wrench size={16} /> تفاصيل الطلب</h3>
            <dl>
              <div><dt>الخدمة</dt><dd>{booking.services?.name_ar ?? 'غير محدد'}</dd></div>
              <div><dt>وصف المشكلة</dt><dd>{booking.issue_description || 'لا يوجد وصف مسجل'}</dd></div>
              <div><dt>الأولوية</dt><dd>{booking.urgency === 'urgent' ? 'عاجل' : 'عادي'}</dd></div>
              <div><dt>الحالة</dt><dd>{statusLabels[booking.status] ?? booking.status}</dd></div>
              <div><dt>وقت إنشاء الطلب</dt><dd>{formatDateTime(booking.created_at)}</dd></div>
              <div><dt>موعد الزيارة</dt><dd>{formatDate(booking.scheduled_date)}{booking.scheduled_slot ? ` · ${booking.scheduled_slot}` : ''}</dd></div>
              <div><dt>الموقع</dt><dd>{[booking.address_text, booking.district, booking.city].filter(Boolean).join(' · ') || 'غير مسجل'}</dd></div>
              <div><dt>تعليمات الوصول</dt><dd>{booking.access_notes || 'لا توجد تعليمات مسجلة'}</dd></div>
              <div><dt>إحداثيات الموقع</dt><dd>{booking.latitude != null && booking.longitude != null ? `${booking.latitude}, ${booking.longitude} (${booking.location_source === 'gps' ? 'GPS' : 'محددة يدويًا'})` : 'لا توجد إحداثيات دقيقة'}</dd></div>
              <div><dt>السعر المعتمد</dt><dd>{formatMoney(booking.price_snapshot)}</dd></div>
              <div><dt>حالة الدفع</dt><dd>{paymentLabels[booking.payment_status] ?? booking.payment_status}{latestPayment?.payment_method ? ` · ${latestPayment.payment_method}` : ''}</dd></div>
              {latestPayment && <div><dt>آخر فاتورة</dt><dd>{latestPayment.invoice_number ?? '—'} · {formatMoney(latestPayment.amount)} · {paymentLabels[latestPayment.status] ?? latestPayment.status}{latestPayment.payment_method ? ` · ${latestPayment.payment_method}` : ''}{latestPayment.receipt_reference ? ` · مرجع ${latestPayment.receipt_reference}` : ''}{latestPayment.review_note ? ` · ملاحظة المراجعة: ${latestPayment.review_note}` : ''}</dd></div>}
              {(booking.booking_quotes ?? []).length > 0 && <div><dt>عروض الأسعار</dt><dd>{booking.booking_quotes?.map((quote) => `${formatMoney(quote.amount)} (${quote.status})${quote.note ? `: ${quote.note}` : ''}`).join('، ')}</dd></div>}
            </dl>
          </section>
          <section className="auto-assignment-detail-block">
            <h3><UserRound size={16} /> العميل والفني المرشح</h3>
            <dl>
              <div><dt>اسم العميل</dt><dd>{booking.profiles?.full_name ?? 'غير مسجل'}</dd></div>
              <div><dt>جوال العميل</dt><dd>{booking.profiles?.phone ?? 'غير مسجل'}</dd></div>
              <div><dt>الفني الحالي</dt><dd>{providerInfo?.full_name ?? 'غير ظاهر ضمن الفنيين المعتمدين'}</dd></div>
              <div><dt>جوال الفني</dt><dd>{providerInfo?.phone ?? 'غير مسجل'}</dd></div>
              <div><dt>اعتماد الفني</dt><dd>{provider?.approval_status === 'approved' ? 'معتمد' : 'تحقق مطلوب'} · {providerInfo?.is_active ? 'الحساب نشط' : 'الحساب غير نشط'}</dd></div>
              <div><dt>حالة التوفر</dt><dd>{provider?.availability_status ?? 'غير محددة'}</dd></div>
              <div><dt>التخصصات النشطة</dt><dd>{matchedServices.map((service) => service.services?.name_ar).filter(Boolean).join('، ') || 'لا توجد تخصصات نشطة ظاهرة'}</dd></div>
              <div><dt>موقع الفني الأساسي</dt><dd>{provider?.base_latitude != null && provider?.base_longitude != null ? `${provider.base_latitude}, ${provider.base_longitude}` : 'غير مسجل'}</dd></div>
              <div><dt>نطاق الخدمة</dt><dd>{provider?.service_radius_km != null ? `${provider.service_radius_km} كم` : 'غير محدد'}</dd></div>
              <div><dt>سبب المطابقة التلقائية</dt><dd>{booking.auto_assignment_note}</dd></div>
            </dl>
            <a className="text-link auto-assignment-map-link" href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={15} /> فتح موقع الطلب على الخريطة</a>
          </section>
        </div>

        {expanded && <>
          <BookingAttachmentsPanel bookingId={booking.id} attachments={booking.booking_attachments ?? []} canUpload={false} />
          <BookingStatusTimeline events={booking.booking_status_history} />
          <BookingChat bookingId={booking.id} />
        </>}

        <div className="auto-assignment-actions">
          <button type="button" className="button button-primary button-small" disabled={busy || parentBusy} onClick={() => setPendingAction('confirm')}><Check size={15} /> اعتماد الفني الحالي</button>
          <button type="button" className="button button-secondary button-small" aria-expanded={editOpen} onClick={() => { setEdit(makeEdit(booking)); setEditOpen((value) => !value) }}><Edit3 size={15} /> {editOpen ? 'إغلاق تعديل البيانات' : 'تعديل بيانات الطلب'}</button>
          <AdminBookingActions booking={booking} providers={providers as any[]} busy={busy || parentBusy} onComplete={onComplete} />
        </div>
        {editOpen && <section className="auto-assignment-edit-form" aria-label="تعديل بيانات الطلب">
          <div className="auto-assignment-edit-heading"><div><h3>تعديل البيانات التشغيلية</h3><p>السعر والدفع والإحداثيات لا تتغير من هنا؛ تعديل العنوان نصّي فقط. ستتحقق قاعدة البيانات من الموعد وتعارضات الفني قبل الحفظ.</p></div><Clock3 size={17} /></div>
          <label className="field-label">وصف المشكلة<textarea rows={3} maxLength={2000} value={edit.issue_description} onChange={(event) => updateField('issue_description', event.target.value)} /></label>
          <div className="field-grid"><label className="field-label">الأولوية<select value={edit.urgency} onChange={(event) => updateField('urgency', event.target.value as AdminAutoAssignmentEdit['urgency'])}><option value="normal">عادي</option><option value="urgent">عاجل</option></select></label><label className="field-label">المدينة<input maxLength={120} value={edit.city} onChange={(event) => updateField('city', event.target.value)} /></label></div>
          <div className="field-grid"><label className="field-label">الحي<input maxLength={120} value={edit.district} onChange={(event) => updateField('district', event.target.value)} /></label><label className="field-label">العنوان<textarea rows={2} maxLength={500} value={edit.address_text} onChange={(event) => updateField('address_text', event.target.value)} /></label></div>
          <label className="field-label">تعليمات الوصول<textarea rows={2} maxLength={1000} value={edit.access_notes} onChange={(event) => updateField('access_notes', event.target.value)} /></label>
          <div className="field-grid"><label className="field-label">تاريخ الموعد<input type="date" value={edit.scheduled_date} onChange={(event) => { updateField('scheduled_date', event.target.value); if (!event.target.value) updateField('scheduled_slot', '') }} /></label><label className="field-label">الفترة<select value={edit.scheduled_slot} onChange={(event) => updateField('scheduled_slot', event.target.value)} disabled={!edit.scheduled_date}><option value="">بدون فترة محددة</option>{edit.scheduled_slot && !slots.includes(edit.scheduled_slot) && <option value={edit.scheduled_slot}>{edit.scheduled_slot} (محفوظ حاليًا)</option>}{slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label></div>
          <label className="field-label">سبب التعديل<textarea rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سببًا واضحًا ليظهر في سجل التدقيق" /></label>
          <div className="auto-assignment-edit-actions"><button type="button" className="button button-primary button-small" disabled={!canSave || busy || parentBusy} onClick={() => setPendingAction('save')}><Save size={15} /> مراجعة وحفظ التعديل</button><small>تُرسل إشعارات للعميل والفني بعد الحفظ.</small></div>
        </section>}
        {message && <div className={message.startsWith('تعذر') || message.startsWith('تغيّر') ? 'inline-error' : 'success-note'} role="status">{message.startsWith('تعذر') || message.startsWith('تغيّر') ? <X size={15} /> : <Check size={15} />}{message}</div>}
      </div>
    </details>
    <ActionConfirmDialog
      open={pendingAction !== null}
      title={pendingAction === 'confirm' ? 'اعتماد الإسناد التلقائي' : 'تأكيد تعديل بيانات الطلب'}
      description={pendingAction === 'confirm'
        ? `سيُعتمد الفني ${providerInfo?.full_name ?? 'المسند حاليًا'} للطلب #${booking.booking_number}، ويُسجل الاعتماد في سجل التدقيق وتُرسل إشعارات للطرفين.`
        : `سيُحفظ تعديل الطلب #${booking.booking_number} مع السبب المدخل. سيُرفض الحفظ إذا لم يعد الإسناد أو الموعد صالحًا.`}
      confirmLabel={pendingAction === 'confirm' ? 'اعتماد الإسناد' : 'حفظ التعديلات'}
      tone="primary"
      busy={busy}
      onCancel={() => setPendingAction(null)}
      onConfirm={() => void submit()}
    />
  </article>
}
