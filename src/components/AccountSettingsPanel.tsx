import { useEffect, useState } from 'react'
import { BriefcaseBusiness, Check, LogOut, Save, ShieldCheck, UserRound, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { getAuthState, getMyAccountProfile, getMyProviderProfile, signOutAccount, updateMyAccountProfile } from '../lib/supabase'
import type { Role } from '../types'

type MemberRole = Extract<Role, 'customer' | 'provider'>

export function AccountSettingsPanel({ role }: { role: MemberRole }) {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [years, setYears] = useState('')
  const [description, setDescription] = useState('')
  const [approval, setApproval] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [account, auth, provider] = await Promise.all([
          getMyAccountProfile(), getAuthState(), role === 'provider' ? getMyProviderProfile() : Promise.resolve({ data: null, error: null }),
        ])
        if (account.error) throw account.error
        if (provider.error) throw provider.error
        if (!active) return
        setFullName(account.data?.full_name ?? '')
        setPhone(account.data?.phone ?? '')
        setCity(account.data?.city ?? '')
        setEmail(auth.user?.email ?? '')
        if (provider.data) {
          setYears(String(provider.data.years_experience ?? ''))
          setDescription(provider.data.service_description ?? '')
          setApproval(provider.data.approval_status ?? '')
        }
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : 'تعذر تحميل بيانات الحساب.') }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [role])
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('')
    if (fullName.trim().length < 2) { setMessage('أدخل اسمًا كاملًا من حرفين على الأقل.'); return }
    if (phone.replace(/\D/g, '').length < 8) { setMessage('أدخل رقم جوال صحيحًا من 8 أرقام على الأقل.'); return }
    let yearsExperience: number | undefined
    if (role === 'provider') {
      yearsExperience = Number(years)
      if (!Number.isInteger(yearsExperience) || yearsExperience < 0 || yearsExperience > 70) { setMessage('أدخل سنوات خبرة صحيحة بين 0 و70.'); return }
      if (description.trim().length < 10) { setMessage('اكتب نبذة مهنية من 10 أحرف على الأقل.'); return }
    }
    setBusy(true)
    try {
      const result = await updateMyAccountProfile({ fullName, phone, city, ...(role === 'provider' ? { yearsExperience, serviceDescription: description } : {}) })
      if (result?.approval_status) setApproval(result.approval_status)
      setMessage(role === 'provider' && result?.review_required ? 'تم حفظ بياناتك، وأُعيد ملفك المهني للمراجعة بسبب تحديث الخبرة أو النبذة.' : 'تم حفظ بيانات الحساب بنجاح.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر حفظ بيانات الحساب.') }
    finally { setBusy(false) }
  }
  const logout = async () => {
    setSigningOut(true); setMessage('')
    try { await signOutAccount(); navigate('/', { replace: true }) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تسجيل الخروج. حاول مرة أخرى.'); setSigningOut(false) }
  }
  if (loading) return <div className="panel loading-state" role="status">جارٍ تحميل بيانات الحساب…</div>
  return <section className="account-settings panel">
    <div className="panel-heading"><div><span className="eyebrow">إعدادات الحساب</span><h2>{role === 'provider' ? 'بياناتك المهنية' : 'بيانات العميل'}</h2><p className="muted">يمكنك تعديل معلوماتك الأساسية في أي وقت. لا يمكن تغيير دور الحساب من هنا.</p></div><span className="account-settings-mark">{role === 'provider' ? <BriefcaseBusiness size={20} /> : <UserRound size={20} />}</span></div>
    <form className="account-settings-form" onSubmit={(event) => void save(event)}>
      {email && <label className="field-label">البريد الإلكتروني<input value={email} readOnly dir="ltr" /></label>}
      <div className="field-grid"><label className="field-label">الاسم الكامل<input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={2} maxLength={160} /></label><label className="field-label">رقم الجوال<input autoComplete="tel" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required maxLength={24} /></label></div>
      <label className="field-label">المدينة (اختياري)<input autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} maxLength={120} /></label>
      {role === 'provider' && <><div className="field-grid"><label className="field-label">سنوات الخبرة<input type="number" min="0" max="70" step="1" value={years} onChange={(event) => setYears(event.target.value)} required /></label><label className="field-label">حالة الاعتماد<input value={approval === 'approved' ? 'معتمد' : approval === 'rejected' ? 'يتطلب تحديثًا' : approval === 'suspended' ? 'موقوف' : 'قيد المراجعة'} readOnly /></label></div><label className="field-label">نبذة مهنية<textarea value={description} onChange={(event) => setDescription(event.target.value)} required minLength={10} maxLength={3000} rows={4} /></label><div className="account-settings-help"><ShieldCheck size={17} /><p>الاسم والجوال والمدينة لا تغيّر دورك. تعديل الخبرة أو النبذة يعيد الاعتماد للمراجعة قبل استقبال أعمال جديدة.</p></div><Link className="button button-secondary button-small" to="/provider/specialties">إدارة التخصصات والخدمات</Link></>}
      <div className="account-settings-actions"><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : <><Save size={16} /> حفظ التغييرات</>}</button><button type="button" className="button button-secondary" disabled={signingOut} onClick={() => void logout()}>{signingOut ? 'جارٍ تسجيل الخروج…' : <><LogOut size={16} /> تسجيل الخروج</>}</button></div>
    </form>
    {message && <div className={message.startsWith('تعذر') || message.startsWith('أدخل') || message.startsWith('اكتب') ? 'inline-error' : 'success-note'} role="status">{message.startsWith('تعذر') ? <X size={16} /> : <Check size={16} />}{message}</div>}
  </section>
}
