export type GeoPoint = { latitude: number; longitude: number }

export const requestCurrentPosition = (): Promise<GeoPoint> => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('المتصفح لا يدعم تحديد الموقع'))
    return
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    (error) => {
      const messages: Record<number, string> = {
        1: 'تم رفض إذن الموقع. يمكنك تحديد العنوان يدويًا.',
        2: 'تعذر تحديد موقعك الآن. جرّب الاختيار اليدوي.',
        3: 'انتهت مهلة تحديد الموقع. جرّب مرة أخرى أو استخدم العنوان اليدوي.',
      }
      reject(new Error(messages[error.code] ?? 'تعذر تحديد الموقع'))
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  )
})

export const haversineKm = (from: GeoPoint, to: GeoPoint) => {
  const radius = 6371
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((from.latitude * Math.PI) / 180) * Math.cos((to.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
