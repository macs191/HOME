# HOME SERVICE

منصة عربية RTL لحجز الخدمات المنزلية، مبنية بـ React وVite وTypeScript، ومرتبطة بمشروع Supabase فعلي لـ PostgreSQL/Auth/Storage/Realtime. التسجيل متاح للعميل والفني، ويُفتح ملف الفني بحالة `pending` ولا تُرفع الصلاحيات من الواجهة. الحجز يستخدم RPC آمن باسم `create_booking`، ومساحة العميل تقرأ الطلبات الحقيقية وتعرض الدفع بعد تأكيد إكمال المهمة.

## التشغيل المحلي

```bash
npm install
npm run dev
```

يفتح Vite على المنفذ `3000`. للفحص والبناء:

```bash
npm run typecheck
npm run build
```

## متغيرات البيئة

انسخ `.env.example` إلى `.env` وضع قيم Supabase العامة فقط:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

لا تضع `SUPABASE_SERVICE_ROLE_KEY` أو مفاتيح الدفع أو أي سر في Vite أو GitHub. العمليات الحساسة، مثل تغيير الأدوار أو اعتماد الفني أو تأكيد الدفع، يجب تنفيذها عبر Edge Functions أو خادم موثوق.

## إعداد Supabase

1. المشروع المرتبط حاليًا هو `mqerrhdlkahtvrlwwwtq`، وقد تم تصفير `public` وحسابات Auth، ثم إعادة كتالوج HOME SERVICE (12 خدمة و11 قسمًا).
2. طبّق migration المصدر `supabase/migrations/20261010000000_initial_schema.sql` و`supabase/migrations/20261010000001_runtime_bootstrap.sql` على أي مشروع جديد.
3. فعّل Email Auth أو مزود تسجيل الدخول المطلوب من Authentication.
4. لا تجعل إنشاء دور `admin` متاحًا من الواجهة. امنح أول مدير عبر SQL آمن بعد تسجيل حسابه ومراجعة معرّف المستخدم:

```sql
update public.user_roles
set role = 'admin'
where user_id = 'USER_UUID_FROM_AUTH_USERS';
```

نفّذ هذا الاستعلام من جلسة إدارية موثوقة فقط، وليس من المتصفح.

## الخرائط والموقع

يستخدم النموذج `Geolocation API` بعد موافقة المستخدم، ويدعم العنوان اليدوي إذا رفض الإذن. لا يُعرض وقت وصول تقديري في النسخة الحالية؛ يجب عند الإنتاج توصيل مزود مسارات موثوق خلف Edge Function، ثم حفظ نتيجة المسار عند الحاجة فقط. لا تعتمد على المسافة المستقيمة باعتبارها زمن قيادة.

## التخزين والإشعارات

أنشئ buckets خاصة للمرفقات، وطبّق سياسات Storage مرتبطة بالمستخدم والطلب. استخدم Supabase Realtime لتحديث الإشعارات بعد إضافة جداول الأحداث/الإشعارات. لا تجعل وثائق الفنيين عامة.

## Vercel

1. المستودع المرتبط: `https://github.com/macs191/HOME`، والفرع `main`.
2. اختر إطار Vite، وأمر البناء `npm run build` ومجلد الناتج `dist`.
3. أضف `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` من Project Settings، دون أي Service Role key.
4. نفّذ Deploy ثم اختبر `/`, `/services`, `/book`, `/customer`, `/provider`, `/admin`.
5. قبل الإنتاج، اربط مسار SPA في `vercel.json` واختبر الجلسات والـ RLS من متصفح مستقل، بما في ذلك `/login`.

## الدفع الإلكتروني

تم نشر وظيفتي Supabase Edge باسم `create-checkout-session` (JWT مطلوب) و`stripe-webhook` (تحقق توقيع Stripe مخصص). بعد تأكيد الفني المهمة، ينشئ `confirm_booking_completion` سجل الدفع، ويجهز زر العميل جلسة Checkout عبر `prepare_payment`. يلزم فقط إضافة الأسرار التالية في Supabase Edge Function Secrets لتفعيل التحصيل الفعلي: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, و`PUBLIC_APP_URL`. لا تُضع هذه القيم في Vite أو GitHub. إذا لم تُضف بعد، ستظهر رسالة إعداد واضحة بدل الادعاء بنجاح الدفع.

## صفحات المشروع

- `/` الصفحة الرئيسية والبحث.
- `/services` كتالوج الخدمات والتصفية.
- `/book` حجز متعدد الخطوات مع GPS أو اختيار يدوي.
- `/customer` مساحة العميل.
- `/provider` مساحة الفني.
- `/admin` لوحة الإدارة.
- `/login` واجهة الدخول الجاهزة للربط مع Supabase Auth.
