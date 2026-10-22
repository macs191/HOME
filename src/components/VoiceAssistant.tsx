import { useEffect, useRef, useState } from 'react'
import { Bot, MapPin, Mic, MicOff, Send, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Message = { from: 'assistant' | 'user'; text: string }
type AssistantDraft = {
  serviceId?: string
  issue: string
  city: string
  district: string
  address: string
  urgency: 'normal' | 'urgent'
  locationSource: 'none' | 'manual'
  scheduledDate: string
  scheduledSlot: string
}
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

function serviceFromText(text: string): string | undefined {
  if (/تسليك|انسداد|مجاري/.test(text)) return 'drain'
  if (/سباك|سباكة|تسريب|ماء|مياه/.test(text)) return 'leak'
  if (/إضاءة|اضاءة|لمبة|مصباح|نور/.test(text)) return 'lighting'
  if (/كهرب|قاطع|تماس/.test(text)) return 'electrical-fault'
  if (/تكييف|مكيف|مكيّف|مبرد/.test(text)) return 'ac-maintenance'
  if (/تنظيف|نظافة/.test(text)) return 'deep-cleaning'
  if (/غسالة|ثلاجة|فرن|جهاز/.test(text)) return 'appliance-repair'
  if (/نجار|نجارة|أثاث خشبي|باب خشب/.test(text)) return 'carpentry'
  if (/دهان|طلاء/.test(text)) return 'painting'
  if (/نقل أثاث|تركيب أثاث/.test(text)) return 'moving'
  if (/حشرات|مكافحة/.test(text)) return 'pest-control'
  if (/قفل|مفتاح|أقفال/.test(text)) return 'locksmith'
  return undefined
}

async function serviceFromAI(text: string): Promise<string | undefined> {
  if (!supabase) return undefined
  try {
    const { data, error } = await supabase.functions.invoke('home-assistant', { body: { text: text.slice(0, 500), consent: true } })
    if (error || typeof data?.service_id !== 'string') return undefined
    return data.service_id
  } catch {
    return undefined
  }
}

function cityFromText(text: string): string {
  const cities = ['مكة المكرمة', 'المدينة المنورة', 'الرياض', 'جدة', 'الدمام', 'مكة']
  const found = cities.find((city) => text.includes(city))
  return found === 'مكة' ? 'مكة المكرمة' : found ?? ''
}

function scheduleFromText(text: string): { scheduledDate: string; scheduledSlot: string } | undefined {
  const now = new Date()
  const date = new Date(now)
  if (/غدًا|غدا|بكرة|بكره/.test(text)) date.setDate(now.getDate() + 1)
  else if (!/اليوم/.test(text)) {
    const iso = text.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/)
    if (!iso) return undefined
    date.setFullYear(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  }
  const scheduledSlot = /صباح|الصبح/.test(text) ? '09:00-12:00' : /ظهر|الظهر|ظهرًا/.test(text) ? '12:00-15:00' : /عصر|العصر/.test(text) ? '16:00-19:00' : /مساء|المساء|ليل/.test(text) ? '19:00-21:00' : ''
  if (!scheduledSlot) return undefined
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return { scheduledDate: `${yyyy}-${mm}-${dd}`, scheduledSlot }
}

export function VoiceAssistant() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const [listening, setListening] = useState(false)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const [pendingAIText, setPendingAIText] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([{ from: 'assistant', text: 'أهلًا بك. اذكر الخدمة المنزلية التي تحتاجها، مثل السباكة أو الكهرباء، وسأجهّز مسودة طلب تراجعها قبل الإرسال.' }])
  const recognition = useRef<any>(null)
  const draftRef = useRef<AssistantDraft | null>(null)
  const [step, setStep] = useState<'service' | 'issue' | 'location' | 'schedule' | 'ready'>('service')
  const [serviceId, setServiceId] = useState<string>()
  const [issue, setIssue] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [address, setAddress] = useState('')
  const say = (text: string) => {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ar-SA'
    window.speechSynthesis.speak(utterance)
  }

  const respond = async (raw: string) => {
    const text = raw.trim().slice(0, 1000)
    if (!text || processingRef.current) return
    processingRef.current = true
    setProcessing(true)
    let reply = ''
    let nextDraft: AssistantDraft | undefined

    try {
      if (step === 'service') {
        const found = serviceFromText(text)
        if (!found) {
          setPendingAIText(text)
          reply = 'لم أتعرف على الخدمة. اكتب اسمها باختصار، أو اختر تصنيف العبارة بالذكاء الاصطناعي. لن تُرسل عبارتك إلى OpenAI قبل موافقتك الصريحة.'
        } else {
          setPendingAIText('')
          setServiceId(found)
          setStep('issue')
          reply = 'ما المشكلة التي تريد وصفها للفني؟ لا ترسل رقم الهوية أو معلومات دفع هنا.'
        }
      } else if (step === 'issue') {
        setIssue(text)
        setStep('location')
        reply = 'ما المدينة والحي أو العنوان التقريبي؟ سيُملأ العنوان في المسودة لتراجعه، ويمكنك اختيار موقع GPS من نموذج الطلب.'
      } else if (step === 'location') {
        const district = text.match(/(?:حي|الحى)\s+([^،,]+)/)?.[1]?.trim().slice(0, 160) ?? ''
        setCity(cityFromText(text))
        setDistrict(district)
        setAddress(text.slice(0, 500))
        setStep('schedule')
        setPendingAIText('')
        reply = 'ممتاز. متى يناسبك الموعد؟ قل مثلًا: غدًا صباحًا، أو 2026-10-25 مساءً.'
      } else if (step === 'schedule') {
        const schedule = scheduleFromText(text)
        if (!schedule) {
          reply = 'أحتاج اليوم والفترة الزمنية. قل مثلًا: غدًا صباحًا، أو اليوم مساءً.'
        } else {
          const draft: AssistantDraft = { serviceId, issue, city, district, address, urgency: /عاجل|طارئ|بسرعة/.test(issue) ? 'urgent' : 'normal', locationSource: 'manual', ...schedule }
          draftRef.current = draft
          setStep('ready')
          reply = 'راجعت البيانات صوتيًا. قل «أرسل الطلب» أو «ارفع الطلب» للتأكيد النهائي، أو قل «عدّل» للمراجعة.'
        }
      } else {
        if (/أرسل|ارفع|تأكيد|نفّذ|ارفعه/.test(text)) {
          nextDraft = draftRef.current ?? undefined
          reply = 'تم تسجيل تأكيدك الصوتي. سأفتح نموذج الحجز بالبيانات التي جمعتها، ولا يتم الإرسال إلا بعد التحقق من الحساب والموافقة على سياسة الطلب.'
        } else reply = 'المسودة جاهزة. قل «أرسل الطلب» للتأكيد النهائي أو «عدّل» للمراجعة.'
      }
    } finally {
      processingRef.current = false
      setProcessing(false)
    }

    setMessages((items) => [...items, { from: 'user', text }, { from: 'assistant', text: reply }])
    say(reply)
    if (nextDraft) setTimeout(() => navigate('/book', { state: { assistantDraft: nextDraft, assistantConfirmed: true } }), 700)
  }

  const classifyWithAI = async () => {
    if (!pendingAIText || processingRef.current) return
    processingRef.current = true
    setProcessing(true)
    try {
      const found = await serviceFromAI(pendingAIText)
      if (found) {
        setServiceId(found)
        setStep('issue')
        const reply = 'تم تصنيف الخدمة. ما المشكلة التي تريد وصفها للفني؟ لن أرسل وصف المشكلة أو الموقع إلى OpenAI.'
        setMessages((items) => [...items, { from: 'assistant', text: reply }])
        say(reply)
      } else {
        const reply = 'لم أتمكن من تصنيف العبارة. اكتب اسم الخدمة باختصار أو افتح نموذج الطلب مباشرة.'
        setMessages((items) => [...items, { from: 'assistant', text: reply }])
        say(reply)
      }
    } finally {
      setPendingAIText('')
      processingRef.current = false
      setProcessing(false)
    }
  }

  const cancelAI = () => {
    setPendingAIText('')
    const reply = 'حسنًا. اكتب اسم الخدمة باختصار وسأستخدم التصنيف المحلي فقط.'
    setMessages((items) => [...items, { from: 'assistant', text: reply }])
    say(reply)
  }

  const startListening = () => {
    if (!SpeechRecognition) {
      setMessages((items) => [...items, { from: 'assistant', text: 'المتصفح لا يدعم الصوت الآن. يمكنك كتابة رسالتك وسأتابع معك.' }])
      return
    }
    const instance = new SpeechRecognition()
    recognition.current = instance
    instance.lang = 'ar-SA'
    instance.continuous = true
    instance.interimResults = false
    instance.onresult = (event: any) => { void respond(event.results[event.results.length - 1][0].transcript) }
    instance.onstart = () => setListening(true)
    instance.onend = () => {
      recognition.current = null
      setListening(false)
      if (openRef.current) setTimeout(() => { if (openRef.current && !recognition.current) startListening() }, 250)
    }
    instance.onerror = () => setListening(false)
    instance.start()
  }

  useEffect(() => () => { recognition.current?.stop(); window.speechSynthesis?.cancel() }, [])

  return <>
    {!open && <button className="voice-assistant-fab" onClick={() => { openRef.current = true; setOpen(true); setTimeout(startListening, 100) }} aria-label="فتح المساعد الصوتي"><Bot size={22} /><span>مساعد HOME</span></button>}
    {open && <section className="voice-assistant-panel" role="dialog" aria-label="مساعد HOME الصوتي" aria-busy={processing}>
      <header><div><span className="eyebrow">مساعد HOME</span><h2>جهّز مسودة طلبك</h2></div><button className="icon-button" onClick={() => { openRef.current = false; setOpen(false); recognition.current?.stop(); recognition.current = null; setListening(false) }} aria-label="إغلاق"><X size={18} /></button></header>
      <div className="voice-assistant-messages" aria-live="polite">{messages.map((item, index) => <div key={index} className={`voice-message ${item.from}`}>{item.text}</div>)}{processing && <div className="voice-message assistant">جارٍ تحديد نوع الخدمة…</div>}</div>
      {pendingAIText && <div className="voice-assistant-ai-consent" role="group" aria-label="الموافقة على تصنيف العبارة"><p>سيُرسل النص المعروض أعلاه إلى OpenAI لتصنيف الخدمة فقط. لا توافق إذا احتوى على اسم أو عنوان أو رقم أو أي معلومة شخصية؛ لا تضمن الفلاتر اكتشاف كل ذلك.</p><div className="button-row"><button type="button" className="button button-primary button-small" onClick={() => void classifyWithAI()} disabled={processing}>أوافق، صَنّف الخدمة</button><button type="button" className="button button-secondary button-small" onClick={cancelAI} disabled={processing}>لا، ألغِ</button></div></div>}
      <div className="voice-assistant-actions"><button className={listening ? 'button button-secondary listening' : 'button button-primary'} onClick={() => listening ? recognition.current?.stop() : startListening()} disabled={processing}>{listening ? <MicOff size={16} /> : <Mic size={16} />} {listening ? 'إيقاف الاستماع' : 'تحدث الآن'}</button><button className="button button-secondary" onClick={() => { openRef.current = false; setOpen(false); recognition.current?.stop(); navigate('/book') }}><MapPin size={16} /> فتح نموذج الطلب</button></div>
      <form className="voice-assistant-input" onSubmit={(event) => { event.preventDefault(); void respond(input); setInput('') }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="اكتب رسالتك هنا…" disabled={processing} /><button type="submit" aria-label="إرسال" disabled={processing || !input.trim()}><Send size={16} /></button></form>
      <small className="voice-assistant-note">المساعد يجمع المسودة صوتيًا؛ لا يُرسل الطلب إلا بعد قولك «أرسل الطلب» وبعد التحقق من الحساب والحقول الإلزامية.</small>
      <small className="voice-assistant-note">عند تعذر التصنيف المحلي، لا تُرسل العبارة تلقائيًا. بعد موافقتك فقط قد تُرسل عبارة الخدمة نفسها إلى OpenAI؛ لا ترسل معها معلومات شخصية. وصف المشكلة والموقع اللذان تجمعهما الخطوات اللاحقة لا يُرسلان إلى OpenAI.</small>
    </section>}
  </>
}
