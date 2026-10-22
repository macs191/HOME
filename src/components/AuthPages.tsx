import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BriefcaseBusiness, Check, ShieldCheck, UserRound, X } from 'lucide-react'
import {
  completeGoogleProfile,
  ensureProviderProfile,
  finishOAuthSignIn,
  getAuthState,
  getMyAccountProfile,
  getMyRole,
  signInAccount,
  signInWithGoogle,
  signOutAccount,
  signUpAccount,
} from '../lib/supabase'
import type { Role } from '../types'

type MemberRole = Extract<Role, 'customer' | 'provider'>

function safeNextPath(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null
}

function dashboardPath(role: Role) {
  return role === 'admin' || role === 'sub_admin' ? '/admin/overview' : role === 'provider' ? '/provider/overview' : '/customer/overview'
}

function pathForRole(role: Role, nextPath: string | null) {
  if (role === 'customer' && nextPath && (nextPath === '/book' || nextPath.startsWith('/book?') || nextPath.startsWith('/customer/'))) return nextPath
  if (role === 'provider' && nextPath?.startsWith('/provider/')) return nextPath
  return dashboardPath(role)
}

function nameFromUser(user: { user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata ?? {}
  const value = metadata.full_name ?? metadata.name ?? [metadata.given_name, metadata.family_name].filter(Boolean).join(' ')
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePhone(value: string) {
  const digits = value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  return digits.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '')
}

function validatePhone(value: string) {
  const normalized = normalizePhone(value)
  const digits = normalized.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 && /^\+?[0-9]+$/.test(normalized) ? normalized : ''
}

function RoleChoice({ value, onChange }: { value: MemberRole | null; onChange: (role: MemberRole) => void }) {
  return <div className="google-role-choice" role="group" aria-label="نوع الحساب">
    <button type="button" className={value === 'customer' ? 'selected' : ''} onClick={() => onChange('customer')}>
      <UserRound size={19} /><span><strong>عميل طالب خدمة</strong><small>أطلب خدمة وأتابعها</small></span>{value === 'customer' && <Check size={17} />}
    </button>
    <button type="button" className={value === 'provider' ? 'selected' : ''} onClick={() => onChange('provider')}>
      <BriefcaseBusiness size={19} /><span><strong>فني / مقدم خدمة</strong><small>أرسل ملفك المهني للمراجعة</small></span>{value === 'provider' && <Check size={17} />}
    </button>
  </div>
}

export function OAuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const nextPath = safeNextPath(params.get('next'))

  useEffect(() => {
    let active = true
    finishOAuthSignIn().then(({ role, profileComplete }) => {
      if (!active) return
      if (role && profileComplete) navigate(pathForRole(role, nextPath), { replace: true })
      else {
        const target = new URL('/auth/complete-profile', window.location.origin)
        if (nextPath) target.searchParams.set('next', nextPath)
        navigate(`${target.pathname}${target.search}`, { replace: true })
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'تعذر إكمال الدخول بحساب Google.')
    })
    return () => { active = false }
  }, [navigate, nextPath])

  return <main className="container auth-page auth-page-simple"><section className="auth-card auth-card-simple">
    <span className="auth-mark"><ShieldCheck size={21} /></span><span className="eyebrow">تسجيل آمن</span>
    <h1>{error ? 'تعذر إكمال الدخول' : 'جارٍ تجهيز حسابك'}</h1>
    <p className="muted">{error || 'نتحقق من جلستك ونكمل بيانات الملف مرة واحدة.'}</p>
    {error && <Link className="button button-primary button-wide" to="/login">العودة لتسجيل الدخول <ArrowLeft size={16} /></Link>}
  </section></main>
}

export function GoogleProfileCompletionPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const nextPath = safeNextPath(params.get('next'))
  const [role, setRole] = useState<MemberRole | null>(null)
  const [roleLocked, setRoleLocked] = useState(false)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const auth = await getAuthState()
        if (!auth.user) { navigate('/login', { replace: true }); return }
        const currentRole = await getMyRole()
        if (currentRole === 'admin' || currentRole === 'sub_admin') { navigate('/admin/overview', { replace: true }); return }
        if (currentRole === 'customer' || currentRole === 'provider') {
          if (active) { setRole(currentRole); setRoleLocked(true) }
        }
        const profile = await getMyAccountProfile()
        if (profile.error) throw profile.error
        if (!active) return
        setFullName(profile.data?.full_name?.trim() || nameFromUser(auth.user))
        setPhone(profile.data?.phone?.trim() || (typeof auth.user.user_metadata?.phone === 'string' ? auth.user.user_metadata.phone : ''))
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'تعذر تحميل بيانات الحساب.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [navigate])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!role) { setError('اختر نوع حسابك للمتابعة.'); return }
    if (fullName.trim().length < 2 || fullName.trim().length > 160) { setError('أدخل الاسم الكامل الصحيح (من حرفين إلى 160 حرفًا).'); return }
    const validPhone = validatePhone(phone)
    if (!validPhone) { setError('أدخل رقم جوال صحيحًا مع رمز الدولة عند الحاجة (8 إلى 15 رقمًا).'); return }
    setBusy(true)
    try {
      const savedRole = await completeGoogleProfile({ role, fullName: fullName.trim(), phone: validPhone })
      navigate(pathForRole(savedRole, nextPath), { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر حفظ بيانات الحساب.')
    } finally { setBusy(false) }
  }

  const logout = async () => { await signOutAccount(); navigate('/', { replace: true }) }

  if (loading) return <main className="container auth-page auth-page-simple"><section className="auth-card auth-card-simple loading-state">جارٍ تحميل بيانات حسابك…</section></main>
  return <main className="container auth-page auth-page-simple"><section className="auth-card auth-card-simple profile-completion-card">
    <span className="auth-mark"><ShieldCheck size={21} /></span><span className="eyebrow">خطوة أخيرة · ملفك بأمان</span>
    <h1>{roleLocked ? 'أكمل بيانات حسابك' : 'كيف ستستخدم هوم سيرفس؟'}</h1>
    <p className="muted">{roleLocked ? 'هذا الحساب مرتبط بدوره الحالي؛ حدّث الاسم والجوال للمتابعة.' : 'اختر مساحتك بعد تسجيل Google، ثم أكد الاسم ورقم الهاتف.'}</p>
    <form onSubmit={submit} className="auth-profile-form">
      {!roleLocked && <RoleChoice value={role} onChange={setRole} />}
      {roleLocked && <div className="locked-role"><span>مساحة الحساب</span><strong>{role === 'provider' ? 'فني / مقدم خدمة' : 'عميل طالب خدمة'}</strong></div>}
      <label className="field-label">الاسم الكامل<input autoComplete="name" required minLength={2} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="كما يظهر في مستنداتك" /></label>
      <label className="field-label">رقم الهاتف<input autoComplete="tel" type="tel" inputMode="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="مثال: +966 5X XXX XXXX" /><small className="field-hint">اكتب الرقم مع رمز الدولة إن كان رقمك دوليًا. يُحفظ ضمن ملفك ولا يُعرض علنًا.</small></label>
      {error && <div className="inline-error" role="alert"><X size={16} />{error}</div>}
      <button className="button button-primary button-wide" disabled={busy || !role}>{busy ? 'جارٍ حفظ بياناتك…' : 'حفظ ومتابعة'} <ArrowLeft size={17} /></button>
    </form>
    <button type="button" className="auth-signout" onClick={() => void logout()}>هذا ليس حسابك؟ تسجيل الخروج</button>
  </section></main>
}

export function LoginPage({ fixedRole }: { fixedRole?: MemberRole }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const nextPath = safeNextPath(params.get('next'))
  const [mode, setMode] = useState<'signin' | 'signup'>(() => params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [role, setRole] = useState<MemberRole>(fixedRole ?? 'customer')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let active = true
    const redirectSavedSession = async () => {
      try {
        const auth = await getAuthState()
        if (!auth.user) return
        const accountRole = await getMyRole()
        if (!active) return
        if (!accountRole) { navigate('/auth/complete-profile', { replace: true }); return }
        if (accountRole === 'customer' || accountRole === 'provider') {
          const profile = await getMyAccountProfile()
          if (profile.error) throw profile.error
          if (!profile.data?.full_name?.trim() || !validatePhone(profile.data?.phone ?? '')) { navigate('/auth/complete-profile', { replace: true }); return }
        }
        navigate(pathForRole(accountRole, nextPath), { replace: true })
      } catch {
        // إبقاء شاشة الدخول ظاهرة إذا تعذّر فحص الجلسة.
      } finally { if (active) setCheckingSession(false) }
    }
    void redirectSavedSession()
    return () => { active = false }
  }, [navigate, nextPath])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      if (mode === 'signin') {
        await signInAccount(email, password)
        const accountRole = await getMyRole()
        if (!accountRole) { navigate('/auth/complete-profile', { replace: true }); return }
        if (accountRole === 'admin' || accountRole === 'sub_admin') { navigate('/admin/overview', { replace: true }); return }
        if (accountRole === 'provider') await ensureProviderProfile('provider')
        const profile = await getMyAccountProfile()
        if (profile.error) throw profile.error
        if (!profile.data?.full_name?.trim() || !validatePhone(profile.data?.phone ?? '')) { navigate('/auth/complete-profile', { replace: true }); return }
        navigate(pathForRole(accountRole, nextPath), { replace: true })
      } else {
        const normalizedPhone = validatePhone(phone)
        if (fullName.trim().length < 2) throw new Error('أدخل الاسم الكامل من حرفين على الأقل.')
        if (!normalizedPhone) throw new Error('أدخل رقم جوال صحيحًا (8 إلى 15 رقمًا).')
        const result = await signUpAccount({ email, password, fullName: fullName.trim(), phone: normalizedPhone, role })
        if (result.session) {
          if (role === 'provider') await ensureProviderProfile('provider')
          const accountRole = await getMyRole()
          if (!accountRole) { navigate('/auth/complete-profile', { replace: true }); return }
          navigate(pathForRole(accountRole, nextPath), { replace: true })
        } else setNotice('تم إنشاء الحساب. إذا طُلب تأكيد البريد، افتح الرسالة ثم سجّل الدخول.')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر إكمال العملية.') }
    finally { setBusy(false) }
  }

  const googleNext = fixedRole === 'provider' ? '/provider/overview' : (nextPath ?? '/customer/overview')
  const googleLogin = async () => {
    setError(''); setNotice(''); setBusy(true)
    try {
      await signInWithGoogle(role, googleNext)
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر بدء الدخول عبر Google.') }
    finally { setBusy(false) }
  }

  if (checkingSession) return <div className="container loading-state auth-loading">جارٍ التحقق من جلسة حسابك…</div>
  return <main className="container auth-page auth-page-simple">
    <section className="auth-card auth-card-simple">
      <Link to="/" className="auth-brand auth-brand-simple" aria-label="هوم سيرفس - الرئيسية"><span className="auth-mark"><ShieldCheck size={21} /></span><strong>هوم سيرفس</strong></Link>
      <span className="eyebrow">{fixedRole === 'provider' ? 'لوحة الفني' : fixedRole === 'customer' ? 'لوحة العميل' : 'حساب واحد، مساحة واضحة'}</span>
      <h1>{mode === 'signin' ? 'أهلًا بك من جديد' : 'أنشئ حسابك بسهولة'}</h1>
      <p className="muted auth-intro">{mode === 'signin' ? 'تابع طلباتك وخدماتك من مكان واحد.' : 'بياناتك محفوظة لتعود إلى طلباتك دون تكرار التسجيل.'}</p>
      <button type="button" className="button google-button google-primary button-wide" disabled={busy} onClick={() => void googleLogin()}><span className="google-g">G</span> المتابعة بحساب Google</button>
      <p className="google-flow-note">إذا كان هذا حساب Google جديدًا، تختار بعد الدخول لوحة العميل أو الفني وتؤكد الاسم ورقم الهاتف.</p>
      <div className="auth-divider"><span>أو باستخدام البريد الإلكتروني</span></div>
      <div className="auth-switch" role="tablist" aria-label="حالة الحساب"><button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); setNotice('') }}>تسجيل الدخول</button><button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); setNotice('') }}>إنشاء حساب</button></div>
      {mode === 'signup' && !fixedRole && <RoleChoice value={role} onChange={setRole} />}
      {fixedRole && <div className="locked-role"><span>نوع المساحة للبريد</span><strong>{fixedRole === 'provider' ? 'فني / مقدم خدمة' : 'عميل طالب خدمة'}</strong></div>}
      <form onSubmit={submit} className="auth-email-form">
        {mode === 'signup' && <><label className="field-label">الاسم الكامل<input autoComplete="name" required minLength={2} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="اكتب اسمك" /></label><label className="field-label">رقم الهاتف<input autoComplete="tel" type="tel" inputMode="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+966 5X XXX XXXX" /></label></>}
        <label className="field-label">البريد الإلكتروني<input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
        <label className="field-label">كلمة المرور<input autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6 أحرف على الأقل" /></label>
        {error && <div className="inline-error" role="alert"><X size={16} />{error}</div>}{notice && <div className="success-note" role="status"><Check size={16} />{notice}</div>}
        <button className="button button-primary button-wide" disabled={busy}>{busy ? 'جارٍ التنفيذ…' : mode === 'signin' ? 'تسجيل الدخول' : 'إنشاء الحساب'} <ArrowLeft size={16} /></button>
      </form>
      <p className="auth-session-note">تبقى الجلسة محفوظة على جهازك حتى تسجل الخروج أو تنتهي صلاحيتها.</p>
      <Link to="/services" className="auth-browse-link">تصفح الخدمات دون تسجيل</Link>
    </section>
  </main>
}
