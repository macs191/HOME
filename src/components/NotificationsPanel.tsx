import { useEffect, useState } from 'react'
import { Bell, BellRing, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getMyNotifications, markNotificationRead, type AppNotification } from '../lib/supabase'

export function playNotificationChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const now = context.currentTime
    ;[880, 1174].forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, now + index * 0.13)
      gain.gain.exponentialRampToValueAtTime(0.13, now + index * 0.13 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + 0.22)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(now + index * 0.13); oscillator.stop(now + index * 0.13 + 0.23)
    })
    window.setTimeout(() => void context.close(), 700)
  } catch { /* لا نوقف واجهة التطبيق إذا منع المتصفح الصوت */ }
}

export function NotificationsPanel() {
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState<NotificationPermission>(() => 'Notification' in window ? Notification.permission : 'denied')

  const refresh = async () => {
    setError('')
    const { data, error: resultError } = await getMyNotifications()
    if (resultError) setError('تعذر تحميل إشعاراتك. تحقق من الاتصال ثم أعد المحاولة.')
    else setItems((data ?? []) as AppNotification[])
    setLoading(false)
  }
  useEffect(() => {
    void refresh()
    const update = (event: Event) => {
      const item = (event as CustomEvent<AppNotification>).detail
      setItems((current) => [item, ...current.filter((notice) => notice.id !== item.id)].slice(0, 30))
    }
    window.addEventListener('homefix:notification', update)
    return () => window.removeEventListener('homefix:notification', update)
  }, [])

  const enableNotifications = async () => {
    if (!('Notification' in window)) { setError('هذا المتصفح لا يدعم إشعارات النظام؛ ستظل التنبيهات ظاهرة داخل التطبيق.'); return }
    setPermission(await Notification.requestPermission())
  }
  const markRead = async (item: AppNotification) => {
    if (item.is_read) return
    try { await markNotificationRead(item.id); setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry)) }
    catch { setError('تعذر تحديث حالة الإشعار. أعد المحاولة.') }
  }

  return <section className="panel notification-center">
    <div className="panel-heading"><div><span className="eyebrow">تنبيهات حسابك</span><h2>الإشعارات</h2><p className="muted">تحديثات الطلبات والاعتماد والفواتير تظهر هنا فور وصولها.</p></div><span className="status-pill">{items.filter((item) => !item.is_read).length} غير مقروءة</span></div>
    <div className="notification-preferences">
      <button type="button" className="button button-secondary button-small" onClick={() => void enableNotifications()} disabled={permission === 'granted'}><BellRing size={15} />{permission === 'granted' ? 'إشعارات النظام مفعّلة' : 'تفعيل إشعارات الهاتف'}</button>
      <span className="status-pill">صوت التنبيه نشط</span>
    </div>
    {error && <div role="alert" className="inline-error">{error}<button type="button" onClick={() => void refresh()}>إعادة المحاولة</button></div>}
    {loading ? <div className="loading-state">جارٍ تحميل الإشعارات…</div> : items.length ? <div className="notification-list">{items.map((item) => {
      const rawPath = item.target_path?.startsWith('/') && !item.target_path.startsWith('//') ? item.target_path : '/'
      const pathAliases: Record<string, string> = { '/customer#orders': '/customer/orders', '/customer#notifications': '/customer/notifications', '/provider#work-queue': '/provider/work-queue', '/provider#ledger': '/provider/ledger', '/admin#quotes': '/admin/quotes', '/admin#payments': '/admin/payments', '/admin#operations': '/admin/operations' }
      const href = pathAliases[rawPath] ?? rawPath
      return <Link key={item.id} to={href} className={`notification-row ${item.is_read ? 'read' : ''}`} onClick={() => void markRead(item)}><span className="notification-mark"><Bell size={15} /></span><span><strong>{item.title}</strong><small>{item.body}</small><time>{new Date(item.created_at).toLocaleString('ar-SA')}</time></span>{!item.is_read && <Check size={16} aria-label="غير مقروء" />}</Link>
    })}</div> : <div className="empty-inline">لا توجد إشعارات حتى الآن؛ ستظهر التحديثات الجديدة هنا.</div>}
  </section>
}
