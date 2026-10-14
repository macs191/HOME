import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bell, Check, ChevronLeft, FileText, Gauge, Layers3, LogOut, MapPin, Search, Send, Settings2, ShieldCheck, TicketPercent, UsersRound, WalletCards, X } from 'lucide-react'
import { AdminMarketplacePanel } from './AdminMarketplacePanel'
import { AdminAccountsPanel } from './AdminAccountsPanel'
import { AdminBookingActions } from './AdminBookingActions'
import { AdminReportsPanel } from './AdminReportsPanel'
import { BookingAttachmentsPanel } from './BookingAttachmentsPanel'
import { addProviderLedgerEntry, assignBookingToProvider, getAdminDocumentUrl, getAdminOperations, getAdminOverview, getAdminProviderApplications, reviewProviderVerification, setProviderCommission, signOutAccount } from '../lib/supabase'
import { MobileBottomNav } from './MobileBottomNav'
import { NotificationsPanel } from './NotificationsPanel'
import { InlineDocumentViewer } from './InlineDocumentViewer'

type Section = 'overview' | 'operations' | 'reports' | 'accounts' | 'applications' | 'catalog' | 'quotes' | 'payments' | 'settings' | 'notifications'
const navItems: { id: Section; label: string; icon: typeof Gauge }[] = [
  { id: 'overview', label: 'نظرة عامة', icon: Gauge }, { id: 'operations', label: 'الطلبات والإسناد', icon: FileText },
  { id: 'reports', label: 'التقارير', icon: Gauge }, { id: 'accounts', label: 'العملاء والفنيون', icon: UsersRound }, { id: 'applications', label: 'طلبات اعتماد الفنيين', icon: ShieldCheck }, { id: 'catalog', label: 'الأقسام والخدمات', icon: Layers3 },
  { id: 'quotes', label: 'عروض الأسعار', icon: TicketPercent }, { id: 'payments', label: 'الفواتير والتحصيل', icon: WalletCards },
  { id: 'settings', label: 'إعدادات المنصة', icon: Settings2 }, { id: 'notifications', label: 'الإشعارات', icon: Bell },
]
const sectionTitle: Record<Section, string> = { overview: 'نظرة عامة', operations: 'الطلبات والإسناد', reports: 'التقارير', accounts: 'العملاء والفنيون', applications: 'طلبات اعتماد الفنيين', catalog: 'الأقسام والخدمات', quotes: 'عروض الأسعار', payments: 'الفواتير والتحصيل', settings: 'إعدادات المنصة', notifications: 'الإشعارات' }

export function AdminWorkspace() {
  const { section: rawSection } = useParams()
  const section: Section = navItems.some((item) => item.id === rawSection) ? rawSection as Section : 'overview'
  const navigate = useNavigate(); const location = useLocation()
  const [overview, setOverview] = useState<any>(null)
  const [applications, setApplications] = useState<any[]>([])
  const [operations, setOperations] = useState<{ recent: any[]; assignable: any[]; providers: any[] }>({ recent: [], assignable: [], providers: [] })
  const [bookingId, setBookingId] = useState(''); const [providerId, setProviderId] = useState('')
  const [entryType, setEntryType] = useState<'late_penalty'|'adjustment'|'payout'>('late_penalty')
  const [amount, setAmount] = useState(''); const [note, setNote] = useState('')
  const [commissionInputs, setCommissionInputs] = useState<Record<string,string>>({})
  const [message, setMessage] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false)
  const selected = operations.assignable.find((row) => row.id === bookingId)
  const eligibleProviders = useMemo(() => selected ? operations.providers.filter((provider) => provider.profiles?.is_active === true && (provider.provider_services ?? []).some((skill: any) => skill.is_active && skill.service_id === selected.service_id)) : [], [selected, operations.providers])

  const load = async () => {
    setLoading(true); setMessage('')
    try {
      if (section === 'overview') { const [metrics, ops] = await Promise.all([getAdminOverview(), getAdminOperations()]); setOverview(metrics); setOperations(ops) }
      else if (section === 'operations') setOperations(await getAdminOperations())
      else if (section === 'applications') { const result = await getAdminProviderApplications(); if (result.error) throw result.error; setApplications((result.data as any[]) ?? []) }
    } catch (error) { setMessage(`تعذر تحميل ${sectionTitle[section]}: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`); return false }
    finally { setLoading(false) }
    return true
  }
  useEffect(() => { void load() }, [section])
  useEffect(() => { if (!navItems.some((item) => item.id === rawSection)) navigate('/admin/overview', { replace: true }) }, [rawSection, navigate])
  const run = async (action: () => Promise<any>, success: string, reload = true) => {
    setBusy(true); setMessage('')
    try { await action(); const refreshed = reload ? await load() : true; if (refreshed) setMessage(success); return true }
    catch (error) { setMessage(`تعذر إكمال العملية: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`); return false }
    finally { setBusy(false) }
  }
  const assign = () => { if (!bookingId || !providerId) return; void run(() => assignBookingToProvider(bookingId, providerId), 'تم إسناد الطلب للفني.', true).then((saved) => { if (saved) { setBookingId(''); setProviderId('') } }) }
  const addLedger = () => {
    if (!providerId || !Number.isFinite(Number(amount)) || Number(amount) === 0 || !note.trim()) { setMessage('اختر فنيًا، وأدخل مبلغًا غير صفري وسببًا واضحًا.'); return }
    void run(() => addProviderLedgerEntry(providerId, bookingId || null, entryType, Number(amount), note), 'تم حفظ القيد المالي في سجل الفني.', false).then((saved) => { if (saved) { setAmount(''); setNote('') } })
  }
  const review = (id: string, status: 'approved'|'rejected') => void run(() => reviewProviderVerification(id, status), status === 'approved' ? 'تم اعتماد الفني.' : 'تم رفض ملف الفني.', true)
  const saveCommission = (id: string) => {
    const value = commissionInputs[id]
    if (value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) { setMessage('أدخل نسبة عمولة بين 0 و100.'); return }
    void run(() => setProviderCommission(id, Number(value)), 'تم حفظ نسبة عمولة الفني.', true)
  }
  const handleSignout = async () => { setBusy(true); setMessage(''); try { await signOutAccount(); window.location.assign('/') } catch (error) { setMessage(`تعذر تسجيل الخروج: ${error instanceof Error ? error.message : 'حاول مرة أخرى.'}`) } finally { setBusy(false) } }
  const nav = <nav className="dashboard-nav-links" aria-label="أقسام الإدارة">{navItems.map(({ id, label, icon: Icon }) => <Link key={id} to={`/admin/${id}`} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined}><Icon size={17} /><span>{label}</span><ChevronLeft size={15} className="nav-chevron" /></Link>)}</nav>

  return <div className="container dashboard-page admin-workspace"><div className="dashboard-top"><div><span className="eyebrow">إدارة المنصة</span><h1>{sectionTitle[section]}</h1><p className="muted">تحكم مستقل وواضح في كل جزء من تشغيل المنصة.</p></div><div className="dashboard-top-actions"><Link to="/services" className="button button-secondary button-small"><Search size={15} /> معاينة الخدمات</Link><button type="button" className="button button-secondary button-small mobile-admin-signout" onClick={handleSignout}><LogOut size={15} /> تسجيل الخروج</button></div></div>
      <div className="dashboard-shell"><aside className="dashboard-nav"><div className="nav-user"><span className="user-avatar"><ShieldCheck size={18} /></span><div><strong>مدير المنصة</strong><small>إدارة العملاء والخدمات والطلبات</small></div></div>{nav}<div className="nav-bottom"><Link to="/" className="button button-secondary button-wide">العودة للموقع</Link><button type="button" onClick={handleSignout} className="nav-logout"><LogOut size={15} /> تسجيل الخروج</button></div></aside>
      <main className="dashboard-content" key={section}>
        {message && <div className={message.startsWith('تعذر') ? 'inline-error' : 'success-note'} role={message.startsWith('تعذر') ? 'alert' : 'status'}>{message.startsWith('تعذر') ? <X size={16} /> : <Check size={16} />}{message}{message.startsWith('تعذر') && <button type="button" className="message-retry" onClick={() => void load()}>إعادة المحاولة</button>}</div>}
        {loading && ['overview','operations','applications'].includes(section) && <div className="panel loading-state">جارٍ تحميل بيانات {sectionTitle[section]}…</div>}
        {!loading && section === 'overview' && <><div className="admin-metrics">{[
          ['الطلبات المسجلة', String(overview?.bookings ?? 0), FileText], ['الفنيون المعتمدون', String(overview?.approvedProviders ?? 0), UsersRound],
          ['قيمة التحصيل', overview?.paidAmount ? `${Number(overview.paidAmount).toFixed(2)} ر.س` : '—', WalletCards], ['طلبات بلا إسناد', String(operations.assignable.length), Layers3],
        ].map(([label, value, Icon]: any) => <div className="metric-card" key={label}><span className="metric-icon"><Icon size={18} /></span><span className="muted">{label}</span><strong>{value}</strong></div>)}</div>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">آخر النشاط</span><h2>الطلبات الأخيرة</h2></div><Link className="text-link" to="/admin/operations">فتح الطلبات والإسناد <ArrowLeft size={15} /></Link></div>{operations.recent.length ? <div className="booking-list">{operations.recent.map((item) => <article className="booking-row" key={item.id}><div><span className="eyebrow">طلب #{item.booking_number}</span><h3>{item.services?.name_ar ?? 'خدمة منزلية'}</h3><p>{item.profiles?.full_name ?? 'عميل'} · {item.profiles?.phone ?? 'بدون رقم'} · {item.city}</p></div><span className="status-pill">{item.status}</span></article>)}</div> : <p className="empty-inline">لا توجد طلبات حتى الآن.</p>}</section>
          <div className="admin-shortcuts">{navItems.filter((item) => item.id !== 'overview').map(({ id,label,icon:Icon }) => <Link className="admin-shortcut" key={id} to={`/admin/${id}`}><Icon size={18} /><strong>{label}</strong><ChevronLeft size={15} /></Link>)}</div></>}
        {!loading && section === 'operations' && <section className="panel admin-operations"><div className="panel-heading"><div><span className="eyebrow">التشغيل</span><h2>إسناد طلب لفني معتمد</h2><p className="muted">يعرض الاختيار فنيين معتمدين مسجلين بالتخصص المطابق فقط.</p></div></div>
          <div className="field-grid"><label className="field-label">الطلب<select value={bookingId} onChange={(e) => { setBookingId(e.target.value); setProviderId('') }}><option value="">اختر طلبًا غير مسند</option>{operations.assignable.map((row) => <option key={row.id} value={row.id}>#{row.booking_number} · {row.services?.name_ar ?? 'خدمة'} · {row.city}</option>)}</select></label><label className="field-label">الفني المطابق<select value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={!bookingId}><option value="">اختر فنيًا</option>{eligibleProviders.map((row) => <option key={row.user_id} value={row.user_id}>{row.profiles?.full_name ?? 'فني'}</option>)}</select></label></div>
          <button type="button" className="button button-primary" onClick={assign} disabled={busy || !bookingId || !providerId}><Send size={15} /> إسناد الطلب</button>{bookingId && !eligibleProviders.length && <div className="inline-error">لا يوجد فني معتمد بهذا التخصص حاليًا.</div>}
          <div className="admin-assignable-list">{operations.assignable.map((row) => <article className="admin-assignable-row" key={row.id}><div><strong>#{row.booking_number} · {row.services?.name_ar ?? 'خدمة'}</strong><small>{row.profiles?.full_name ?? 'عميل'} · {row.profiles?.phone ?? 'بدون رقم'}</small><small>{[row.address_text,row.district,row.city].filter(Boolean).join(' · ')}</small><p>{row.issue_description}</p><BookingAttachmentsPanel bookingId={row.id} attachments={row.attachments ?? row.booking_attachments ?? []} canUpload={false} /></div><div><a className="text-link" target="_blank" rel="noreferrer" href={row.latitude != null && row.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${row.latitude},${row.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([row.address_text,row.district,row.city].filter(Boolean).join(' '))}`}><MapPin size={15} /> فتح الموقع</a><AdminBookingActions booking={row} providers={operations.providers} busy={busy} onComplete={load} /></div></article>)}</div>
          <div className="admin-recent-operations"><h2>الطلبات المسندة والحديثة</h2><p className="muted">يمكنك تعديل الإسناد أو إغلاق الطلب مع حفظ السبب. تبقى صور الطلب داخل الصفحة.</p>{operations.recent.map((row) => <article className="admin-recent-row" key={row.id}><div><strong>#{row.booking_number} · {row.services?.name_ar ?? 'خدمة'}</strong><small>{row.profiles?.full_name ?? 'عميل'} · الحالة: {row.status}</small><BookingAttachmentsPanel bookingId={row.id} attachments={row.attachments ?? row.booking_attachments ?? []} canUpload={false} /></div><AdminBookingActions booking={row} providers={operations.providers} busy={busy} onComplete={load} /></article>)}</div>
          <hr /><h2>تسوية رصيد فني</h2><p className="muted">الأجور النظامية فقط؛ أدخل المبلغ الموجب، وتُخصم غرامة التأخير أو يُسجل الصرف آليًا من النظام.</p><div className="field-grid"><label className="field-label">الفني<select value={providerId} onChange={(e) => setProviderId(e.target.value)}><option value="">اختر فنيًا معتمدًا</option>{operations.providers.map((row) => <option key={row.user_id} value={row.user_id}>{row.profiles?.full_name ?? 'فني'}</option>)}</select></label><label className="field-label">نوع القيد<select value={entryType} onChange={(e) => setEntryType(e.target.value as typeof entryType)}><option value="late_penalty">خصم تأخير</option><option value="adjustment">تسوية نظامية</option><option value="payout">صرف مستحق</option></select></label></div><div className="field-grid"><label className="field-label">المبلغ الموجب<input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label className="field-label">السبب<input value={note} onChange={(e) => setNote(e.target.value)} /></label></div><button type="button" className="button button-secondary" onClick={addLedger} disabled={busy || !providerId || !amount || !note.trim()}><WalletCards size={15} /> حفظ القيد المالي</button>
        </section>}
        {!loading && section === 'applications' && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">الفريق</span><h2>طلبات اعتماد الفنيين</h2><p className="muted">راجع التخصص والخبرة والهوية والسيرة الذاتية قبل تفعيل الإسناد.</p></div><span className="status-pill">{applications.length} ملفات</span></div>{applications.length ? <div className="provider-applications">{applications.map((item) => <article className="application-row" key={item.user_id}><div><strong>{item.profiles?.full_name ?? 'فني بدون اسم'}</strong><small>{item.profiles?.phone ?? 'لا يوجد جوال'} · {item.profiles?.city ?? 'المدينة غير مسجلة'} · {item.approval_status} · {item.years_experience ?? 0} سنوات خبرة</small><small>{(item.provider_services ?? []).filter((x: any) => x.is_active).map((x: any) => x.services?.name_ar).filter(Boolean).join('، ') || 'لا توجد تخصصات مسجلة'}</small><p className="application-bio">{item.service_description ?? item.professional_bio ?? 'لا توجد نبذة مهنية.'}</p><ProviderApplicationDocuments documents={item.provider_documents ?? []} /></div><div className="application-actions"><span className="status-pill">{item.provider_documents?.find((document: any) => document.is_current !== false)?.status ?? 'بدون مستند'}</span><label className="commission-control">العمولة %<input type="number" min="0" max="100" step="0.01" value={commissionInputs[item.user_id] ?? item.default_commission_rate ?? ''} onChange={(e) => setCommissionInputs({ ...commissionInputs, [item.user_id]: e.target.value })} placeholder="الافتراضي" /></label><button type="button" className="button button-secondary button-small" disabled={busy || commissionInputs[item.user_id] == null || commissionInputs[item.user_id] === ''} onClick={() => saveCommission(item.user_id)}>حفظ العمولة</button>{item.approval_status === 'pending' && <><button type="button" className="button button-primary button-small" disabled={busy} onClick={() => review(item.user_id,'approved')}>اعتماد</button><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => review(item.user_id,'rejected')}>رفض</button></>}</div></article>)}</div> : <p className="empty-inline">لا توجد طلبات اعتماد بانتظار المراجعة.</p>}</section>}
        {!loading && section === 'accounts' && <AdminAccountsPanel />}
        {section === 'notifications' && <NotificationsPanel />}
        {!loading && section === 'reports' && <AdminReportsPanel />}
        {['catalog','quotes','payments','settings'].includes(section) && <AdminMarketplacePanel section={section as 'catalog'|'quotes'|'payments'|'settings'} />}
      </main>
    </div>
    <MobileBottomNav items={navItems.filter(({ id }) => !['reports','applications','catalog','quotes','payments','settings','notifications'].includes(id)).map(({ id, label, icon }) => ({ to: `/admin/${id}`, label: id === 'overview' ? 'الرئيسية' : 'الطلبات', icon }))} activePath={location.pathname} />
  </div>
}

function ProviderApplicationDocuments({ documents }: { documents: Array<{ id: string; document_type: string; storage_path: string; is_current?: boolean }> }) {
  const [open, setOpen] = useState(false)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [links, setLinks] = useState<Record<string, { preview: string; download: string }>>({})
  const [error, setError] = useState('')
  const [activeDocument, setActiveDocument] = useState<{ url: string; title: string; filePath: string } | null>(null)
  const current = documents.filter((document) => document.is_current !== false)
  const labels: Record<string, string> = { identity_front: 'وجه الهوية', identity_back: 'ظهر الهوية', national_id: 'الهوية', cv: 'السيرة الذاتية', license: 'الرخصة المهنية', certificate: 'الشهادة المهنية' }
  const toggle = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (loaded || !current.length) return
    setLoadingDocs(true); setError('')
    try {
      const pairs = await Promise.all(current.map(async (document) => {
        const [preview, download] = await Promise.all([getAdminDocumentUrl(document.document_type, document.storage_path), getAdminDocumentUrl(document.document_type, document.storage_path, true)])
        return [document.id, { preview, download }] as const
      }))
      setLinks(Object.fromEntries(pairs)); setLoaded(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر فتح مستندات الفني.') }
    finally { setLoadingDocs(false) }
  }
  return <div className="application-documents"><button type="button" className="button button-secondary button-small" aria-expanded={open} onClick={() => void toggle()}>{open ? 'إخفاء مستندات الاعتماد' : `عرض مستندات الاعتماد (${current.length})`}</button>{open && <div className="application-document-list">{loadingDocs ? <small>جارٍ إنشاء روابط آمنة للملفات…</small> : error ? <small className="inline-error">{error}</small> : current.length ? current.map((document) => <div className="application-document" key={document.id}><span>{labels[document.document_type] ?? 'مستند'}</span>{links[document.id] && <span className="application-document-links"><button type="button" onClick={() => setActiveDocument({ url: links[document.id].preview, title: labels[document.document_type] ?? 'مستند', filePath: document.storage_path })}>عرض داخل الصفحة</button><a href={links[document.id].download}>تنزيل</a></span>}</div>) : <small>لم تُرفع مستندات اعتماد لهذا الفني.</small>}</div>}{activeDocument && <InlineDocumentViewer {...activeDocument} onClose={() => setActiveDocument(null)} />}</div>
}
