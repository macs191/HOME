import { ArrowLeft, CheckCircle2, Eye, LockKeyhole, ShieldCheck, Smartphone, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'

export function AboutPage() {
  return <main className="container inner-page public-info-page">
    <section className="public-info-hero">
      <span className="eyebrow">عن هوم سيرفس</span>
      <h1>خدمات المنزل،<br /><span>بثقة ووضوح.</span></h1>
      <p className="lead">هوم سيرفس منصة سعودية تربط العملاء بفنيين معتمدين، وتجمع الطلب والموعد والصور والمحادثة والفاتورة في تجربة واحدة.</p>
      <div className="hero-actions"><Link className="button button-primary" to="/services">استعرض الخدمات <ArrowLeft size={17} /></Link><Link className="text-link" to="/book">ابدأ طلبك</Link></div>
    </section>
    <section className="public-info-grid">
      <article className="panel public-info-card"><span className="public-info-icon"><UsersRound size={21} /></span><h2>للعميل والفني</h2><p>مساحات منفصلة وواضحة؛ العميل يتابع طلبه، والفني يرى الأعمال المسندة إليه فقط.</p></article>
      <article className="panel public-info-card"><span className="public-info-icon"><ShieldCheck size={21} /></span><h2>تشغيل مسؤول</h2><p>الإسناد والاعتماد وتغيير الحالات محكومة بصلاحيات الخادم، وليس بعناصر الواجهة وحدها.</p></article>
      <article className="panel public-info-card"><span className="public-info-icon"><Smartphone size={21} /></span><h2>ويب وAndroid</h2><p>نفس الحساب يعمل على الويب وتطبيق Android، مع إشعارات الطلبات وروابط آمنة للتفاصيل.</p></article>
    </section>
    <section className="panel public-info-section"><span className="eyebrow">ما الذي نركز عليه؟</span><h2>تجربة عملية تحترم وقتك وبياناتك</h2><div className="public-info-list"><p><CheckCircle2 size={17} /> تسعير واضح: السعر الثابت يظهر عندما يكون مؤكدًا، والخدمات الأخرى تمر بمسار عرض سعر.</p><p><CheckCircle2 size={17} /> مشاركة محدودة: لا يرى الفني إلا تفاصيل المهمة المسندة إليه، ولا يبدأ تتبع الموقع إلا بموافقة العميل.</p><p><CheckCircle2 size={17} /> متابعة موحدة: الصور والمحادثة والحالة والفاتورة في سجل الطلب نفسه.</p></div></section>
    <p className="public-info-meta">آخر تحديث للمعلومات: 22 أكتوبر 2026 · <Link to="/privacy">اقرأ الخصوصية والحماية</Link></p>
  </main>
}

export function PrivacyPage() {
  return <main className="container inner-page public-info-page">
    <section className="public-info-hero compact"><span className="eyebrow">الخصوصية والحماية</span><h1>بياناتك ليست<br /><span>جزءًا من المنتج.</span></h1><p className="lead">نستخدم البيانات اللازمة لتنفيذ الخدمة ومتابعتها فقط، ونحافظ على فصل صلاحيات العميل والفني والإدارة.</p></section>
    <section className="public-info-grid">
      <article className="panel public-info-card"><span className="public-info-icon"><LockKeyhole size={21} /></span><h2>جلسة آمنة</h2><p>لا يحتوي تطبيق Android على مفاتيح Service Role أو أسرار الخادم. الجلسة تُدار عبر Supabase، ويمكنك تسجيل الخروج من الجهاز.</p></article>
      <article className="panel public-info-card"><span className="public-info-icon"><Eye size={21} /></span><h2>الموقع بإذن واضح</h2><p>يمكنك إدخال العنوان يدويًا. يُطلب GPS عند اختيارك، وموقع الفني يُشارك فقط أثناء مهمة نشطة وبعد موافقتك.</p></article>
      <article className="panel public-info-card"><span className="public-info-icon"><ShieldCheck size={21} /></span><h2>ملفات خاصة</h2><p>صور الأعطال ومستندات الفنيين في مخازن خاصة، ولا تُعرض عبر روابط عامة أو لمستخدم غير مشارك.</p></article>
    </section>
    <section className="panel public-info-section"><span className="eyebrow">ملخص الاستخدام</span><h2>ما نطلبه ولماذا</h2><div className="public-info-list"><p><CheckCircle2 size={17} /> بيانات الحساب: تسجيل الدخول، التواصل، وربط طلباتك بحسابك.</p><p><CheckCircle2 size={17} /> بيانات الطلب: الخدمة والعنوان والوصف والموعد لتنفيذ الإسناد والمتابعة.</p><p><CheckCircle2 size={17} /> الصور والمحادثة: تُستخدم لمعالجة العطل، ولا تُشارك إلا مع أطراف الطلب المصرح لهم.</p><p><CheckCircle2 size={17} /> الإشعارات: اختيارية، وتُستخدم لتنبيهك بالحالة والرسائل المهمة. يمكنك رفضها من إعدادات Android.</p></div><div className="public-info-callout"><strong>مهم:</strong> لا تضع كلمات مرور أو بيانات بطاقات أو معلومات شخصية حساسة في وصف العطل أو رسائل الدعم.</div></section>
    <div className="public-info-actions"><Link className="button button-secondary" to="/about">عن هوم سيرفس</Link><Link className="button button-primary" to="/downloads">تحميل التطبيق <ArrowLeft size={17} /></Link></div>
  </main>
}
