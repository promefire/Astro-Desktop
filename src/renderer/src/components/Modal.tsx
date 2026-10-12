import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ title, onCancel, children }: { title: string; onCancel(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef(onCancel)
  cancel.current = onCancel
  useEffect(() => {
    const element = dialog.current!, previous = window.document.activeElement
    element.showModal()
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog className="create-dialog editor-dialog" aria-label={title} ref={dialog} onCancel={event => { event.preventDefault(); cancel.current() }}><h2>{title}</h2>{children}</dialog>
}
