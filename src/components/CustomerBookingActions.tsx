import { useState } from 'react'
import { Ban, Check, X } from 'lucide-react'
import { cancelCustomerBooking } from '../lib/supabase'

type Props = { booking: any; onComplete: () => Promise<void> | void }
const cancellable = new Set(['pending', 'quoted', 'accepted', 'assigned'])

export function CustomerBookingActions({ booking, onComplete }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const activeInvoice = (booking.payments ?? []).length > 0
  if (!cancellable.has(booking.status) || booking.status === 'cancelled') return null
  if (activeInvoice || booking.payment_status === 'paid') return <p className="booking-action-note">تعذر الإلغاء تلقائيًا لوجود فاتورة أو محاولة دفع تحتاج مراجعة الإدارة.</p>
  const cancel = async () => {
    if (reason.trim().length < 3) { setMessage('اكتب سببًا مختصرًا للإلغاء.'); return }
    setBusy(true); setMessage('')
    try { await cancelCustomerBooking(booking.id, reason.trim()); await onComplete(); setMessage('تم إلغاء الطلب.'); setOpen(false) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر إلغاء الطلب.') }
    finally { setBusy(false) }
  }
  return <div className="booking-cancel-control">
    {!open ? <button type="button" className="text-link danger-link" onClick={() => { setOpen(true); setMessage('') }}><Ban size={15} /> طلب إلغاء</button> : <div className="booking-cancel-form"><label className="field-label">سبب الإلغاء<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} minLength={3} placeholder="اكتب سببًا مختصرًا" /></label><p className="muted">الإلغاء متاح قبل تحرك الفني، ولا تُفرض غرامة آلية عبر هذا الإجراء.</p><div className="button-row"><button type="button" className="button button-secondary button-small" onClick={() => setOpen(false)} disabled={busy}>تراجع</button><button type="button" className="button button-danger button-small" onClick={() => void cancel()} disabled={busy || reason.trim().length < 3}>{busy ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'} <Ban size={14} /></button></div></div>}
    {message && <div className={message.startsWith('تعذر') || message.startsWith('اكتب') ? 'inline-error' : 'success-note'} role="status">{message.startsWith('تعذر') ? <X size={15} /> : <Check size={15} />}{message}</div>}
  </div>
}
