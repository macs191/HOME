import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'

export function OrderDialog({
  number,
  title,
  status,
  meta,
  children,
}: {
  number?: string | number
  title: string
  status?: ReactNode
  meta?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const close = () => setOpen(false)
    dialog.addEventListener('close', close)
    return () => dialog.removeEventListener('close', close)
  }, [])
  return <>
    <button type="button" className="order-mini-card" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span><small>طلب {number ? `#${number}` : ''}</small><strong>{title}</strong>{meta && <em>{meta}</em>}</span>
      <span className="order-mini-side">{status}<ChevronLeft size={17} /></span>
    </button>
    <dialog ref={dialogRef} className="order-dialog" onCancel={() => setOpen(false)}>
      <div className="order-dialog-inner" dir="rtl">
        <header className="order-dialog-header"><div><small>تفاصيل الطلب {number ? `#${number}` : ''}</small><h2>{title}</h2>{meta && <p>{meta}</p>}</div><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="إغلاق التفاصيل"><X size={19} /></button></header>
        <div className="order-dialog-body">{children}</div>
      </div>
    </dialog>
  </>
}
