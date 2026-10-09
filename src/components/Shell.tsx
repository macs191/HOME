import { Bell, ChevronDown, Menu, Moon, Search, Sun, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BrandMark } from './Brand'
import type { Notice } from '../types'

const notices: Notice[] = [{ id: '1', title: 'مركز الإشعارات جاهز', body: 'ستظهر هنا تحديثات طلباتك عند ربط الحساب.', time: 'الآن', unread: true }]

export function Shell({ children, theme, onThemeChange }: { children: ReactNode; theme: 'light' | 'dark'; onThemeChange: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMobileOpen(false), [location.pathname])
  const nav = [{ to: '/', label: 'الرئيسية' }, { to: '/services', label: 'الخدمات' }, { to: '/book', label: 'اطلب خدمة' }, { to: '/customer', label: 'مساحة العميل' }]
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <button className="icon-button mobile-menu" onClick={() => setMobileOpen((value) => !value)} aria-label="فتح القائمة">{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <Link to="/" className="brand-link"><BrandMark /></Link>
        <nav className={`main-nav ${mobileOpen ? 'is-open' : ''}`}>{nav.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>{item.label}</NavLink>)}</nav>
        <div className="topbar-actions">
          <button className="icon-button hide-mobile" aria-label="بحث"><Search size={18} /></button>
          <div className="notice-wrap"><button className="icon-button" onClick={() => setNoticeOpen((value) => !value)} aria-label="الإشعارات"><Bell size={18} /><span className="notice-dot" /></button>{noticeOpen && <div className="notice-popover"><div className="popover-head"><strong>الإشعارات</strong><span className="soft-label">{notices.length} جديد</span></div>{notices.map((notice) => <div className="notice-item" key={notice.id}><span className="notice-bullet" /><div><strong>{notice.title}</strong><p>{notice.body}</p><small>{notice.time}</small></div></div>)}<Link to="/customer" className="popover-link">عرض مساحة العميل</Link></div>}</div>
          <button className="icon-button" onClick={onThemeChange} aria-label="تغيير المظهر">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link to="/login" className="login-link hide-mobile">تسجيل الدخول <ChevronDown size={14} /></Link>
          <Link to="/book" className="button button-small hide-mobile">ابدأ طلبك</Link>
        </div>
      </div>
    </header>
    <main>{children}</main>
    <footer className="footer"><div className="container footer-grid"><div><BrandMark /><p className="muted footer-copy">منصة تربطك بفني مناسب، في الوقت المناسب. بوضوح أكبر وبدون وعود غير مؤكدة.</p></div><div><strong>روابط سريعة</strong><Link to="/services">استعرض الخدمات</Link><Link to="/book">أنشئ طلبًا</Link><Link to="/provider">انضم كمقدم خدمة</Link></div><div><strong>الدعم والسياسات</strong><Link to="/customer">مركز المساعدة</Link><Link to="/customer">سياسة الخصوصية</Link><Link to="/customer">سياسة الإلغاء</Link></div><div><strong>تواصل معنا</strong><p className="muted">support@homeservice.example</p><p className="muted">السبت – الخميس، 9 ص – 9 م</p></div></div><div className="container footer-bottom"><span>© 2026 هوم سيرفس</span><span>مصمم للخدمة الحقيقية، لا للأرقام الوهمية.</span></div></footer>
  </div>
}
