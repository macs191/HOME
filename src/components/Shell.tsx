import { Bell, Menu, Moon, Search, Sun, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BrandMark } from './Brand'

export function Shell({ children, theme, onThemeChange }: { children: ReactNode; theme: 'light' | 'dark'; onThemeChange: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const location = useLocation()
  useEffect(() => setMobileOpen(false), [location.pathname])
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event) }
    const installed = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', installed)
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installed) }
  }, [])
  const installApp = async () => { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null) }
  const nav = [{ to: '/', label: 'الرئيسية' }, { to: '/services', label: 'الخدمات' }, { to: '/book', label: 'اطلب خدمة' }, { to: '/customer/login', label: 'دخول العملاء' }, { to: '/provider/login', label: 'دخول الفنيين' }]
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <button className="icon-button mobile-menu" onClick={() => setMobileOpen((value) => !value)} aria-label="فتح القائمة">{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <Link to="/" className="brand-link"><BrandMark /></Link>
        <nav className={`main-nav ${mobileOpen ? 'is-open' : ''}`}>{nav.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>{item.label}</NavLink>)}</nav>
        <div className="topbar-actions">
          {installPrompt && <button className="button button-small install-app-button" onClick={() => void installApp()}>تثبيت التطبيق</button>}
          <Link className="icon-button hide-mobile" aria-label="بحث" to="/services"><Search size={18} /></Link>
          <Link className="icon-button" aria-label="إشعارات العميل" title="إشعارات العميل" to="/customer#notifications"><Bell size={18} /></Link>
          <button className="icon-button" onClick={onThemeChange} aria-label="تغيير المظهر">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link to="/customer/login" className="login-link hide-mobile">دخول العملاء</Link>
          <Link to="/book" className="button button-small hide-mobile">ابدأ طلبك</Link>
        </div>
      </div>
    </header>
    <main>{children}</main>
    <footer className="footer"><div className="container footer-grid"><div><BrandMark /><p className="muted footer-copy">منصة تربطك بفني مناسب، في الوقت المناسب. بوضوح أكبر وبدون وعود غير مؤكدة.</p></div><div><strong>روابط سريعة</strong><Link to="/services">استعرض الخدمات</Link><Link to="/book">أنشئ طلبًا</Link><Link to="/provider">انضم كمقدم خدمة</Link></div><div><strong>حسابات المنصة</strong><Link to="/customer/login">دخول العملاء</Link><Link to="/provider/login">دخول الفنيين</Link><Link to="/admin">لوحة الإدارة</Link></div><div><strong>الدعم</strong><p className="muted">تابع حالة الطلب والتنبيهات من مساحة العميل.</p><Link to="/customer/login">فتح مساحة العميل</Link></div></div><div className="container footer-bottom"><span>© 2026 هوم سيرفس</span><span>مصمم للخدمة الحقيقية، لا للأرقام الوهمية.</span></div></footer>
  </div>
}
