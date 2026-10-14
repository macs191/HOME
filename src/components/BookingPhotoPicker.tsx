import { useEffect, useId, useState } from 'react'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'

type Props = {
  files: File[]
  onChange: (files: File[]) => void
  maxFiles?: number
  title?: string
  description?: string
}
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function BookingPhotoPicker({ files, onChange, maxFiles = 5, title = 'صور توضح العطل', description = 'اختياري — التقط صورة بالكاميرا أو اخترها من المعرض.' }: Props) {
  const inputId = useId()
  const [error, setError] = useState('')
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])
  const remaining = Math.max(0, maxFiles - files.length)
  const addFiles = (selection: FileList | null) => {
    if (!selection?.length) return
    const incoming = Array.from(selection)
    const accepted = incoming.filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type) && file.size > 0 && file.size <= 15 * 1024 * 1024)
    const rejected = incoming.length - accepted.length
    const unique = accepted.filter((file) => !files.some((current) => current.name === file.name && current.size === file.size && current.lastModified === file.lastModified))
    const next = [...files, ...unique].slice(0, maxFiles)
    onChange(next)
    const overLimit = files.length + unique.length > maxFiles
    setError(rejected ? 'تم تجاهل ملف غير صوري أو يتجاوز 15 ميجابايت.' : overLimit ? `الحد الأقصى ${maxFiles} صور لكل طلب.` : '')
  }
  return <section className="booking-photo-picker" aria-label={title}>
    <div className="booking-photo-picker-head"><div><strong>{title}</strong><p>{description}</p></div><span>{files.length}/{maxFiles}</span></div>
    <input id={inputId} className="booking-photo-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple disabled={!remaining} onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = '' }} />
    <label className="booking-photo-add" htmlFor={inputId} aria-disabled={!remaining} tabIndex={remaining ? 0 : -1}>
      <span><Camera size={18} /><ImagePlus size={18} /></span>
      <strong>{remaining ? 'التقاط صورة أو اختيار من المعرض' : 'اكتمل الحد الأقصى للصور'}</strong>
      <small>JPG أو PNG أو WebP · حتى 15MB قبل الضغط</small>
    </label>
    {error && <p className="inline-error booking-photo-error" role="alert">{error}</p>}
    {files.length > 0 && <div className="booking-photo-grid">{files.map((file, index) => <figure className="booking-photo-thumb" key={`${file.name}-${file.lastModified}-${index}`}><img src={previews[index]} alt={`معاينة الصورة ${index + 1}`} /><figcaption>{file.name}</figcaption><button type="button" className="icon-button" aria-label={`إزالة الصورة ${index + 1}`} onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}><Trash2 size={15} /></button></figure>)}</div>}
  </section>
}
