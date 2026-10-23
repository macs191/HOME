# حالة دمج مكالمات Agora

آخر تحديث: 2026-10-24

## ما تم إنجازه

تم استبدال محرك WebRTC السابق بمحرك **Agora RTC Web SDK** داخل الواجهة. حزمة SDK موجودة في `package.json` باسم `agora-rtc-sdk-ng`، ومنطق المكالمة موجود في `src/components/VoiceCall.tsx`.

المكالمة تستخدم قناة إشارة Supabase الحالية لدعوة الطرف الآخر وقبول المكالمة ورفضها وإنهائها، ثم تستخدم قناة Agora منفصلة للصوت الفعلي. يتم إنشاء مسار الميكروفون عبر Agora ونشره، ويتم الاشتراك في الصوت الوارد وتشغيله عند وصول الطرف الآخر.

تمت إضافة واجهة مكالمة عائمة مناسبة للهاتف. تظهر عند الاتصال أو عند استقبال المكالمة، وتحتوي على حالة المكالمة والمدة وأزرار قبول ورفض وكتم الصوت وإنهاء المكالمة. تنسيقها موجود في نهاية `src/styles.css` تحت اسم `voice-call-floating`.

أماكن ظهور الواجهة:

- العميل: `src/components/AdminContactPanel.tsx` داخل لوحة العميل، بعنوان «الاتصال بالإدارة».
- الفني: `src/App.tsx` داخل لوحة الفني، باستخدام `AdminContactPanel`.
- الإدارة: `src/components/AdminAccountsPanel.tsx` داخل تفاصيل العميل أو الفني، بزر اتصال مباشر.
- الاتصال داخل الطلب: `src/components/BookingChat.tsx`، ويستخدم نفس مكوّن Agora.
- استقبال اتصال الإدارة: `src/components/VoiceCallInbox.tsx`، وهو مركب داخل `DashboardLayout` في `src/App.tsx`.

تمت إضافة استدعاء التوكن في `src/lib/supabase.ts` باسم `getAgoraRtcToken`. وظيفة توليد التوكن موجودة في `supabase/functions/agora-token/index.ts`، وهي تتطلب جلسة مستخدم صحيحة ولا تسمح بطلبات مجهولة. تم نشر الوظيفة إلى Supabase باسم `agora-token` مع تفعيل التحقق من JWT.

تم تحديث `.env.example` لتوضيح أن أسرار Agora يجب أن تبقى في Supabase، كما تم الحفاظ على صلاحية Android للميكروفون في `android/app/src/main/AndroidManifest.xml`. تطبيق Android الحالي يستخدم واجهة الويب داخل Capacitor، ولذلك يستفيد من دمج Agora Web الموجود في المشروع دون تغيير مسار تسجيل الدخول الأساسي.

## ما لم يكتمل بعد

المفاتيح الفعلية لحساب Agora غير متوفرة في بيئة المشروع حتى الآن. لذلك لن تعمل المكالمة فعليًا قبل إضافة السرّين التاليين إلى **Supabase Edge Function Secrets**:

- `AGORA_APP_ID`
- `AGORA_APP_CERTIFICATE`

لا تضع `AGORA_APP_CERTIFICATE` في `.env` الخاص بالواجهة، ولا في متغير يبدأ بـ `VITE_`، ولا داخل Git. بعد إضافة السرّين، يجب إعادة نشر وظيفة `agora-token` أو إعادة تشغيلها من إعدادات Supabase إذا طلبت لوحة Supabase ذلك.

لم تتم إضافة Agora Native Android SDK إلى Gradle. الدمج الحالي مقصود أن يعمل عبر Web SDK داخل Capacitor ويحافظ على مشروع Android الحالي دون تغيير كبير. إذا كان المطلوب لاحقًا مكالمات تعمل في الخلفية بعد إغلاق WebView أو تكامل مكالمات النظام، فسيكون ذلك مشروعًا منفصلًا يحتاج Agora Native Android SDK وخدمة إشعارات ومكالمات نظامية.

لم يتم تنفيذ اختبار مكالمة حقيقي بين حسابين لأن ذلك يتطلب حساب Agora مهيأً بالمفاتيح، حسابين مسجلين في الوقت نفسه، وسماح الميكروفون على الجهازين.

## خطوات الإكمال

1. من Agora Console أنشئ أو اختر مشروعًا مفعّلًا لخدمة RTC، وتأكد من وجود App ID وApp Certificate.
2. في Supabase Project Settings ثم Edge Functions ثم Secrets أضف `AGORA_APP_ID` و`AGORA_APP_CERTIFICATE` بالقيم الفعلية.
3. افتح الموقع بحساب عميل وحساب إدارة أو فني على جهازين أو نافذتين مختلفتين.
4. اسمح للمتصفح أو تطبيق Android باستخدام الميكروفون.
5. اضغط «الاتصال بالإدارة» من العميل أو الفني، أو افتح حساب العميل/الفني من الإدارة واضغط زر الاتصال.
6. إذا ظهرت رسالة أن Agora غير مهيأة، راجع أسرار Edge Function وسجل تشغيل وظيفة `agora-token` في Supabase.

## الفحوصات المنفذة

تم تشغيل `npm run typecheck` و`npm run build` بنجاح بعد إضافة حزمة Agora وواجهة المكالمة العائمة. تم أيضًا نشر وظيفة `agora-token` إلى مشروع Supabase، لكن حالة المكالمات الفعلية تظل معلقة على إضافة أسرار Agora واختبار حسابين حقيقيين.

## المراجع الرسمية

- [1]: https://docs.agora.io/en/realtime-media/rtc/voice-quickstart "Agora Voice-only quickstart"
- [2]: https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/deploy-token-server "Agora Deploy a token server"
- [3]: https://www.npmjs.com/package/agora-token "Agora agora-token package"
