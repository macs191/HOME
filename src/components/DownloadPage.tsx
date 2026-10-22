import { useEffect, useState } from 'react'
import { Apple, ArrowDownToLine, CheckCircle2, Download, Globe2, Info, Smartphone, Sparkles } from 'lucide-react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<InstallChoice> }

function isStandalone() {
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone)
}

function WebInstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone())
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent) }
    const installedHandler = () => { setPrompt(null); setInstalled(true) }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', installedHandler)
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installedHandler) }
  }, [])
  const install = async () => {
    if (installed) return
    if (!prompt) { window.alert('افتح قائمة المتصفح ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'); return }
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setPrompt(null)
  }
  return <button type="button" className="button button-primary button-wide" onClick={() => void install()}><Download size={17} />{installed ? 'التطبيق مثبت' : 'تثبيت تطبيق Web'}</button>
}

function DownloadCard({ icon, tone, title, subtitle, description, children, status }: { icon: React.ReactNode; tone: string; title: string; subtitle: string; description: string; children: React.ReactNode; status?: string }) {
  return <article className={`download-card ${tone}`}><div className="download-card-icon">{icon}</div><span className="eyebrow">{subtitle}</span><h2>{title}</h2><p>{description}</p>{status && <div className="download-card-status"><Info size={15} />{status}</div>}<div className="download-card-action">{children}</div></article>
}

export function DownloadPage() {
  const androidUrl = (import.meta.env.VITE_ANDROID_DOWNLOAD_URL as string | undefined)?.trim() || '/downloads/home-service.apk'
  const iosUrl = (import.meta.env.VITE_IOS_DOWNLOAD_URL as string | undefined)?.trim()
  const androidReady = Boolean(import.meta.env.VITE_ANDROID_DOWNLOAD_URL)
  return <main className="download-page"><section className="download-hero"><div className="download-hero-orbit" /><div className="container download-hero-inner"><span className="eyebrow"><Sparkles size={15} /> تجربة هوم سيرفس على كل أجهزتك</span><h1>حمّل التطبيق بالطريقة<br /><em>المناسبة لك.</em></h1><p>اختر نسختك واحتفظ بطلباتك وإشعاراتك ومحادثاتك في متناول يدك. نفس الحساب يعمل على الويب وAndroid وiPhone.</p><div className="download-hero-note"><CheckCircle2 size={16} /> تسجيل الدخول والبيانات متزامنة مع حسابك في كل الأجهزة</div></div></section><section className="container download-content"><div className="download-section-heading"><div><span className="eyebrow">ثلاث تجارب، حساب واحد</span><h2>اختر جهازك</h2></div><p>نسخة الويب تعمل فورًا، ونسخ الهاتف تُوزّع عبر القنوات الرسمية لضمان تحديث آمن وتثبيت موثوق.</p></div><div className="download-grid"><DownloadCard tone="android" icon={<Smartphone size={28} />} subtitle="Android" title="تطبيق Android" description="نسخة أصلية بإشعارات الطلبات، تسجيل Google داخل التطبيق، ورفع الصور والمستندات." status={!androidReady ? 'سيظهر رابط APK بعد رفع النسخة الموقعة.' : undefined}>{androidReady ? <a className="button button-primary button-wide" href={androidUrl} download><ArrowDownToLine size={17} />تحميل APK</a> : <button className="button button-muted button-wide" type="button" disabled><ArrowDownToLine size={17} />APK قيد التجهيز</button>}</DownloadCard><DownloadCard tone="ios" icon={<Apple size={28} />} subtitle="iPhone & iPad" title="تطبيق iPhone" description="تجربة iOS رسمية مع إشعارات النظام وتحديثات آمنة من قناة Apple." status={!iosUrl ? 'سيظهر رابط App Store أو TestFlight بعد التوقيع والنشر.' : undefined}>{iosUrl ? <a className="button button-dark button-wide" href={iosUrl}>فتح App Store</a> : <button className="button button-muted button-wide" type="button" disabled>قريبًا على App Store</button>}</DownloadCard><DownloadCard tone="web" icon={<Globe2 size={28} />} subtitle="Web App" title="تطبيق Web" description="افتح المنصة الآن من المتصفح وثبّتها على الشاشة الرئيسية بدون متجر أو ملف تثبيت."><WebInstallButton /></DownloadCard></div><div className="download-security-note"><Info size={18} /><div><strong>توزيع آمن وتحديثات واضحة</strong><p>لن نطلب تثبيتًا يتجاوز تحذيرات نظام التشغيل أو يلغي حماية الجهاز. Android وiPhone يفرضان التوقيع والتحقق الرسمي؛ هذا يحمي حسابك وبياناتك من النسخ المعدلة.</p></div></div></section></main>
}
