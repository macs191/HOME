const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024
const MAX_EDGE = 1800
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function prepareBookingPhoto(file: File): Promise<Blob> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error('اختر صورة JPG أو PNG أو WebP من الكاميرا أو المعرض.')
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('يجب أن تكون الصورة أكبر من صفر وألا تتجاوز 15 ميجابايت قبل الضغط.')
  if (typeof createImageBitmap !== 'function') throw new Error('متصفح الهاتف لا يدعم معالجة الصورة الآمنة. حدّث المتصفح ثم أعد المحاولة.')

  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('تعذر قراءة الصورة. اختر JPG أو PNG أو WebP من الجهاز.') }

  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    let quality = 0.86
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('تعذر تجهيز الصورة للرفع.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('تعذر ضغط الصورة.')), 'image/jpeg', quality))
      if (blob.size <= MAX_OUTPUT_BYTES) return blob
      if (quality > 0.55) quality = Math.max(0.55, quality - 0.08)
      else scale *= 0.82
    }
    throw new Error('تعذر ضغط الصورة إلى أقل من 5 ميجابايت. اختر صورة أصغر.')
  } finally {
    bitmap.close()
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
