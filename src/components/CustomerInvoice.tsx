import { useEffect, useState } from 'react'
import { Banknote, Check, FileText, Printer, X } from 'lucide-react'
import { changeInvoicePayment, chooseInvoicePayment, getPlatformSettings, submitTransferReference } from '../lib/supabase'

type Invoice = { id: string; invoice_number: number; amount: number; status: string; payment_method: 'cash' | 'bank_transfer' | null; receipt_reference?: string | null; review_note?: string | null }
type Booking = { id: string; booking_number: number; status: string; price_snapshot: number | null; payments?: Invoice[] }

export function CustomerInvoice({ booking }: { booking: Booking }) {
  const [invoice, setInvoice] = useState<Invoice | null>(booking.payments?.[0] ?? null)
  const [settings, setSettings] = useState<any>(null)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { getPlatformSettings().then(({ data }) => setSettings(data)).catch(() => undefined) }, [])
  if (!invoice) return booking.status === 'completed' && !booking.price_snapshot ? <div className="invoice-pending"><FileText size={16} /> انتهى العمل؛ السعر قيد مراجعة الإدارة قبل إصدار الفاتورة.</div> : null
  const run = async (action: () => Promise<any>, success: string) => {
    setBusy(true); setMessage('')
    try { const result = await action(); if (result) setInvoice((current) => ({ ...current, ...result })); setMessage(success) }
    catch { setMessage('تعذر تحديث الفاتورة. حاول مرة أخرى.') }
    finally { setBusy(false) }
  }
  return <div className="customer-invoice">
    <div className="invoice-head"><span><FileText size={17} /> فاتورة رقم {invoice.invoice_number}</span><strong>{Number(invoice.amount).toFixed(2)} ر.س</strong></div>
    {invoice.status === 'paid' ? <div className="invoice-status paid"><Check size={15} /> مدفوعة ومؤكدة</div> : <>
      {!invoice.payment_method && <div className="invoice-methods"><p>اختر طريقة الدفع بعد مراجعة تفاصيل الفاتورة:</p><div><button className="button button-secondary button-small" disabled={busy} onClick={() => run(() => chooseInvoicePayment(invoice.id, 'cash'), 'سُجل الدفع النقدي؛ ستؤكد الإدارة الاستلام بعد التحصيل.') }><Banknote size={15} /> نقدًا</button><button className="button button-secondary button-small" disabled={busy} onClick={() => run(() => chooseInvoicePayment(invoice.id, 'bank_transfer'), 'اخترت التحويل البنكي. استخدم بيانات الحساب وأرسل مرجع العملية.')}>تحويل بنكي</button></div></div>}
      {invoice.payment_method === 'cash' && invoice.status !== 'paid' && <div className="invoice-status"><Banknote size={15} /> الدفع نقدًا؛ تسجل الإدارة التحصيل بعد استلام المبلغ.<button className="text-link" disabled={busy} onClick={() => run(() => changeInvoicePayment(invoice.id, 'bank_transfer'), 'تم تغيير الطريقة إلى تحويل بنكي.')}>تغيير إلى تحويل بنكي</button></div>}
      {invoice.payment_method === 'bank_transfer' && invoice.status !== 'paid' && <div className="transfer-details"><button className="text-link" disabled={busy} onClick={() => run(() => changeInvoicePayment(invoice.id, 'cash'), 'تم تغيير الطريقة إلى الدفع النقدي.')}>رجوع واختيار الدفع النقدي</button><strong>بيانات التحويل البنكي</strong>{settings?.bank_name && <span>البنك: {settings.bank_name}</span>}{settings?.bank_account_name && <span>اسم المستفيد: {settings.bank_account_name}</span>}{settings?.iban && <code dir="ltr">IBAN: {settings.iban}</code>}{!settings?.iban && <span className="muted">لم تضف الإدارة بيانات التحويل بعد.</span>}{invoice.status === 'pending' ? <div className="invoice-status"><Check size={15} /> استلمنا مرجع التحويل، والفاتورة بانتظار مراجعة الإدارة.</div> : <form onSubmit={(event) => { event.preventDefault(); void run(() => submitTransferReference(invoice.id, reference), 'أُرسل مرجع التحويل للمراجعة.') }}><label className="field-label">رقم العملية أو مرجع التحويل<input value={reference} onChange={(event) => setReference(event.target.value)} minLength={3} maxLength={120} required placeholder="أدخل مرجع التحويل" /></label><button className="button button-primary button-small" disabled={busy || !settings?.iban || reference.trim().length < 3}>{busy ? 'جارٍ الإرسال…' : 'إرسال للمراجعة'}</button></form>}</div>}
      {invoice.status === 'failed' && invoice.review_note && <div className="inline-error"><X size={15} />{invoice.review_note}</div>}
    </>}
    <div className="invoice-foot"><small>طلب #{booking.booking_number} · الفاتورة تصدر بعد اعتماد السعر وإكمال العمل.</small><button type="button" className="text-link" onClick={() => window.print()}><Printer size={15} /> طباعة الفاتورة</button></div>
    {message && <div className={message.startsWith('تعذر') ? 'inline-error' : 'success-note'}>{message.startsWith('تعذر') ? <X size={15} /> : <Check size={15} />}{message}</div>}
  </div>
}
