import { Check, Clock3 } from 'lucide-react'

type StatusEvent = { id?: string; from_status?: string | null; to_status?: string | null; note?: string | null; created_at?: string }

type Props = { events?: StatusEvent[] | null }

const labels: Record<string, string> = {
  draft: 'مسودة', pending: 'قيد المراجعة', quoted: 'بانتظار عرض السعر', accepted: 'تم قبول العرض', assigned: 'تم إسناد الفني',
  on_the_way: 'الفني في الطريق', arrived: 'وصل الفني', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى', disputed: 'قيد المراجعة',
}

export function BookingStatusTimeline({ events }: Props) {
  const items = [...(events ?? [])].sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
  if (!items.length) return null
  return <section className="booking-timeline" aria-label="سجل حالة الطلب">
    <div className="booking-timeline-heading"><Clock3 size={15} /><strong>سجل الطلب</strong></div>
    <ol>{items.map((event, index) => <li key={event.id ?? `${event.created_at}-${index}`}>
      <span className="booking-timeline-dot"><Check size={12} /></span>
      <div><strong>{labels[event.to_status ?? ''] ?? event.to_status ?? 'تحديث الطلب'}</strong>{event.note && <p>{event.note}</p>}<time dateTime={event.created_at}>{event.created_at ? new Date(event.created_at).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</time></div>
    </li>)}</ol>
  </section>
}
