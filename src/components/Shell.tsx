import { Bell, Download, Menu, Moon, Search, Sun, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BrandMark } from './Brand'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<InstallChoice> }

function isStandaloneApp() {
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone)
}

function InstallGuide({ onClose }: { onClose: () => void }) {
  const userAgent = navigator.userAgent
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent) && !(window as Window & { MSStream?: unknown }).MSStream
  const isAndroid = /Android/i.test(userAgent)
  const steps = isAppleMobile
    ? ['افتح الموقع في متصفح Safari.', 'اضغط زر «مشاركة» أسفل الشاشة أو أعلاها.', 'اختر «إضافة إلى الشاشة الرئيسية»، ثم اضغط «إضافة».']
    : isAndroid
      ? ['افتح الموقع في Chrome.', 'افتح قائمة المتصفح ⋮.', 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».']
      : ['افتح قائمة المتصفح أو رمز التثبيت بجانب شريط العنوان.', 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».']

  return <div className="install-guide-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="install-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
      <button type="button" className="icon-button install-guide-close" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
      <span className="install-guide-icon"><Download size={22} /></span>
      <span className="eyebrow">تطبيق ويب قابل للتثبيت</span>
      <h2 id="install-guide-title">أضف هوم سيرفس إلى جهازك</h2>
      <p className="muted">سيظهر التطبيق على الشاشة الرئيسية ويفتح في نافذة مستقلة عندما يدعم متصفحك ذلك.</p>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <button type="button" className="button button-primary button-wide" onClick={onClose}>حسنًا</button>
    </section>
  </div>
}

export function Shell({ children, theme, onThemeChange }: { children: ReactNode; theme: 'light' | 'dark'; onThemeChange: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [installGuideOpen, setInstallGuideOpen] = useState(false)
  const [appInstalled, setAppInstalled] = useState(false)
  const location = useLocation()

  useEffect(() => setMobileOpen(false), [location.pathname])

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const installed = () => { setInstallPrompt(null); setAppInstalled(true) }
    const checkStandalone = () => setAppInstalled(isStandaloneApp())
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', installed)
    checkStandalone()
    const displayMode = window.matchMedia?.('(display-mode: standalone)')
    displayMode?.addEventListener?.('change', checkStandalone)
    return () => {
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('appinstalled', installed)
      displayMode?.removeEventListener?.('change', checkStandalone)
    }
  }, [])

  useEffect(() => {
    if (!mobileOpen && !installGuideOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); setInstallGuideOpen(false) }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen, installGuideOpen])

  const installApp = async () => {
    setMobileOpen(false)
    if (appInstalled || isStandaloneApp()) { setAppInstalled(true); return }
    if (!installPrompt) { setInstallGuideOpen(true); return }
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallPrompt(null)
      if (choice.outcome === 'accepted') setAppInstalled(true)
    } catch {
      setInstallGuideOpen(true)
    }
  }

  const nav = [
    { to: '/', label: 'الرئيسية' },
    { to: '/services', label: 'الخدمات' },
    { to: '/book', label: 'اطلب خدمة' },
    { to: '/customer/login', label: 'دخول العملاء' },
    { to: '/provider/login', label: 'دخول الفنيين' },
  ]

  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="icon-button mobile-menu" onClick={() => setMobileOpen((value) => !value)} aria-label={mobileOpen ? 'إغلاق القائمة' : 'فتح القائمة'} aria-expanded={mobileOpen} aria-controls="main-site-navigation">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link to="/" className="brand-link" aria-label="هوم سيرفس — الرئيسية"><BrandMark /></Link>
        <nav id="main-site-navigation" className={`main-nav ${mobileOpen ? 'is-open' : ''}`} aria-label="روابط الموقع">
          {nav.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive ? 'active' : ''}>{item.label}</NavLink>)}
          <button type="button" className="main-nav-install" onClick={() => void installApp()} disabled={appInstalled}>
            <Download size={17} /><span>{appInstalled ? 'التطبيق مثبت' : 'تثبيت التطبيق'}</span>
          </button>
        </nav>
        <div className="topbar-actions">
          {installPrompt && !appInstalled && <button type="button" className="button button-small install-app-button" onClick={() => void installApp()}><Download size={15} /> تثبيت التطبيق</button>}
          <Link className="icon-button hide-mobile" aria-label="بحث" to="/services"><Search size={18} /></Link>
          <Link className="icon-button" aria-label="مركز الإشعارات" title="مركز الإشعارات" to={location.pathname.startsWith('/admin') ? '/admin/notifications' : location.pathname.startsWith('/provider') ? '/provider/notifications' : '/customer/notifications'}><Bell size={18} /></Link>
          <button type="button" className="icon-button" onClick={onThemeChange} aria-label="تغيير المظهر">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link to="/customer/login" className="login-link hide-mobile">دخول العملاء</Link>
          <Link to="/book" className="button button-small hide-mobile">ابدأ طلبك</Link>
        </div>
      </div>
    </header>
    <main>{children}</main>
    <footer className="footer"><div className="container footer-grid"><div><BrandMark /><p className="muted footer-copy">منصة تربطك بفني مناسب، في الوقت المناسب. بوضوح أكبر وبدون وعود غير مؤكدة.</p></div><div><strong>روابط سريعة</strong><Link to="/services">استعرض الخدمات</Link><Link to="/book">أنشئ طلبًا</Link><Link to="/provider">انضم كمقدم خدمة</Link></div><div><strong>حسابات المنصة</strong><Link to="/customer/login">دخول العملاء</Link><Link to="/provider/login">دخول الفنيين</Link><Link to="/admin">لوحة الإدارة</Link></div><div><strong>الدعم</strong><p className="muted">تابع حالة الطلب والتنبيهات من مساحة العميل.</p><Link to="/customer/login">فتح مساحة العميل</Link></div></div><div className="container footer-bottom"><span>© 2026 هوم سيرفس</span><span>مصمم للخدمة الحقيقية، لا للأرقام الوهمية.</span></div></footer>
    {installGuideOpen && <InstallGuide onClose={() => setInstallGuideOpen(false)} />}
  </div>
}
