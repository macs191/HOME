import { useEffect, useRef, useState } from 'react'
import { Banknote, Check, FileText, Printer, X } from 'lucide-react'
import { ActionConfirmDialog } from './ActionConfirmDialog'
import { changeInvoicePayment, chooseInvoicePayment, getPlatformSettings, submitTransferReference } from '../lib/supabase'

type PaymentMethod = 'cash' | 'bank_transfer'
type Invoice = { id: string; invoice_number: number; amount: number; status: string; payment_method: PaymentMethod | null; receipt_reference?: string | null; review_note?: string | null }
type Booking = { id: string; booking_number: number; status: string; price_snapshot: number | null; payments?: Invoice[] }

const methodLabel: Record<PaymentMethod, string> = { cash: 'نقدًا', bank_transfer: 'تحويل بنكي' }

export function CustomerInvoice({ booking }: { booking: Booking }) {
  const [invoice, setInvoice] = useState<Invoice | null>(booking.payments?.[0] ?? null)
  const [settings, setSettings] = useState<any>(null)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingMethod, setPendingMethod] = useState<PaymentMethod | null>(null)
  const inFlight = useRef(false)
  useEffect(() => { getPlatformSettings().then(({ data }) => setSettings(data)).catch(() => undefined) }, [])
  if (!invoice) return booking.status === 'completed' && !booking.price_snapshot ? <div className="invoice-pending"><FileText size={16} /> انتهى العمل؛ السعر قيد مراجعة الإدارة قبل إصدار الفاتورة.</div> : null

  const run = async (action: () => Promise<any>, success: string) => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true); setMessage('')
    try {
      const result = await action()
      if (result) setInvoice((current) => current ? { ...current, ...result } : current)
      setMessage(success)
      return true
    } catch {
      setMessage('تعذر تحديث الفاتورة. تحقق من اتصالك وحالة الفاتورة ثم حاول مرة أخرى.')
      return false
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const confirmMethodChange = async () => {
    if (!pendingMethod || busy) return
    const previousMethod = invoice.payment_method
    const action = previousMethod ? changeInvoicePayment(invoice.id, pendingMethod) : chooseInvoicePayment(invoice.id, pendingMethod)
    const success = previousMethod
      ? `تم تغيير طريقة الدفع إلى ${methodLabel[pendingMethod]}؛ أُعيد مرجع التحويل وملاحظة المراجعة إلى الحالة الافتراضية.`
      : `تم تسجيل اختيار الدفع ${methodLabel[pendingMethod]}؛ لا يُسجّل تحصيل المبلغ بهذه الخطوة.`
    if (await run(() => action, success)) setPendingMethod(null)
  }

  const requestMethodChange = (method: PaymentMethod) => {
    if (busy || method === invoice.payment_method) return
    setMessage('')
    setPendingMethod(method)
  }

  const confirmDescription = invoice.payment_method
    ? `سيتم تغيير طريقة الدفع من ${methodLabel[invoice.payment_method]} إلى ${pendingMethod ? methodLabel[pendingMethod] : 'الطريقة المختارة'}. سيُمسح مرجع التحويل وملاحظة المراجعة، وتعود حالة الفاتورة إلى غير مدفوعة.`
    : `سيُسجل اختيار ${pendingMethod ? methodLabel[pendingMethod] : 'طريقة الدفع'} لهذه الفاتورة فقط. لا يُحصّل النظام أي مبلغ الآن؛ تؤكد الإدارة التحصيل لاحقًا.`

  return <div className="customer-invoice">
    <div className="invoice-head"><span><FileText size={17} /> فاتورة رقم {invoice.invoice_number}</span><strong>{Number(invoice.amount).toFixed(2)} ر.س</strong></div>
    {invoice.status === 'paid' ? <div className="invoice-status paid"><Check size={15} /> مدفوعة ومؤكدة</div> : <>
      {!invoice.payment_method && <div className="invoice-methods"><p>اختر طريقة الدفع بعد مراجعة تفاصيل الفاتورة:</p><div><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => requestMethodChange('cash')}><Banknote size={15} /> نقدًا</button><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => requestMethodChange('bank_transfer')}>تحويل بنكي</button></div></div>}
      {invoice.payment_method === 'cash' && invoice.status !== 'paid' && <div className="invoice-status"><Banknote size={15} /> الدفع نقدًا؛ تسجل الإدارة التحصيل بعد استلام المبلغ.<button type="button" className="text-link" disabled={busy} onClick={() => requestMethodChange('bank_transfer')}>تغيير إلى تحويل بنكي</button></div>}
      {invoice.payment_method === 'bank_transfer' && invoice.status !== 'paid' && <div className="transfer-details"><button type="button" className="text-link" disabled={busy} onClick={() => requestMethodChange('cash')}>رجوع واختيار الدفع النقدي</button><strong>بيانات التحويل البنكي</strong>{settings?.bank_name && <span>البنك: {settings.bank_name}</span>}{settings?.bank_account_name && <span>اسم المستفيد: {settings.bank_account_name}</span>}{settings?.iban && <code dir="ltr">IBAN: {settings.iban}</code>}{!settings?.iban && <span className="muted">لم تضف الإدارة بيانات التحويل بعد.</span>}{invoice.status === 'pending' ? <div className="invoice-status"><Check size={15} /> استلمنا مرجع التحويل، والفاتورة بانتظار مراجعة الإدارة.</div> : <form onSubmit={(event) => { event.preventDefault(); void run(() => submitTransferReference(invoice.id, reference), 'أُرسل مرجع التحويل للمراجعة.') }}><label className="field-label">رقم العملية أو مرجع التحويل<input value={reference} onChange={(event) => setReference(event.target.value)} minLength={3} maxLength={120} required placeholder="أدخل مرجع التحويل" /></label><button className="button button-primary button-small" disabled={busy || !settings?.iban || reference.trim().length < 3}>{busy ? 'جارٍ الإرسال…' : 'إرسال للمراجعة'}</button></form>}</div>}
      {invoice.status === 'failed' && invoice.review_note && <div className="inline-error"><X size={15} />{invoice.review_note}</div>}
    </>}
    <div className="invoice-foot"><small>طلب #{booking.booking_number} · الفاتورة تصدر بعد اعتماد السعر وإكمال العمل.</small><button type="button" className="text-link" onClick={() => window.print()}><Printer size={15} /> طباعة الفاتورة</button></div>
    {message && <div className={message.startsWith('تعذر') ? 'inline-error' : 'success-note'} role={message.startsWith('تعذر') ? 'alert' : 'status'}>{message.startsWith('تعذر') ? <X size={15} /> : <Check size={15} />}{message}</div>}
    <ActionConfirmDialog open={pendingMethod !== null} title={invoice.payment_method ? 'تأكيد تغيير طريقة الدفع' : 'تأكيد طريقة الدفع'} description={confirmDescription} confirmLabel={invoice.payment_method ? 'تأكيد التغيير' : 'تأكيد الاختيار'} tone="primary" busy={busy} onCancel={() => setPendingMethod(null)} onConfirm={confirmMethodChange} />
  </div>
}
