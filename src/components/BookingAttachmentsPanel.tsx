import { useEffect, useState } from 'react'
import { Camera, Check, Image as ImageIcon, LoaderCircle, X } from 'lucide-react'
import { getBookingAttachmentUrl, uploadBookingPhotos } from '../lib/supabase'
import { BookingPhotoPicker } from './BookingPhotoPicker'

type Attachment = { id: string; storage_path: string; mime_type: string; file_size_bytes?: number; created_at?: string }
type Props = { bookingId: string; attachments?: Attachment[] | null; canUpload?: boolean; onUploaded?: () => Promise<void> | void }
const EMPTY_ATTACHMENTS: Attachment[] = []

export function BookingAttachmentsPanel({ bookingId, attachments, canUpload = false, onUploaded }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const items = attachments ?? EMPTY_ATTACHMENTS
  useEffect(() => {
    let active = true
    Promise.all(items.map(async (item) => {
      try { return [item.id, await getBookingAttachmentUrl(item.storage_path)] as const }
      catch { return [item.id, ''] as const }
    })).then((pairs) => { if (active) setUrls(Object.fromEntries(pairs)) })
    return () => { active = false }
  }, [items])
  const upload = async () => {
    if (!files.length) { setMessage('اختر صورة واحدة على الأقل.'); return }
    setBusy(true); setMessage('')
    try {
      const result = await uploadBookingPhotos(bookingId, files)
      const failures = result.failures.length
      setFiles([])
      setMessage(failures ? `تم رفع ${result.uploaded} صورة؛ تعذر رفع ${failures}. أعد اختيار الصور غير المرفوعة للمحاولة.` : `تم رفع ${result.uploaded} صورة بأمان.`)
      await onUploaded?.()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر رفع الصور. حاول مرة أخرى.') }
    finally { setBusy(false) }
  }
  return <section className="booking-attachments" aria-label="صور الطلب">
    <div className="booking-attachments-head"><strong><ImageIcon size={16} /> صور العطل</strong><span>{items.length} صور</span></div>
    {items.length > 0 ? <div className="booking-attachment-grid">{items.map((item, index) => <button type="button" className="booking-attachment-thumb" key={item.id} disabled={!urls[item.id]} onClick={() => setSelected(item.id)} aria-label={`عرض صورة العطل ${index + 1}`}>{urls[item.id] ? <img src={urls[item.id]} alt={`صورة العطل ${index + 1}`} loading="lazy" /> : <span className="booking-attachment-loading"><LoaderCircle size={18} /></span>}</button>)}</div> : <p className="muted booking-attachments-empty">لم تُرفق صور لهذا الطلب.</p>}
    {canUpload && items.length < 5 && <div className="booking-attachment-upload"><BookingPhotoPicker files={files} onChange={setFiles} maxFiles={5 - items.length} title="إضافة صور للطلب" description="لا ترفع صورة تحتوي بيانات شخصية غير لازمة." /><button type="button" className="button button-primary button-small" onClick={() => void upload()} disabled={busy || files.length === 0}>{busy ? <LoaderCircle size={15} className="spin" /> : <Camera size={15} />}{busy ? 'جارٍ رفع الصور…' : 'رفع الصور المحددة'}</button></div>}
    {message && <div className={message.startsWith('تعذر') ? 'inline-error' : 'success-note'} role="status">{message.startsWith('تعذر') ? <X size={15} /> : <Check size={15} />}{message}</div>}
    {selected && <div className="booking-photo-viewer" role="dialog" aria-modal="true" aria-label="معاينة صورة العطل" onClick={() => setSelected(null)}><button type="button" className="icon-button" aria-label="إغلاق المعاينة" onClick={() => setSelected(null)}><X size={20} /></button>{urls[selected] && <img src={urls[selected]} alt="صورة العطل المكبرة" onClick={(event) => event.stopPropagation()} />}</div>}
  </section>
}
