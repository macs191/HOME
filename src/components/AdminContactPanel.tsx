import { Headphones, Phone } from 'lucide-react'
import { VoiceCall } from './VoiceCall'

type Props = { bookingId?: string; compact?: boolean }

export function AdminContactPanel({ bookingId, compact = false }: Props) {
  return <section className={`panel admin-contact-panel${compact ? ' admin-contact-panel-compact' : ''}`}>
    <div className="admin-contact-copy"><span className="admin-contact-icon"><Headphones size={19} /></span><div><span className="eyebrow">دعم مباشر</span><h2>التواصل مع الإدارة</h2><p className="muted">اتصل بالإدارة صوتيًا بخصوص الطلب الحالي دون مشاركة رقمك الشخصي.</p></div></div>
    {bookingId ? <VoiceCall bookingId={bookingId} targetRole="admin" /> : <div className="admin-contact-unavailable"><Phone size={16} /><span>يظهر زر الاتصال عند وجود طلب مفتوح مرتبط بحسابك.</span></div>}
  </section>
}
