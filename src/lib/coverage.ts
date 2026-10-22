export const COVERED_CITIES = ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة'] as const

export const BOOKING_SLOTS = [
  { value: '09:00-12:00', label: '9:00 ص – 12:00 م' },
  { value: '12:00-15:00', label: '12:00 م – 3:00 م' },
  { value: '16:00-19:00', label: '4:00 م – 7:00 م' },
  { value: '19:00-21:00', label: '7:00 م – 9:00 م' },
] as const

export const MAPS_PROVIDER = (import.meta.env.VITE_MAPS_PROVIDER ?? 'osm').toLowerCase() === 'google' ? 'google' : 'osm'
