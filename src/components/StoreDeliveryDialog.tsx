import { useState } from 'react'
import { Calculator, Check, MapPin, Timer, Truck, X } from 'lucide-react'
import { adminSetProductDeliveryPricing } from '../lib/supabase'

type Props = { order: any; busy?: boolean; onClose: () => void; onSaved: () => Promise<void> }

export function StoreDeliveryDialog({ order, busy: parentBusy = false, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<'manual' | 'distance' | 'time'>(order.delivery_pricing_mode ?? 'manual')
  const [fee, setFee] = useState(String(order.delivery_fee ?? 0))
  const [baseFee, setBaseFee] = useState(String(order.delivery_base_fee ?? 0))
  const [rate, setRate] = useState(String(order.delivery_rate ?? 0))
  const [distance, setDistance] = useState(String(order.delivery_distance_km ?? ''))
  const [eta, setEta] = useState(String(order.delivery_eta_minutes ?? ''))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true); setMessage('')
    try {
      await adminSetProductDeliveryPricing({ orderId: order.id, mode, fee: Number(fee) || 0, baseFee: Number(baseFee) || 0, rate: Number(rate) || 0, distanceKm: distance === '' ? null : Number(distance), etaMinutes: eta === '' ? null : Number(eta) })
      await onSaved(); onClose()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر حفظ تسعير التوصيل.') }
    finally { setBusy(false) }
  }
  const calculated = mode === 'distance' ? (Number(baseFee) || 0) + (Number(rate) || 0) * (Number(distance) || 0) : mode === 'time' ? (Number(baseFee) || 0) + (Number(rate) || 0) * (Number(eta) || 0) : Number(fee) || 0
  return <div className="store-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="store-delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="delivery-dialog-title"><header className="store-dialog-header"><div><span className="eyebrow"><Truck size={15} /> إدارة التوصيل</span><h2 id="delivery-dialog-title">طلب متجر #{order.order_number}</h2><p className="muted">{order.profiles?.full_name ?? 'عميل'} · {[order.city, order.district, order.address_text].filter(Boolean).join(' · ') || 'العنوان غير مكتمل'}</p></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></header><div className="delivery-mode-grid"><button type="button" className={mode === 'manual' ? 'selected' : ''} onClick={() => setMode('manual')}><Calculator size={18} /><strong>مبلغ ثابت</strong><small>تحدده الإدارة مباشرة</small></button><button type="button" className={mode === 'distance' ? 'selected' : ''} onClick={() => setMode('distance')}><MapPin size={18} /><strong>حسب المسافة</strong><small>أساس + سعر لكل كم</small></button><button type="button" className={mode === 'time' ? 'selected' : ''} onClick={() => setMode('time')}><Timer size={18} /><strong>حسب الزمن</strong><small>أساس + سعر لكل دقيقة</small></button></div>{mode === 'manual' ? <label className="field-label">قيمة التوصيل (ر.س)<input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} /></label> : <div className="field-grid"><label className="field-label">الرسوم الأساسية (ر.س)<input type="number" min="0" step="0.01" value={baseFee} onChange={(event) => setBaseFee(event.target.value)} /></label><label className="field-label">{mode === 'distance' ? 'المسافة (كم)' : 'المدة (دقيقة)'}<input type="number" min="0" step={mode === 'distance' ? '0.1' : '1'} value={mode === 'distance' ? distance : eta} onChange={(event) => mode === 'distance' ? setDistance(event.target.value) : setEta(event.target.value)} /></label><label className="field-label">سعر الوحدة (ر.س)<input type="number" min="0" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} /></label></div>}<div className="delivery-total"><span>قيمة التوصيل المحسوبة</span><strong>{calculated.toFixed(2)} ر.س</strong></div>{message && <div className="inline-error">{message}</div>}<footer className="store-dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>إلغاء</button><button type="button" className="button button-primary" disabled={busy || parentBusy} onClick={() => void save()}><Check size={16} />{busy ? 'جارٍ الحفظ…' : 'حفظ قيمة التوصيل'}</button></footer></section></div>
}
