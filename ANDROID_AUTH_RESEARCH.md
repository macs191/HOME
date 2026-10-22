# مراجع Android Auth وPush

- Capacitor Push Notifications / Firebase: https://capacitorjs.com/docs/guides/push-notifications-firebase
  - Capacitor يوضح إعداد FCM لتسجيل Android واستقبال Push، وضرورة مطابقة application ID وSHA-1.
- Supabase Push Notifications: https://supabase.com/docs/guides/functions/examples/push-notifications
  - Supabase يوضح تشغيل Edge Function من Database Webhook وإرسال الإشعار عبر مزود خارجي مثل FCM/Expo.
- Supabase Realtime: https://supabase.com/docs/guides/realtime
  - Realtime يدعم Broadcast وPostgres Changes للأجهزة المتصلة.
- Capawesome Google Sign-In: https://capawesome.io/docs/sdks/capacitor/google-sign-in/
  - يمكن استخدام تسجيل Google أصلي على Android وإرجاع idToken، ثم تمريره إلى Supabase Auth عبر signInWithIdToken. يجب استخدام Web OAuth Client ID داخل initialize، وإنشاء Android OAuth Client بنفس package name وSHA-1.
