-- بيانات اختبار منفصلة؛ لا تطبقها على الإنتاج دون تغيير واضح للبيئة.
insert into public.service_categories (slug, name_ar, description, icon, display_order) values
('plumbing', 'السباكة', 'تسريبات، انسدادات وإصلاحات المياه', 'droplets', 1),
('electricity', 'الكهرباء', 'أعطال وتمديدات وفحص آمن', 'zap', 2),
('ac', 'التكييف والتبريد', 'تنظيف وصيانة وتركيب المكيفات', 'wind', 3)
on conflict (slug) do nothing;

insert into public.services (category_id, slug, name_ar, description, pricing_type, duration_minutes, display_order)
select id, 'leak', 'كشف وإصلاح تسريب مياه', 'فحص مصدر التسريب ومعالجته.', 'provider_quote', 90, 1
from public.service_categories where slug = 'plumbing'
on conflict (slug) do nothing;
