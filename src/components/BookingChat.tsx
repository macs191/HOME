import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ImagePlus, MessageCircle, Send, X } from 'lucide-react'
import { getAuthState, getBookingAttachmentUrl, getBookingMessages, getMyRole, removeBookingChatPhoto, sendBookingMessage, subscribeToBookingMessages, uploadBookingChatPhoto } from '../lib/supabase'
import { VoiceCall } from './VoiceCall'

type Message = { id: string; sender_id: string; body: string; attachment_path: string | null; created_at: string }
const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024

export function BookingChat({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [userId, setUserId] = useState('')
  const [callRole, setCallRole] = useState<'admin' | 'provider' | 'customer' | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState('')
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({})
  const fileInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!attachment) { setAttachmentPreview(''); return }
    const url = URL.createObjectURL(attachment)
    setAttachmentPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [attachment])

  useEffect(() => {
    if (!open) return
    let active = true
    let dispose: (() => void) | undefined
    setLoading(true)
    setError('')

    const refreshMessages = async () => {
      const refreshed = await getBookingMessages(bookingId)
      if (!active) return
      if (refreshed.error) throw refreshed.error
      const rows = (refreshed.data as Message[]) ?? []
      setMessages(rows)
      const entries = await Promise.all(rows.filter((item) => item.attachment_path).map(async (item) => {
        try { return [item.id, await getBookingAttachmentUrl(item.attachment_path!)] as const }
        catch { return [item.id, ''] as const }
      }))
      if (active) setAttachmentUrls(Object.fromEntries(entries))
    }

    void (async () => {
      const auth = await getAuthState()
      if (!active) return
      setUserId(auth.user?.id ?? '')
      const role = await getMyRole()
      setCallRole(role === 'customer' ? 'admin' : role === 'provider' ? 'customer' : undefined)
      await refreshMessages()
      if (active) dispose = await subscribeToBookingMessages(bookingId, () => { void refreshMessages().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'تعذر تحديث المحادثة.') }) })
    })().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'تعذر تحميل المحادثة.')
    }).finally(() => { if (active) setLoading(false) })

    return () => { active = false; dispose?.() }
  }, [bookingId, open])

  const selectAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null
    if (!file) return
    if (file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) {
      setError('يجب ألا يتجاوز حجم الصورة قبل الضغط 15 ميجابايت.')
      event.currentTarget.value = ''
      return
    }
    if (file.type && !file.type.startsWith('image/')) {
      setError('اختر ملف صورة من الكاميرا أو المعرض.')
      event.currentTarget.value = ''
      return
    }
    setError('')
    setAttachment(file)
  }

  const send = async () => {
    if ((!body.trim() && !attachment) || busy || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    let uploadedPath: string | undefined
    try {
      if (attachment) uploadedPath = await uploadBookingChatPhoto(bookingId, attachment)
      const saved = await sendBookingMessage(bookingId, body, uploadedPath) as Message
      setMessages((current) => current.some((item) => item.id === saved.id) ? current : [...current, saved])
      if (uploadedPath) void getBookingAttachmentUrl(uploadedPath).then((url) => setAttachmentUrls((current) => ({ ...current, [saved.id]: url }))).catch(() => undefined)
      setBody('')
      setAttachment(null)
      if (fileInput.current) fileInput.current.value = ''
    } catch (reason) {
      if (uploadedPath) { try { await removeBookingChatPhoto(uploadedPath) } catch { /* قد يمنع الخادم حذف ملف مرتبط برسالة محفوظة */ } }
      setError(reason instanceof Error ? reason.message : 'تعذر إرسال الرسالة.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <section className="booking-chat">
    <button type="button" className="button button-secondary button-small booking-chat-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><MessageCircle size={15} /> {open ? 'إخفاء المحادثة' : 'فتح المحادثة'}</button>
    {open && <div className="booking-chat-panel">
      <div className="booking-chat-heading"><strong>محادثة الطلب</strong><div className="booking-chat-heading-actions"><VoiceCall bookingId={bookingId} targetRole={callRole} /><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="إغلاق المحادثة"><X size={15} /></button></div></div>
      <div className="booking-chat-messages" aria-live="polite">{loading ? <p className="muted">جارٍ تحميل الرسائل…</p> : messages.length ? messages.map((item) => <div className={item.sender_id === userId ? 'booking-chat-message own' : 'booking-chat-message'} key={item.id}>
        {item.body && <p>{item.body}</p>}
        {item.attachment_path && (attachmentUrls[item.id] ? <a className="booking-chat-attachment-link" href={attachmentUrls[item.id]} target="_blank" rel="noreferrer"><img className="booking-chat-attachment-image" src={attachmentUrls[item.id]} alt="مرفق صورة في محادثة الطلب" /></a> : <span className="muted">تعذر تحميل صورة المحادثة أو انتهت صلاحية رابطها.</span>)}
        <time>{new Date(item.created_at).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })}</time>
      </div>) : <p className="muted">لا توجد رسائل بعد. اكتب استفسارك أو أرفق صورة.</p>}</div>
      {attachment && <div className="booking-chat-attachment-preview"><img src={attachmentPreview} alt="معاينة الصورة قبل الإرسال" /><div><strong>{attachment.name}</strong><small>سيتم ضغطها ورفعها بصورة خاصة بحد أقصى 5 ميجابايت.</small></div><button type="button" className="icon-button" onClick={() => { setAttachment(null); if (fileInput.current) fileInput.current.value = '' }} disabled={busy} aria-label="إزالة الصورة"><X size={15} /></button></div>}
      <div className="booking-chat-compose"><button type="button" className="icon-button booking-chat-attach-button" onClick={() => fileInput.current?.click()} disabled={busy} aria-label="إرفاق صورة"><ImagePlus size={18} /></button><input ref={fileInput} className="booking-chat-file-input" type="file" accept="image/*" onChange={selectAttachment} aria-label="اختر صورة للمحادثة" /><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} maxLength={4000} placeholder="اكتب رسالة أو أرفق صورة" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><button type="button" className="button button-primary button-small" onClick={() => void send()} disabled={busy || (!body.trim() && !attachment)} aria-label="إرسال الرسالة">{busy ? 'جارٍ الإرسال…' : <Send size={15} />}</button></div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>}
  </section>
}
