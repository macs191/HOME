import { useEffect, useState } from 'react'
import { LocateFixed, MapPin, ShieldCheck, X } from 'lucide-react'
import { getBookingTrackingState, providerUpdateBookingLocation, setBookingTrackingConsent, subscribeToBookingTracking } from '../lib/supabase'

type Props = { booking: any; role: 'customer' | 'provider'; onChanged?: () => Promise<void> | void }
const activeStatuses = new Set(['assigned', 'on_the_way', 'arrived', 'in_progress'])

export function BookingLocationTracking({ booking, role, onChanged }: Props) {
  const [consented, setConsented] = useState(Boolean(booking.tracking_consent_at && !booking.tracking_revoked_at))
  const [location, setLocation] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const active = activeStatuses.has(booking.status)
  useEffect(() => {
    if (!active) return
    let alive = true
    let dispose: (() => void) | undefined
    const refresh = async () => { const state = await getBookingTrackingState(booking.id); if (!alive) return; setConsented(Boolean(state.booking?.tracking_consent_at && !state.booking?.tracking_revoked_at)); setLocation(state.location) }
    void refresh(); void subscribeToBookingTracking(booking.id, () => void refresh()).then((cleanup) => { dispose = cleanup })
    return () => { alive = false; dispose?.() }
  }, [active, booking.id])
  useEffect(() => {
    if (role !== 'provider' || !active || !consented || !navigator.geolocation) return
    let alive = true
    const watchId = navigator.geolocation.watchPosition((position) => { if (alive) void providerUpdateBookingLocation(booking.id, position.coords.latitude, position.coords.longitude, position.coords.accuracy).catch(() => undefined) }, () => undefined, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 })
    return () => { alive = false; navigator.geolocation.clearWatch(watchId) }
  }, [active, booking.id, consented, role])
  if (!active) return null
  const toggleConsent = async () => { setBusy(true); setMessage(''); try { await setBookingTrackingConsent(booking.id, !consented); setConsented(!consented); if (!consented) setMessage('تمت الموافقة. سيظهر موقع الفني أثناء المهمة فقط.') ; else { setLocation(null); setMessage('تم إيقاف مشاركة الموقع لهذا الطلب.') }; await onChanged?.() } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تحديث موافقة الموقع.') } finally { setBusy(false) } }
  const mapUrl = location ? `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}` : ''
  return <section className="tracking-card"><div className="tracking-head"><span className="tracking-icon"><LocateFixed size={17} /></span><div><strong>{role === 'customer' ? 'موقع الفني أثناء المهمة' : 'تتبع المهمة بإذن العميل'}</strong><small>{role === 'customer' ? 'لا يبدأ التتبع إلا بعد موافقتك، ويتوقف عند انتهاء الطلب.' : consented ? 'الموقع يُرسل فقط أثناء هذه المهمة النشطة.' : 'بانتظار موافقة العميل قبل إرسال موقعك.'}</small></div></div>{role === 'customer' && <button type="button" className={`button ${consented ? 'button-secondary' : 'button-primary'} button-small`} onClick={() => void toggleConsent()} disabled={busy}>{consented ? 'إيقاف التتبع' : 'السماح بالتتبع'}</button>}{role === 'provider' && consented && <p className="tracking-status"><ShieldCheck size={14} /> مشاركة الموقع مفعلة لهذه المهمة فقط</p>}{role === 'customer' && consented && location && <a className="tracking-map-link" href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={14} /> فتح آخر موقع معروف على الخريطة</a>}{role === 'customer' && consented && !location && <p className="muted tracking-wait"><LocateFixed size={14} /> بانتظار أول تحديث من الفني…</p>}{message && <div className={message.startsWith('تم') ? 'success-note' : 'inline-error'} role="status"><X size={14} />{message}</div>}</section>
}
