import type { ReactNode } from 'react'
import { Check, Clock3, RefreshCw, Search, Truck, Wrench } from 'lucide-react'

type Props = {
  role: 'customer' | 'provider' | 'admin'
  items: any[]
  loading?: boolean
  title?: string
  description?: string
  error?: string
  onRefresh?: () => void
  children: ReactNode
}

const statusLabels: Record<string, string> = { pending: 'قيد المراجعة', assigned: 'مسند', on_the_way: 'في الطريق', arrived: 'وصل', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى', quoted: 'عرض سعر', accepted: 'مقبول' }
const roles = { customer: { title: 'مركز طلباتك', description: 'تابع الحالة والصور والمحادثة والفاتورة من مكان واحد.', icon: Search }, provider: { title: 'مركز أعمالك', description: 'استقبل الطلبات المسندة، حدّث الحالة، وتابع تفاصيل العميل.', icon: Wrench }, admin: { title: 'مركز التشغيل', description: 'راجع الطلبات، الصور، الإسناد، الدفع، والمحادثة من شاشة موحدة.', icon: Truck } }

export function UnifiedOrdersCenter({ role, items, loading = false, title, description, error, onRefresh, children }: Props) {
  const config = roles[role]
  const counts = items.reduce<Record<string, number>>((result, item) => { result[item.status] = (result[item.status] ?? 0) + 1; return result }, {})
  const active = items.filter((item) => !['completed', 'cancelled'].includes(item.status)).length
  const completed = counts.completed ?? 0
  const Icon = config.icon
  return <div className="unified-orders-center" data-role={role}>
    <section className="panel unified-orders-header" aria-label="مركز الطلبات الموحد">
      <div className="unified-orders-heading"><span className="unified-orders-icon"><Icon size={21} /></span><div><span className="eyebrow">مركز الطلبات الموحد</span><h2>{title ?? config.title}</h2><p className="muted">{description ?? config.description}</p></div></div>
      <div className="unified-orders-actions">{onRefresh && <button type="button" className="button button-secondary button-small" onClick={onRefresh} disabled={loading}><RefreshCw size={15} /> {loading ? 'جارٍ التحديث…' : 'تحديث'}</button>}</div>
      <div className="unified-orders-metrics"><div><strong>{items.length}</strong><span>كل الطلبات</span></div><div><strong>{active}</strong><span>طلبات نشطة</span></div><div><strong>{completed}</strong><span>مكتملة</span></div></div>
      <div className="unified-orders-statuses" aria-label="ملخص حالات الطلبات">{Object.entries(counts).map(([status, count]) => <span className="status-pill" key={status}><span>{statusLabels[status] ?? status}</span> {count}</span>)}</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </section>
    {loading ? <div className="panel loading-state" role="status">جارٍ تحميل الطلبات…</div> : children}
  </div>
}

export function UnifiedOrderStatusLegend() {
  return <div className="unified-order-legend"><span><Clock3 size={14} /> قيد التنفيذ</span><span><Truck size={14} /> في الطريق</span><span><Check size={14} /> مكتمل</span></div>
}
