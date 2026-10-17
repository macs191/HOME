import { useEffect, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { getAuthState, getBookingMessages, sendBookingMessage, subscribeToBookingMessages } from '../lib/supabase'

type Message = { id: string; sender_id: string; body: string; created_at: string }

export function BookingChat({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    let dispose: (() => void) | undefined
    setLoading(true); setError('')
    void Promise.all([getAuthState(), getBookingMessages(bookingId)]).then(([auth, result]) => {
      if (!active) return
      setUserId(auth.user?.id ?? '')
      if (result.error) throw result.error
      setMessages((result.data as Message[]) ?? [])
      return subscribeToBookingMessages(bookingId, async () => {
        const refreshed = await getBookingMessages(bookingId)
        if (!refreshed.error && active) setMessages((refreshed.data as Message[]) ?? [])
      })
    }).then((cleanup) => { if (active) dispose = cleanup }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'تعذر تحميل المحادثة.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; dispose?.() }
  }, [bookingId, open])

  const send = async () => {
    if (!body.trim() || busy) return
    setBusy(true); setError('')
    try { const saved = await sendBookingMessage(bookingId, body); setMessages((current) => [...current, saved as Message]); setBody('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر إرسال الرسالة.') }
    finally { setBusy(false) }
  }

  return <section className="booking-chat">
    <button type="button" className="button button-secondary button-small booking-chat-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><MessageCircle size={15} /> {open ? 'إخفاء المحادثة' : 'فتح المحادثة'}</button>
    {open && <div className="booking-chat-panel"><div className="booking-chat-heading"><strong>محادثة الطلب</strong><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="إغلاق المحادثة"><X size={15} /></button></div><div className="booking-chat-messages">{loading ? <p className="muted">جارٍ تحميل الرسائل…</p> : messages.length ? messages.map((item) => <div className={item.sender_id === userId ? 'booking-chat-message own' : 'booking-chat-message'} key={item.id}><p>{item.body}</p><time>{new Date(item.created_at).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>) : <p className="muted">لا توجد رسائل بعد. اكتب استفسارك هنا.</p>}</div><div className="booking-chat-compose"><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} maxLength={4000} placeholder="اكتب رسالة للعميل أو الفني أو الإدارة" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><button type="button" className="button button-primary button-small" onClick={() => void send()} disabled={busy || !body.trim()} aria-label="إرسال الرسالة"><Send size={15} /></button></div>{error && <div className="inline-error" role="alert">{error}</div>}</div>}
  </section>
}
