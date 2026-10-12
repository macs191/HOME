import type { Service, ServiceCategory } from '../types'

// Local fallback catalog. IDs intentionally match Supabase service/category slugs.
export const categories: ServiceCategory[] = [
  { id: 'plumbing', name: 'السباكة', description: 'تسريبات، انسدادات وإصلاحات المياه', icon: 'droplets', color: '#2bb8aa', featured: true },
  { id: 'electrical', name: 'الكهرباء', description: 'أعطال وتمديدات وفحص آمن', icon: 'zap', color: '#f3b84b', featured: true },
  { id: 'ac', name: 'التكييف', description: 'صيانة وتنظيف المكيفات', icon: 'wind', color: '#75aee8', featured: true },
  { id: 'cleaning', name: 'التنظيف', description: 'تنظيف عميق للمنازل', icon: 'sparkles', color: '#c78ce0', featured: true },
  { id: 'appliance', name: 'صيانة الأجهزة', description: 'إصلاح الأجهزة المنزلية', icon: 'refrigerator', color: '#e58567' },
  { id: 'carpentry', name: 'النجارة', description: 'أبواب وأثاث وإصلاحات خشبية', icon: 'hammer', color: '#c58a52' },
  { id: 'painting', name: 'الدهانات', description: 'دهان وتجديد الغرف', icon: 'paintbrush', color: '#ea8eae' },
  { id: 'moving', name: 'نقل وتركيب', description: 'نقل وتركيب الأثاث', icon: 'truck', color: '#7892d8' },
  { id: 'pest-control', name: 'مكافحة الحشرات', description: 'حلول آمنة لمكافحة الحشرات', icon: 'bug', color: '#82b77d' },
  { id: 'locks', name: 'الأبواب والأقفال', description: 'فتح وتركيب وإصلاح الأقفال', icon: 'key-round', color: '#9b9bb5' },
  { id: 'general', name: 'الصيانة العامة', description: 'خدمات منزلية متنوعة', icon: 'wrench', color: '#5bb4c8' },
]

export const services: Service[] = [
  { id: 'leak', categoryId: 'plumbing', name: 'إصلاح تسريب مياه', shortDescription: 'فحص التسريب وتحديد مصدره والحل المناسب.', description: 'زيارة فنية لفحص التسريب الظاهر أو المخفي وتحديد الحل المناسب قبل بدء العمل.', duration: '', priceLabel: 'عرض سعر', featured: true },
  { id: 'drain', categoryId: 'plumbing', name: 'تسليك مجاري', shortDescription: 'معالجة انسداد الأحواض والمصارف.', description: 'تسليك الأحواض والمصارف مع توضيح سبب الانسداد وتوصيات الوقاية.', duration: '', priceLabel: 'عرض سعر', featured: true },
  { id: 'electrical-fault', categoryId: 'electrical', name: 'إصلاح عطل كهربائي', shortDescription: 'تشخيص العطل قبل بدء الإصلاح.', description: 'فحص آمن للدوائر والمفاتيح وتحديد نطاق الإصلاح المطلوب.', duration: '', priceLabel: 'عرض سعر', featured: true },
  { id: 'lighting', categoryId: 'electrical', name: 'تركيب إضاءة', shortDescription: 'تركيب وحدات الإضاءة المنزلية.', description: 'تركيب وحدات الإضاءة والتحقق من سلامة التوصيلات.', duration: '', priceLabel: 'عرض سعر' },
  { id: 'ac-maintenance', categoryId: 'ac', name: 'صيانة مكيف', shortDescription: 'فحص وتنظيف وصيانة المكيف.', description: 'فحص أداء المكيف والتصريف وتنظيف الأجزاء بحسب حالته.', duration: '', priceLabel: 'عرض سعر', featured: true },
  { id: 'deep-cleaning', categoryId: 'cleaning', name: 'تنظيف عميق', shortDescription: 'تنظيف شامل للمساحات الأساسية.', description: 'خدمة تنظيف عميق قابلة للتخصيص حسب مساحة المنزل.', duration: '', priceLabel: 'عرض سعر', featured: true },
  { id: 'appliance-repair', categoryId: 'appliance', name: 'صيانة جهاز منزلي', shortDescription: 'تشخيص وإصلاح الأجهزة المنزلية.', description: 'فحص الجهاز وتحديد العطل والحل المناسب قبل التنفيذ.', duration: '', priceLabel: 'عرض سعر' },
  { id: 'carpentry', categoryId: 'carpentry', name: 'إصلاح نجارة', shortDescription: 'إصلاح الأبواب والأثاث الخشبي.', description: 'أعمال النجارة المنزلية والإصلاحات الخشبية.', duration: '', priceLabel: 'عرض سعر' },
  { id: 'painting', categoryId: 'painting', name: 'دهان غرفة', shortDescription: 'دهان وتجديد غرفة حسب الطلب.', description: 'تجهيز السطح وتنفيذ الدهان بعد تحديد المساحة والمواد.', duration: '', priceLabel: 'عرض سعر' },
  { id: 'moving', categoryId: 'moving', name: 'نقل وتركيب أثاث', shortDescription: 'فك ونقل وتركيب الأثاث المنزلي.', description: 'تنسيق نقل وتركيب الأثاث بحسب العنوان وحجم المنقولات.', duration: '', priceLabel: 'عرض سعر' },
  { id: 'pest-control', categoryId: 'pest-control', name: 'مكافحة حشرات', shortDescription: 'معالجة آمنة لمشكلة الحشرات.', description: 'تحديد نوع المشكلة واختيار المعالجة المناسبة للموقع.', duration: '', priceLabel: 'عرض سعر' },
  { id: 'locksmith', categoryId: 'locks', name: 'فتح أو تركيب قفل', shortDescription: 'خدمات فتح الأقفال وتركيبها.', description: 'فحص القفل وتقديم خدمة الفتح أو الاستبدال أو التركيب.', duration: '', priceLabel: 'عرض سعر' },
]

export const getCategory = (id?: string, source: ServiceCategory[] = categories) => source.find((category) => category.id === id)
export const getService = (id?: string, source: Service[] = services) => source.find((service) => service.id === id)

export const stats = [
  { value: '12', label: 'خدمة نشطة في الكتالوج' },
  { value: '11', label: 'قسمًا في المنصة' },
  { value: '0', label: 'تقييمات مختلقة' },
]
