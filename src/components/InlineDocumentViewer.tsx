import { useEffect } from 'react'
import { Download, FileText, X } from 'lucide-react'

type Props = { url: string; title: string; filePath: string; onClose: () => void }

export function InlineDocumentViewer({ url, title, filePath, onClose }: Props) {
  const isImage = /\.(jpe?g|png)$/i.test(filePath)
  const isPdf = /\.pdf$/i.test(filePath)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return <div className="document-viewer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="document-viewer-dialog" role="dialog" aria-modal="true" aria-label={`معاينة ${title}`}>
      <header className="document-viewer-header"><div><span className="eyebrow">ملف خاص · معاينة آمنة</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق المعاينة"><X size={20} /></button></header>
      <div className="document-viewer-content">
        {isImage ? <img src={url} alt={title} /> : isPdf ? <iframe src={url} title={title} loading="lazy" /> : <div className="document-viewer-unsupported"><FileText size={34} /><strong>معاينة هذا النوع غير مدعومة داخل المتصفح</strong><p>يمكنك تنزيل الملف الآمن وفتحه باستخدام تطبيق مناسب.</p></div>}
      </div>
      <footer className="document-viewer-footer"><a className="button button-primary button-small" href={url} download><Download size={15} />تنزيل المستند</a><span>المستند خاص ويظهر للمصرح لهم فقط.</span></footer>
    </section>
  </div>
}
