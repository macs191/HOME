import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

export type MobileNavItem = { to: string; label: string; icon: LucideIcon }

export function MobileBottomNav({ items, activePath }: { items: MobileNavItem[]; activePath: string }) {
  return <nav className="mobile-bottom-nav" aria-label="التنقل الرئيسي للهاتف">
    {items.map(({ to, label, icon: Icon }) => {
      const active = activePath === to || (to !== '/' && activePath.startsWith(`${to}/`))
      return <Link key={to} to={to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
        <Icon size={19} strokeWidth={active ? 2.4 : 1.8} /><span>{label}</span>
      </Link>
    })}
  </nav>
}
