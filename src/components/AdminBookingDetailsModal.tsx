import { useMemo, useState } from 'react'
import { Ban, CalendarDays, Check, ExternalLink, MapPin, MessageCircle, Navigation, UserRound, Wrench, X } from 'lucide-react'
import { AdminBookingActions } from './AdminBookingActions'
import { BookingAttachmentsPanel } from './BookingAttachmentsPanel'
import { BookingChat } from './BookingChat'
import { BookingStatusTimeline } from './BookingStatusTimeline'
import { assignBookingToProvider, autoAssignBookingToNearestProvider } from '../lib/supabase'

type Props = { booking: any; providers: any[]; busy?: boolean; onClose: () => void; onComplete: () => Promise<unknown> | void }
const statusLabels: Record<string, string> = { pending: 'قيد المراجعة', quoted: 'عرض سعر', accepted: 'مقبول', assigned: 'مسند', on_the_way: 'في الطريق', arrived: 'وصل', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى' }

function profile(value: any) { return Array.isArray(value) ? value[0] : value }
function phoneForWhatsApp(value: unknown) {
  const raw = String(value ?? '').trim()
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('05')) return `966${digits.slice(1)}`
  if (digits.startsWith('5') && digits.length === 9) return `966${digits}`
  return digits
}
function formatDate(value: unknown) { return value ? new Date(String(value)).toLocaleDateString('ar-SA') : 'غير محدد' }

export function AdminBookingDetailsModal({ booking, providers, busy = false, onClose, onComplete }: Props) {
  const [providerId, setProviderId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const customer = profile(booking.profiles)
  const assignedProvider = profile(profile(booking.provider_profiles)?.profiles)
  const eligibleProviders = useMemo(() => providers.filter((provider) => provider.profiles?.is_active === true && provider.user_id !== booking.provider_id && (provider.provider_services ?? []).some((skill: any) => skill.is_active && skill.service_id === booking.service_id)), [providers, booking.provider_id, booking.service_id])
  const provider = assignedProvider ?? eligibleProviders.find((item) => item.user_id === providerId)?.profiles
  const appUrl = `${window.location.origin}/provider/work-queue?booking=${encodeURIComponent(booking.id)}`
  const whatsappPhone = phoneForWhatsApp(provider?.phone)
  const whatsappText = [`طلب HOME SERVICE رقم #${booking.booking_number ?? ''}`, `الخدمة: ${booking.services?.name_ar ?? 'خدمة منزلية'}`, `العميل: ${customer?.full_name ?? 'عميل'}${customer?.phone ? ` — ${customer.phone}` : ''}`, `الموعد: ${formatDate(booking.scheduled_date)} · ${booking.scheduled_slot ?? 'غير محدد'}`, `الموقع: ${[booking.address_text, booking.district, booking.city].filter(Boolean).join('، ') || 'غير مكتمل'}`, `وصف المشكلة: ${booking.issue_description ?? 'غير متوفر'}`, `فتح الطلب: ${appUrl}`].join('\n')
  const whatsappUrl = whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappText)}` : ''
  const assign = async () => {
    if (!providerId || assigning) return
    setAssigning(true)
    try { await assignBookingToProvider(booking.id, providerId); await onComplete(); onClose() } finally { setAssigning(false) }
  }
  const autoAssign = async () => {
    if (assigning) return
    setAssigning(true)
    try { await autoAssignBookingToNearestProvider(booking.id); await onComplete(); onClose() } finally { setAssigning(false) }
  }
  return <div className="admin-booking-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="admin-booking-modal" role="dialog" aria-modal="true" aria-labelledby="admin-booking-dialog-title" dir="rtl">
    <header className="admin-booking-modal-header"><div><span className="eyebrow">تفاصيل الطلب #{booking.booking_number ?? ''}</span><h2 id="admin-booking-dialog-title">{booking.services?.name_ar ?? 'خدمة منزلية'}</h2><p className="muted">{customer?.full_name ?? 'عميل'} · {formatDate(booking.created_at)}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={19} /></button></header>
    <div className="admin-booking-modal-status"><span className="status-pill">{statusLabels[booking.status] ?? booking.status}</span>{booking.urgency === 'urgent' && <span className="status-pill warning">عاجل</span>}<span className="muted">{booking.payment_status ?? 'الدفع بعد التنفيذ'}</span></div>
    <div className="admin-booking-detail-grid"><article><span><UserRound size={15} /> العميل</span><strong>{customer?.full_name ?? 'غير مسجل'}</strong><small>{customer?.phone ?? 'بدون رقم'}</small></article><article><span><CalendarDays size={15} /> الموعد</span><strong>{formatDate(booking.scheduled_date)}</strong><small>{booking.scheduled_slot ?? 'غير محدد'}</small></article><article><span><MapPin size={15} /> الموقع</span><strong>{booking.city ?? 'غير محدد'}</strong><small>{[booking.district, booking.address_text].filter(Boolean).join(' · ') || 'لا يوجد عنوان'}</small></article><article><span><Wrench size={15} /> الفني</span><strong>{provider?.full_name ?? 'لم يُسند بعد'}</strong><small>{provider?.phone ?? '—'}</small></article></div>
    <div className="admin-booking-description"><span className="eyebrow">وصف المشكلة</span><p>{booking.issue_description || 'لا يوجد وصف.'}</p>{booking.access_notes && <><span className="eyebrow">تعليمات الوصول</span><p>{booking.access_notes}</p></>}</div>
    <div className="admin-booking-modal-subsections"><BookingAttachmentsPanel bookingId={booking.id} attachments={booking.attachments ?? booking.booking_attachments ?? []} canUpload={false} /><BookingStatusTimeline events={booking.booking_status_history ?? []} /><BookingChat bookingId={booking.id} /></div>
    <div className="admin-booking-modal-actions"><a className="button button-secondary button-small" target="_blank" rel="noreferrer" href={booking.latitude != null && booking.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${booking.latitude},${booking.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([booking.address_text, booking.district, booking.city].filter(Boolean).join(' '))}`}><MapPin size={15} /> فتح الخريطة</a>{whatsappUrl ? <a className="button button-whatsapp button-small" target="_blank" rel="noreferrer" href={whatsappUrl}><MessageCircle size={15} /> إرسال WhatsApp للفني</a> : <span className="muted">لا يوجد رقم فني صالح لـ WhatsApp</span>}{booking.provider_id && <a className="button button-secondary button-small" target="_blank" rel="noreferrer" href={appUrl}><ExternalLink size={15} /> فتح حساب الفني</a>}</div>
    {!booking.provider_id && <div className="admin-booking-assign-box"><div><strong>إسناد الطلب</strong><small>اختر فنيًا مطابقًا أو شغّل المطابقة حسب الموقع والتخصص.</small></div><div className="field-grid"><select value={providerId} onChange={(event) => setProviderId(event.target.value)} aria-label="اختيار فني"><option value="">اختر فنيًا معتمدًا</option>{eligibleProviders.map((item) => <option key={item.user_id} value={item.user_id}>{item.profiles?.full_name ?? 'فني'} · {item.profiles?.phone ?? 'بدون رقم'}</option>)}</select><div className="button-row"><button type="button" className="button button-primary button-small" disabled={assigning || busy || !providerId} onClick={() => void assign()}><Check size={14} /> إسناد الفني</button><button type="button" className="button button-secondary button-small" disabled={assigning || busy} onClick={() => void autoAssign()}><Navigation size={14} /> مطابقة تلقائية</button></div></div>{!eligibleProviders.length && <small className="inline-error">لا يوجد فني معتمد مطابق حاليًا.</small>}</div>}
    <div className="admin-booking-modal-footer"><AdminBookingActions booking={booking} providers={providers} busy={busy || assigning} onComplete={async () => { await onComplete(); onClose() }} /><button type="button" className="button button-danger button-small" onClick={onClose}><Ban size={14} /> إغلاق النافذة</button></div>
  </section></div>
}
