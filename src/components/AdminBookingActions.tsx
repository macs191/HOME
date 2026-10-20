import { useMemo, useRef, useState } from 'react'
import { Ban, Check, RotateCw, Unlink, X } from 'lucide-react'
import { ActionConfirmDialog } from './ActionConfirmDialog'
import { adminCancelBooking, adminReassignBooking, adminUnassignBooking } from '../lib/supabase'

type Props = { booking: any; providers: any[]; busy?: boolean; onComplete: () => Promise<unknown> | void }
type PendingAction = { kind: 'reassign'; providerId: string; providerName: string } | { kind: 'unassign' | 'cancel' }
const preStart = new Set(['pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived'])

export function AdminBookingActions({ booking, providers, busy: parentBusy = false, onComplete }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const inFlight = useRef(false)
  const candidates = useMemo(() => providers.filter((provider) => provider.profiles?.is_active === true && provider.user_id !== booking.provider_id && (provider.provider_services ?? []).some((skill: any) => skill.is_active && skill.service_id === booking.service_id)), [providers, booking.provider_id, booking.service_id])
  if (!preStart.has(booking.status)) return null

  const requestAction = (action: PendingAction) => {
    if (reason.trim().length < 3) { setMessage('اكتب سببًا واضحًا من 3 أحرف على الأقل.'); return }
    setMessage('')
    setPendingAction(action)
  }

  const perform = async () => {
    if (!pendingAction || busy || inFlight.current) return
    if (reason.trim().length < 3) { setMessage('اكتب سببًا واضحًا من 3 أحرف على الأقل.'); setPendingAction(null); return }
    const action = pendingAction
    inFlight.current = true
    setBusy(true); setMessage('')
    try {
      if (action.kind === 'reassign') await adminReassignBooking(booking.id, action.providerId, reason)
      else if (action.kind === 'unassign') await adminUnassignBooking(booking.id, reason)
      else await adminCancelBooking(booking.id, reason)
      await onComplete()
      setMessage(action.kind === 'reassign' ? 'تم تغيير إسناد الطلب وأُبلغ الأطراف.' : action.kind === 'unassign' ? 'أُعيد الطلب إلى قائمة الإسناد.' : 'أُغلق الطلب وسُجل السبب وأُبلغ الأطراف.')
      setReason(''); setProviderId(''); setPendingAction(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تحديث الطلب.')
      setPendingAction(null)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const confirmDetails = pendingAction?.kind === 'reassign'
    ? `سيُنقل الطلب رقم ${booking.booking_number ?? ''} إلى الفني ${pendingAction.providerName}، وسيُحفظ السبب ويُبلغ الأطراف.`
    : pendingAction?.kind === 'unassign'
      ? `سيُفك إسناد الطلب رقم ${booking.booking_number ?? ''} ويعود إلى قائمة الإسناد، مع حفظ السبب وإبلاغ الأطراف.`
      : `سيُلغى الطلب رقم ${booking.booking_number ?? ''} ويُحفظ السبب ويُبلغ العميل والفني. لن يمكن التراجع عن هذا الإجراء من هذه النافذة.`

  return <div className="admin-booking-actions">
    <button type="button" className="button button-secondary button-small" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>إدارة الحالة</button>
    {expanded && <div className="admin-booking-actions-form">
      <label className="field-label">سبب الإجراء<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="سبب الإلغاء أو تغيير الإسناد" /></label>
      {booking.provider_id && <><p className="muted">يمكن تعديل الإسناد ما دام التنفيذ لم يبدأ.</p><label className="field-label">فني بديل<select value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">اختر فنيًا مطابقًا</option>{candidates.map((provider) => <option key={provider.user_id} value={provider.user_id}>{provider.profiles?.full_name ?? 'فني'}</option>)}</select></label><button type="button" className="button button-primary button-small" disabled={busy || parentBusy || !providerId || reason.trim().length < 3} onClick={() => requestAction({ kind: 'reassign', providerId, providerName: candidates.find((provider) => provider.user_id === providerId)?.profiles?.full_name ?? 'الفني المختار' })}><RotateCw size={14} /> إعادة الإسناد</button><button type="button" className="button button-secondary button-small" disabled={busy || parentBusy || reason.trim().length < 3} onClick={() => requestAction({ kind: 'unassign' })}><Unlink size={14} /> فك الإسناد</button></>}
      <button type="button" className="button button-danger button-small" disabled={busy || parentBusy || reason.trim().length < 3} onClick={() => requestAction({ kind: 'cancel' })}><Ban size={14} /> إلغاء الطلب</button>
      {message && <div className={message.startsWith('تعذر') || message.startsWith('اكتب') ? 'inline-error' : 'success-note'} role="status">{message.startsWith('تعذر') || message.startsWith('اكتب') ? <X size={15} /> : <Check size={15} />}{message}</div>}
    </div>}
    <ActionConfirmDialog open={pendingAction !== null} title={pendingAction?.kind === 'cancel' ? 'تأكيد إلغاء الطلب' : pendingAction?.kind === 'unassign' ? 'تأكيد فك الإسناد' : 'تأكيد إعادة الإسناد'} description={confirmDetails} confirmLabel={pendingAction?.kind === 'cancel' ? 'إلغاء الطلب' : pendingAction?.kind === 'unassign' ? 'فك الإسناد' : 'تأكيد الإسناد'} busy={busy} onCancel={() => setPendingAction(null)} onConfirm={perform} />
  </div>
}
