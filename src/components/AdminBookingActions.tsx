import { useMemo, useState } from 'react'
import { Ban, Check, RotateCw, Unlink, X } from 'lucide-react'
import { adminCancelBooking, adminReassignBooking, adminUnassignBooking } from '../lib/supabase'

type Props = { booking: any; providers: any[]; busy?: boolean; onComplete: () => Promise<unknown> | void }
const preStart = new Set(['pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived'])

export function AdminBookingActions({ booking, providers, busy: parentBusy = false, onComplete }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const candidates = useMemo(() => providers.filter((provider) => provider.profiles?.is_active === true && provider.user_id !== booking.provider_id && (provider.provider_services ?? []).some((skill: any) => skill.is_active && skill.service_id === booking.service_id)), [providers, booking.provider_id, booking.service_id])
  if (!preStart.has(booking.status)) return null
  const perform = async (action: () => Promise<unknown>, success: string) => {
    if (reason.trim().length < 3) { setMessage('اكتب سببًا واضحًا من 3 أحرف على الأقل.'); return }
    setBusy(true); setMessage('')
    try { await action(); await onComplete(); setMessage(success); setReason(''); setProviderId('') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تحديث الطلب.') }
    finally { setBusy(false) }
  }
  return <div className="admin-booking-actions">
    <button type="button" className="button button-secondary button-small" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>إدارة الحالة</button>
    {expanded && <div className="admin-booking-actions-form">
      <label className="field-label">سبب الإجراء<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="سبب الإلغاء أو تغيير الإسناد" /></label>
      {booking.provider_id && <><p className="muted">يمكن تعديل الإسناد ما دام التنفيذ لم يبدأ.</p><label className="field-label">فني بديل<select value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">اختر فنيًا مطابقًا</option>{candidates.map((provider) => <option key={provider.user_id} value={provider.user_id}>{provider.profiles?.full_name ?? 'فني'}</option>)}</select></label><button type="button" className="button button-primary button-small" disabled={busy || parentBusy || !providerId || reason.trim().length < 3} onClick={() => void perform(() => adminReassignBooking(booking.id, providerId, reason), 'تم تغيير إسناد الطلب وأُبلغ الأطراف.') }><RotateCw size={14} /> إعادة الإسناد</button><button type="button" className="button button-secondary button-small" disabled={busy || parentBusy || reason.trim().length < 3} onClick={() => void perform(() => adminUnassignBooking(booking.id, reason), 'أُعيد الطلب إلى قائمة الإسناد.') }><Unlink size={14} /> فك الإسناد</button></>}
      <button type="button" className="button button-danger button-small" disabled={busy || parentBusy || reason.trim().length < 3} onClick={() => { if (window.confirm('تأكيد إغلاق الطلب؟ سيُحفظ السبب ويُبلغ العميل والفني.')) void perform(() => adminCancelBooking(booking.id, reason), 'أُغلق الطلب وسُجل السبب وأُبلغ الأطراف.') }}><Ban size={14} /> إلغاء الطلب</button>
      {message && <div className={message.startsWith('تعذر') || message.startsWith('اكتب') ? 'inline-error' : 'success-note'} role="status">{message.startsWith('تعذر') || message.startsWith('اكتب') ? <X size={15} /> : <Check size={15} />}{message}</div>}
    </div>}
  </div>
}
