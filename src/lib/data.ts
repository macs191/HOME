import type { Service, ServiceCategory } from '../types'

export const categories: ServiceCategory[] = [
  { id: 'plumbing', name: 'السباكة', description: 'تسريبات، انسدادات وإصلاحات المياه', icon: 'droplets', color: '#2bb8aa', featured: true },
  { id: 'electricity', name: 'الكهرباء', description: 'أعطال وتمديدات وفحص آمن', icon: 'zap', color: '#f3b84b', featured: true },
  { id: 'ac', name: 'التكييف والتبريد', description: 'تنظيف وصيانة وتركيب المكيفات', icon: 'wind', color: '#75aee8', featured: true },
  { id: 'cleaning', name: 'تنظيف المنازل', description: 'تنظيف دوري وعميق للمساحات', icon: 'sparkles', color: '#c78ce0', featured: true },
  { id: 'appliances', name: 'صيانة الأجهزة', description: 'غسالات، ثلاجات وأجهزة منزلية', icon: 'refrigerator', color: '#e58567' },
  { id: 'carpentry', name: 'النجارة', description: 'أبواب، خزائن وإصلاحات خشبية', icon: 'hammer', color: '#c58a52' },
  { id: 'paint', name: 'الدهانات', description: 'تجديد الجدران بلمسة احترافية', icon: 'paintbrush', color: '#ea8eae' },
  { id: 'moving', name: 'نقل الأثاث', description: 'فك وتغليف ونقل آمن', icon: 'truck', color: '#7892d8' },
  { id: 'assembly', name: 'تركيب الأثاث', description: 'تركيب احترافي في مكانك', icon: 'box', color: '#d5a657' },
  { id: 'pest', name: 'مكافحة الحشرات', description: 'حلول آمنة للمنزل والمنشأة', icon: 'bug', color: '#82b77d' },
  { id: 'locks', name: 'الأبواب والأقفال', description: 'فتح، إصلاح واستبدال الأقفال', icon: 'key-round', color: '#9b9bb5' },
  { id: 'general', name: 'الصيانة العامة', description: 'حلول يومية متنوعة للمنزل', icon: 'wrench', color: '#5bb4c8' },
]

export const services: Service[] = [
  { id: 'leak', categoryId: 'plumbing', name: 'كشف وإصلاح تسريب مياه', shortDescription: 'فحص مصدر التسريب ومعالجته بأقل تدخل', description: 'زيارة فنية لفحص التسريب الظاهر أو المخفي وتحديد الحل المناسب قبل بدء العمل.', duration: '60–120 دقيقة', priceLabel: 'سعر يحدده الفني بعد المعاينة', featured: true },
  { id: 'drain', categoryId: 'plumbing', name: 'تسليك مجاري وأحواض', shortDescription: 'حل الانسدادات المنزلية بسرعة', description: 'تسليك الأحواض والمصارف مع توضيح سبب الانسداد وتوصيات الوقاية.', duration: '45–90 دقيقة', priceLabel: 'سعر يبدأ من 120 ر.س', featured: true },
  { id: 'ac-clean', categoryId: 'ac', name: 'تنظيف وصيانة مكيف سبليت', shortDescription: 'تنظيف الفلاتر وفحص الأداء', description: 'تنظيف مكونات المكيف وفحص التبريد والتصريف وفق حالة الجهاز.', duration: '60 دقيقة', priceLabel: 'سعر يبدأ من 100 ر.س', featured: true },
  { id: 'electric-fault', categoryId: 'electricity', name: 'فحص عطل كهربائي', shortDescription: 'تشخيص العطل قبل الإصلاح', description: 'فحص آمن للدوائر والمفاتيح وتحديد نطاق الإصلاح المطلوب.', duration: '60–90 دقيقة', priceLabel: 'سعر يحدده الفني بعد المعاينة' },
  { id: 'deep-clean', categoryId: 'cleaning', name: 'تنظيف عميق للمنزل', shortDescription: 'تنظيف شامل للمساحات الأساسية', description: 'خدمة تنظيف عميق قابلة للتخصيص حسب مساحة المنزل وعدد الغرف.', duration: '3–6 ساعات', priceLabel: 'احصل على عرض سعر' },
  { id: 'washer', categoryId: 'appliances', name: 'صيانة غسالة', shortDescription: 'تشخيص وصيانة أعطال الغسالات', description: 'فحص الجهاز وتحديد القطعة أو الإصلاح المطلوب قبل التنفيذ.', duration: '60–120 دقيقة', priceLabel: 'سعر يحدده الفني بعد المعاينة' },
]

export const getCategory = (id?: string) => categories.find((category) => category.id === id)
export const getService = (id?: string) => services.find((service) => service.id === id)

export const stats = [
  { value: '12', label: 'قسم خدمة' },
  { value: '24/7', label: 'استقبال الطلبات' },
  { value: '0', label: 'تقييمات مختلقة' },
]
