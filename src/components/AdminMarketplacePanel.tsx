import { useEffect, useState } from 'react'
import { Banknote, Check, Edit3, Save, Settings2, X } from 'lucide-react'
import { CategoryIcon } from './Brand'
import { acceptProviderQuote, getAdminCatalog, getAdminPayments, getAdminQuotes, getPlatformSettings, rejectProviderQuote, reviewInvoicePayment, saveAdminCategory, saveAdminService, saveDefaultCommission, savePaymentSettings } from '../lib/supabase'

const iconChoices = [
  ['wrench', 'أدوات وصيانة'], ['droplets', 'سباكة ومياه'], ['zap', 'كهرباء'], ['wind', 'تكييف وتهوية'],
  ['sparkles', 'تنظيف'], ['refrigerator', 'أجهزة منزلية'], ['hammer', 'نجارة'], ['paintbrush', 'دهان'],
  ['truck', 'نقل وأثاث'], ['box', 'تغليف وتركيب'], ['bug', 'مكافحة حشرات'], ['key-round', 'أقفال ومفاتيح'],
] as const
const emptyCategory = { slug: '', name_ar: '', description: '', icon: 'wrench', color: '#20d4c5', is_active: true, is_featured: false }
const emptyService = { category_id: '', slug: '', name_ar: '', description: '', pricing_type: 'provider_quote' as 'fixed' | 'provider_quote', base_price: '', is_active: true, is_featured: false }
type Section = 'catalog' | 'quotes' | 'payments' | 'settings'
const object = (value: any) => Array.isArray(value) ? value[0] : value

export function AdminMarketplacePanel({ section, onChanged }: { section: Section; onChanged?: () => void }) {
  const [catalog, setCatalog] = useState<{ categories: any[]; services: any[] }>({ categories: [], services: [] })
  const [quotes, setQuotes] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [categoryForm, setCategoryForm] = useState(emptyCategory)
  const [categoryId, setCategoryId] = useState<string>()
  const [serviceForm, setServiceForm] = useState(emptyService)
  const [serviceId, setServiceId] = useState<string>()
  const [defaultRate, setDefaultRate] = useState('')
  const [bank, setBank] = useState({ bank_name: '', bank_account_name: '', iban: '' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})

  const refresh = async (clearMessage = true) => {
    setLoading(true)
    if (clearMessage) setMessage('')
    try {
      if (section === 'catalog') {
        const next = await getAdminCatalog()
        setCatalog(next)
        setServiceForm((current) => ({ ...current, category_id: current.category_id || next.categories[0]?.id || '' }))
      } else if (section === 'quotes') {
        const result = await getAdminQuotes()
        if (result.error) throw result.error
        setQuotes(result.data ?? [])
      } else if (section === 'payments') {
        const result = await getAdminPayments()
        if (result.error) throw result.error
        setPayments(result.data ?? [])
      } else {
        const result = await getPlatformSettings()
        if (result.error) throw result.error
        const setting = result.data as any
        if (setting) {
          setDefaultRate(setting.default_commission_rate == null ? '' : String(setting.default_commission_rate))
          setBank({ bank_name: setting.bank_name ?? '', bank_account_name: setting.bank_account_name ?? '', iban: setting.iban ?? '' })
        }
      }
      return undefined
    } catch (error) {
      const details = error instanceof Error ? error.message : 'خطأ غير معروف'
      setMessage(`تعذر تحميل بيانات هذا القسم: ${details}`)
      return details
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [section])

  const perform = async (action: () => Promise<any>, success: string) => {
    setBusy(true); setMessage('')
    try {
      await action()
      if (section === 'catalog') {
        setCategoryId(undefined); setCategoryForm(emptyCategory)
        setServiceId(undefined); setServiceForm((current) => ({ ...emptyService, category_id: current.category_id }))
      }
      const refreshError = await refresh(false)
      setMessage(refreshError ? `${success} لكن تعذر تحديث القائمة: ${refreshError}` : success)
      onChanged?.()
    } catch (error) {
      setMessage(`تعذر إكمال العملية: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`)
    } finally { setBusy(false) }
  }

  const saveCategory = (event: React.FormEvent) => {
    event.preventDefault()
    void perform(() => saveAdminCategory({ ...categoryForm, ...(categoryId ? { id: categoryId } : {}) }), 'تم حفظ القسم وتحديث القائمة.')
  }
  const saveService = (event: React.FormEvent) => {
    event.preventDefault()
    const category_id = serviceForm.category_id || catalog.categories.find((item) => item.is_active)?.id || ''
    if (!category_id) { setMessage('أضف قسمًا فعّالًا أولًا حتى تتمكن من إنشاء خدمة.'); return }
    void perform(() => saveAdminService({ ...serviceForm, ...(serviceId ? { id: serviceId } : {}), category_id, base_price: serviceForm.pricing_type === 'fixed' ? Number(serviceForm.base_price) : null }), 'تم حفظ الخدمة وتحديث القائمة.')
  }
  const editCategory = (row: any) => { setCategoryId(row.id); setCategoryForm({ slug: row.slug, name_ar: row.name_ar, description: row.description ?? '', icon: row.icon ?? 'wrench', color: row.color ?? '#20d4c5', is_active: row.is_active, is_featured: row.is_featured }) }
  const editService = (row: any) => { setServiceId(row.id); setServiceForm({ category_id: row.category_id, slug: row.slug, name_ar: row.name_ar, description: row.description ?? '', pricing_type: row.pricing_type === 'fixed' ? 'fixed' : 'provider_quote', base_price: row.base_price == null ? '' : String(row.base_price), is_active: row.is_active, is_featured: row.is_featured }) }
  const header = (eyebrow: string, title: string, description: string, count?: string) => <div className="panel-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p className="muted">{description}</p></div>{count && <span className="status-pill">{count}</span>}</div>

  if (loading && !message) return <div className="panel loading-state" role="status">جارٍ تحميل بيانات هذا القسم…</div>
  return <div className="admin-marketplace-grid">
    {section === 'catalog' && <section className="panel" id="catalog">{header('إدارة الكتالوج', 'الأقسام والخدمات', 'أضف فئات وخدمات، واختر التسعير الثابت أو عرض الفني.', `${catalog.categories.length} أقسام · ${catalog.services.length} خدمات`)}
      <div className="catalog-admin-columns">
        <div><form className="admin-form" onSubmit={saveCategory}><h3>{categoryId ? 'تعديل القسم' : 'إضافة قسم'}</h3>
          <label className="field-label">اسم القسم<input required value={categoryForm.name_ar} onChange={(e) => setCategoryForm({ ...categoryForm, name_ar: e.target.value })} /></label>
          <label className="field-label">معرّف الرابط<input required pattern="[a-z0-9-]+" value={categoryForm.slug} onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value.toLowerCase() })} placeholder="plumbing" dir="ltr" /></label>
          <label className="field-label">وصف القسم<input value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} /></label>
          <div className="field-grid"><label className="field-label">أيقونة القسم<select className="icon-picker" value={categoryForm.icon} onChange={(e) => setCategoryForm({ ...categoryForm, icon: e.target.value })}>{iconChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="icon-preview"><CategoryIcon name={categoryForm.icon} size={22} /><span>معاينة الأيقونة</span></div></div>
          <label className="field-label">لون القسم<input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })} /></label>
          <label className="check-row"><input type="checkbox" checked={categoryForm.is_active} onChange={(e) => setCategoryForm({ ...categoryForm, is_active: e.target.checked })} /> ظاهر للعملاء</label><label className="check-row"><input type="checkbox" checked={categoryForm.is_featured} onChange={(e) => setCategoryForm({ ...categoryForm, is_featured: e.target.checked })} /> قسم مميز</label>
          <div className="button-row"><button type="submit" className="button button-primary button-small" disabled={busy}><Save size={15} /> {categoryId ? 'حفظ التعديلات' : 'حفظ القسم'}</button>{categoryId && <button type="button" className="button button-secondary button-small" onClick={() => { setCategoryId(undefined); setCategoryForm(emptyCategory) }}>إلغاء</button>}</div>
        </form><div className="catalog-list">{catalog.categories.map((row) => <div className="catalog-list-row" key={row.id}><span className="catalog-row-icon" style={{ color: row.color }}><CategoryIcon name={row.icon} size={19} /></span><div className="catalog-row-copy"><strong>{row.name_ar}</strong><small>{row.slug} · {row.is_active ? 'نشط' : 'مخفي'}</small></div><button type="button" className="icon-button" aria-label={`تعديل ${row.name_ar}`} onClick={() => editCategory(row)}><Edit3 size={15} /></button></div>)}</div></div>
        <div><form className="admin-form" onSubmit={saveService}><h3>{serviceId ? 'تعديل الخدمة' : 'إضافة خدمة'}</h3>
          <label className="field-label">اسم الخدمة<input required value={serviceForm.name_ar} onChange={(e) => setServiceForm({ ...serviceForm, name_ar: e.target.value })} /></label>
          <label className="field-label">القسم<select required value={serviceForm.category_id || ''} onChange={(e) => setServiceForm({ ...serviceForm, category_id: e.target.value })}><option value="">اختر القسم</option>{catalog.categories.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name_ar}</option>)}</select></label>
          <label className="field-label">معرّف الرابط<input required pattern="[a-z0-9-]+" value={serviceForm.slug} onChange={(e) => setServiceForm({ ...serviceForm, slug: e.target.value.toLowerCase() })} placeholder="tap-repair" dir="ltr" /></label>
          <label className="field-label">الوصف<input value={serviceForm.description} onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })} /></label>
          <label className="field-label">طريقة التسعير<select value={serviceForm.pricing_type} onChange={(e) => setServiceForm({ ...serviceForm, pricing_type: e.target.value as 'fixed' | 'provider_quote' })}><option value="provider_quote">يقدمه الفني بعد التنفيذ</option><option value="fixed">سعر ثابت من الإدارة</option></select></label>
          {serviceForm.pricing_type === 'fixed' && <label className="field-label">السعر الثابت (ر.س)<input type="number" min="0.01" step="0.01" required value={serviceForm.base_price} onChange={(e) => setServiceForm({ ...serviceForm, base_price: e.target.value })} /></label>}
          <label className="check-row"><input type="checkbox" checked={serviceForm.is_active} onChange={(e) => setServiceForm({ ...serviceForm, is_active: e.target.checked })} /> ظاهرة للعملاء</label><label className="check-row"><input type="checkbox" checked={serviceForm.is_featured} onChange={(e) => setServiceForm({ ...serviceForm, is_featured: e.target.checked })} /> خدمة مميزة</label>
          <div className="button-row"><button type="submit" className="button button-primary button-small" disabled={busy || !catalog.categories.some((row) => row.is_active)}><Save size={15} /> {serviceId ? 'حفظ التعديلات' : 'حفظ الخدمة'}</button>{serviceId && <button type="button" className="button button-secondary button-small" onClick={() => { setServiceId(undefined); setServiceForm({ ...emptyService, category_id: catalog.categories.find((row) => row.is_active)?.id ?? '' }) }}>إلغاء</button>}</div>
        </form><div className="catalog-list">{catalog.services.map((row) => { const category = catalog.categories.find((entry) => entry.id === row.category_id); return <div className="catalog-list-row" key={row.id}><span className="catalog-row-icon"><CategoryIcon name={category?.icon ?? 'wrench'} size={19} /></span><div className="catalog-row-copy"><strong>{row.name_ar}</strong><small>{category?.name_ar ?? 'قسم'} · {row.pricing_type === 'fixed' ? `${Number(row.base_price).toFixed(2)} ر.س` : 'عرض سعر'} · {row.is_active ? 'نشطة' : 'مخفية'}</small></div><button type="button" className="icon-button" aria-label={`تعديل ${row.name_ar}`} onClick={() => editService(row)}><Edit3 size={15} /></button></div>})}</div></div>
      </div>
    </section>}
    {section === 'quotes' && <section className="panel" id="quotes">{header('التسعير', 'عروض الفنيين', 'راجع قيمة التنفيذ قبل إصدار فاتورة للعميل.', `${quotes.length} بانتظار المراجعة`)}{quotes.length ? <div className="ops-list">{quotes.map((quote) => { const booking = object(quote.bookings); const provider = object(quote.provider_profiles); const customer = object(booking?.profiles); const service = object(booking?.services); const rejectReason = reviewNotes[quote.id] ?? ''; return <article className="ops-row" key={quote.id}><div><strong>طلب #{booking?.booking_number ?? '—'} · {service?.name_ar ?? 'خدمة'}</strong><small>الفني: {object(provider?.profiles)?.full_name ?? '—'} · العميل: {customer?.full_name ?? '—'} ({customer?.phone ?? '—'})</small><small>{[booking?.address_text, booking?.district, booking?.city].filter(Boolean).join(' · ')}</small><p>{quote.note || booking?.issue_description || 'لا توجد تفاصيل إضافية'}</p></div><div className="ops-row-actions"><strong>{Number(quote.amount).toFixed(2)} ر.س</strong><button type="button" className="button button-primary button-small" disabled={busy} onClick={() => void perform(() => acceptProviderQuote(quote.id), 'تم اعتماد السعر وإصدار الفاتورة.') }><Check size={15} /> اعتماد وإصدار الفاتورة</button><label className="field-label quote-reject-field">سبب الرفض المطلوب<input value={rejectReason} minLength={3} maxLength={500} onChange={(e) => setReviewNotes({ ...reviewNotes, [quote.id]: e.target.value })} placeholder="مثال: أرفق تفصيل المواد" /></label><button type="button" className="button button-secondary button-small" disabled={busy || rejectReason.trim().length < 3} onClick={() => void perform(() => rejectProviderQuote(quote.id, rejectReason.trim()), 'رُفض العرض وأُرسل السبب للفني لإعادة التقديم.') }><X size={15} /> رفض العرض</button></div></article>})}</div> : <p className="empty-inline">لا توجد عروض أسعار تنتظر المراجعة.</p>}</section>}
    {section === 'payments' && <section className="panel" id="payments">{header('التحصيل', 'الفواتير والمدفوعات', 'أكد استلام النقد أو طابق مرجع التحويل قبل تسجيل الدفع.', `${payments.length} فواتير مفتوحة`)}{payments.length ? <div className="ops-list">{payments.map((payment) => { const booking = object(payment.bookings); const customer = object(booking?.profiles); const method = payment.payment_method === 'cash' ? 'نقدًا' : payment.payment_method === 'bank_transfer' ? 'تحويل بنكي' : 'لم يحدد العميل'; const canConfirm = ['unpaid', 'pending'].includes(payment.status) && ['cash', 'bank_transfer'].includes(payment.payment_method); return <article className="ops-row" key={payment.id}><div><strong>فاتورة #{payment.invoice_number} · {Number(payment.amount).toFixed(2)} ر.س</strong><small>طلب #{booking?.booking_number ?? '—'} · {customer?.full_name ?? '—'} · {customer?.phone ?? '—'}</small><small>طريقة الدفع: {method} · الحالة: {payment.status}</small>{payment.status === 'failed' && <small className="inline-error">فشل التحويل؛ بانتظار إعادة اختيار العميل لطريقة الدفع.</small>}{payment.receipt_reference && <small>مرجع التحويل: <b dir="ltr">{payment.receipt_reference}</b></small>}{payment.review_note && <small className="inline-error">{payment.review_note}</small>}</div><div className="ops-row-actions"><input aria-label="ملاحظة مراجعة الدفع" value={reviewNotes[payment.id] ?? ''} onChange={(e) => setReviewNotes({ ...reviewNotes, [payment.id]: e.target.value })} placeholder="ملاحظة اختيارية" /><button type="button" className="button button-primary button-small" disabled={busy || !canConfirm} onClick={() => void perform(() => reviewInvoicePayment(payment.id, true, reviewNotes[payment.id] ?? ''), 'تم تأكيد التحصيل وإضافة صافي الفني إلى رصيده.')}><Check size={15} /> تأكيد التحصيل</button>{payment.payment_method === 'bank_transfer' && payment.status === 'pending' && <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void perform(() => reviewInvoicePayment(payment.id, false, reviewNotes[payment.id] || 'تعذر مطابقة التحويل. أعد مراجعة المرجع.'), 'رُفض التحويل وأُبلغ العميل.') }><X size={15} /> رفض التحويل</button>}</div></article>})}</div> : <p className="empty-inline">لا توجد فواتير مفتوحة حاليًا.</p>}</section>}
    {section === 'settings' && <section className="panel" id="settings">{header('إعدادات المنصة', 'العمولات والتحويل البنكي', 'تستخدم العمولة الافتراضية إذا لم تُسجل نسبة خاصة للفني.')}<div className="settings-columns"><form className="admin-form" onSubmit={(e) => { e.preventDefault(); void perform(() => saveDefaultCommission(Number(defaultRate)), 'تم حفظ نسبة العمولة الافتراضية.') }}><h3><Settings2 size={17} /> العمولة الافتراضية</h3><label className="field-label">نسبة المنصة (%)<input type="number" min="0" max="100" step="0.01" required value={defaultRate} onChange={(e) => setDefaultRate(e.target.value)} placeholder="أدخل النسبة" /></label><small className="muted">يمكن ضبط نسبة مختلفة لكل فني من قسم اعتماد الفنيين.</small><button type="submit" className="button button-primary button-small" disabled={busy || defaultRate === ''}><Save size={15} /> حفظ العمولة</button></form><form className="admin-form" onSubmit={(e) => { e.preventDefault(); void perform(() => savePaymentSettings(bank.bank_name, bank.bank_account_name, bank.iban), 'تم تحديث بيانات التحويل التي تظهر في فواتير العملاء.') }}><h3><Banknote size={17} /> بيانات التحويل البنكي</h3><label className="field-label">البنك<input value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} /></label><label className="field-label">اسم المستفيد<input value={bank.bank_account_name} onChange={(e) => setBank({ ...bank, bank_account_name: e.target.value })} /></label><label className="field-label">رقم الآيبان<input dir="ltr" value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.target.value })} placeholder="SA…" /></label><button type="submit" className="button button-primary button-small" disabled={busy}><Save size={15} /> حفظ بيانات التحويل</button></form></div></section>}
    {message && <div className={message.startsWith('تعذر') ? 'inline-error' : 'success-note'} role={message.startsWith('تعذر') ? 'alert' : 'status'}>{message.startsWith('تعذر') ? <X size={15} /> : <Check size={15} />}{message}<button type="button" className="message-retry" onClick={() => void refresh()}>إعادة تحميل</button></div>}
  </div>
}
