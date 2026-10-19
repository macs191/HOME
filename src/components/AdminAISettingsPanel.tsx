import { useEffect, useRef, useState } from 'react'
import { Bot, Check, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

type SettingsAction = 'status' | 'save' | 'clear'

function errorText(code: string) {
  const messages: Record<string, string> = {
    primary_admin_required: 'هذه الإعدادات متاحة لمدير المنصة الرئيسي فقط.',
    invalid_api_key: 'صيغة المفتاح غير صالحة. تحقق من القيمة وحاول مجددًا.',
    api_key_required: 'أدخل مفتاح OpenAI أولًا.',
  }
  return messages[code] ?? 'تعذر حفظ إعدادات المساعد. تحقق من الاتصال ثم أعد المحاولة.'
}

export function AdminAISettingsPanel() {
  const [configured, setConfigured] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [accessChecked, setAccessChecked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const keyInput = useRef<HTMLInputElement>(null)

  const invoke = async (action: SettingsAction, apiKey?: string) => {
    if (!supabase) throw new Error('settings_unavailable')
    const { data, error } = await supabase.functions.invoke('admin-ai-settings', {
      body: { action, ...(apiKey === undefined ? {} : { apiKey }) },
    })
    if (error) {
      const status = (error as any).context?.status
      throw new Error(status === 403 ? 'primary_admin_required' : 'settings_unavailable')
    }
    if (data?.error) throw new Error(String(data.error))
    return data as { configured?: boolean }
  }

  const refresh = async () => {
    setLoading(true)
    setAccessChecked(false)
    setCanManage(false)
    setMessage('')
    try {
      if (!supabase) throw new Error('settings_unavailable')
      const { data: isPrimaryAdmin, error } = await supabase.rpc('has_role', { required_role: 'admin' })
      if (error) throw new Error('settings_unavailable')
      setAccessChecked(true)
      if (isPrimaryAdmin !== true) return
      setCanManage(true)
      try {
        const result = await invoke('status')
        setConfigured(result.configured === true)
      } catch (statusError) {
        setMessage(errorText(statusError instanceof Error ? statusError.message : 'settings_unavailable'))
      }
    } catch (error) {
      setMessage(errorText(error instanceof Error ? error.message : 'settings_unavailable'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = keyInput.current?.value ?? ''
    if (value.trim().length < 20 || value.length > 512) {
      setMessage('أدخل قيمة مفتاح صالحة بطول مناسب.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await invoke('save', value)
      setConfigured(result.configured === true)
      if (keyInput.current) keyInput.current.value = ''
      setMessage('حُفظ المفتاح المشفّر. لن تُعرض قيمته مرة أخرى.')
    } catch (error) {
      setMessage(errorText(error instanceof Error ? error.message : 'settings_unavailable'))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (!configured || !window.confirm('إزالة مفتاح OpenAI من إعدادات HOME؟ سيتوقف تصنيف الخدمة بالذكاء الاصطناعي.')) return
    setBusy(true)
    setMessage('')
    try {
      const result = await invoke('clear')
      setConfigured(result.configured === true)
      setMessage('تمت إزالة مفتاح OpenAI. سيستمر المساعد بالتصنيف المحلي.')
    } catch (error) {
      setMessage(errorText(error instanceof Error ? error.message : 'settings_unavailable'))
    } finally {
      setBusy(false)
    }
  }

  // Hide the component entirely unless the signed-in account has the root admin role.
  if (!accessChecked || !canManage) return null

  return <section className="panel admin-ai-settings" aria-labelledby="admin-ai-settings-title">
    <div className="panel-heading"><div><span className="eyebrow">المساعد الذكي</span><h2 id="admin-ai-settings-title"><Bot size={20} /> إعداد مفتاح OpenAI</h2><p className="muted">إدارة الاتصال بالتصنيف الذكي من دون وضع المفتاح في المتصفح أو مستودع الشيفرة.</p></div><span className={configured ? 'status-pill status-pill-success' : 'status-pill'}>{loading ? 'جارٍ التحقق…' : configured ? 'المفتاح مضبوط' : 'غير مضبوط'}</span></div>
    {loading && <p className="muted" role="status">جارٍ التحقق من حالة المفتاح…</p>}
    {!loading && <>
      <form className="admin-form" onSubmit={(event) => void save(event)}>
        <label className="field-label" htmlFor="home-openai-key">مفتاح OpenAI
          <input ref={keyInput} id="home-openai-key" name="openai-api-key" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} dir="ltr" minLength={20} maxLength={512} placeholder={configured ? 'أدخل مفتاحًا جديدًا للاستبدال' : 'الصق مفتاح OpenAI هنا'} disabled={busy} />
        </label>
        <div className="button-row"><button type="submit" className="button button-primary button-small" disabled={busy}><KeyRound size={15} /> {busy ? 'جارٍ الحفظ…' : configured ? 'حفظ المفتاح الجديد' : 'حفظ المفتاح'}</button>{configured && <button type="button" className="button button-secondary button-small" onClick={() => void clear()} disabled={busy}><Trash2 size={15} /> إزالة المفتاح</button>}</div>
      </form>
      {message && <p className={message.startsWith('تعذر') || message.includes('غير صالحة') || message.includes('متاحة') ? 'inline-error' : 'success-note'} role="status">{message}</p>}
      <div className="security-note"><ShieldCheck size={17} /><p>يُحفظ المفتاح مشفّرًا في Supabase Vault ولا يُعاد إلى الواجهة بعد الحفظ. لا تُرسل عبارة الخدمة إلى OpenAI إلا بعد موافقة المستخدم الصريحة. قد تحتوي العبارة التي وافق على إرسالها على معلومات شخصية؛ لا تضع فيها عنوانًا أو رقمًا أو اسمًا. يحظر الخادم بعض الأنماط الشائعة، لكن الفلاتر ليست مضمونة. وصف المشكلة والموقع اللذان تجمعهما الخطوات اللاحقة لا يُرسلان. قد تُحتسب الاستدعاءات حسب خطة OpenAI، وبحد أقصى 12 محاولة لكل حساب في الساعة.</p></div>
      {!loading && configured && <p className="muted"><Check size={15} /> التصنيف الذكي متاح بعد موافقة المستخدم؛ إزالة المفتاح تعيده فورًا إلى القواعد المحلية.</p>}
    </>}
  </section>
}
