import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { PATCH_NOTES } from '../patchNotes'
import './PatchNotesDialog.css'

export default function PatchNotesDialog({ onDismiss }: { onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.showModal()
    closeRef.current?.focus()
    return () => {
      dialog?.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onDismiss()
    }
    if (event.key !== 'Tab') return
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const first = buttons[0], last = buttons[buttons.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus() }
  }

  return (
    <dialog ref={dialogRef} className="patch-notes-overlay" aria-modal="true" aria-labelledby="patch-notes-title" onKeyDown={handleKeyDown} onCancel={(event) => { event.preventDefault(); onDismiss() }} onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss() }}>
      <div className="patch-notes-dialog">
        <div className="patch-notes-header">
          <div>
            <span className="patch-notes-eyebrow">FLOWCHART UPDATES</span>
            <h2 id="patch-notes-title">What's new</h2>
          </div>
          <button ref={closeRef} className="patch-notes-close" onClick={onDismiss} aria-label="Close patch notes">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>
        <div className="patch-notes-body">
          {PATCH_NOTES.map((note, index) => (
            <section key={note.revision} className="patch-notes-release" aria-labelledby={`patch-notes-release-${note.revision}`}>
              <div className="patch-notes-release-meta">
                <time dateTime={note.publishedOn}>{new Date(`${note.publishedOn}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time>
                {index === 0 && <span className="patch-notes-latest">Latest</span>}
              </div>
              <h3 id={`patch-notes-release-${note.revision}`}>{note.title}</h3>
              <ul>{note.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
            </section>
          ))}
        </div>
        <div className="patch-notes-footer">
          <span>Revisit these updates in What's new.</span>
          <button className="patch-notes-done" onClick={onDismiss}>Got it</button>
        </div>
      </div>
    </dialog>
  )
}
