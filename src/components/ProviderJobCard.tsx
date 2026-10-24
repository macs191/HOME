import { useState } from 'react'
import { Banknote, Check, ExternalLink, MapPin, Phone, Send } from 'lucide-react'
import { advanceProviderBooking, finishFixedPriceBooking, providerConfirmCashPayment, submitProviderQuote } from '../lib/supabase'
import { BookingAttachmentsPanel } from './BookingAttachmentsPanel'
import { BookingStatusTimeline } from './BookingStatusTimeline'
import { BookingChat } from './BookingChat'
import { BookingLocationTracking } from './BookingLocationTracking'
import { OrderDialog } from './OrderDialog'

type Props = { item: any; onUpdate: () => Promise<void>; onMessage: (value: string) => void }
const statusLabel: Record<string, string> = { pending: 'جديد', quoted: 'عرض سعر', accepted: 'مقبول', assigned: 'تم الإسناد', on_the_way: 'الفني في الطريق', arrived: 'وصل الفني', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغي', disputed: 'قيد المراجعة' }
const nextAction: Record<string, string> = { assigned: 'التوجه إلى العميل', on_the_way: 'تأكيد الوصول', arrived: 'بدء تنفيذ العمل' }

export function ProviderJobCard({ item, onUpdate, onMessage }: Props) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const customer = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles
  const service = Array.isArray(item.services) ? item.services[0] : item.services
  const isFixed = service?.pricing_type === 'fixed'
  const pendingQuote = (item.booking_quotes ?? []).find((quote: any) => quote.status === 'pending')
  const latestQuote = [...(item.booking_quotes ?? [])].sort((a: any, b: any) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0]
  const rejectedQuote = item.status === 'completed' && !isFixed && latestQuote?.status === 'rejected' ? latestQuote : null
  const cashInvoice = (item.payments ?? []).find((payment: any) => payment.payment_method === 'cash')
  const execute = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); onMessage('')
    try { await action(); await onUpdate(); onMessage(success) }
    catch { onMessage('تعذر تنفيذ الإجراء. تحقق من الاتصال وحاول مرة أخرى.') }
    finally { setBusy(false) }
  }
  const mapUrl = item.latitude != null && item.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.address_text, item.district, item.city].filter(Boolean).join(' '))}`
  return <OrderDialog number={item.booking_number} title={service?.name_ar ?? 'خدمة منزلية'} status={<span className="status-pill">{statusLabel[item.status] ?? item.status}</span>} meta={customer?.full_name || 'العميل'}><article className="provider-job-card">
    <div className="provider-job-head"><div><span className="eyebrow">طلب #{item.booking_number} · {service?.name_ar ?? 'خدمة منزلية'}</span><h3>{customer?.full_name || 'العميل'}</h3><p>{item.scheduled_date ? `${item.scheduled_date} · ${item.scheduled_slot ?? ''}` : 'موعد مرن حسب الاتفاق'}</p></div><span className="status-pill">{statusLabel[item.status] ?? item.status}</span></div>
    <div className="provider-job-details"><p><strong>الموقع:</strong> {[item.address_text, item.district, item.city].filter(Boolean).join(' · ') || 'لم يحدد العنوان'}</p>{item.access_notes && <p><strong>ملاحظات الوصول:</strong> {item.access_notes}</p>}<p><strong>وصف الطلب:</strong> {item.issue_description || 'لا يوجد وصف إضافي'}</p></div>
    <BookingAttachmentsPanel bookingId={item.id} attachments={item.attachments ?? item.booking_attachments ?? []} canUpload={false} /><BookingStatusTimeline events={item.booking_status_history} /><BookingChat bookingId={item.id} /><BookingLocationTracking booking={item} role="provider" onChanged={onUpdate} />
    <div className="provider-job-links"><a href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={15} /> فتح موقع العميل <ExternalLink size={13} /></a>{customer?.phone && <a href={`tel:${customer.phone}`}><Phone size={15} /> {customer.phone}</a>}</div>
    {item.status in nextAction && <button className="button button-primary button-small" disabled={busy} onClick={() => void execute(() => advanceProviderBooking(item.id), `تم تحديث حالة الطلب إلى: ${statusLabel[item.status === 'assigned' ? 'on_the_way' : item.status === 'on_the_way' ? 'arrived' : 'in_progress']}.`)}>{nextAction[item.status]} <Check size={15} /></button>}
    {item.status === 'in_progress' && (isFixed ? <div className="fixed-finish"><p>سعر ثابت معتمد: <strong>{Number(service?.base_price ?? item.price_snapshot ?? 0).toFixed(2)} ر.س</strong></p><button type="button" className="button button-primary button-small" disabled={busy} onClick={() => void execute(() => finishFixedPriceBooking(item.id), 'تم إنهاء المهمة وإصدار الفاتورة للعميل.')}>إنهاء المهمة وإصدار الفاتورة <Check size={15} /></button></div> : <QuoteForm amount={amount} note={note} busy={busy} setAmount={setAmount} setNote={setNote} onSubmit={() => void execute(() => submitProviderQuote(item.id, Number(amount), note), 'أُرسل السعر إلى الإدارة للمراجعة قبل إصدار الفاتورة.')} />)}
    {rejectedQuote && <div className="quote-rejected-note"><strong>رُفض آخر سعر من الإدارة.</strong><p>سبب الرفض: {rejectedQuote.admin_review_note ?? 'لم يُذكر سبب.'}</p><QuoteForm amount={amount} note={note} busy={busy} setAmount={setAmount} setNote={setNote} onSubmit={() => void execute(() => submitProviderQuote(item.id, Number(amount), note), 'أُعيد إرسال السعر إلى الإدارة للمراجعة.')} /></div>}
    {pendingQuote && <div className="invoice-pending"><Check size={15} /> أُرسل السعر ({Number(pendingQuote.amount).toFixed(2)} ر.س) — بانتظار اعتماد الإدارة.</div>}
    {item.status === 'completed' && item.price_snapshot != null && <div className="provider-job-details"><p><strong>قيمة الفاتورة:</strong> {Number(item.price_snapshot).toFixed(2)} ر.س</p><p><strong>صافي مستحقك:</strong> {item.provider_amount_snapshot == null ? 'يظهر بعد اعتماد السعر/العمولة' : `${Number(item.provider_amount_snapshot).toFixed(2)} ر.س`}</p><p>يُضاف المستحق إلى رصيدك بعد تأكيد تحصيل الإدارة للفاتورة.</p></div>}
    {item.status === 'completed' && cashInvoice?.status !== 'paid' && cashInvoice && <form className="cash-confirm-form" onSubmit={(event) => { event.preventDefault(); void execute(() => providerConfirmCashPayment(cashInvoice.id, Number(cashAmount)), 'تم تأكيد استلام الدفع النقدي وتحديث الفاتورة إلى مدفوعة.') }}><p><Banknote size={15} /> العميل اختار الدفع نقدًا. أدخل المبلغ الذي استلمته فعليًا لتأكيد التحصيل.</p><label className="field-label">المبلغ المستلم نقدًا (ر.س)<input type="number" min="0.01" step="0.01" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} placeholder={String(cashInvoice.amount ?? item.price_snapshot ?? '')} required /></label><button type="submit" className="button button-primary button-small" disabled={busy || Number(cashAmount) <= 0}>تأكيد استلام {cashAmount || 'المبلغ'} <Check size={15} /></button></form>}
  </article></OrderDialog>
}

function QuoteForm({ amount, note, busy, setAmount, setNote, onSubmit }: { amount: string; note: string; busy: boolean; setAmount: (value: string) => void; setNote: (value: string) => void; onSubmit: () => void }) {
  return <form className="provider-quote-form" onSubmit={(event) => { event.preventDefault(); onSubmit() }}><p className="muted quote-form-note">اكتب السعر الفعلي بعد التنفيذ، مع توضيح الأعمال والمواد.</p><label className="field-label">السعر النهائي بعد التنفيذ (ر.س)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label className="field-label">تفاصيل العمل المنجز<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="اكتب الأعمال والمواد التي تفسر السعر" /></label><button type="submit" className="button button-primary button-small" disabled={busy || Number(amount) <= 0}>{busy ? 'جارٍ الإرسال…' : 'إرسال السعر إلى الإدارة'} <Send size={15} /></button></form>
}
