import { useEffect, useRef } from 'react'
import type { LocalDraft } from '../hooks/useLocalDraft'
import './LocalCopyDialog.css'

interface Props {
  draft: LocalDraft | null
  portableBackup: boolean
  nodeCount: number
  edgeCount: number
  error: string | null
  onCancel: () => void
  onDownload: () => void
  onConfirm: () => void
}

export default function LocalCopyDialog({ draft, portableBackup, nodeCount, edgeCount, error, onCancel, onDownload, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const latestCancel = useRef(onCancel)
  latestCancel.current = onCancel
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        latestCancel.current()
      } else if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        if (!buttons?.length) return
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <div className="local-copy-overlay">
      <div ref={dialogRef} className="local-copy-dialog" role="dialog" aria-modal="true" aria-labelledby="local-copy-title" aria-describedby="local-copy-description">
        <span className="local-copy-eyebrow">Keep your earlier work safe</span>
        <h2 id="local-copy-title">A browser draft is already saved</h2>
        <p id="local-copy-description">This local copy will use the same browser draft slot. {portableBackup ? 'Download your saved diagram before replacing it. You can reopen that file with Import from JSON.' : 'Download the raw backup for salvage before replacing it. This unverified file cannot be imported automatically.'}</p>
        <div className="local-copy-comparison">
          <section aria-label="Existing browser draft"><strong>Existing draft</strong>{draft ? <><p>{draft.flow.nodes.length} nodes · {draft.flow.edges.length} connections</p><p>Saved {new Date(draft.savedAt).toLocaleString()}</p><ul>{draft.flow.nodes.slice(0, 3).map(node => <li key={node.id}>{node.label || 'Untitled node'}</li>)}</ul></> : <p>Its contents could not be verified. The stored data will stay untouched until you explicitly replace it.</p>}</section>
          <section aria-label="New local copy"><strong>Your current canvas</strong><p>{nodeCount} nodes · {edgeCount} connections</p><p>The original shared chart will stay unchanged.</p></section>
        </div>
        {error && <p className="local-copy-error" role="alert">{error}</p>}
        <div className="local-copy-actions"><button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onDownload}>{portableBackup ? 'Download saved diagram' : 'Download raw backup'}</button><button className="local-copy-confirm" type="button" onClick={onConfirm}>Replace saved draft and make copy</button></div>
      </div>
    </div>
  )
}
