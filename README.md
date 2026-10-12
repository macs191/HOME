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

1. المشروع المرتبط حاليًا هو `ojivulfurjjsskqzghfb`، وقد تم تجهيز `public` وحسابات Auth وكتالوج HOME SERVICE (12 خدمة و11 قسمًا).
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

توجد خريطة تفاعلية تبدأ بوضع **القمر الصناعي** عبر Esri World Imagery مع إسناد المصدر، ويمكن تبديلها إلى طبقة طرق OpenStreetMap. البحث يعمل عبر Google Places عندما تضيف `VITE_GOOGLE_MAPS_API_KEY` كمفتاح مقيّد بالنطاق، ويعود تلقائيًا إلى Nominatim/OpenStreetMap مجانًا عند غياب المفتاح. Google Maps ليس خدمة مجانية بلا شروط: يتطلب API key وتفعيل billing؛ لذلك لا يتم تضمين مفتاح افتراضي أو كشف سر في المستودع. يستخدم النموذج `Geolocation API` بعد موافقة المستخدم، ويدعم العنوان اليدوي والنقر/السحب على الخريطة.

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

## الهوية الملكية وتشغيل الفنيين
- زر طلب الخدمة يفتح حوار حساب قبل إدخال العنوان، مع Google OAuth عند تفعيل Google provider في Supabase Auth.
- صفحة الفني تحتوي على نموذج اعتماد ورفع هوية إلى bucket خاص، ولا تعرض المستندات إلا لصاحبها أو الإدارة عبر RLS.
- لوحة الإدارة تحتوي على إسناد طلب وقيود أجر/خصم/تسوية عبر RPC. طبّق migrations المرقمة في `supabase/migrations/` بالترتيب على قاعدة Supabase قبل التشغيل.
- مشروع Supabase المرتبط: `ojivulfurjjsskqzghfb`. طُبّقت migrations الأساسية، ثم `admin_controls` لتعيين دور الحساب عند التسجيل واعتماد الفني ومنع إسناد الطلب لفني غير معتمد، و`identity_bucket_hardening` لتقييد مستندات الهوية بـ5MB وأنواع JPG/PNG/PDF مع إبقاء bucket خاصًا وسياسة حذف ذاتي آمنة، و`security_policy_hardening` لسحب تنفيذ الدوال الحساسة من `anon` وإضافة سياسات RLS لربط الخدمات. تبقى أسرار Stripe الخاصة ببوابة الدفع مطلوبة في إعدادات Edge Functions.
- حساب المدير التشغيلي `admin171@gmail.com` مؤكد البريد ودوره `admin` في `user_roles`. لا تستخدم كلمة المرور في المستودع أو السجلات. ضع `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` في إعدادات بيئة النشر؛ لا تضع مفتاح Service Role في الواجهة أو Git.
