import { useState } from 'react'
import { Check, Star, X } from 'lucide-react'
import { submitBookingReview } from '../lib/supabase'

type Props = { bookingId: string; existing?: any; onSaved: (review: any) => void }
const fields = [{ key: 'quality', label: 'جودة العمل' }, { key: 'punctuality', label: 'الالتزام بالموعد' }, { key: 'conduct', label: 'التعامل والاحترام' }, { key: 'value', label: 'القيمة مقابل السعر' }]

export function BookingReviewForm({ bookingId, existing, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, number>>({ quality: existing?.quality ?? 0, punctuality: existing?.punctuality ?? 0, conduct: existing?.conduct ?? 0, value: existing?.value ?? 0 })
  const [comment, setComment] = useState(existing?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (existing) return <section className="booking-review saved"><div className="booking-review-heading"><Check size={15} /><strong>تم تقييم الخدمة</strong></div><p className="muted">متوسط التقييم: {((existing.quality + existing.punctuality + existing.conduct + existing.value) / 4).toFixed(1)} من 5</p>{existing.comment && <p className="booking-review-comment">{existing.comment}</p>}</section>
  const save = async () => {
    if (Object.values(values).some((value) => value < 1)) { setMessage('اختر تقييمًا لكل بند.'); return }
    setBusy(true); setMessage('')
    try { const result = await submitBookingReview({ bookingId, quality: values.quality, punctuality: values.punctuality, conduct: values.conduct, value: values.value, comment }); onSaved(result); setMessage('تم حفظ تقييمك، شكرًا لك.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر إرسال التقييم.') }
    finally { setBusy(false) }
  }
  return <section className="booking-review"><div className="booking-review-heading"><Star size={15} /><strong>قيّم تجربة الخدمة</strong></div><div className="booking-review-fields">{fields.map((field) => <div className="booking-rating-row" key={field.key}><span>{field.label}</span><div className="rating-stars">{[1,2,3,4,5].map((value) => <button type="button" key={value} className={values[field.key] >= value ? 'rating-star active' : 'rating-star'} onClick={() => setValues((current) => ({ ...current, [field.key]: value }))} aria-label={`${field.label}: ${value} من 5`}><Star size={16} fill="currentColor" /></button>)}</div></div>)}</div><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} maxLength={1000} placeholder="ملاحظة اختيارية عن التجربة" /><button type="button" className="button button-primary button-small" onClick={() => void save()} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'إرسال التقييم'} <Check size={14} /></button>{message && <div className={message.startsWith('تم') ? 'success-note' : 'inline-error'} role="status">{message.startsWith('تم') ? <Check size={14} /> : <X size={14} />}{message}</div>}</section>
}
