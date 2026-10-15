const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024
const MAX_EDGE = 1800
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

function detectedType(file: File) {
  if (ACCEPTED_IMAGE_TYPES.has(file.type)) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'
  return ''
}

export async function prepareBookingPhoto(file: File): Promise<Blob> {
  if (!detectedType(file)) throw new Error('اختر صورة من الكاميرا أو المعرض بصيغة JPG أو PNG أو WebP.')
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('يجب أن تكون الصورة أكبر من صفر وألا تتجاوز 15 ميجابايت قبل الضغط.')

  let bitmap: ImageBitmap | null = null
  let image: HTMLImageElement | null = null
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    else {
      image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        const url = URL.createObjectURL(file)
        element.onload = () => { URL.revokeObjectURL(url); resolve(element) }
        element.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
        element.src = url
      })
    }
  } catch { throw new Error('تعذر قراءة الصورة من الهاتف. أعد التقاطها أو اختر JPG/PNG من المعرض.') }

  try {
    const source = bitmap ?? image!
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
