import { useEffect, useState } from 'react'
import { Check, Download, FileText, Percent, ShieldCheck, X } from 'lucide-react'
import { getAdminDocumentUrl } from '../lib/supabase'
import { InlineDocumentViewer } from './InlineDocumentViewer'

type Props = {
  application: any
  busy?: boolean
  onClose: () => void
  onReview: (status: 'approved' | 'rejected') => void
  onCommission: (value: string) => void
}

const labels: Record<string, string> = { identity_front: 'وجه الهوية', identity_back: 'ظهر الهوية', national_id: 'الهوية الوطنية', cv: 'السيرة الذاتية', license: 'الرخصة المهنية', certificate: 'الشهادة المهنية' }

export function AdminProviderApplicationModal({ application, busy = false, onClose, onReview, onCommission }: Props) {
  const [links, setLinks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [commission, setCommission] = useState(String(application.default_commission_rate ?? ''))
  const [preview, setPreview] = useState<{ url: string; title: string; filePath: string } | null>(null)
  const profile = Array.isArray(application.profiles) ? application.profiles[0] : application.profiles
  const documents = (application.provider_documents ?? []).filter((doc: any) => doc.is_current !== false)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true); setError('')
      try {
        const entries = await Promise.all(documents.map(async (doc: any) => [doc.id, await getAdminDocumentUrl(doc.document_type, doc.storage_path)] as const))
        if (active) setLinks(Object.fromEntries(entries))
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'تعذر إنشاء روابط المستندات.') }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [application.user_id])

  return <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="admin-provider-modal" role="dialog" aria-modal="true" aria-label="تفاصيل طلب اعتماد الفني">
      <header className="admin-provider-modal-header"><div><span className="eyebrow"><ShieldCheck size={14} /> طلب اعتماد فني</span><h2>{profile?.full_name ?? 'فني بدون اسم'}</h2><p>{profile?.email ?? application.email ?? 'بدون بريد'} · {profile?.phone ?? application.phone ?? 'بدون جوال'}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={20} /></button></header>
      <div className="admin-provider-modal-body">
        <div className="provider-modal-grid"><div className="provider-modal-facts"><div><span>المدينة</span><strong>{profile?.city ?? 'غير مسجلة'}</strong></div><div><span>سنوات الخبرة</span><strong>{application.years_experience ?? 0}</strong></div><div><span>الحالة</span><strong>{application.approval_status ?? 'pending'}</strong></div><div><span>العمولة الحالية</span><strong>{application.default_commission_rate ?? 0}%</strong></div></div><div className="provider-modal-bio"><h3>النبذة ومجالات العمل</h3><p>{application.service_description ?? application.professional_bio ?? 'لا توجد نبذة مهنية مسجلة.'}</p><h3>التخصصات</h3><p>{(application.provider_services ?? []).filter((item: any) => item.is_active).map((item: any) => item.services?.name_ar).filter(Boolean).join('، ') || 'لا توجد تخصصات مسجلة'}</p></div></div>
        <section className="provider-modal-section"><div className="section-heading-inline"><h3><FileText size={17} /> مستندات الاعتماد</h3><span className="status-pill">{documents.length} مستند</span></div>{loading ? <p className="muted">جارٍ تجهيز روابط المستندات الآمنة…</p> : error ? <div className="inline-error">{error}</div> : documents.length ? <div className="provider-modal-documents">{documents.map((doc: any) => <div className="provider-modal-document" key={doc.id}><FileText size={18} /><div><strong>{labels[doc.document_type] ?? 'مستند'}</strong><small>{doc.status ?? 'قيد المراجعة'}</small></div>{links[doc.id] ? <span className="document-actions"><button type="button" className="button button-secondary button-small" onClick={() => setPreview({ url: links[doc.id], title: labels[doc.document_type] ?? 'مستند', filePath: doc.storage_path })}>عرض</button><a className="button button-secondary button-small" href={links[doc.id]} download><Download size={14} />تحميل</a></span> : <small>غير متاح</small>}</div>)}</div> : <p className="muted">لم يرفع الفني مستندات حتى الآن.</p>}</section>
        <section className="provider-modal-section"><h3><Percent size={17} /> عمولة الفني</h3><div className="provider-commission-editor"><input type="number" min="0" max="100" step="0.01" value={commission} onChange={(event) => setCommission(event.target.value)} placeholder="نسبة العمولة" /><button type="button" className="button button-secondary button-small" onClick={() => onCommission(commission)} disabled={busy || !commission}>حفظ العمولة</button></div></section>
      </div>
      <footer className="admin-provider-modal-footer"><button type="button" className="button button-primary" onClick={() => onReview('approved')} disabled={busy || application.approval_status === 'approved'}><Check size={16} /> اعتماد الفني</button><button type="button" className="button button-danger" onClick={() => onReview('rejected')} disabled={busy || application.approval_status === 'rejected'}>رفض وإلغاء الطلب</button><button type="button" className="button button-secondary" onClick={onClose}>إغلاق</button></footer>
    </section>
    {preview && <InlineDocumentViewer {...preview} onClose={() => setPreview(null)} />}
  </div>
}
