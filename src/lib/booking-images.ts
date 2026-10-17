const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024
const MAX_EDGE = 1800
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

function detectedType(file: File) {
  const type = file.type.toLowerCase()
  if (ACCEPTED_IMAGE_TYPES.has(type)) return type === 'image/jpg' ? 'image/jpeg' : type
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'
  return ''
}

async function decodePhoto(file: File): Promise<{ source: ImageBitmap | HTMLImageElement; bitmap: ImageBitmap | null }> {
  if (typeof createImageBitmap === 'function') {
    try { const bitmap = await createImageBitmap(file); return { source: bitmap, bitmap } } catch { /* جرّب المسار المتوافق مع الهاتف */ }
  }
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      const url = URL.createObjectURL(file)
      element.onload = () => { URL.revokeObjectURL(url); resolve(element) }
      element.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
      element.src = url
    })
    return { source: image, bitmap: null }
  } catch { throw new Error('تعذر قراءة الصورة من الهاتف. أعد التقاطها أو اختر JPG أو PNG من المعرض.') }
}

export async function prepareBookingPhoto(file: File): Promise<Blob> {
  const type = detectedType(file)
  if (!type) throw new Error('الملف ليس صورة مدعومة. اختر JPG أو PNG أو WebP.')
  if (type === 'image/heic' || type === 'image/heif') throw new Error('صيغة HEIC غير مدعومة في هذا المتصفح. من إعدادات الكاميرا اختر JPG أو استخدم اختيار PNG/JPG.')
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('يجب ألا تتجاوز الصورة 15 ميجابايت قبل الضغط.')

  const { source, bitmap } = await decodePhoto(file)
  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height))
    let quality = 0.86
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(source.width * scale))
      canvas.height = Math.max(1, Math.round(source.height * scale))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('تعذر تجهيز الصورة للرفع.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('تعذر ضغط الصورة.')), 'image/jpeg', quality))
      if (blob.size <= MAX_OUTPUT_BYTES) return blob
      if (quality > 0.55) quality = Math.max(0.55, quality - 0.08)
      else scale *= 0.82
    }
    throw new Error('تعذر ضغط الصورة إلى أقل من 5 ميجابايت. اختر صورة أصغر.')
  } finally { bitmap?.close() }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
