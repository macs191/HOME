import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpLeft, CalendarDays, Check, ChevronLeft, CircleHelp, Clock3, FileText, Filter, Gauge, Globe2, Layers3, LocateFixed, LockKeyhole, MapPin, Menu, MessageCircle, ShoppingBag, MoreHorizontal, Navigation, Plus, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Star, TicketPercent, TrendingUp, UserRound, UsersRound, WalletCards, X, Zap, type LucideIcon } from 'lucide-react'
import { BrandMark, CategoryIcon, featureIcons } from './components/Brand'
import { Shell } from './components/Shell'
import { NotificationsPanel, playNotificationChime } from './components/NotificationsPanel'
import { CustomerInvoice } from './components/CustomerInvoice'
import { BookingPhotoPicker } from './components/BookingPhotoPicker'
import { BookingAttachmentsPanel } from './components/BookingAttachmentsPanel'
import { BookingStatusTimeline } from './components/BookingStatusTimeline'
import { BookingChat } from './components/BookingChat'
import { BookingReviewForm } from './components/BookingReviewForm'
import { BookingLocationTracking } from './components/BookingLocationTracking'
import { AccountSettingsPanel } from './components/AccountSettingsPanel'
import { CustomerBookingActions } from './components/CustomerBookingActions'
import { ProviderJobCard } from './components/ProviderJobCard'
import { AdminMarketplacePanel } from './components/AdminMarketplacePanel'
import { AdminWorkspace } from './components/AdminWorkspace'
import { StorePage, StoreOrdersPanel } from './components/StorePage'
import { VoiceAssistant } from './components/VoiceAssistant'
import { AdminContactPanel } from './components/AdminContactPanel'
import { UnifiedOrdersCenter } from './components/UnifiedOrdersCenter'
import { OrderDialog } from './components/OrderDialog'
import { DownloadPage } from './components/DownloadPage'
import { AboutPage, PrivacyPage } from './components/PublicInfoPages'
import { GoogleProfileCompletionPage, LoginPage, OAuthCallbackPage } from './components/AuthPages'
const MapPicker = lazy(() => import('./components/MapPicker').then((module) => ({ default: module.MapPicker })))
import { categories, getCategory, getService, services } from './lib/data'
import { getCustomerAddresses, getStoreCatalog, saveCustomerAddress } from './lib/supabase'
import { haversineKm, requestCurrentPosition, type GeoPoint } from './lib/geo'
import { BOOKING_SLOTS, COVERED_CITIES } from './lib/coverage'
import { initialiseAndroidApp, requestAndroidNotifications } from './lib/mobile'
import { acceptProviderQuote, addProviderLedgerEntry, advanceProviderBooking, assignBookingToProvider, createBookingFromDraft, finishFixedPriceBooking, uploadBookingPhotos, getAdminOverview, getAdminOperations, getAdminProviderApplications, getAuthState, getMyRole, getMyBookings, subscribeToMyBookings, getMyNotifications, getMyProviderProfile, getProviderLedger, getProviderWorkQueue, getProviderSpecialtyOptions, getProviderSpecialties, saveProviderSpecialties, getProviderSchedule, saveProviderSchedule, addProviderTimeOff, removeProviderTimeOff, getLiveCatalog, isSupabaseConfigured, markNotificationRead, onAuthStateChange, reviewProviderVerification, setProviderCommission, signInWithGoogle, submitProviderOnboarding, ensureProviderProfile, subscribeToMyNotifications, type AppNotification, type AuthState } from './lib/supabase'
import type { BookingDraft, Role } from './types'

const initialDraft: BookingDraft = { issue: '', urgency: 'normal', city: '', district: '', address: '', accessNotes: '', locationSource: 'none', scheduledDate: '', scheduledSlot: '' }

function restoreBookingDraft(raw: string, serviceFallback?: string): BookingDraft {
  const saved = JSON.parse(raw) as Partial<BookingDraft>
  const text = (value: unknown, max = 2000) => typeof value === 'string' ? value.slice(0, max) : ''
  const coordinate = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined
  return {
    serviceId: typeof saved.serviceId === 'string' ? saved.serviceId : serviceFallback,
    issue: text(saved.issue),
    urgency: saved.urgency === 'urgent' ? 'urgent' : 'normal',
    city: text(saved.city, 120),
    district: text(saved.district, 160),
    address: text(saved.address, 500),
    accessNotes: text(saved.accessNotes, 1000),
    latitude: coordinate(saved.latitude, -90, 90),
    longitude: coordinate(saved.longitude, -180, 180),
    locationSource: saved.locationSource === 'gps' || saved.locationSource === 'manual' ? saved.locationSource : 'none',
    scheduledDate: typeof saved.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.scheduledDate) ? saved.scheduledDate : '',
    scheduledSlot: text(saved.scheduledSlot, 80),
  }
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return (localStorage.getItem('homefix-theme-v2') as 'light' | 'dark' | null) ?? 'light' } catch { return 'light' } })
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('homefix-theme-v2', theme) } catch { /* التخزين قد يكون معطلًا في التصفح الخاص */ } }, [theme])
  useEffect(() => {
    let cleanup: (() => void) | undefined
    void initialiseAndroidApp().then(async (remove) => { cleanup = remove; const auth = await getAuthState(); if (auth.user) await requestAndroidNotifications() }).catch(() => undefined)
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined)
    const authSubscription = onAuthStateChange((next) => { if (next.user) void requestAndroidNotifications() })
    return () => { cleanup?.(); authSubscription.unsubscribe() }
  }, [])
  return <Shell theme={theme} onThemeChange={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}><NotificationMonitor /><Routes><Route path="/" element={<SessionEntryRoute />} /><Route path="/services" element={<ServicesPage />} /> <Route path="/about" element={<AboutPage />} /><Route path="/privacy" element={<PrivacyPage />} /><Route path="/downloads" element={<DownloadPage />} /><Route path="/store" element={<StorePage />} /><Route path="/book" element={<BookingPage />} /><Route path="/customer/:section?" element={<ProtectedRoute requiredRole="customer"><CustomerPage /></ProtectedRoute>} /><Route path="/provider/:section?" element={<ProtectedRoute requiredRole="provider"><ProviderPage /></ProtectedRoute>} /><Route path="/admin/:section?" element={<ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>} /><Route path="/login" element={<LoginPage />} /><Route path="/customer/login" element={<LoginPage fixedRole="customer" />} /><Route path="/provider/login" element={<LoginPage fixedRole="provider" />} /><Route path="/auth/callback" element={<OAuthCallbackPage />} /><Route path="/auth/complete-profile" element={<GoogleProfileCompletionPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell>
}

function SessionEntryRoute() {
  const [state, setState] = useState<'checking' | 'guest' | 'profile' | Role>('checking')
  useEffect(() => {
    let active = true
    const resolve = async () => {
      try {
        const auth = await getAuthState()
        if (!auth.user) { if (active) setState('guest'); return }
        const role = await getMyRole()
        if (active) setState(role ?? 'profile')
      } catch {
        if (active) setState('guest')
      }
    }
    void resolve()
    return () => { active = false }
  }, [])
  if (state === 'checking') return <div className="container loading-state">جارٍ فتح لوحة حسابك…</div>
  if (state === 'guest') return <HomePage />
  if (state === 'profile') return <Navigate to="/auth/complete-profile" replace />
  return <Navigate to={dashboardPath(state)} replace />
}

function useCatalog() {
  const [catalog, setCatalog] = useState({ categories, services, error: '' })
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    getLiveCatalog().then((live) => { if (active) setCatalog({ ...live, error: '' }) }).catch((error) => { if (active) setCatalog({ categories, services, error: 'تعذر تحميل قائمة الخدمات الآن. أعد المحاولة لاحقًا.' }) })
    return () => { active = false }
  }, [])
  return catalog
}

function ProtectedRoute({ children, requiredRole }: { children: React.ReactNode; requiredRole?: Extract<Role, 'customer' | 'provider' | 'admin'> }) {
  const [state, setState] = useState<(AuthState & { role?: Role | null }) | null>(null)
  useEffect(() => { let active = true; Promise.all([getAuthState(), getMyRole()]).then(([auth, role]) => { if (active) setState({ ...auth, role }) }).catch(() => { if (active) setState({ session: null, user: null, role: null }) }); const subscription = onAuthStateChange((next) => { if (active) getMyRole().then((role) => setState({ ...next, role })).catch(() => setState({ ...next, role: null })) }); return () => { active = false; subscription.unsubscribe() } }, [])
  if (!state) return <div className="container loading-state">جارٍ التحقق من جلسة الحساب...</div>
  if (!state.user) return <Navigate to={requiredRole === 'provider' ? '/provider/login' : requiredRole === 'customer' ? '/customer/login' : '/login'} replace />
  const hasRole = requiredRole === undefined || (requiredRole === 'admin' ? state.role === 'admin' || state.role === 'sub_admin' : state.role === requiredRole)
  if (!hasRole) return <Navigate to={state.role === 'provider' ? '/provider/overview' : state.role === 'admin' || state.role === 'sub_admin' ? '/admin/overview' : state.role === 'customer' ? '/customer/overview' : '/login?error=role-missing'} replace />
  return <>{children}</>
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'dark' }) { return <span className={`status-pill ${tone}`}>{children}</span> }
function SectionTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) { return <div className="section-title"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p className="muted section-description">{description}</p>}</div>{action}</div> }
function EmptyState({ icon: Icon = Layers3, title, body, action }: { icon?: LucideIcon; title: string; body: string; action?: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{body}</p>{action}</div> }

function RequestAuthDialog({ open, onClose, role = 'customer', nextPath = '/book' }: { open: boolean; onClose: () => void; role?: 'customer' | 'provider'; nextPath?: string }) {
  const [googleError, setGoogleError] = useState('')
  const navigate = useNavigate()
  if (!open) return null
  const target = role === 'provider' ? '/provider' : (safeNextPath(nextPath) ?? '/book')
  const goGoogle = async () => { setGoogleError(''); try { const result = await signInWithGoogle(role, target); if (result.flow === 'native') { const accountRole = await getMyRole(); onClose(); navigate(accountRole ? (accountRole === 'admin' || accountRole === 'sub_admin' ? '/admin/overview' : accountRole === 'provider' ? '/provider/overview' : target) : `/auth/complete-profile?next=${encodeURIComponent(target)}`, { replace: true }) } } catch (error) { setGoogleError(error instanceof Error ? error.message : 'تعذر بدء الدخول عبر Google') } }
  return <div className="royal-modal-backdrop" role="dialog" aria-modal="true"><div className="royal-modal"><button className="modal-close" onClick={onClose} aria-label="إغلاق"><X size={18} /></button><span className="royal-seal">✦</span><span className="eyebrow">خطوة آمنة قبل الطلب</span><h2>ابدأ طلبك بحسابك</h2><p>أنشئ حساب طالب خدمة أو سجّل الدخول لمتابعة الطلب والدفع بعد إكمال العمل.</p>{googleError && <div className="inline-error"><X size={16} />{googleError}</div>}<button className="button google-button button-wide" onClick={goGoogle}><span className="google-g">G</span>المتابعة بحساب Google</button><Link className="button button-primary button-wide" to={role === 'provider' ? '/provider/login' : `/customer/login?next=${encodeURIComponent(target)}`} onClick={onClose}>تسجيل الدخول أو إنشاء حساب <ArrowLeft size={16} /></Link><button className="modal-secondary" onClick={onClose}>سأعود لاحقًا</button></div></div>
}

function HomePage() {
  const [search, setSearch] = useState('')
  const [requestOpen, setRequestOpen] = useState(false)
  const [storeCatalog, setStoreCatalog] = useState<{ products: any[] }>({ products: [] })
  const navigate = useNavigate()
  useEffect(() => { getStoreCatalog().then((catalog) => setStoreCatalog(catalog)).catch(() => undefined) }, [])
  const { categories: serviceCategories, services: serviceList, error: catalogError } = useCatalog()
  const featured = serviceList.filter((service) => service.featured)
  const matching = useMemo(() => search.trim() ? serviceList.filter((service) => `${service.name} ${service.shortDescription}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [], [search, serviceList])
  return <>
    <section className="hero"><div className="hero-grid container"><div className="hero-copy"><span className="hero-kicker"><span className="pulse-line" /> خدمة منزلية بوضوح أكبر</span><h1>خلّ العطل علينا،<br /><em>والوقت لك.</em></h1><p>منصة واحدة تساعدك تجد الخدمة المناسبة، تحدد موقع العطل، وتتابع طلبك خطوة بخطوة — بدون تخمينات ولا وعود غير مؤكدة.</p><div className="hero-actions"><button className="button button-primary button-large" onClick={() => setRequestOpen(true)}>ابدأ طلبك <ArrowLeft size={17} /></button><Link className="text-link" to="/services">استعرض الخدمات <ChevronLeft size={16} /></Link></div><div className="hero-proof"><div className="avatar-stack"><span>م</span><span>س</span><span>ع</span></div><div><strong>مصمم للخدمة الحقيقية</strong><small>تقييمات وبيانات مصدرها طلبات فعلية فقط</small></div></div></div><div className="hero-visual"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-card main-service-card"><div className="card-topline"><span className="mini-label"><span className="live-dot" /> ابدأ من الكتالوج</span><MoreHorizontal size={18} /></div><div className="hero-card-icon"><HomeGlyph /></div><span className="eyebrow">إدارة المنزل</span><h3>خدمة مناسبة<br />تصل إليك</h3><div className="route-line"><span className="route-dot" /><span /><b /><span className="route-dot teal" /></div><div className="route-meta"><span>موقعك</span><span>منصة هوم سيرفس</span></div></div><div className="floating-card floating-location"><span className="floating-icon teal-bg"><Navigation size={15} /></span><div><small>موقع العطل</small><strong>حدده بدقة، أو اختر يدويًا</strong></div></div><div className="floating-card floating-trust"><span className="floating-icon yellow-bg"><ShieldCheck size={16} /></span><div><small>ثقة محسوبة</small><strong>لا بيانات وهمية</strong></div></div><div className="hero-grid-mark">···<br />···<br />···</div></div></div></section>
    <section className="search-section container"><div className="search-panel"><div><span className="eyebrow">من أين نبدأ؟</span><h2>ما الخدمة التي تحتاجها اليوم؟</h2></div><div className="home-search"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن سباكة، كهرباء، تكييف..." /><button onClick={() => navigate(`/services${search ? `?q=${encodeURIComponent(search)}` : ''}`)}>بحث</button>{matching.length > 0 && <div className="search-suggestions">{matching.map((service) => <button key={service.id} onClick={() => navigate(`/book?service=${service.id}`)}><CategoryIcon name={getCategory(service.categoryId, serviceCategories)?.icon ?? 'wrench'} size={16} /><span>{service.name}</span><ChevronLeft size={15} /></button>)}</div>}</div><button className="location-link" onClick={() => navigate('/book')}><LocateFixed size={18} /><span>حدد موقع الخدمة</span></button></div></section>
    <section className="container page-section"><SectionTitle eyebrow="الخدمات الأساسية" title="كل ما يحتاجه بيتك، في مكان واحد" description="كتالوج واضح يبدأ بالخدمات الأكثر طلبًا ويمكن توسيعه من لوحة الإدارة." action={<Link to="/services" className="text-link">كل الخدمات <ChevronLeft size={16} /></Link>} /><div className="category-grid">{serviceCategories.filter((category) => category.featured && serviceList.some((service) => service.categoryId === category.id)).map((category) => <Link to={`/services?category=${category.id}`} className="category-card" key={category.id}><span className="category-icon" style={{ background: `${category.color}18`, color: category.color }}><CategoryIcon name={category.icon} size={21} /></span><strong>{category.name}</strong><p>{category.description}</p><ArrowUpLeft size={16} className="category-arrow" /></Link>)}</div></section>
    <section className="container page-section split-section"><div className="split-copy"><span className="eyebrow">لماذا هوم سيرفس؟</span><h2>خطوات قليلة،<br /><span>صورة أوضح.</span></h2><p>نحن نرتب تجربة الطلب حول المعلومات التي تحتاجها فعلًا: نوع الخدمة، موقع العطل، الموعد، ثم تحديثات واضحة حتى الإكمال.</p><div className="feature-list"><Feature icon="location" title="موقع أدق" body="GPS بإذنك، أو تحديد يدوي عندما تفضّل." /><Feature icon="verified" title="ثقة قابلة للتحقق" body="لا نعرض تقييمًا أو توفرًا بلا مصدر." /><Feature icon="clock" title="متابعة أسهل" body="تاريخ واضح لكل انتقال في حالة الطلب." /></div></div><div className="process-card"><span className="process-number">01</span><div className="process-illustration"><div className="process-house"><HomeGlyph /></div><div className="process-pin pin-one"><MapPin size={17} /></div><div className="process-pin pin-two"><MapPin size={17} /></div><div className="process-line" /></div><div className="process-footer"><strong>حدد مكان العطل</strong><span>المدينة، الحي، العنوان أو النقطة على الخريطة</span></div></div></section>
    <section className="container page-section"><SectionTitle eyebrow="الأكثر طلبًا" title="ابدأ من خدمة واضحة" action={<Link to="/services" className="text-link">استعرض الكتالوج <ChevronLeft size={16} /></Link>} /><div className="service-grid">{catalogError && <div className="inline-error">تعذر تحميل قائمة الخدمات الآن. أعد المحاولة لاحقًا.</div>} {featured.map((service) => <ServiceCard key={service.id} service={service} catalogCategories={serviceCategories} />)}</div></section>
    <section className="container page-section home-store-section"><SectionTitle eyebrow="متجر هوم سيرفس" title="منتجات للبيت، مع تركيب عند الطلب" description="تصفح المنتجات المتاحة واختر فنيًا لتركيبها عند الحاجة." action={<Link to="/store" className="text-link">كل المنتجات <ChevronLeft size={16} /></Link>} /><div className="product-grid home-product-grid">{storeCatalog.products.filter((item) => item.is_featured || item.is_active).slice(0, 4).map((product) => <Link to="/store" className="product-card product-card-compact" key={product.id}><div className="product-image">{product.image_url ? <img src={product.image_url} alt={product.name_ar} /> : <ShoppingBag size={28} />} </div><div className="product-card-body"><span className="eyebrow">منتج متاح</span><h2>{product.name_ar}</h2><strong>{(Number(product.price) * (1 - Number(product.discount_percent) / 100)).toFixed(2)} ر.س</strong></div></Link>)}</div></section>
    <section className="container page-section trust-strip"><div className="trust-intro"><span className="eyebrow">بيانات مباشرة</span><h2>كتالوج واقعي<br />بدون أرقام تجريبية.</h2></div><div className="stat-card"><strong>{serviceList.length}</strong><span>خدمة فعّالة في الكتالوج</span></div><div className="stat-card"><strong>{serviceCategories.length}</strong><span>قسم يحتوي خدمات فعّالة</span></div></section>
    <section className="container page-section role-entry"><SectionTitle eyebrow="اختر مساحتك" title="كل حساب في مكانه" description="دخول مستقل وتجربة مصممة حسب دورك." /><div className="role-entry-grid"><Link to="/customer/login" className="role-entry-card"><span className="category-icon"><UserRound size={22} /></span><strong>أنا عميل</strong><p>سجّل الدخول لإدارة طلباتك ومواعيدك وعناوينك.</p><span className="text-link">دخول العملاء <ArrowLeft size={15} /></span></Link><Link to="/provider/login" className="role-entry-card"><span className="category-icon"><UsersRound size={22} /></span><strong>أنا فني / مقدم خدمة</strong><p>ادخل لمساحتك المهنية أو أنشئ ملفًا لمراجعته.</p><span className="text-link">دخول الفنيين <ArrowLeft size={15} /></span></Link></div></section>
    <section className="container cta-band"><div><span className="eyebrow">للفنيين والشركات</span><h2>خبرتك تستحق<br /><em>طلبات أفضل.</em></h2><p>بعد اعتماد ملفك، تستقبل الطلبات المسندة وتتبع المهمة ومستحقك من لوحة الفني.</p></div><Link to="/provider/login" className="button button-light">إنشاء حساب فني <ArrowLeft size={17} /></Link><div className="cta-decoration">✦</div></section>
    <RequestAuthDialog open={requestOpen} onClose={() => setRequestOpen(false)} />
  </>
}

function HomeGlyph() { return <div className="home-glyph"><span /><span /><span /><span /></div> }
function Feature({ icon, title, body }: { icon: keyof typeof featureIcons; title: string; body: string }) { const Icon = featureIcons[icon]; return <div className="feature-row"><span className="feature-icon"><Icon size={17} /></span><div><strong>{title}</strong><p>{body}</p></div></div> }
function ServiceCard({ service, catalogCategories = categories }: { service: (typeof services)[number]; catalogCategories?: typeof categories }) { const category = getCategory(service.categoryId, catalogCategories); return <Link to={`/book?service=${service.id}`} className="service-card"><div className="service-card-head"><span className="category-icon" style={{ background: `${category?.color ?? '#20d4c5'}18`, color: category?.color }}><CategoryIcon name={category?.icon ?? 'wrench'} size={18} /></span><span className="service-arrow"><ArrowUpLeft size={17} /></span></div><span className="eyebrow">{category?.name}</span><h3>{service.name}</h3><p>{service.shortDescription}</p><div className="service-card-meta"><span>{service.duration ? <><Clock3 size={14} />{service.duration}</> : 'تحدد المدة بعد مراجعة الطلب'}</span><span className="price-label">{service.priceLabel}</span></div></Link> }

function ServicesPage() {
  const { categories: serviceCategories, services: serviceList, error: catalogError } = useCatalog()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const category = params.get('category') ?? 'all'
  const [alphabetical, setAlphabetical] = useState(false)
  useEffect(() => { setQuery(params.get('q') ?? '') }, [params])
  const matchingServices = serviceList.filter((service) => (category === 'all' || service.categoryId === category) && `${service.name} ${service.shortDescription}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const filtered = alphabetical ? [...matchingServices].sort((left, right) => left.name.localeCompare(right.name, 'ar')) : matchingServices
  return <div className="container inner-page"><div className="page-heading"><div><span className="eyebrow">كتالوج الخدمات</span><h1>خدمات البيت،<br /><span>مرتبة بوضوح.</span></h1><p className="muted">اختر ما تحتاجه، وسنأخذك إلى تفاصيل الطلب دون تشتيت.</p></div><Link to="/book" className="button button-primary">أنشئ طلبًا <Plus size={17} /></Link></div><div className="toolbar"><div className="toolbar-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الخدمة أو نوع العطل" /></div><div className="filter-row"><button className={category === 'all' ? 'filter-chip selected' : 'filter-chip'} onClick={() => setParams({ q: query })}>كل الخدمات</button>{serviceCategories.map((item) => <button key={item.id} className={category === item.id ? 'filter-chip selected' : 'filter-chip'} onClick={() => setParams({ q: query, category: item.id })}><CategoryIcon name={item.icon} size={15} />{item.name}</button>)}</div></div>{catalogError && <div className="inline-error">تعذر تحميل قائمة الخدمات الآن.</div>}<div className="results-line"><span>{filtered.length} خدمات في الكتالوج الحالي</span><button type="button" className="sort-button" aria-label={alphabetical ? 'إعادة ترتيب الخدمات حسب الكتالوج' : 'ترتيب الخدمات أبجديًا'} aria-pressed={alphabetical} onClick={() => setAlphabetical((value) => !value)}><SlidersHorizontal size={15} />{alphabetical ? 'ترتيب أبجدي' : 'ترتيب الكتالوج'}</button></div>{filtered.length ? <div className="service-grid service-grid-large">{filtered.map((service) => <ServiceCard key={service.id} service={service} catalogCategories={serviceCategories} />)}</div> : <EmptyState icon={Search} title="لم نجد خدمة بهذا الوصف" body="جرّب كلمة أخرى أو اختر قسمًا من القائمة." action={<button className="button button-secondary" onClick={() => { setQuery(''); setParams({}) }}>عرض كل الخدمات</button>} />}<section className="info-note"><ShieldCheck size={20} /><div><strong>التسعير الواضح جزء من التجربة</strong><p>السعر الثابت يظهر عندما يكون محددًا. أما الخدمات التي تحتاج معاينة فستظهر كطلب عرض سعر، دون تحويل تقدير غير مؤكد إلى فاتورة.</p></div></section></div>
}

function BookingPage() {
  const { categories: serviceCategories, services: serviceList } = useCatalog()
  const [params] = useSearchParams()
  const location = useLocation()
  const assistantState = location.state as { assistantDraft?: Partial<BookingDraft>; assistantConfirmed?: boolean } | null
  const assistantDraft = assistantState?.assistantDraft
  const assistantConfirmed = assistantState?.assistantConfirmed === true
  const serviceReturnPath = `/book${params.toString() ? `?${params.toString()}` : ''}`
  const serviceParam = params.get('service') ?? params.get('assistantService') ?? assistantDraft?.serviceId
  const navigate = useNavigate()
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [accountRole, setAccountRole] = useState<Role | null | undefined>(undefined)
  useEffect(() => { let active = true; getAuthState().then(async (state) => { if (!active) return; setAuthState(state); if (state.user) setAccountRole(await getMyRole()) }).catch(() => { if (active) setAuthState({ user: null, session: null }) }); return () => { active = false } }, [])
  const userId = authState?.user?.id
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<BookingDraft>({ ...initialDraft, serviceId: serviceParam, issue: assistantDraft?.issue ?? '', city: assistantDraft?.city ?? '', district: assistantDraft?.district ?? '', address: assistantDraft?.address ?? '', urgency: assistantDraft?.urgency === 'urgent' ? 'urgent' : 'normal', locationSource: assistantDraft?.locationSource === 'manual' ? 'manual' : 'none', scheduledDate: assistantDraft?.scheduledDate ?? '', scheduledSlot: assistantDraft?.scheduledSlot ?? '' })
  const [draftOwner, setDraftOwner] = useState<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [policyAccepted, setPolicyAccepted] = useState(assistantConfirmed)
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [savedAddresses, setSavedAddresses] = useState<any[]>([])
  const [addressLabel, setAddressLabel] = useState('المنزل')
  const [addressMessage, setAddressMessage] = useState('')
  const [uploadWarning, setUploadWarning] = useState('')
  const assistantAutoSubmit = useRef(false)
  useEffect(() => {
    if (!userId) return
    void getCustomerAddresses().then(({ data }) => setSavedAddresses((data as any[]) ?? [])).catch(() => undefined)
    const key = `homefix-booking-draft-v1:${userId}`
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) {
        const restored = restoreBookingDraft(saved, serviceParam)
        setDraft(assistantDraft ? { ...restored, ...assistantDraft, serviceId: assistantDraft.serviceId ?? restored.serviceId } : restored)
        setDraftRestored(true)
      } else if (assistantDraft) {
        setDraft((current) => ({ ...current, ...assistantDraft, serviceId: assistantDraft.serviceId ?? current.serviceId }))
      }
    } catch { /* التخزين المؤقت قد يكون معطلًا في وضع التصفح الخاص */ }
    setDraftOwner(userId)
  }, [userId, serviceParam, assistantDraft])
  useEffect(() => {
    if (!userId || draftOwner !== userId) return
    try { sessionStorage.setItem(`homefix-booking-draft-v1:${userId}`, JSON.stringify(draft)) } catch { /* لا نوقف الحجز إذا تعذر التخزين المؤقت */ }
  }, [userId, draftOwner, draft])
  const [geoError, setGeoError] = useState('')
  const [locating, setLocating] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const selectedService = getService(draft.serviceId, serviceList)
  if (!authState || (authState.user && accountRole === undefined)) return <div className="container loading-state">جارٍ التحقق من الحساب…</div>
  if (authState.user && !accountRole) return <Navigate to="/login?error=role-missing" replace />
  if (authState.user && accountRole !== 'customer') return <Navigate to={dashboardPath(accountRole as Role)} replace />
  if (!authState.user) return <><div className="container inner-page narrow-page"><div className="access-card"><span className="royal-seal">✦</span><h1>الطلب يبدأ من حسابك</h1><p>لخصوصية العنوان ومتابعة الطلب، سجّل الدخول أو أنشئ حسابًا قبل إدخال تفاصيل الخدمة.</p><Link to="/" className="text-link">العودة للرئيسية</Link></div></div><RequestAuthDialog open onClose={() => navigate('/')} nextPath={serviceReturnPath} /></>
  const update = <K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const chooseSavedAddress = (id: string) => { const address = savedAddresses.find((item) => item.id === id); if (!address) return; update('city', address.city ?? ''); update('district', address.district ?? ''); update('address', address.address_text ?? ''); update('accessNotes', address.access_notes ?? ''); if (address.latitude != null && address.longitude != null) { update('latitude', Number(address.latitude)); update('longitude', Number(address.longitude)); update('locationSource', 'manual') }; setAddressMessage('تم تحميل العنوان المحفوظ.') }
  const saveCurrentAddress = async () => { setAddressMessage(''); try { const saved = await saveCustomerAddress({ label: addressLabel, city: draft.city, district: draft.district, address: draft.address, accessNotes: draft.accessNotes, latitude: draft.latitude, longitude: draft.longitude }); setSavedAddresses((current) => [saved, ...current]); setAddressMessage('تم حفظ العنوان لاستخدامه لاحقًا.') } catch (error) { setAddressMessage(error instanceof Error ? error.message : 'تعذر حفظ العنوان.') } }
  const useGps = async () => { setLocating(true); setGeoError(''); try { const point = await requestCurrentPosition(); update('latitude', point.latitude); update('longitude', point.longitude); update('locationSource', 'gps'); setGeoError('') } catch (error) { setGeoError(error instanceof Error ? error.message : 'تعذر تحديد الموقع') } finally { setLocating(false) } }
  const submitBooking = async () => { if (!draft.serviceId) return; if (!policyAccepted) { setSubmitError('يرجى تأكيد الموافقة على سياسة الطلب قبل الإرسال.'); return }; setSubmitting(true); setSubmitError(''); setUploadWarning(''); try { const created = await createBookingFromDraft(draft, draft.serviceId, policyAccepted); const createdData: any = (created as any)?.data ?? created; const bookingId = Array.isArray(createdData) ? createdData[0]?.id ?? createdData[0]?.booking_id : createdData?.id ?? createdData?.booking_id ?? (typeof createdData === 'string' ? createdData : undefined); if (photoFiles.length && bookingId) { try { const upload = await uploadBookingPhotos(bookingId, photoFiles); if (upload.failures.length) setUploadWarning(`تم إنشاء الطلب ورفع ${upload.uploaded} صورة، لكن تعذر رفع ${upload.failures.length}. يمكنك إعادة المحاولة من طلباتك. ${upload.failureReasons?.join(' · ') ?? ''}`) } catch { setUploadWarning('تم إنشاء الطلب، لكن تعذر رفع الصور الآن. يمكنك إعادة المحاولة من طلباتك.') } } else if (photoFiles.length && !bookingId) setUploadWarning('تم إنشاء الطلب، لكن تعذر ربط الصور به الآن. أعد المحاولة من طلباتك.'); if (userId) { try { sessionStorage.removeItem(`homefix-booking-draft-v1:${userId}`) } catch { /* تجاهل تعذر تنظيف التخزين المؤقت */ } }; setDraftOwner(null); setDraftRestored(false); setPhotoFiles([]); setSubmitted(true) } catch (error) { setSubmitError(error instanceof Error ? error.message : 'تعذر إرسال الطلب. تحقق من البيانات ثم حاول مرة أخرى.') } finally { setSubmitting(false) } }
  useEffect(() => {
    if (!assistantConfirmed || assistantAutoSubmit.current || !userId || accountRole !== 'customer' || !draft.serviceId || !draft.issue || !draft.city || !draft.address || !draft.scheduledDate || !draft.scheduledSlot) return
    assistantAutoSubmit.current = true
    void submitBooking()
  }, [assistantConfirmed, userId, accountRole, draft.serviceId, draft.issue, draft.city, draft.address, draft.scheduledDate, draft.scheduledSlot])
  const canNext = step === 1 ? Boolean(draft.serviceId && draft.issue.trim()) : step === 2 ? Boolean(draft.city && draft.address) : step === 3 ? Boolean(draft.scheduledDate && draft.scheduledSlot) : true
  if (submitted) return <div className="container inner-page narrow-page booking-page"><div className="success-card"><span className="success-icon"><Check size={25} /></span><span className="eyebrow">تم تسجيل الطلب</span><h1>طلبك جاهز للخطوة التالية.</h1><p>تم تجهيز تفاصيل <strong>{selectedService?.name ?? 'الخدمة'}</strong>. تم حفظ الطلب وإرساله لمسار الإسناد الإداري وفق الصلاحيات.</p>{uploadWarning && <div className="warning-note" role="status"><X size={16} />{uploadWarning}</div>}<div className="success-summary"><span><strong>الموقع</strong>{draft.locationSource === 'gps' ? 'تم تحديده عبر GPS' : draft.address}</span><span><strong>الموعد</strong>{draft.scheduledDate} · {draft.scheduledSlot}</span></div><div className="hero-actions"><Link className="button button-primary" to="/customer/orders">اذهب إلى طلباتك <ArrowLeft size={17} /></Link><Link className="text-link" to="/">العودة للرئيسية</Link></div></div></div>
  return <div className="container inner-page narrow-page booking-page"><div className="booking-head"><div><span className="eyebrow">طلب خدمة جديد</span><h1>من العطل إلى الحل،<br /><span>بخطوات واضحة.</span></h1></div><span className="booking-note"><ShieldCheck size={16} /> لا نرسل طلبك دون تأكيدك</span></div><div className="stepper">{['الخدمة', 'الموقع', 'الموعد', 'المراجعة'].map((label, index) => <div className={step >= index + 1 ? 'step active' : 'step'} key={label}><span>{index + 1}</span><small>{label}</small></div>)}</div>{draftRestored && <div className="success-note" role="status"><Check size={15} /> استعدنا مسودة طلبك من هذه الجلسة.</div>}<div className="booking-layout"><div className="booking-main">{step === 1 && <div className="form-card"><FormHeader step="01" title="ما الذي يحتاج إصلاحًا؟" body="اختر خدمة واكتب وصفًا يساعد مقدم الخدمة على فهم الحالة." /><label className="field-label">الخدمة المطلوبة<select value={draft.serviceId ?? ''} onChange={(event) => update('serviceId', event.target.value || undefined)}><option value="">اختر من الكتالوج</option>{serviceList.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label className="field-label">وصف المشكلة<textarea value={draft.issue} onChange={(event) => update('issue', event.target.value)} placeholder="مثال: يوجد تسريب بسيط تحت حوض المطبخ منذ صباح اليوم..." rows={5} maxLength={4000} /></label><BookingPhotoPicker files={photoFiles} onChange={setPhotoFiles} maxFiles={3} title="صور العطل" description="اختياري — التقط من الكاميرا أو اختر حتى 3 صور من المعرض." /><div className="field-grid"><label className="field-label">درجة الاستعجال<div className="segmented"><button type="button" className={draft.urgency === 'normal' ? 'selected' : ''} onClick={() => update('urgency', 'normal')}>عادي</button><button type="button" className={draft.urgency === 'urgent' ? 'selected' : ''} onClick={() => update('urgency', 'urgent')}>عاجل</button></div></label><div className="field-helper"><CircleHelp size={16} /><span>كلما كان الوصف أدق، أصبح ترشيح الخدمة أسهل.</span></div></div></div>}{step === 2 && <div className="form-card"><FormHeader step="02" title="أين يقع العطل؟" body="شارك موقعك بإذنك أو أدخل العنوان يدويًا. تحديد GPS ليس شرطًا لإكمال الطلب." />{savedAddresses.length > 0 && <label className="field-label saved-address-select">استخدم عنوانًا محفوظًا<select defaultValue="" onChange={(event) => chooseSavedAddress(event.target.value)}><option value="">اختيار عنوان سابق</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.label} · {address.city} · {address.address_text}</option>)}</select></label>}<button type="button" className="location-button" onClick={useGps} disabled={locating}><span className="location-button-icon"><LocateFixed size={20} /></span><span><strong>{locating ? 'جارٍ تحديد الموقع...' : 'إرسال موقعي الحالي'}</strong><small>{draft.locationSource === 'gps' ? `${draft.latitude?.toFixed(5)}, ${draft.longitude?.toFixed(5)}` : 'سيطلب المتصفح إذن الوصول إلى موقعك'}</small></span><ChevronLeft size={17} /></button>{geoError && <div className="inline-error"><X size={16} />{geoError}</div>}<Suspense fallback={<div className="map-loading" role="status">جارٍ تحميل الخريطة…</div>}><MapPicker value={draft.latitude && draft.longitude ? { latitude: draft.latitude, longitude: draft.longitude } : undefined} onChange={({ point, address, district, city }) => { update('latitude', point.latitude); update('longitude', point.longitude); update('locationSource', 'manual'); update('address', address); if (district) update('district', district); if (city) update('city', city) }} /></Suspense><div className="field-grid"><label className="field-label">المدينة<select value={draft.city} onChange={(event) => update('city', event.target.value)}><option value="">اختر المدينة</option>{COVERED_CITIES.map((city) => <option key={city}>{city}</option>)}</select></label><label className="field-label">الحي<input value={draft.district} onChange={(event) => update('district', event.target.value)} placeholder="اسم الحي" maxLength={160} /></label></div><label className="field-label">العنوان التفصيلي<input value={draft.address} onChange={(event) => update('address', event.target.value)} placeholder="الشارع، رقم المبنى، علامة مميزة" maxLength={500} /></label><label className="field-label">تعليمات الوصول <span className="optional">اختياري</span><textarea value={draft.accessNotes} onChange={(event) => update('accessNotes', event.target.value)} placeholder="مثال: المدخل من جهة المواقف" rows={3} maxLength={1000} /></label><div className="save-address-row"><input value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} maxLength={40} placeholder="اسم العنوان: المنزل" /><button type="button" className="button button-secondary button-small" onClick={() => void saveCurrentAddress()} disabled={!draft.city || !draft.address}>حفظ العنوان</button></div>{addressMessage && <div className={addressMessage.startsWith('تم') ? 'success-note' : 'inline-error'} role="status">{addressMessage}</div>}</div>}{step === 3 && <div className="form-card"><FormHeader step="03" title="متى يناسبك؟" body="اختر يومًا وفترة زمنية مناسبة. التوفر النهائي يُعاد التحقق منه عند الإسناد." /><div className="field-grid"><label className="field-label">التاريخ<input type="date" min={new Date().toISOString().slice(0, 10)} value={draft.scheduledDate} onChange={(event) => update('scheduledDate', event.target.value)} /></label><label className="field-label">الفترة الزمنية<select value={draft.scheduledSlot} onChange={(event) => update('scheduledSlot', event.target.value)}><option value="">اختر الفترة</option>{BOOKING_SLOTS.map((slot) => <option key={slot.value} value={slot.value}>{slot.label}</option>)}</select></label></div><div className="availability-note"><CalendarDays size={19} /><div><strong>مواعيد مرنة تساعد على ترشيح أفضل</strong><p>لا نعرض موعدًا على أنه مؤكد قبل التحقق من توفر مقدم الخدمة.</p></div></div><div className="availability-note"><UsersRound size={19} /><div><strong>الإدارة تسند الطلب إلى الفني الأنسب</strong><p>تختار الإدارة فنيًا معتمدًا بحسب الخدمة وموقعك، وتصل إليه بيانات المهمة اللازمة فقط.</p></div></div></div>}{step === 4 && <div className="form-card"><FormHeader step="04" title="راجع طلبك قبل الإرسال" body="تأكد من التفاصيل. تصدر الفاتورة بعد إكمال العمل واعتماد السعر، ثم تختار الدفع نقدًا أو بالتحويل." /><div className="review-list"><ReviewRow label="الخدمة" value={selectedService?.name ?? 'غير محددة'} /><ReviewRow label="الوصف" value={draft.issue} /><ReviewRow label="الموقع" value={draft.locationSource === 'gps' ? `GPS · ${draft.latitude?.toFixed(5)}, ${draft.longitude?.toFixed(5)}` : `${draft.city}، ${draft.district}، ${draft.address}`} /><ReviewRow label="الموعد" value={`${draft.scheduledDate} · ${draft.scheduledSlot}`} /><ReviewRow label="السعر" value={selectedService?.priceLabel ?? 'يحدد بعد المعاينة'} /></div><label className="policy-check"><input type="checkbox" checked={policyAccepted} onChange={(event) => { setPolicyAccepted(event.target.checked); setSubmitError('') }} /><span>أوافق على سياسة الإلغاء ومشاركة بيانات موقع هذا الطلب مع الفني المسند إليه فقط.</span></label></div>}{submitError && <div className="inline-error"><X size={16} />{submitError}</div>}<div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setStep((value) => Math.max(1, value - 1))} disabled={step === 1}>رجوع</button>{step < 4 ? <button type="button" className="button button-primary" disabled={!canNext} onClick={() => setStep((value) => value + 1)}>التالي <ArrowLeft size={17} /></button> : <button type="button" className="button button-primary" onClick={submitBooking} disabled={submitting || !policyAccepted}>{submitting ? 'جارٍ الإرسال...' : 'تأكيد الطلب'} <Send size={16} /></button>}</div></div><aside className="booking-aside"><div className="summary-card"><span className="eyebrow">ملخص الطلب</span><div className="summary-service"><span className="category-icon"><CategoryIcon name={getCategory(selectedService?.categoryId, serviceCategories)?.icon ?? 'wrench'} size={18} /></span><div><strong>{selectedService?.name ?? 'لم تختر خدمة بعد'}</strong><small>{selectedService ? selectedService.duration : 'ستظهر التفاصيل هنا'}</small></div></div><div className="summary-divider" /><div className="summary-line"><span>الرسوم</span><strong>{selectedService?.priceLabel ?? 'تحدد بعد المعاينة'}</strong></div><div className="summary-line"><span>طريقة الدفع</span><strong>بعد التنفيذ: نقدًا أو تحويلًا</strong></div></div><div className="security-note"><LockKeyhole size={17} /><div><strong>بياناتك تحت سيطرتك</strong><p>نشارك موقع العطل مع الطرف المصرح له فقط، ولا نتتبع الموقع في الخلفية.</p></div></div></aside></div></div>
}
function FormHeader({ step, title, body }: { step: string; title: string; body: string }) { return <div className="form-header"><span className="form-number">{step}</span><div><h2>{title}</h2><p className="muted">{body}</p></div></div> }
function ReviewRow({ label, value }: { label: string; value: string }) { return <div className="review-row"><span>{label}</span><strong>{value || '—'}</strong></div> }

function CustomerPage() {
  const { section: routeSection } = useParams()
  const customerSection = routeSection ?? 'overview'
  const [bookings, setBookings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [notifications, setNotifications] = useState<any[]>([])
  const [bookingQuery, setBookingQuery] = useState('')
  const [bookingFilter, setBookingFilter] = useState('all')
  const statusLabel: Record<string, string> = { pending: 'قيد المراجعة', quoted: 'بانتظار عرض', accepted: 'تم القبول', assigned: 'تم إسناد الفني', on_the_way: 'الفني في الطريق', arrived: 'وصل الفني', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى' }
  const canUpload = new Set(['pending', 'quoted', 'accepted', 'assigned'])
  const filteredBookings = useMemo(() => bookings.filter((booking) => {
    const haystack = [booking.booking_number, booking.services?.name_ar, booking.city, booking.district, booking.issue_description].filter(Boolean).join(' ').toLowerCase()
    return (!bookingQuery.trim() || haystack.includes(bookingQuery.trim().toLowerCase())) && (bookingFilter === 'all' || booking.status === bookingFilter)
  }), [bookings, bookingFilter, bookingQuery])
  const contactBooking = bookings.find((booking) => !['cancelled', 'completed'].includes(booking.status)) ?? bookings[0]
  const refreshBookings = async () => {
    setLoading(true)
    try { const { data, error } = await getMyBookings(); if (error) throw error; setBookings((data as any[]) ?? []); setMessage('') }
    catch { setMessage('تعذر تحميل الطلبات الآن. حاول مرة أخرى.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refreshBookings(); let dispose: (() => void) | undefined; void subscribeToMyBookings(() => void refreshBookings(), 'customer').then((cleanup) => { dispose = cleanup }); return () => dispose?.() }, [])
  useEffect(() => { let active = true; getMyNotifications().then(({ data, error }) => { if (!active) return; if (error) setMessage('تعذر تحميل الإشعارات الآن. حاول مرة أخرى.'); setNotifications((data as any[]) ?? []) }).catch(() => { if (active) setMessage('تعذر تحميل الإشعارات الآن. حاول مرة أخرى.') }); return () => { active = false } }, [])
  if (routeSection && !['overview', 'orders', 'store-orders', 'notifications', 'settings'].includes(routeSection)) return <Navigate to="/customer/overview" replace />
  return <DashboardLayout role="customer" eyebrow="لوحتك" title="مرحبًا بك، ابدأ من هنا." description="تابع طلباتك وفواتيرك وإشعاراتك من مساحة واحدة.">
    <div className="dashboard-grid"><div className="dashboard-main"><VoiceAssistant /><AdminContactPanel bookingId={contactBooking?.id} compact />
      {customerSection === 'overview' && <><div className="quick-actions"><Link to="/book" className="quick-action primary"><span><Plus size={20} /></span><strong>إنشاء طلب جديد</strong><small>احجز خدمة منزلية</small><ArrowUpLeft size={17} /></Link><Link to="/customer/orders" className="quick-action"><span><FileText size={20} /></span><strong>طلباتي الحالية</strong><small>راجع الحالة والصور والفواتير</small><ArrowUpLeft size={17} /></Link><Link to="/store" className="quick-action"><span><ShoppingBag size={20} /></span><strong>متجر المنتجات</strong><small>اطلب منتجًا أو تركيبًا</small><ArrowUpLeft size={17} /></Link><Link to="/customer/settings" className="quick-action"><span><UserRound size={20} /></span><strong>إعدادات الحساب</strong><small>حدّث بياناتك الأساسية</small><ArrowUpLeft size={17} /></Link></div><section className="panel dashboard-accessible-note"><h2>مساحتك جاهزة للمتابعة</h2><p className="muted">يمكنك الوصول إلى طلباتك وإعدادات الحساب من القائمة الجانبية أو أزرار المساحة.</p><Link className="text-link" to="/customer/orders">فتح الطلبات <ArrowLeft size={15} /></Link></section></>}
      {customerSection === 'store-orders' && <StoreOrdersPanel />}
      {customerSection === 'orders' && <><UnifiedOrdersCenter role="customer" items={bookings} loading={false} error={message} onRefresh={() => void refreshBookings()}><></></UnifiedOrdersCenter><div className="panel" id="orders"><SectionTitle title="طلباتك الأخيرة" action={<StatusPill>{filteredBookings.length} من {bookings.length}</StatusPill>} /><div className="booking-filters"><label className="accounts-search"><Search size={16} /><input value={bookingQuery} onChange={(event) => setBookingQuery(event.target.value)} placeholder="ابحث برقم الطلب أو الخدمة أو المدينة" /></label><select aria-label="تصفية حالة الطلب" value={bookingFilter} onChange={(event) => setBookingFilter(event.target.value)}><option value="all">كل الحالات</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{message && <div className="inline-error" role="alert"><X size={16} />{message}</div>}{loading ? <div className="loading-state">جارٍ تحميل طلباتك...</div> : filteredBookings.length ? <div className="booking-list">{filteredBookings.map((booking) => <OrderDialog key={booking.id} number={booking.booking_number} title={booking.services?.name_ar ?? 'خدمة منزلية'} status={<StatusPill tone={booking.status === 'completed' ? 'success' : booking.status === 'cancelled' ? 'warning' : 'neutral'}>{statusLabel[booking.status] ?? booking.status}</StatusPill>} meta={`${booking.city}${booking.district ? `، ${booking.district}` : ''} · ${booking.scheduled_date ?? 'موعد يحدد لاحقًا'}`}><article className="booking-row customer-booking-row"><div><span className="eyebrow">طلب #{booking.booking_number}</span><h3>{booking.services?.name_ar ?? 'خدمة منزلية'}</h3><p>{booking.city}{booking.district ? `، ${booking.district}` : ''} · {booking.scheduled_date ?? 'موعد يحدد لاحقًا'}</p>{booking.cancellation_reason && <p className="booking-cancellation-reason"><strong>سبب الإلغاء:</strong> {booking.cancellation_reason}</p>}<BookingAttachmentsPanel bookingId={booking.id} attachments={booking.attachments ?? booking.booking_attachments ?? []} canUpload={canUpload.has(booking.status)} onUploaded={refreshBookings} /><BookingStatusTimeline events={booking.booking_status_history} /><BookingChat bookingId={booking.id} /><BookingLocationTracking booking={booking} role="customer" onChanged={refreshBookings} /><CustomerBookingActions booking={booking} onComplete={refreshBookings} /></div><div className="booking-row-side"><StatusPill tone={booking.status === 'completed' ? 'success' : booking.status === 'cancelled' ? 'warning' : 'neutral'}>{statusLabel[booking.status] ?? booking.status}</StatusPill><strong>{booking.price_snapshot ? `${booking.price_snapshot} ر.س` : 'بانتظار التسعير'}</strong></div><CustomerInvoice booking={booking} />{booking.status === 'completed' && <BookingReviewForm bookingId={booking.id} existing={(booking.reviews ?? [])[0]} onSaved={(review) => setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, reviews: [review] } : item))} />}</article></OrderDialog>)}</div> : <EmptyState icon={FileText} title="لا توجد طلبات حتى الآن" body="أنشئ أول طلب، وستظهر حالته وتاريخه هنا." action={<Link className="button button-primary" to="/book">ابدأ بطلب خدمة</Link>} />}</div></>}
      {customerSection === 'settings' && <AccountSettingsPanel role="customer" />}
      {customerSection === 'notifications' && <NotificationsPanel />}
    </div><aside className="dashboard-side"><div className="panel dashboard-side-links"><Link className="text-link" to="/customer/settings">إعدادات الحساب <ArrowLeft size={14} /></Link><Link className="text-link" to="/customer/orders">الطلبات والمرفقات <ArrowLeft size={14} /></Link>{notifications.length > 0 && <span className="muted">لديك {notifications.length} إشعارات</span>}</div></aside></div>
  </DashboardLayout>
}

function ProviderPage() {
  const { section: routeSection } = useParams()
  const providerSection = routeSection ?? 'overview'
  const [queue, setQueue] = useState<any[]>([])
  const [providerProfile, setProviderProfile] = useState<any>(null)
  const [ledger, setLedger] = useState<any[]>([])
  const [fullName, setFullName] = useState('')
  const [years, setYears] = useState('')
  const [bio, setBio] = useState('')
  const [phone, setPhone] = useState('')
  const [serviceCity, setServiceCity] = useState('')
  const [identityFront, setIdentityFront] = useState<File | null>(null)
  const [identityBack, setIdentityBack] = useState<File | null>(null)
  const [certificateFile, setCertificateFile] = useState<File | null>(null)
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [providerMessage, setProviderMessage] = useState('')
  const [workMessage, setWorkMessage] = useState('')
  const [specialtyOptions, setSpecialtyOptions] = useState<any[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [specialtyMessage, setSpecialtyMessage] = useState('')
  const [specialtyBusy, setSpecialtyBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [baseLocation, setBaseLocation] = useState<GeoPoint | null>(null)

  const refreshProviderData = async () => {
    const [work, money, profile, options, selected] = await Promise.all([getProviderWorkQueue(), getProviderLedger(), getMyProviderProfile(), getProviderSpecialtyOptions(), getProviderSpecialties()])
    for (const result of [work, money, profile, options, selected]) if (result.error) throw result.error
    setQueue((work.data as any[]) ?? []); setLedger((money.data as any[]) ?? [])
    setSpecialtyOptions((options.data as any[]) ?? [])
    setSelectedServiceIds(((selected.data as any[]) ?? []).map((row) => row.service_id))
    if (profile.data) {
      const accountProfile = Array.isArray(profile.data.profiles) ? profile.data.profiles[0] : profile.data.profiles
      setProviderProfile(profile.data)
      if (profile.data.base_latitude != null && profile.data.base_longitude != null) setBaseLocation({ latitude: Number(profile.data.base_latitude), longitude: Number(profile.data.base_longitude) })
      setFullName(accountProfile?.full_name ?? '')
      setYears(String(profile.data.years_experience ?? ''))
      setBio(profile.data.service_description ?? '')
      setPhone(accountProfile?.phone ?? '')
      setServiceCity(accountProfile?.city ?? '')
    }
  }
  useEffect(() => {
    let active = true
    ;(async () => { try { await ensureProviderProfile('provider'); await refreshProviderData(); const dispose = await subscribeToMyBookings(() => void refreshProviderData(), 'provider'); if (active) (window as any).__homeProviderRealtimeDispose = dispose } catch { if (active) setWorkMessage('تعذر تحميل بيانات الفني الآن. حدّث الصفحة أو تواصل مع الإدارة.') } finally { if (active) setInitialLoading(false) } })()
    return () => { active = false; const dispose = (window as any).__homeProviderRealtimeDispose as (() => void) | undefined; dispose?.(); delete (window as any).__homeProviderRealtimeDispose }
  }, [])


  const submitVerification = async (event: React.FormEvent) => {
    event.preventDefault(); setProviderMessage('')
    if (!selectedServiceIds.length) { setProviderMessage('اختر خدمة واحدة على الأقل.'); return }
    if (fullName.trim().length < 2 || fullName.trim().length > 160) { setProviderMessage('أدخل الاسم الكامل بحروف تتراوح بين 2 و160 حرفًا.'); return }
    if (!identityFront || !identityBack) { setProviderMessage('أرفق صورة وجه الهوية وصورة ظهرها.'); return }
    const yearsNumber = Number(years)
    if (!Number.isInteger(yearsNumber) || yearsNumber < 0 || yearsNumber > 70) { setProviderMessage('أدخل سنوات خبرة صحيحة بين 0 و70.'); return }
    if (bio.trim().length < 10) { setProviderMessage('اكتب نبذة مهنية من 10 أحرف على الأقل.'); return }
    if (phone.trim().length < 6) { setProviderMessage('أدخل رقم جوال صحيحًا.'); return }
    if (serviceCity.trim().length < 2) { setProviderMessage('أدخل مدينة تقديم الخدمة.'); return }
    if (!baseLocation) { setProviderMessage('حدد موقعك الأساسي على الخريطة حتى نرشح لك الطلبات ضمن نطاق 50 كم.'); return }
    setBusy(true)
    try {
      await submitProviderOnboarding({ fullName, yearsExperience: yearsNumber, serviceDescription: bio, phone, city: serviceCity, baseLatitude: baseLocation.latitude, baseLongitude: baseLocation.longitude, serviceIds: selectedServiceIds, identityFront, identityBack, certificate: certificateFile, cv: cvFile })
      setProviderMessage('تم إرسال ملفك للمراجعة. صور الهوية إلزامية، أما الشهادة والسيرة الذاتية فاختياريتان.')
      await refreshProviderData()
    } catch (error) { setProviderMessage(error instanceof Error ? error.message : 'تعذر إرسال الملف.') }
    finally { setBusy(false) }
  }
  const saveSpecialties = async (event: React.FormEvent) => {
    event.preventDefault(); setSpecialtyMessage('')
    if (!selectedServiceIds.length) { setSpecialtyMessage('اختر خدمة واحدة على الأقل.'); return }
    setSpecialtyBusy(true)
    try { const result = await saveProviderSpecialties(selectedServiceIds); setSpecialtyMessage(result?.changed && result?.approval_status === 'pending' ? 'تم تحديث تخصصاتك وإرسالها للمراجعة قبل استقبال أعمال جديدة.' : 'تم تحديث الخدمات التي تقدمها.') }
    catch (error) { setSpecialtyMessage(error instanceof Error ? error.message : 'تعذر حفظ التخصصات.') }
    finally { setSpecialtyBusy(false) }
  }
  if (routeSection && !['overview','work-queue','specialties','verification','schedule','ledger','notifications','settings','contact'].includes(routeSection)) return <Navigate to="/provider/overview" replace />
  if (initialLoading) return <div className="container loading-state">جارٍ تجهيز لوحة الفني…</div>

  const onboardingForm = <section className="panel verification-panel provider-onboarding-form"><div className="onboarding-intro"><span className="onboarding-icon"><ShieldCheck size={22} /></span><div><span className="eyebrow">ملف مقدم الخدمة</span><h2>أكمل بيانات التسجيل</h2><p className="muted">لن تظهر الطلبات قبل استكمال البيانات ومراجعتها من الإدارة. الهوية والشهادة محفوظتان بمساحة خاصة، والسيرة الذاتية اختيارية.</p></div></div>
    <form onSubmit={submitVerification}><div className="field-grid"><label className="field-label">الاسم الكامل<input type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={160} /></label><label className="field-label">رقم الجوال<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label><label className="field-label">مدينة تقديم الخدمة<input value={serviceCity} onChange={(e) => setServiceCity(e.target.value)} autoComplete="address-level2" required maxLength={120} /></label><label className="field-label">سنوات الخبرة<input type="number" min="0" max="70" step="1" value={years} onChange={(e) => setYears(e.target.value)} required /></label></div>
      <div className="provider-base-location"><div><h3>موقعك الأساسي للخدمة</h3><p className="muted">اختر المنطقة التي تعمل فيها عادةً. يُحفظ هذا الموقع مرة واحدة ويستخدم النظام نطاقًا ثابتًا قدره 50 كم، دون تتبع موقعك المباشر.</p></div><Suspense fallback={<div className="map-loading">جارٍ تحميل الخريطة…</div>}><MapPicker value={baseLocation ?? undefined} onChange={({ point, city }) => { setBaseLocation(point); if (city && !serviceCity) setServiceCity(city) }} /></Suspense>{baseLocation && <small className="field-hint">تم تحديد الموقع الأساسي: {baseLocation.latitude.toFixed(5)}، {baseLocation.longitude.toFixed(5)}</small>}</div>
      <label className="field-label">نبذة عن خبرتك ومجالات عملك<textarea value={bio} onChange={(e) => setBio(e.target.value)} required minLength={10} maxLength={3000} placeholder="اذكر خبرتك وأبرز الأعمال التي تنفذها" rows={4} /></label>
      <div className="provider-service-picker"><div><h3>اختر الأقسام والخدمات</h3><p className="muted">يمكنك اختيار أكثر من خدمة. ستُستخدم هذه القائمة لمطابقة الطلبات المناسبة لك.</p></div><div className="specialty-options">{specialtyOptions.map((option) => { const category = Array.isArray(option.service_categories) ? option.service_categories[0] : option.service_categories; return <label className="specialty-option" key={option.id}><input type="checkbox" checked={selectedServiceIds.includes(option.id)} onChange={(event) => setSelectedServiceIds((current) => event.target.checked ? Array.from(new Set([...current, option.id])) : current.filter((id) => id !== option.id))} /><span><strong>{option.name_ar}</strong><small>{category?.name_ar ?? 'خدمة'}</small></span></label> })}</div>{!specialtyOptions.length && <p className="muted">لا توجد خدمات نشطة للاختيار حاليًا.</p>}</div>
      <div className="provider-document-grid"><label className="file-drop"><strong>هوية وطنية — الوجه</strong><span>صوّر الوجه الأمامي بوضوح</span><input type="file" accept="image/jpeg,image/png" capture="environment" onChange={(e) => setIdentityFront(e.target.files?.[0] ?? null)} required /><small>{identityFront?.name ?? 'JPG أو PNG · حتى 5MB'}</small></label><label className="file-drop"><strong>هوية وطنية — الظهر</strong><span>صوّر الوجه الخلفي بوضوح</span><input type="file" accept="image/jpeg,image/png" capture="environment" onChange={(e) => setIdentityBack(e.target.files?.[0] ?? null)} required /><small>{identityBack?.name ?? 'JPG أو PNG · حتى 5MB'}</small></label></div>
      <div className="provider-extra-documents"><label className="file-drop cert-drop"><strong>الشهادة المهنية <span className="optional">اختياري</span></strong><span>يمكن إضافتها لاحقًا أو تركها فارغة</span><input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(e) => setCertificateFile(e.target.files?.[0] ?? null)} /><small>{certificateFile?.name ?? 'JPG أو PNG أو PDF · حتى 5MB'}</small></label><label className="file-drop cv-drop"><strong>السيرة الذاتية <span className="optional">اختياري</span></strong><span>يمكنك إضافتها الآن أو ترك الحقل فارغًا</span><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setCvFile(e.target.files?.[0] ?? null)} /><small>{cvFile?.name ?? 'PDF أو DOC أو DOCX · حتى 10MB'}</small></label></div>
      {providerMessage && <div className={providerMessage.startsWith('تعذر') || providerMessage.startsWith('أرفق') || providerMessage.startsWith('اختر') || providerMessage.startsWith('أدخل') || providerMessage.startsWith('اكتب') || providerMessage.includes('الشهادة المهنية اختيارية') ? 'inline-error' : 'success-note'} role="status">{providerMessage}</div>}
      <button className="button button-primary button-wide" disabled={busy || !specialtyOptions.length}>{busy ? 'جارٍ إرسال الملف…' : 'إرسال للمراجعة'}</button>
    </form>
  </section>

  if (!providerProfile?.onboarding_completed) return <div className="provider-onboarding-overlay"><section className="provider-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-onboarding-title"><div className="provider-onboarding-header"><span className="eyebrow">لوحة الفني · إكمال التسجيل</span><h1 id="provider-onboarding-title">خطوة واحدة قبل بدء العمل</h1><p className="muted">أكمل بياناتك وارفع الهوية والشهادة مرة واحدة لإرسال ملفك إلى الإدارة؛ السيرة الذاتية اختيارية.</p></div>{workMessage.startsWith('تعذر') && <div className="inline-error"><X size={16} />{workMessage}</div>}{onboardingForm}</section></div>
  if (providerSection === 'verification') return <DashboardLayout role="provider" eyebrow="الاعتماد" title="ملف الاعتماد" description="تابع حالة ملفك المهني ومستنداتك الخاصة."><div className="dashboard-grid"><div className="dashboard-main"><div className="provider-banner"><div><span className="eyebrow">حالة الاعتماد</span><h2>{providerProfile.approval_status === 'approved' ? 'حسابك معتمد' : providerProfile.approval_status === 'rejected' ? 'يلزم تحديث الملف' : 'ملفك قيد المراجعة'}</h2><p>{providerProfile.approval_status === 'rejected' ? 'يمكنك تحديث الملف وإعادة إرساله للمراجعة.' : 'تم استلام بياناتك؛ لا حاجة لإرسالها مرة أخرى.'}</p></div></div></div><aside className="dashboard-side">{providerProfile.approval_status === 'rejected' ? onboardingForm : <div className="panel"><SectionTitle title="الملف محفوظ" description="بياناتك ومستنداتك محفوظة في مساحة خاصة وتظهر للإدارة فقط." /></div>}</aside></div></DashboardLayout>

  const total = ledger.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const providerStatus = providerProfile.approval_status === 'approved' ? 'الحساب معتمد' : providerProfile.approval_status === 'rejected' ? 'يلزم تحديث البيانات' : 'قيد مراجعة الإدارة'
  return <DashboardLayout role="provider" eyebrow="لوحة الفني" title="طلباتك أولًا" description="تابع الطلبات المسندة، حدّث حالتها، وأضف ملاحظاتك من مكان واحد.">
    <div className="dashboard-grid provider-dashboard-clean"><div className="dashboard-main">
      {providerSection === 'overview' && <><AdminContactPanel bookingId={queue[0]?.id} compact /><UnifiedOrdersCenter role="provider" items={queue} loading={false} error={workMessage} onRefresh={() => void refreshProviderData()}><></></UnifiedOrdersCenter>
        <div className="provider-kpi-grid"><div className="metric-card"><span className="muted">طلبات حالية</span><strong>{queue.length}</strong></div><div className="metric-card"><span className="muted">الرصيد الحالي</span><strong>{total.toFixed(2)} ر.س</strong></div></div>
        <section className="panel provider-home-queue"><div className="panel-heading"><div><span className="eyebrow">تشغيل اليوم</span><h2>الطلبات المسندة</h2></div><Link className="text-link" to="/provider/work-queue">عرض الكل <ArrowLeft size={15} /></Link></div>{queue.length ? <div className="booking-list">{queue.slice(0, 3).map((item) => <ProviderJobCard key={item.id} item={item} onUpdate={refreshProviderData} onMessage={setWorkMessage} />)}</div> : <EmptyState icon={MessageCircle} title="لا توجد طلبات مسندة" body="ستظهر الطلبات هنا عند إسنادها إليك." />}</section>
      </>}
      {providerSection === 'work-queue' && <><UnifiedOrdersCenter role="provider" items={queue} loading={false} error={workMessage} onRefresh={() => void refreshProviderData()}><></></UnifiedOrdersCenter><div className="panel" id="work-queue"><SectionTitle title="الطلبات" action={<StatusPill>{queue.length} طلبات</StatusPill>} />{workMessage && <div className={workMessage.startsWith('تعذر') ? 'inline-error' : 'success-note'}>{workMessage}</div>}{queue.length ? <div className="booking-list">{queue.map((item) => <ProviderJobCard key={item.id} item={item} onUpdate={refreshProviderData} onMessage={setWorkMessage} />)}</div> : <EmptyState icon={MessageCircle} title="لا توجد طلبات مسندة" body="ستظهر الطلبات هنا عند إسنادها إليك." />}</div></>}
      {providerSection === 'schedule' && <ProviderSchedulePanel />}
      {providerSection === 'contact' && <AdminContactPanel bookingId={queue[0]?.id} />}
      {providerSection === 'settings' && <AccountSettingsPanel role="provider" />}
      {providerSection === 'notifications' && <NotificationsPanel />}
      {providerSection === 'ledger' && <div className="panel provider-ledger" id="ledger"><SectionTitle title="الأرباح" /><div className="ledger-total"><span>الرصيد الحالي</span><strong>{total.toFixed(2)} ر.س</strong></div>{ledger.length ? ledger.map((item) => <div className="ledger-row" key={item.id}><span>{item.entry_type === 'late_penalty' ? 'خصم تأخير' : item.entry_type === 'earning' ? 'أجر خدمة' : 'تسوية'}</span><strong className={Number(item.amount) < 0 ? 'negative' : 'positive'}>{Number(item.amount).toFixed(2)} ر.س</strong></div>) : <p className="muted">ستظهر الأرباح بعد إتمام أول خدمة.</p>}</div>}
    </div><aside className="dashboard-side"><div className="panel provider-status-card"><StatusPill tone={providerProfile.approval_status === 'approved' ? 'success' : 'warning'}>{providerStatus}</StatusPill><Link className="text-link" to="/provider/notifications">فتح الإشعارات <ArrowLeft size={14} /></Link></div></aside></div>
  </DashboardLayout>

}
function ProviderSchedulePanel() {
  const weekDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  const [weekly, setWeekly] = useState<Record<number, { enabled: boolean; start: string; end: string }>>(() => Object.fromEntries(weekDays.map((_, day) => [day, { enabled: day < 5, start: '09:00', end: '18:00' }])))
  const [timeOff, setTimeOff] = useState<any[]>([])
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void getProviderSchedule().then((result) => { if (result.error) { setMessage('تعذر تحميل الجدول الآن.'); return }; const next = { ...weekly }; (result.weekly as any[]).forEach((row) => { next[Number(row.weekday)] = { enabled: Boolean(row.is_enabled), start: String(row.start_time).slice(0, 5), end: String(row.end_time).slice(0, 5) } }); setWeekly(next); setTimeOff((result.timeOff as any[]) ?? []) }).catch(() => setMessage('تعذر تحميل الجدول الآن.')) }, [])
  const save = async () => { setBusy(true); setMessage(''); try { await saveProviderSchedule(Object.entries(weekly).map(([weekday, row]) => ({ weekday: Number(weekday), start_time: row.start, end_time: row.end, is_enabled: row.enabled }))); setMessage('تم حفظ جدول العمل.') } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر حفظ الجدول.') } finally { setBusy(false) } }
  const addHoliday = async () => { setMessage(''); try { const item = await addProviderTimeOff({ startsOn, endsOn, reason }); setTimeOff((current) => [...current, item]); setStartsOn(''); setEndsOn(''); setReason(''); setMessage('تمت إضافة فترة الإجازة.') } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر إضافة الإجازة.') } }
  const removeHoliday = async (id: string) => { try { await removeProviderTimeOff(id); setTimeOff((current) => current.filter((item) => item.id !== id)); setMessage('تم حذف الإجازة.') } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر حذف الإجازة.') } }
  return <div className="schedule-stack"><section className="panel"><SectionTitle eyebrow="التوفر" title="جدول العمل الأسبوعي" description="حدد أيام وساعات استقبال المهام. لا يشارك هذا الجدول موقعك ولا يتتبعك في الخلفية." /><div className="schedule-list">{weekDays.map((label, day) => <div className="schedule-row" key={label}><label className="schedule-day"><input type="checkbox" checked={weekly[day].enabled} onChange={(event) => setWeekly((current) => ({ ...current, [day]: { ...current[day], enabled: event.target.checked } }))} /><strong>{label}</strong></label><input type="time" value={weekly[day].start} disabled={!weekly[day].enabled} onChange={(event) => setWeekly((current) => ({ ...current, [day]: { ...current[day], start: event.target.value } }))} /><span>إلى</span><input type="time" value={weekly[day].end} disabled={!weekly[day].enabled} onChange={(event) => setWeekly((current) => ({ ...current, [day]: { ...current[day], end: event.target.value } }))} /></div>)}</div><button className="button button-primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? 'جارٍ الحفظ...' : 'حفظ جدول العمل'}</button></section><section className="panel"><SectionTitle eyebrow="الاستثناءات" title="الإجازات وفترات عدم التوفر" description="أضف فترة لن يتم خلالها ترشيحك لمهام جديدة وفق الجدول القادم." /><div className="field-grid"><label className="field-label">من<input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="field-label">إلى<input type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div><label className="field-label">السبب <span className="optional">اختياري</span><input maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="إجازة أو ظرف خاص" /></label><button className="button button-secondary" type="button" onClick={() => void addHoliday()}>إضافة فترة عدم توفر</button>{timeOff.length ? <div className="time-off-list">{timeOff.map((item) => <div className="time-off-row" key={item.id}><div><strong>{item.starts_on} — {item.ends_on}</strong><small>{item.reason || 'فترة عدم توفر'}</small></div><button className="text-link danger-link" type="button" onClick={() => void removeHoliday(item.id)}>حذف</button></div>)}</div> : <p className="muted">لا توجد إجازات مضافة.</p>}</section>{message && <div className={message.startsWith('تم') ? 'success-note' : 'inline-error'} role="status">{message}</div>}</div>
}
function AdminPage() { return <AdminWorkspace /> }
function dashboardPath(role: Role) { return role === 'admin' || role === 'sub_admin' ? '/admin/overview' : role === 'provider' ? '/provider/overview' : '/customer/overview' }
function safeNextPath(value: string | null) { return value && value.startsWith('/') && !value.startsWith('//') ? value : null }

function DashboardLayout({ role, eyebrow, title, description, children }: { role: Role; eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  const location = useLocation()
  const customerNav = [{ label: 'الرئيسية', icon: Gauge, to: '/customer/overview' }, { label: 'الطلبات', icon: FileText, to: '/customer/orders' }, { label: 'طلبات المنتجات', icon: ShoppingBag, to: '/customer/store-orders' }, { label: 'اطلب خدمة', icon: MapPin, to: '/book' }, { label: 'الإشعارات', icon: MessageCircle, to: '/customer/notifications' }, { label: 'الإعدادات', icon: Settings2, to: '/customer/settings' }]
  const providerNav = [{ label: 'الرئيسية', icon: Gauge, to: '/provider/overview' }, { label: 'الطلبات', icon: FileText, to: '/provider/work-queue' }, { label: 'التواصل مع الإدارة', icon: MessageCircle, to: '/provider/contact' }, { label: 'الجدول', icon: CalendarDays, to: '/provider/schedule' }, { label: 'الأرباح', icon: WalletCards, to: '/provider/ledger' }, { label: 'الإشعارات', icon: MessageCircle, to: '/provider/notifications' }, { label: 'الإعدادات', icon: Settings2, to: '/provider/settings' }]
  const nav = role === 'provider' ? providerNav : customerNav
  return <div className={`container dashboard-page ${role === 'customer' ? 'customer-mobile-dashboard' : ''}`}><div className="dashboard-shell"><aside className="dashboard-nav"><div className="nav-user"><span className="user-avatar"><UserRound size={18} /></span><div><strong>{role === 'provider' ? 'الفني' : 'العميل'}</strong></div></div>{nav.map(({ label, icon: Icon, to }) => <Link className={location.pathname === to ? 'active' : ''} key={label} to={to}><Icon size={17} />{label}</Link>)}<div className="nav-bottom">{role === 'customer' ? <Link to="/book" className="button button-primary button-wide"><Plus size={16} />طلب جديد</Link> : <Link to="/" className="button button-secondary button-wide">العودة للموقع</Link>}</div></aside><div className="dashboard-content">{children}</div></div></div>
}

export default App

function NotificationMonitor() {
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    const connect = async () => {
      unsubscribe?.(); unsubscribe = undefined
      const auth = await getAuthState()
      if (!active || !auth.user) return
      unsubscribe = await subscribeToMyNotifications((item: AppNotification) => {
        if (!active) return
        playNotificationChime()
        window.dispatchEvent(new CustomEvent('homefix:notification', { detail: item }))
        if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
          void navigator.serviceWorker?.ready.then((registration) => registration.showNotification(item.title, { body: item.body, icon: '/icons/homefix-192.png', badge: '/icons/homefix-192.png', tag: item.id, data: { url: item.target_path || '/' } })).catch(() => undefined)
        }
      })
    }
    void connect()
    const authSubscription = onAuthStateChange(() => { void connect() })
    const nativePush = (event: Event) => {
      if (!active) return
      const notification = (event as CustomEvent<any>).detail
      playNotificationChime()
      if (notification?.id || notification?.data?.notification_id) {
        const item: AppNotification = {
          id: notification.id ?? notification.data.notification_id,
          title: notification.title ?? 'إشعار جديد',
          body: notification.body ?? '',
          notification_type: notification.data?.notification_type ?? 'general',
          target_path: notification.data?.target_path ?? '/customer/notifications',
          is_read: false,
          created_at: new Date().toISOString(),
        }
        window.dispatchEvent(new CustomEvent('homefix:notification', { detail: item }))
      }
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
        void navigator.serviceWorker?.ready.then((registration) => registration.showNotification(notification?.title ?? 'إشعار جديد', { body: notification?.body ?? '', icon: '/icons/homefix-192.png', badge: '/icons/homefix-192.png', tag: notification?.id ?? `push-${Date.now()}` })).catch(() => undefined)
      }
    }
    window.addEventListener('homefix:push-received', nativePush)
    return () => { active = false; unsubscribe?.(); authSubscription.unsubscribe(); window.removeEventListener('homefix:push-received', nativePush) }
  }, [])
  return null
}
