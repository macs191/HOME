import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { getAdminAuditLogs, type AdminAuditLog } from '../lib/supabase'

const actionLabels: Record<string, string> = {
  row_insert: 'إنشاء سجل',
  row_update: 'تعديل سجل',
  row_delete: 'حذف سجل',
  provider_onboarding_submitted: 'إرسال طلب اعتماد فني',
  admin_provider_specialties_updated: 'تعديل تخصصات فني',
  admin_account_updated: 'تعديل حساب',
  admin_account_activated: 'تفعيل حساب',
  admin_account_deactivated: 'إيقاف حساب',
  admin_account_deleted: 'حذف حساب',
}
const entityLabels: Record<string, string> = {
  bookings: 'طلب خدمة',
  services: 'خدمة',
  products: 'منتج',
  coupons: 'قسيمة',
  profiles: 'حساب',
  provider_profiles: 'ملف فني',
  provider_documents: 'مستند اعتماد',
  payments: 'سجل مالي',
  booking_quotes: 'عرض سعر',
  product_orders: 'طلب متجر',
  product_order_refunds: 'استرداد متجر',
  provider_ledger_entries: 'قيد مستحقات',
}

export function AdminAuditPanel() {
  const [rows, setRows] = useState<AdminAuditLog[]>([])
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadedCount, setLoadedCount] = useState(0)
  const [error, setError] = useState('')

  const load = async (dateFrom = appliedFrom, dateTo = appliedTo, append = false) => {
    const offset = append ? loadedCount : 0
    setLoading(true)
    setError('')
    try {
      const page = await getAdminAuditLogs({ from: dateFrom || undefined, to: dateTo || undefined, offset, limit: 50 })
      setRows((current) => append ? [...current, ...page.rows.filter((row) => !current.some((item) => item.id === row.id))] : page.rows)
      setLoadedCount(offset + page.rows.length)
      setHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تحميل سجل التدقيق.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load('', '') }, [])

  const visibleRows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return rows
    return rows.filter((row) => [row.action, row.entity_type, row.entity_id, row.actor?.full_name]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(term))
  }, [query, rows])

  const submitFilters = (event: React.FormEvent) => {
    event.preventDefault()
    if (from && to && from > to) {
      setError('تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه.')
      return
    }
    setAppliedFrom(from)
    setAppliedTo(to)
    void load(from, to)
  }

  const describeChanges = (row: AdminAuditLog) => {
    const changes = row.metadata?.changes
    if (!changes || typeof changes !== 'object') return row.metadata?.source === 'database_trigger' ? 'تغيير مسجل من قاعدة البيانات' : '—'
    return Object.entries(changes).map(([key, values]) => {
      const value = values as { before?: unknown; after?: unknown }
      return `${key}: ${value.before == null ? '—' : String(value.before)} ← ${value.after == null ? '—' : String(value.after)}`
    }).join(' · ')
  }

  return <section className="panel admin-audit-panel">
      <div className="panel-heading"><div><span className="eyebrow">الحوكمة والشفافية</span><h2>سجل التدقيق</h2><p className="muted">يعرض السجل على دفعات. لا تُعرض بيانات العناوين أو الهوية أو محتوى المحادثة.</p></div>
      <button type="button" className="button button-secondary button-small" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> تحديث</button>
    </div>
    <form className="booking-filters admin-audit-filters" onSubmit={submitFilters}>
      <label className="accounts-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالإجراء أو نوع السجل أو المعرّف أو الفاعل" /></label>
      <label className="field-label">من<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="field-label">إلى<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button type="submit" className="button button-primary button-small" disabled={loading}>تطبيق التصفية</button>
    </form>
    {error && <div className="inline-error" role="alert">{error}<button type="button" className="message-retry" onClick={() => void load()}>إعادة المحاولة</button></div>}
    {loading && !rows.length ? <div className="loading-state">جارٍ تحميل سجل التدقيق…</div> : visibleRows.length ? <>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table"><thead><tr><th>الوقت</th><th>الفاعل</th><th>الإجراء</th><th>نوع السجل</th><th>المعرّف</th><th>تفاصيل التغيير</th></tr></thead><tbody>
        {visibleRows.map((row) => <tr key={row.id}><td><time dateTime={row.created_at}>{new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.created_at))}</time></td><td>{row.actor?.full_name ?? (row.actor_id ? 'مستخدم' : 'النظام')}</td><td>{actionLabels[row.action] ?? row.action}</td><td>{entityLabels[row.entity_type] ?? row.entity_type}</td><td><code>{row.entity_id ?? '—'}</code></td><td>{describeChanges(row)}</td></tr>)}
      </tbody></table></div>
      <p className="muted admin-audit-count">{visibleRows.length} سجل ظاهر ضمن {rows.length} سجل محمّل.</p>
      {hasMore && <button type="button" className="button button-secondary button-small" onClick={() => void load(appliedFrom, appliedTo, true)} disabled={loading}>{loading ? 'جارٍ التحميل…' : 'تحميل المزيد'}</button>}
    </> : <p className="empty-inline">لا توجد أحداث تطابق عوامل التصفية.</p>}
  </section>
}
