import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bell, Check, ChevronLeft, FilePlus, FileText, Gauge, Layers3, LogOut, MapPin, Navigation, Search, ShoppingBag, Send, Settings2, ShieldCheck, TicketPercent, TrendingUp, UsersRound, WalletCards, X, ClipboardList } from 'lucide-react'
import { AdminMarketplacePanel } from './AdminMarketplacePanel'
import { AdminProductsPanel } from './AdminProductsPanel'
import { AdminManualBookingPanel } from './AdminManualBookingPanel'
import { AdminAccountsPanel } from './AdminAccountsPanel'
import { AdminBookingDetailsModal } from './AdminBookingDetailsModal'
import { AdminAutoAssignmentReviewPanel } from './AdminAutoAssignmentReviewPanel'
import { AdminReportsPanel } from './AdminReportsPanel'
import { addProviderLedgerEntry, assignBookingToProvider, autoAssignBookingToNearestProvider, getAdminDocumentUrl, getAdminOperations, getAdminOverview, getAdminProviderApplications, reviewProviderVerification, setProviderCommission, signOutAccount, subscribeToAdminChanges } from '../lib/supabase'
import { NotificationsPanel } from './NotificationsPanel'
import { InlineDocumentViewer } from './InlineDocumentViewer'
import { AdminAuditPanel } from './AdminAuditPanel'
import { AdminAISettingsPanel } from './AdminAISettingsPanel'
import { ActionConfirmDialog } from './ActionConfirmDialog'
import { playNotificationChime } from './NotificationsPanel'

type Section = 'overview' | 'new-order' | 'operations' | 'reports' | 'accounts' | 'applications' | 'catalog' | 'products' | 'quotes' | 'payments' | 'settings' | 'notifications' | 'audit'
const navItems: { id: Section; label: string; icon: typeof Gauge }[] = [
  { id: 'overview', label: 'نظرة عامة', icon: Gauge }, { id: 'new-order', label: 'إضافة طلب', icon: FilePlus }, { id: 'operations', label: 'الطلبات والإسناد', icon: FileText },
  { id: 'reports', label: 'التقارير', icon: TrendingUp }, { id: 'accounts', label: 'العملاء والفنيون', icon: UsersRound }, { id: 'applications', label: 'طلبات اعتماد الفنيين', icon: ShieldCheck }, { id: 'catalog', label: 'الأقسام والخدمات', icon: Layers3 }, { id: 'products', label: 'متجر المنتجات', icon: ShoppingBag },
  { id: 'quotes', label: 'عروض الأسعار', icon: TicketPercent }, { id: 'payments', label: 'الفواتير والتحصيل', icon: WalletCards },
  { id: 'settings', label: 'إعدادات المنصة', icon: Settings2 }, { id: 'notifications', label: 'الإشعارات', icon: Bell }, { id: 'audit', label: 'سجل التدقيق', icon: ClipboardList },
]
const sectionTitle: Record<Section, string> = { overview: 'نظرة عامة', 'new-order': 'إضافة طلب', operations: 'الطلبات والإسناد', reports: 'التقارير', accounts: 'العملاء والفنيون', applications: 'طلبات اعتماد الفنيين', catalog: 'الأقسام والخدمات', products: 'متجر المنتجات', quotes: 'عروض الأسعار', payments: 'الفواتير والتحصيل', settings: 'إعدادات المنصة', notifications: 'الإشعارات', audit: 'سجل التدقيق' }

export function AdminWorkspace() {
  const { section: rawSection } = useParams()
  const [searchParams] = useSearchParams()
  const section: Section = navItems.some((item) => item.id === rawSection) ? rawSection as Section : 'overview'
  const navigate = useNavigate(); const location = useLocation()
  const [overview, setOverview] = useState<any>(null)
  const [applications, setApplications] = useState<any[]>([])
  const [operations, setOperations] = useState<{ recent: any[]; assignable: any[]; providers: any[]; autoReview: any[]; autoReviewOffset: number; autoReviewHasMore: boolean }>({ recent: [], assignable: [], providers: [], autoReview: [], autoReviewOffset: 0, autoReviewHasMore: false })
  const [bookingId, setBookingId] = useState(''); const [providerId, setProviderId] = useState('')
  const [pendingAssignment, setPendingAssignment] = useState<{ kind: 'manual'; bookingId: string; bookingNumber: number | string; providerId: string; providerName: string } | { kind: 'auto'; bookingId: string; bookingNumber: number | string } | null>(null)
  const [operationsView, setOperationsView] = useState<'review' | 'manage'>('manage')
  const [entryType, setEntryType] = useState<'late_penalty'|'adjustment'|'payout'>('late_penalty')
  const [amount, setAmount] = useState(''); const [note, setNote] = useState('')
  const [commissionInputs, setCommissionInputs] = useState<Record<string,string>>({})
  const [message, setMessage] = useState(''); const [operationsQuery, setOperationsQuery] = useState(''); const [operationsStatus, setOperationsStatus] = useState('all'); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false)
  const [liveAlerts, setLiveAlerts] = useState({ bookings: 0, product_orders: 0, products: 0, provider_profiles: 0, notifications: 0 })
  const [detailBooking, setDetailBooking] = useState<any | null>(null)
  useEffect(() => { if (section === 'operations') { const requested = searchParams.get('booking'); if (requested) setBookingId(requested) } }, [section, searchParams])
  useEffect(() => {
    if (section !== 'operations') { setDetailBooking(null); return }
    const requested = searchParams.get('booking')
    if (!requested) return
    const found = [...operations.assignable, ...operations.recent].find((row) => row.id === requested)
    if (found) setDetailBooking(found)
  }, [section, searchParams, operations.assignable, operations.recent])
  const filterOperations = (rows: any[]) => rows.filter((row) => { const customer = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; const haystack = [row.booking_number, row.services?.name_ar, customer?.full_name, customer?.phone, row.city, row.district, row.issue_description].filter(Boolean).join(' ').toLowerCase(); return (!operationsQuery.trim() || haystack.includes(operationsQuery.trim().toLowerCase())) && (operationsStatus === 'all' || row.status === operationsStatus) })
  const filteredAssignable = useMemo(() => filterOperations(operations.assignable), [operations.assignable, operationsQuery, operationsStatus])
  const filteredRecent = useMemo(() => filterOperations(operations.recent), [operations.recent, operationsQuery, operationsStatus])
  const selected = operations.assignable.find((row) => row.id === bookingId)
  const eligibleProviders = useMemo(() => selected ? operations.providers.filter((provider) => provider.profiles?.is_active === true && (provider.provider_services ?? []).some((skill: any) => skill.is_active && skill.service_id === selected.service_id)) : [], [selected, operations.providers])

  const load = async () => {
    setLoading(true); setMessage('')
    try {
      if (section === 'overview') { const [metrics, ops] = await Promise.all([getAdminOverview(), getAdminOperations(false)]); setOverview(metrics); setOperations(ops) }
      else if (section === 'operations') setOperations(await getAdminOperations())
      else if (section === 'applications') { const result = await getAdminProviderApplications(); if (result.error) throw result.error; setApplications((result.data as any[]) ?? []) }
    } catch (error) { setMessage(`تعذر تحميل ${sectionTitle[section]}: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`); return false }
    finally { setLoading(false) }
    return true
  }
  useEffect(() => { void load() }, [section])
  useEffect(() => {
    let active = true
    let refreshTimer: number | undefined
    let unsubscribe: (() => void) | undefined
    void subscribeToAdminChanges((table) => {
      if (!active) return
      setLiveAlerts((current) => ({ ...current, [table]: current[table] + 1 }))
      playNotificationChime()
      window.dispatchEvent(new CustomEvent('homefix:admin-data-changed', { detail: { table } }))
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => { void load() }, 450)
    }).then((cleanup) => { if (active) unsubscribe = cleanup; else cleanup() })
    return () => { active = false; window.clearTimeout(refreshTimer); unsubscribe?.() }
  }, [section])
  useEffect(() => { if (!navItems.some((item) => item.id === rawSection)) navigate('/admin/overview', { replace: true }) }, [rawSection, navigate])
  const run = async (action: () => Promise<any>, success: string, reload = true) => {
    setBusy(true); setMessage('')
    try { await action(); const refreshed = reload ? await load() : true; if (refreshed) setMessage(success); return true }
    catch (error) { setMessage(`تعذر إكمال العملية: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`); return false }
    finally { setBusy(false) }
  }
  const loadOlderAutoReviews = async () => {
    if (busy || loading || !operations.autoReviewHasMore) return
    setBusy(true); setMessage('')
    try {
      const page = await getAdminOperations(true, operations.autoReviewOffset + 100)
      setOperations((current) => ({ ...current, autoReview: [...current.autoReview, ...page.autoReview].sort((a, b) => new Date(a.updated_at ?? a.created_at ?? 0).getTime() - new Date(b.updated_at ?? b.created_at ?? 0).getTime()), autoReviewOffset: page.autoReviewOffset, autoReviewHasMore: page.autoReviewHasMore }))
    } catch (error) { setMessage(`تعذر تحميل إسنادات أقدم: ${error instanceof Error ? error.message : 'حاول مرة أخرى.'}`) }
    finally { setBusy(false) }
  }
  const assign = () => { if (!bookingId || !providerId || !selected) return; const chosen = eligibleProviders.find((provider) => provider.user_id === providerId); if (!chosen) return; setPendingAssignment({ kind: 'manual', bookingId, bookingNumber: selected.booking_number, providerId, providerName: chosen.profiles?.full_name ?? 'الفني المختار' }) }
  const autoAssign = () => { if (!bookingId || !selected) return; setPendingAssignment({ kind: 'auto', bookingId, bookingNumber: selected.booking_number }) }
  const confirmAssignment = async () => {
    if (!pendingAssignment || busy) return
    const action = pendingAssignment
    const saved = await run(
      () => action.kind === 'manual' ? assignBookingToProvider(action.bookingId, action.providerId) : autoAssignBookingToNearestProvider(action.bookingId),
      action.kind === 'manual' ? `تم إسناد الطلب إلى ${action.providerName}.` : 'تم تشغيل المطابقة التلقائية حسب التخصص والموقع الأساسي ضمن 50 كم.',
      true,
    )
    setPendingAssignment(null)
    if (saved) { setBookingId(''); if (action.kind === 'manual') setProviderId('') }
  }
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
  const alertFor = (id: Section) => id === 'operations' ? liveAlerts.bookings : id === 'products' ? liveAlerts.product_orders + liveAlerts.products : id === 'applications' ? liveAlerts.provider_profiles : id === 'notifications' ? liveAlerts.notifications : 0
  const nav = (items: typeof navItems, label: string) => <nav className="dashboard-nav-links" aria-label={label}>{items.map(({ id, label, icon: Icon }) => <Link key={id} to={`/admin/${id}`} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined}><Icon size={17} /><span>{label}</span>{alertFor(id) > 0 && <b className="nav-badge" aria-label={`${alertFor(id)} تحديثات جديدة`}>{Math.min(alertFor(id), 99)}</b>}<ChevronLeft size={15} className="nav-chevron" /></Link>)}</nav>

  return <div className="container dashboard-page admin-workspace">{detailBooking && <AdminBookingDetailsModal booking={detailBooking} providers={operations.providers} busy={busy} onClose={() => setDetailBooking(null)} onComplete={load} />}<ActionConfirmDialog open={pendingAssignment !== null} title={pendingAssignment?.kind === 'manual' ? 'تأكيد إسناد الطلب' : 'تأكيد المطابقة التلقائية'} description={pendingAssignment?.kind === 'manual' ? `سيتم إسناد الطلب #${pendingAssignment.bookingNumber} إلى الفني ${pendingAssignment.providerName}. راجع الملخص قبل المتابعة.` : pendingAssignment ? `ستحاول المطابقة التلقائية اختيار فني مناسب للطلب #${pendingAssignment.bookingNumber} وفق التخصص والموقع والتوفر المسجل.` : ''} confirmLabel={pendingAssignment?.kind === 'manual' ? 'تأكيد الإسناد' : 'تشغيل المطابقة'} tone="primary" busy={busy} onCancel={() => setPendingAssignment(null)} onConfirm={confirmAssignment} /><div className="dashboard-top"><div><span className="eyebrow">إدارة المنصة</span><h1>{sectionTitle[section]} {alertFor(section) > 0 && <span className="section-alert-badge">{Math.min(alertFor(section), 99)} جديد</span>}</h1><p className="muted">تحكم مستقل وواضح في كل جزء من تشغيل المنصة.</p></div><div className="dashboard-top-actions"><Link to="/services" className="button button-secondary button-small"><Search size={15} /> معاينة الخدمات</Link><button type="button" className="button button-secondary button-small mobile-admin-signout" onClick={handleSignout}><LogOut size={15} /> تسجيل الخروج</button></div></div>
      <div className="dashboard-shell"><aside className="dashboard-nav"><div className="nav-user"><span className="user-avatar"><ShieldCheck size={18} /></span><div><strong>مدير المنصة</strong><small>افتح قائمة الحساب من الأعلى للتنقل بين الأقسام</small></div></div>{nav(navItems, 'أقسام الإدارة')}<div className="nav-bottom"><Link to="/" className="button button-secondary button-wide">العودة للموقع</Link><button type="button" onClick={handleSignout} className="nav-logout"><LogOut size={15} /> تسجيل الخروج</button></div></aside>
      <main className="dashboard-content" key={section}>
        {message && <div className={message.startsWith('تعذر') ? 'inline-error' : 'success-note'} role={message.startsWith('تعذر') ? 'alert' : 'status'}>{message.startsWith('تعذر') ? <X size={16} /> : <Check size={16} />}{message}{message.startsWith('تعذر') && <button type="button" className="message-retry" onClick={() => void load()}>إعادة المحاولة</button>}</div>}
        {alertFor(section) > 0 && <Link className="section-alert-banner" to={`/admin/${section}`}><Bell size={16} /><span>لديك {Math.min(alertFor(section), 99)} تحديث جديد في قسم {sectionTitle[section]}</span><ChevronLeft size={15} /></Link>}
        {loading && ['overview','operations','applications'].includes(section) && <div className="panel loading-state">جارٍ تحميل بيانات {sectionTitle[section]}…</div>}
        {!loading && section === 'overview' && <><div className="admin-metrics">{[
          ['الطلبات المسجلة', String(overview?.bookings ?? 0), FileText], ['الفنيون المعتمدون', String(overview?.approvedProviders ?? 0), UsersRound],
          ['قيمة التحصيل', overview?.paidAmount ? `${Number(overview.paidAmount).toFixed(2)} ر.س` : '—', WalletCards], ['طلبات بلا إسناد', String(operations.assignable.length), Layers3],
        ].map(([label, value, Icon]: any) => <div className="metric-card" key={label}><span className="metric-icon"><Icon size={18} /></span><span className="muted">{label}</span><strong>{value}</strong></div>)}</div>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">آخر النشاط</span><h2>الطلبات الأخيرة</h2></div><Link className="text-link" to="/admin/operations">فتح الطلبات والإسناد <ArrowLeft size={15} /></Link></div>{operations.recent.length ? <div className="booking-list">{operations.recent.map((item) => <Link className="booking-row admin-booking-link" to={`/admin/operations?booking=${item.id}`} key={item.id}><div><span className="eyebrow">طلب #{item.booking_number}</span><h3>{item.services?.name_ar ?? 'خدمة منزلية'}</h3><p>{item.profiles?.full_name ?? 'عميل'} · {item.profiles?.phone ?? 'بدون رقم'} · {item.city}</p><small>اضغط لفتح الإسناد والصور والتحكم</small></div><span className="status-pill">{item.status}</span></Link>)}</div> : <p className="empty-inline">لا توجد طلبات حتى الآن.</p>}</section>
          <div className="admin-shortcuts">{navItems.filter((item) => item.id !== 'overview').map(({ id,label,icon:Icon }) => <Link className="admin-shortcut" key={id} to={`/admin/${id}`}><Icon size={18} /><strong>{label}</strong><ChevronLeft size={15} /></Link>)}</div></>}
        {!loading && section === 'operations' && <><nav className="admin-inner-strip operations-inner-strip" aria-label="أقسام الطلبات والإسناد"><span>تشغيل الطلبات</span><button type="button" className={operationsView === 'manage' ? 'active' : ''} onClick={() => setOperationsView('manage')}>الإسناد وإدارة الطلبات</button><button type="button" className={operationsView === 'review' ? 'active' : ''} onClick={() => setOperationsView('review')}>مراجعة المطابقة</button></nav>{operationsView === 'review' && <div className="operations-review-panel"><AdminAutoAssignmentReviewPanel bookings={operations.autoReview} providers={operations.providers} busy={busy} hasMore={operations.autoReviewHasMore} onLoadMore={loadOlderAutoReviews} onComplete={load} /></div>}{operationsView === 'manage' && <section className="panel admin-operations"><div className="panel-heading"><div><span className="eyebrow">التشغيل</span><h2>إسناد طلب لفني معتمد</h2><p className="muted">يعرض الاختيار فنيين معتمدين مسجلين بالتخصص المطابق فقط.</p></div></div>
          <div className="booking-filters admin-booking-filters"><label className="accounts-search"><Search size={16} /><input value={operationsQuery} onChange={(event) => setOperationsQuery(event.target.value)} placeholder="ابحث برقم الطلب أو العميل أو المدينة" /></label><select aria-label="تصفية حالة الطلب" value={operationsStatus} onChange={(event) => setOperationsStatus(event.target.value)}><option value="all">كل الحالات</option><option value="pending">قيد المراجعة</option><option value="quoted">بانتظار العرض</option><option value="accepted">مقبول</option><option value="assigned">مسند</option><option value="in_progress">قيد التنفيذ</option><option value="completed">مكتمل</option><option value="cancelled">ملغى</option></select></div><div className="field-grid"><label className="field-label">الطلب<select value={bookingId} onChange={(e) => { setBookingId(e.target.value); setProviderId('') }}><option value="">اختر طلبًا غير مسند</option>{filteredAssignable.map((row) => <option key={row.id} value={row.id}>#{row.booking_number} · {row.services?.name_ar ?? 'خدمة'} · {row.city}</option>)}</select></label><label className="field-label">الفني المطابق<select value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={!bookingId}><option value="">اختر فنيًا</option>{eligibleProviders.map((row) => <option key={row.user_id} value={row.user_id}>{row.profiles?.full_name ?? 'فني'}</option>)}</select></label></div>
          <div className="button-row"><button type="button" className="button button-primary" onClick={assign} disabled={busy || !bookingId || !providerId}><Send size={15} /> إسناد يدوي</button><button type="button" className="button button-secondary" onClick={autoAssign} disabled={busy || !bookingId}><Navigation size={15} /> المطابقة التلقائية الأقرب</button></div>{bookingId && !eligibleProviders.length && <div className="inline-error">لا يوجد فني معتمد بهذا التخصص حاليًا.</div>}
          <div className="admin-assignable-list">{filteredAssignable.length ? filteredAssignable.map((row) => <button type="button" className="admin-order-mini-row" key={row.id} onClick={() => setDetailBooking(row)}><span className="admin-order-mini-main"><strong>#{row.booking_number} · {row.services?.name_ar ?? 'خدمة'}</strong><small>{row.profiles?.full_name ?? 'عميل'} · {[row.city, row.district].filter(Boolean).join(' · ') || 'الموقع غير مكتمل'}</small></span><span className="admin-order-mini-meta"><small>{row.scheduled_date ?? 'موعد غير محدد'} · {row.scheduled_slot ?? ''}</small><span className="status-pill">غير مسند</span></span><ChevronLeft size={16} /></button>) : <p className="empty-inline">لا توجد طلبات غير مسندة بهذه التصفية.</p>}</div>
          <div className="admin-recent-operations"><h2>الطلبات المسندة والحديثة</h2><p className="muted">اضغط على أي صف لفتح جميع التفاصيل والإجراءات في نافذة وسط الشاشة.</p>{filteredRecent.length ? <div className="admin-order-mini-list">{filteredRecent.map((row) => <button type="button" className="admin-order-mini-row" key={row.id} onClick={() => setDetailBooking(row)}><span className="admin-order-mini-main"><strong>#{row.booking_number} · {row.services?.name_ar ?? 'خدمة'}</strong><small>{row.profiles?.full_name ?? 'عميل'} · {row.provider_profiles?.profiles?.full_name ?? 'لم يُسند لفني'}</small></span><span className="admin-order-mini-meta"><small>{row.city ?? 'مدينة غير محددة'}</small><span className="status-pill">{row.status}</span></span><ChevronLeft size={16} /></button>)}</div> : <p className="empty-inline">لا توجد طلبات حديثة بهذه التصفية.</p>}</div>
          <hr /><h2>تسوية رصيد فني</h2><p className="muted">الأجور النظامية فقط؛ أدخل المبلغ الموجب، وتُخصم غرامة التأخير أو يُسجل الصرف آليًا من النظام.</p><div className="field-grid"><label className="field-label">الفني<select value={providerId} onChange={(e) => setProviderId(e.target.value)}><option value="">اختر فنيًا معتمدًا</option>{operations.providers.map((row) => <option key={row.user_id} value={row.user_id}>{row.profiles?.full_name ?? 'فني'}</option>)}</select></label><label className="field-label">نوع القيد<select value={entryType} onChange={(e) => setEntryType(e.target.value as typeof entryType)}><option value="late_penalty">خصم تأخير</option><option value="adjustment">تسوية نظامية</option><option value="payout">صرف مستحق</option></select></label></div><div className="field-grid"><label className="field-label">المبلغ الموجب<input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label className="field-label">السبب<input value={note} onChange={(e) => setNote(e.target.value)} /></label></div><button type="button" className="button button-secondary" onClick={addLedger} disabled={busy || !providerId || !amount || !note.trim()}><WalletCards size={15} /> حفظ القيد المالي</button>
        </section>}
        </>}
        {!loading && section === 'applications' && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">الفريق</span><h2>طلبات اعتماد الفنيين</h2><p className="muted">راجع التخصص والخبرة والهوية والسيرة الذاتية قبل تفعيل الإسناد.</p></div><span className="status-pill">{applications.length} ملفات</span></div>{applications.length ? <div className="provider-applications">{applications.map((item) => <article className="application-row" key={item.user_id}><div><strong>{item.profiles?.full_name ?? 'فني بدون اسم'}</strong><small>{item.profiles?.phone ?? 'لا يوجد جوال'} · {item.profiles?.city ?? 'المدينة غير مسجلة'} · {item.approval_status} · {item.years_experience ?? 0} سنوات خبرة</small><small>{(item.provider_services ?? []).filter((x: any) => x.is_active).map((x: any) => x.services?.name_ar).filter(Boolean).join('، ') || 'لا توجد تخصصات مسجلة'}</small><p className="application-bio">{item.service_description ?? item.professional_bio ?? 'لا توجد نبذة مهنية.'}</p><ProviderApplicationDocuments documents={item.provider_documents ?? []} /></div><div className="application-actions"><span className="status-pill">{item.provider_documents?.find((document: any) => document.is_current !== false)?.status ?? 'بدون مستند'}</span><label className="commission-control">العمولة %<input type="number" min="0" max="100" step="0.01" value={commissionInputs[item.user_id] ?? item.default_commission_rate ?? ''} onChange={(e) => setCommissionInputs({ ...commissionInputs, [item.user_id]: e.target.value })} placeholder="الافتراضي" /></label><button type="button" className="button button-secondary button-small" disabled={busy || commissionInputs[item.user_id] == null || commissionInputs[item.user_id] === ''} onClick={() => saveCommission(item.user_id)}>حفظ العمولة</button>{item.approval_status === 'pending' && <><button type="button" className="button button-primary button-small" disabled={busy} onClick={() => review(item.user_id,'approved')}>اعتماد</button><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => review(item.user_id,'rejected')}>رفض</button></>}</div></article>)}</div> : <p className="empty-inline">لا توجد طلبات اعتماد بانتظار المراجعة.</p>}</section>}
        {!loading && section === 'accounts' && <AdminAccountsPanel />}
        {section === 'notifications' && <NotificationsPanel />}
        {!loading && section === 'reports' && <AdminReportsPanel />}
        {section === 'audit' && <AdminAuditPanel />}
        {section === 'new-order' && <AdminManualBookingPanel onCreated={() => void load()} />}
        {section === 'products' && <AdminProductsPanel />}
        {['catalog','quotes','payments','settings'].includes(section) && <AdminMarketplacePanel section={section as 'catalog'|'quotes'|'payments'|'settings'} />}
        {section === 'settings' && <AdminAISettingsPanel />}
      </main>
    </div>
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
