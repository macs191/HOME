

insert into public.product_categories(slug,name_ar,description,display_order,is_active) values
('cameras','الكاميرات','كاميرات المراقبة والعدسات والملحقات.',1,true),
('security-systems','أنظمة الحماية','حلول الإنذار والتحكم والدخول.',2,true),
('plumbing-products','منتجات السباكة','قطع وأدوات سباكة للاستخدام المنزلي.',3,true),
('electrical-products','منتجات الكهرباء','مستلزمات كهربائية آمنة للمنزل.',4,true)
on conflict (slug) do nothing;
