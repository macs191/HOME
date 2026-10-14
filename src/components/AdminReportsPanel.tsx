import { useState } from 'react'
import { Download, FileText, RefreshCw, WalletCards, X } from 'lucide-react'
import { getAdminOperationalReport } from '../lib/supabase'

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const labels: Record<string, string> = { draft: 'مسودة', pending: 'قيد المراجعة', quoted: 'عرض سعر', accepted: 'مقبول', assigned: 'مسند', on_the_way: 'في الطريق', arrived: 'وصل', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى', disputed: 'قيد المراجعة' }

export function AdminReportsPanel() {
  const today = new Date()
  const start = new Date(today); start.setDate(today.getDate() - 29)
  const [from, setFrom] = useState(localDate(start))
  const [to, setTo] = useState(localDate(today))
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const load = async () => {
    if (!from || !to || from > to) { setMessage('اختر فترة زمنية صحيحة.'); return }
    const startDay = new Date(`${from}T00:00:00`); const endDay = new Date(`${to}T00:00:00`)
    if ((endDay.getTime() - startDay.getTime()) / 86400000 > 365) { setMessage('أقصى نطاق للتقرير 366 يومًا.'); return }
    setLoading(true); setMessage('')
    try { setReport(await getAdminOperationalReport(from, to)) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تحميل التقرير.') }
    finally { setLoading(false) }
  }
  const exportCsv = () => {
    if (!report) return
    const lines: string[][] = [['التاريخ', 'الطلبات', 'المبالغ المحصلة (ر.س)'], ...(report.daily ?? []).map((row: any): string[] => [String(row.date), String(row.bookings), Number(row.paid_amount).toFixed(2)])]
    const csv = '\uFEFF' + lines.map((line) => line.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `home-report-${from}-${to}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  const statusRows = report?.bookings_by_status ?? []
  const maxStatus = Math.max(1, ...statusRows.map((row: any) => Number(row.count)))
  return <div className="admin-report-panel">
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">تقارير موثوقة</span><h2>ملخص التشغيل والتحصيل</h2><p className="muted">تُحسب الأرقام في قاعدة البيانات على كامل السجل؛ اختر فترة لا تتجاوز سنة.</p></div><FileText size={22} /></div><div className="report-filters"><label className="field-label">من تاريخ<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label className="field-label">إلى تاريخ<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><div className="report-actions"><button type="button" className="button button-primary button-small" onClick={() => void load()} disabled={loading}>{loading ? 'جارٍ الحساب…' : <><RefreshCw size={15} /> تحديث التقرير</>}</button>{report && <button type="button" className="button button-secondary button-small" onClick={exportCsv}><Download size={15} /> تصدير CSV</button>}</div></div>{message && <div className="inline-error" role="alert"><X size={15} />{message}</div>}</section>
    {report && <><div className="admin-report-metrics"><div className="metric-card"><span className="muted">الطلبات خلال الفترة</span><strong>{Number(report.bookings_total ?? 0).toLocaleString('ar-SA')}</strong></div><div className="metric-card"><span className="muted">التحصيل المؤكد</span><strong>{Number(report.paid_amount ?? 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })} ر.س</strong></div><div className="metric-card"><span className="muted">الفواتير المحصلة</span><strong>{Number(report.paid_count ?? 0).toLocaleString('ar-SA')}</strong></div><div className="metric-card"><span className="muted">فواتير تحتاج متابعة</span><strong>{Number(report.open_invoices ?? 0).toLocaleString('ar-SA')}</strong></div><div className="metric-card"><span className="muted">عروض قيد المراجعة</span><strong>{Number(report.pending_quotes ?? 0).toLocaleString('ar-SA')}</strong></div></div>
      <div className="admin-report-columns"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">توزيع الحالات</span><h2>حالات الطلبات</h2></div></div>{statusRows.length ? <div className="report-status-list">{statusRows.map((row: any) => <div className="report-status-row" key={row.status}><div><strong>{labels[row.status] ?? row.status}</strong><span>{Number(row.count).toLocaleString('ar-SA')}</span></div><div className="report-progress"><span style={{ width: `${Math.max(4, (Number(row.count) / maxStatus) * 100)}%` }} /></div></div>)}</div> : <p className="muted">لا توجد طلبات ضمن الفترة المحددة.</p>}</section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">يومي</span><h2>النشاط اليومي</h2></div><WalletCards size={21} /></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>التاريخ</th><th>الطلبات</th><th>التحصيل</th></tr></thead><tbody>{(report.daily ?? []).map((row: any) => <tr key={row.date}><td>{row.date}</td><td>{Number(row.bookings).toLocaleString('ar-SA')}</td><td>{Number(row.paid_amount).toFixed(2)} ر.س</td></tr>)}</tbody></table></div></section></div></>}
  </div>
}
