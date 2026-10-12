import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Search, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react'
import { getAdminAccounts, getAdminAccountRecords, getAdminDocumentUrl, getProviderSpecialtyOptions, updateAdminAccount, updateAdminProviderSpecialties } from '../lib/supabase'

type Account = Awaited<ReturnType<typeof getAdminAccounts>>[number]
type Records = Awaited<ReturnType<typeof getAdminAccountRecords>>

function csvCell(value: unknown) { return `"${String(value ?? '').split('"').join('""')}"` }
function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const text = '\uFEFF' + [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}
function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}
const docLabels: Record<string, string> = { cv: 'السيرة الذاتية', identity_front: 'الهوية — الوجه', identity_back: 'الهوية — الظهر', national_id: 'الهوية', license: 'رخصة مهنية', certificate: 'شهادة' }
const statusLabels: Record<string, string> = { pending: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', suspended: 'موقوف', completed: 'مكتمل', assigned: 'مسند', in_progress: 'جارٍ التنفيذ', cancelled: 'ملغي', paid: 'مدفوع', unpaid: 'غير مدفوع' }

export function AdminAccountsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Account | null>(null)
  const [records, setRecords] = useState<Records | null>(null)
  const [docUrls, setDocUrls] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<'all'|'customer'|'provider'>('all')
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [specialtySaving, setSpecialtySaving] = useState(false)
  const [serviceOptions, setServiceOptions] = useState<any[]>([])
  const [providerServiceIds, setProviderServiceIds] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ fullName: '', phone: '', city: '', years: '', description: '' })

  const loadAccounts = async () => {
    setLoading(true); setError('')
    try { setAccounts(await getAdminAccounts(search, role)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر تحميل الحسابات.') }
    finally { setLoading(false) }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void loadAccounts() }, 250); return () => window.clearTimeout(timer) }, [search, role])
  useEffect(() => { let active = true; getProviderSpecialtyOptions().then(({ data, error }) => { if (active) { if (error) setError('تعذر تحميل قائمة الخدمات. حاول مرة أخرى.'); else setServiceOptions((data as any[]) ?? []) } }).catch(() => { if (active) setError('تعذر تحميل قائمة الخدمات. حاول مرة أخرى.') }); return () => { active = false } }, [])

  const selectAccount = async (account: Account) => {
    setSelected(account); setRecords(null); setDocUrls({}); setDetailsLoading(true); setError(''); setMessage('')
    try {
      const data = await getAdminAccountRecords(account.user_id)
      setRecords(data)
      setProviderServiceIds((data.provider?.provider_services ?? []).filter((item: any) => item.is_active).map((item: any) => item.service_id))
      setForm({ fullName: data.profile?.full_name ?? account.full_name ?? '', phone: data.profile?.phone ?? account.phone ?? '', city: data.profile?.city ?? account.city ?? '', years: String(data.provider?.years_experience ?? account.years_experience ?? ''), description: data.provider?.service_description ?? data.provider?.professional_bio ?? account.service_description ?? '' })
      const docs = (data.provider?.provider_documents ?? []).filter((doc: any) => doc.is_current !== false)
      const signed = await Promise.all(docs.map(async (doc: any) => [doc.id, await getAdminDocumentUrl(doc.document_type, doc.storage_path)] as const))
      setDocUrls(Object.fromEntries(signed))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر تحميل سجل الحساب.') }
    finally { setDetailsLoading(false) }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected) return
    setSaving(true); setError(''); setMessage('')
    try {
      await updateAdminAccount({ userId: selected.user_id, fullName: form.fullName, phone: form.phone, city: form.city, yearsExperience: selected.role === 'provider' ? Number(form.years) : null, serviceDescription: form.description })
      setMessage('تم حفظ التعديلات.')
      const updatedAccount = { ...selected, full_name: form.fullName.trim(), phone: form.phone.trim() || null, city: form.city.trim() || null, years_experience: selected.role === 'provider' ? Number(form.years) : null, service_description: form.description.trim() }
      setSelected(updatedAccount)
      setAccounts((current) => current.map((item) => item.user_id === selected.user_id ? { ...item, ...updatedAccount } : item))
      void loadAccounts()
      const refreshed = await getAdminAccountRecords(selected.user_id); setRecords(refreshed)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر حفظ التغييرات.') }
    finally { setSaving(false) }
  }

  const saveProviderServices = async () => {
    if (!selected || selected.role !== 'provider') return
    setSpecialtySaving(true); setError(''); setMessage('')
    try {
      await updateAdminProviderSpecialties(selected.user_id, providerServiceIds)
      setMessage('تم تحديث الخدمات التي يقدمها الفني.')
      setRecords(await getAdminAccountRecords(selected.user_id))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر تحديث الخدمات.') }
    finally { setSpecialtySaving(false) }
  }

  const exportAccounts = () => downloadCsv('حسابات-المنصة.csv', accounts.map((item) => ({ الاسم: item.full_name, البريد: item.email, الجوال: item.phone, المدينة: item.city, النوع: item.role === 'provider' ? 'فني' : 'عميل', الخبرة: item.years_experience, حالة_الاعتماد: item.approval_status, تاريخ_التسجيل: item.created_at })))
  const exportHistory = () => {
    if (!selected || !records) return
    downloadCsv(`سجل-${selected.role === 'provider' ? 'فني' : 'عميل'}-${selected.user_id.slice(0,8)}.csv`, records.bookings.map((item: any) => ({ رقم_الطلب: item.booking_number, الخدمة: item.services?.name_ar, الحالة: statusLabels[item.status] ?? item.status, المدينة: item.city, الحي: item.district, العنوان: item.address_text, الوصف: item.issue_description, السعر: item.price_snapshot, الدفع: item.payments?.map((p: any) => `${p.invoice_number ?? ''} ${p.amount ?? ''} ${statusLabels[p.status] ?? p.status}`).join(' | '), التاريخ: item.created_at })))
  }
  const exportAccountRecord = () => {
    if (!selected || !records) return
    const provider = records.provider ? { ...records.provider, provider_documents: (records.provider.provider_documents ?? []).map((doc: any) => ({ document_type: doc.document_type, status: doc.status, created_at: doc.created_at })), provider_services: (records.provider.provider_services ?? []).map((service: any) => service.services?.name_ar).filter(Boolean) } : null
    downloadJson(`ملف-${selected.role === 'provider' ? 'فني' : 'عميل'}-${selected.user_id.slice(0,8)}.json`, { profile: records.profile, role: records.role, bookings: records.bookings, provider, ledger: records.ledger })
  }
  const providerServices = useMemo(() => (records?.provider?.provider_services ?? []).filter((item: any) => item.is_active).map((item: any) => item.services?.name_ar).filter(Boolean), [records])

  return <div className="admin-accounts">
    <div className="panel admin-accounts-toolbar"><div><span className="eyebrow">إدارة الحسابات</span><h2>العملاء والفنيون</h2><p className="muted">اعرض بيانات الحساب وسجل الطلبات، راجع مستندات الفني الخاصة، وحدّث البيانات أو نزّلها.</p></div><div className="admin-account-actions"><a className="button button-secondary button-small" href="/customer/login?mode=signup">إنشاء حساب عميل</a><a className="button button-secondary button-small" href="/provider/login?mode=signup">تسجيل فني جديد</a><button type="button" className="button button-primary button-small" onClick={exportAccounts} disabled={!accounts.length}><Download size={15} />تنزيل قائمة الحسابات</button></div></div>
    <div className="accounts-layout">
      <section className="panel accounts-list-panel">
        <div className="accounts-filters"><label className="accounts-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو البريد أو الجوال" /></label><select aria-label="تصفية نوع الحساب" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="all">الكل</option><option value="customer">العملاء</option><option value="provider">الفنيون</option></select></div>
        {error && !selected && <div className="inline-error" role="alert"><X size={16} />{error}<button type="button" onClick={() => void loadAccounts()}>إعادة المحاولة</button></div>}
        {loading ? <div className="loading-state">جارٍ تحميل الحسابات…</div> : accounts.length ? <div className="account-list">{accounts.map((item) => <button type="button" key={item.user_id} className={`account-list-row ${selected?.user_id === item.user_id ? 'selected' : ''}`} onClick={() => void selectAccount(item)}><span className="account-avatar">{item.role === 'provider' ? <ShieldCheck size={18} /> : <UserRound size={18} />}</span><span className="account-list-copy"><strong>{item.full_name || 'بدون اسم'}</strong><small>{item.email}</small><small>{item.phone || 'لا يوجد رقم جوال'} · {item.role === 'provider' ? 'فني' : 'عميل'}</small></span><span className="account-state">{item.role === 'provider' ? statusLabels[item.approval_status ?? 'pending'] ?? item.approval_status : 'عميل'}</span></button>)}</div> : <div className="empty-inline">لا توجد حسابات مطابقة.</div>}
      </section>
      <section className="panel account-detail-panel">
        {!selected ? <div className="account-detail-empty"><UsersRound size={30} /><h3>اختر حسابًا لعرض تفاصيله</h3><p>ستظهر هنا بيانات الحساب وسجلاته ومرفقاته المصرح بها.</p></div> : <>
          <div className="account-detail-heading"><div><span className="eyebrow">{selected.role === 'provider' ? 'ملف فني' : 'ملف عميل'}</span><h2>{selected.full_name || selected.email}</h2><p className="muted">{selected.email} · {selected.phone || 'لا يوجد رقم جوال'}</p></div><div className="account-detail-actions"><button type="button" className="button button-secondary button-small" onClick={exportAccountRecord} disabled={!records}><Download size={14} />تنزيل الملف</button><button type="button" className="icon-button" onClick={() => { setSelected(null); setRecords(null); setError('') }} aria-label="إغلاق تفاصيل الحساب"><X size={18} /></button></div></div>
          {error && <div className="inline-error" role="alert"><X size={16} />{error}</div>}{message && <div className="success-note">{message}</div>}
          {detailsLoading ? <div className="loading-state">جارٍ تحميل سجل الحساب…</div> : records && <>
            <form className="account-edit-form" onSubmit={save}><h3>بيانات الحساب</h3><div className="field-grid"><label className="field-label">الاسم الكامل<input required minLength={2} maxLength={160} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label><label className="field-label">رقم الجوال<input type="tel" maxLength={32} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label className="field-label">المدينة<input maxLength={120} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>{selected.role === 'provider' && <label className="field-label">سنوات الخبرة<input type="number" min="0" max="70" value={form.years} onChange={(event) => setForm({ ...form, years: event.target.value })} /></label>}</div>{selected.role === 'provider' && <label className="field-label">نبذة ومجالات العمل<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>}<div className="account-edit-actions"><button className="button button-primary" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button><span className="muted">لا يمكن تغيير بيانات الدخول من هنا.</span></div></form>
            {selected.role === 'provider' && <section className="account-subsection"><h3>تعديل التخصصات والخدمات</h3><p className="muted">اختر الخدمات النشطة التي يمكن إسنادها للفني.</p><div className="specialty-options provider-admin-service-options">{serviceOptions.map((option) => { const category = Array.isArray(option.service_categories) ? option.service_categories[0] : option.service_categories; return <label className="specialty-option" key={option.id}><input type="checkbox" checked={providerServiceIds.includes(option.id)} onChange={(event) => setProviderServiceIds((current) => event.target.checked ? Array.from(new Set([...current, option.id])) : current.filter((id) => id !== option.id))} /><span><strong>{option.name_ar}</strong><small>{category?.name_ar ?? 'خدمة'}</small></span></label> })}</div><button type="button" className="button button-secondary button-small" onClick={() => void saveProviderServices()} disabled={specialtySaving || !providerServiceIds.length || !serviceOptions.length}>{specialtySaving ? 'جارٍ الحفظ…' : 'حفظ تخصصات الفني'}</button></section>}
            {selected.role === 'provider' && <section className="account-subsection"><h3>الخدمات التي يقدمها</h3>{providerServices.length ? <div className="account-service-tags">{providerServices.map((name: string) => <span key={name}>{name}</span>)}</div> : <p className="muted">لم يختر الفني خدمات بعد.</p>}<h3>مستندات الاعتماد</h3>{(records.provider?.provider_documents ?? []).filter((doc: any) => doc.is_current !== false).length ? <div className="account-documents">{(records.provider?.provider_documents ?? []).filter((doc: any) => doc.is_current !== false).map((doc: any) => <div className="account-document" key={doc.id}><FileText size={17} /><span><strong>{docLabels[doc.document_type] ?? 'مستند'}</strong><small>{statusLabels[doc.status] ?? doc.status}</small></span>{docUrls[doc.id] ? <a className="button button-secondary button-small" href={docUrls[doc.id]} target="_blank" rel="noreferrer">عرض / تنزيل</a> : <small>غير متاح</small>}</div>)}</div> : <p className="muted">لم تُرفع مستندات اعتماد حتى الآن.</p>}</section>}
            <section className="account-subsection"><div className="account-history-heading"><h3>سجل الطلبات ({records.bookings.length})</h3><button type="button" className="button button-secondary button-small" onClick={exportHistory} disabled={!records.bookings.length}><Download size={14} />تنزيل السجل</button></div>{records.bookings.length ? <div className="account-history-list">{records.bookings.map((item: any) => <article className="account-history-item" key={item.id}><div><strong>#{item.booking_number} · {item.services?.name_ar ?? 'خدمة'}</strong><small>{[item.city,item.district,item.address_text].filter(Boolean).join(' · ')}</small><p>{item.issue_description}</p></div><span className="status-pill">{statusLabels[item.status] ?? item.status}</span><small>{item.price_snapshot ? `${item.price_snapshot} ر.س` : 'بانتظار التسعير'}</small></article>)}</div> : <p className="muted">لا توجد طلبات مرتبطة بهذا الحساب.</p>}</section>
            {selected.role === 'provider' && <section className="account-subsection"><h3>سجل المستحقات ({records.ledger.length})</h3>{records.ledger.length ? records.ledger.map((item: any) => <div className="ledger-row" key={item.id}><span>{item.note || item.entry_type}</span><strong>{Number(item.amount).toFixed(2)} ر.س</strong></div>) : <p className="muted">لا توجد قيود مالية.</p>}</section>}
          </>}
        </>}
      </section>
    </div>
  </div>
}
