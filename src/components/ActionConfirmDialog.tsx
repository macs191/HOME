import { useEffect, useId, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

export type ActionConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  confirmDisabled?: boolean
  tone?: 'danger' | 'primary'
  children?: React.ReactNode
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ActionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  tone = 'danger',
  children,
  onConfirm,
  onCancel,
}: ActionConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  const busyRef = useRef(busy)
  onCancelRef.current = onCancel
  busyRef.current = busy

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.requestAnimationFrame(() => cancelRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((item) => item.offsetParent !== null)
      if (!items.length) { event.preventDefault(); dialogRef.current.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [open])

  if (!open) return null
  return <div className="action-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section
      ref={dialogRef}
      className={`action-confirm-dialog ${tone === 'danger' ? 'is-danger' : 'is-primary'}`}
      role={tone === 'danger' ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <div className="action-confirm-heading"><span className="action-confirm-icon"><AlertTriangle size={19} /></span><div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div></div>
      {children && <div className="action-confirm-extra">{children}</div>}
      <div className="action-confirm-buttons">
        <button ref={cancelRef} type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>تراجع</button>
        <button type="button" className={`button ${tone === 'danger' ? 'button-danger' : 'button-primary'}`} onClick={() => void onConfirm()} disabled={busy || confirmDisabled}>
          {busy ? 'جارٍ التنفيذ…' : confirmLabel}
        </button>
      </div>
    </section>
  </div>
}
