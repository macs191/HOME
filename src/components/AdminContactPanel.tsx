import { useEffect, useState } from 'react'
import { Headphones, Phone } from 'lucide-react'
import { VoiceCall } from './VoiceCall'
import { getActiveAdminCallParticipants, type BookingCallParticipant } from '../lib/supabase'

type Props = { bookingId?: string; compact?: boolean }

export function AdminContactPanel({ bookingId, compact = false }: Props) {
  const [adminId, setAdminId] = useState('')
  useEffect(() => { let active = true; void getActiveAdminCallParticipants().then(({ data }) => { if (active) setAdminId((data?.[0] as BookingCallParticipant | undefined)?.user_id ?? '') }).catch(() => undefined); return () => { active = false } }, [])
  return <section className={`panel admin-contact-panel${compact ? ' admin-contact-panel-compact' : ''}`}>
    <div className="admin-contact-copy"><span className="admin-contact-icon"><Headphones size={19} /></span><div><span className="eyebrow">دعم مباشر</span><h2>التواصل مع الإدارة</h2><p className="muted">اتصل بالإدارة صوتيًا بخصوص الطلب الحالي دون مشاركة رقمك الشخصي.</p></div></div>
    {adminId ? <VoiceCall directAdminId={adminId} fixedTargetLabel="الاتصال بالإدارة" /> : bookingId ? <VoiceCall bookingId={bookingId} targetRole="admin" fixedTargetLabel="الاتصال بالإدارة" /> : <div className="admin-contact-unavailable"><Phone size={16} /><span>جارٍ تجهيز قناة الاتصال بالإدارة…</span></div>}
  </section>
}
