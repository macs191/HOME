import { Bell, Download, Menu, Moon, Search, Sun, UserRound, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BrandMark } from './Brand'
import { signOutAccount } from '../lib/supabase'

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

function ProfileHub({ role, onClose, onSignOut, signingOut }: { role: 'customer' | 'provider' | 'admin' | null; onClose: () => void; onSignOut: () => void; signingOut: boolean }) {
  if (!role) return <section className="profile-hub" role="dialog" aria-label="الحساب"><div className="profile-hub-head"><strong>الحساب</strong><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div><p className="muted">سجّل الدخول للوصول إلى الطلبات والإعدادات.</p><div className="profile-hub-links"><Link to="/downloads" onClick={onClose}>تحميل التطبيقات</Link></div><Link className="button button-primary button-wide" to="/customer/login" onClick={onClose}>تسجيل الدخول</Link></section>
  if (role === 'admin') return <section className="profile-hub" role="dialog" aria-label="حساب الإدارة"><div className="profile-hub-head"><div className="profile-hub-avatar"><UserRound size={20} /></div><div><strong>حساب الإدارة</strong><small>الوصول السريع</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div><nav className="profile-hub-links" aria-label="روابط الإدارة"><Link to="/admin/overview" onClick={onClose}>الرئيسية</Link><Link to="/admin/operations" onClick={onClose}>الطلبات والإسناد</Link><Link to="/admin/accounts" onClick={onClose}>العملاء والفنيون</Link><Link to="/admin/notifications" onClick={onClose}>الإشعارات</Link><Link to="/admin/settings" onClick={onClose}>إعدادات المنصة</Link></nav><button type="button" className="profile-hub-signout" onClick={onSignOut} disabled={signingOut}>{signingOut ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}</button></section>
  const base = role === 'provider' ? '/provider' : '/customer'
  return <section className="profile-hub" role="dialog" aria-label="ملف الحساب">
    <div className="profile-hub-head"><div className="profile-hub-avatar"><UserRound size={20} /></div><div><strong>{role === 'provider' ? 'حساب الفني' : 'حساب العميل'}</strong><small>الوصول السريع</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div>
    <nav className="profile-hub-links" aria-label="روابط الحساب"><Link to={`${base}/overview`} onClick={onClose}>الرئيسية</Link><Link to={role === 'provider' ? `${base}/work-queue` : `${base}/orders`} onClick={onClose}>الطلبات</Link><Link to={`${base}/notifications`} onClick={onClose}>الإشعارات</Link><Link to={`${base}/settings`} onClick={onClose}>إعدادات الحساب</Link><Link to="/downloads" onClick={onClose}>تحميل التطبيقات</Link></nav>
    <button type="button" className="profile-hub-signout" onClick={onSignOut} disabled={signingOut}>{signingOut ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}</button>
  </section>
}

export function Shell({ children, theme, onThemeChange }: { children: ReactNode; theme: 'light' | 'dark'; onThemeChange: () => void }) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [installGuideOpen, setInstallGuideOpen] = useState(false)
  const [appInstalled, setAppInstalled] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const location = useLocation()
  const role = location.pathname.startsWith('/provider') ? 'provider' : location.pathname.startsWith('/customer') ? 'customer' : location.pathname.startsWith('/admin') ? 'admin' : null
  const inWorkspace = Boolean(role || location.pathname.startsWith('/admin'))

  useEffect(() => setProfileOpen(false), [location.pathname])
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    const installed = () => { setInstallPrompt(null); setAppInstalled(true) }
    const checkStandalone = () => setAppInstalled(isStandaloneApp())
    window.addEventListener('beforeinstallprompt', capture); window.addEventListener('appinstalled', installed); checkStandalone()
    const displayMode = window.matchMedia?.('(display-mode: standalone)'); displayMode?.addEventListener?.('change', checkStandalone)
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installed); displayMode?.removeEventListener?.('change', checkStandalone) }
  }, [])
  useEffect(() => {
    if (!profileOpen && !installGuideOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setProfileOpen(false); setInstallGuideOpen(false) } }
    window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape)
  }, [profileOpen, installGuideOpen])
  const installApp = async () => {
    setProfileOpen(false)
    if (appInstalled || isStandaloneApp()) { setAppInstalled(true); return }
    if (!installPrompt) { setInstallGuideOpen(true); return }
    try { await installPrompt.prompt(); const choice = await installPrompt.userChoice; setInstallPrompt(null); if (choice.outcome === 'accepted') setAppInstalled(true) } catch { setInstallGuideOpen(true) }
  }
  const handleSignOut = async () => { setSigningOut(true); try { await signOutAccount(); window.location.assign('/') } catch { setSigningOut(false) } }
  const nav = [{ to: '/', label: 'الرئيسية' }, { to: '/services', label: 'الخدمات' }, { to: '/about', label: 'عن هوم سيرفس' }, { to: '/book', label: 'اطلب خدمة' }, { to: '/customer/login', label: 'دخول العملاء' }, { to: '/provider/login', label: 'دخول الفنيين' }]

  return <div className={`app-shell ${inWorkspace ? 'workspace-shell' : ''}`}>
    <header className="topbar"><div className="topbar-inner">
      <Link to="/" className="brand-link" aria-label="هوم سيرفس — الرئيسية"><BrandMark /></Link>
      {!inWorkspace && <nav id="main-site-navigation" className="main-nav" aria-label="روابط الموقع">{nav.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>{item.label}</NavLink>)}<NavLink to="/downloads" className={({ isActive }) => isActive ? 'active' : ''}>تحميل التطبيقات</NavLink></nav>}
      <div className="topbar-actions">{!inWorkspace && installPrompt && !appInstalled && <button type="button" className="button button-small install-app-button" onClick={() => void installApp()}>تثبيت التطبيق</button>}<Link className="icon-button hide-mobile" aria-label="بحث" to="/services"><Search size={18} /></Link><Link className="icon-button" aria-label="مركز الإشعارات" title="مركز الإشعارات" to={role === 'admin' ? '/admin/notifications' : role === 'provider' ? '/provider/notifications' : '/customer/notifications'}><Bell size={18} /></Link><button type="button" className="icon-button hide-mobile" onClick={onThemeChange} aria-label="تغيير المظهر">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><button type="button" className="icon-button mobile-menu-trigger" onClick={() => setProfileOpen((value) => !value)} aria-label="فتح القائمة" aria-expanded={profileOpen}><Menu size={21} /></button><button type="button" className="icon-button profile-trigger hide-mobile" onClick={() => setProfileOpen((value) => !value)} aria-label="الحساب" aria-expanded={profileOpen}><UserRound size={19} /></button><Link to="/book" className="button button-small hide-mobile">ابدأ طلبك</Link></div>
    </div></header>
    {profileOpen && <div className="profile-hub-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false) }}><ProfileHub role={role} onClose={() => setProfileOpen(false)} onSignOut={() => void handleSignOut()} signingOut={signingOut} /></div>}
    <main>{children}</main>
    <footer className="footer"><div className="container footer-grid"><div><BrandMark /><p className="muted footer-copy">منصة تربطك بفني مناسب، في الوقت المناسب.</p></div><div><strong>روابط سريعة</strong><Link to="/services">استعرض الخدمات</Link><Link to="/book">أنشئ طلبًا</Link><Link to="/about">عن هوم سيرفس</Link></div><div><strong>حسابات المنصة</strong><Link to="/customer/login">دخول العملاء</Link><Link to="/provider/login">دخول الفنيين</Link></div><div><strong>الدعم والخصوصية</strong><Link to="/customer/login">فتح لوحة العميل</Link><Link to="/privacy">الخصوصية والحماية</Link><Link to="/downloads">تحميل التطبيقات</Link></div></div><div className="container footer-bottom"><span>© 2026 هوم سيرفس</span></div></footer>
    {installGuideOpen && <InstallGuide onClose={() => setInstallGuideOpen(false)} />}
  </div>
}
