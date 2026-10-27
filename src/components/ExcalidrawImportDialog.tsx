import { useEffect, useRef } from 'react'
import type { ArchitectureScene } from '../shared/architectureScene'
import './ExcalidrawImportDialog.css'

interface ExcalidrawImportDialogProps {
  filename: string
  scene: ArchitectureScene
  onOpen: () => void
  onInsert: () => void
  onCancel: () => void
}

export default function ExcalidrawImportDialog({ filename, scene, onOpen, onInsert, onCancel }: ExcalidrawImportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      if (event.key !== 'Tab') return
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      const lastButton = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); lastButton?.focus() }
      else if (!event.shiftKey && document.activeElement === lastButton) { event.preventDefault(); buttons[0]?.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); previous?.focus() }
  }, [onCancel])

  const images = Object.keys(scene.files).length
  const frames = scene.elements.filter((element) => element.type === 'frame').length
  return (
    <div className="excalidraw-import-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="excalidraw-import-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="excalidraw-import-title" aria-describedby="excalidraw-import-description">
        <div className="excalidraw-import-heading">
          <div className="excalidraw-import-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 3"/><path d="M12 7v10M7 12h10"/></svg>
          </div>
          <span className="excalidraw-import-eyebrow">EDITABLE EXCALIDRAW SCENE</span>
          <h2 id="excalidraw-import-title">Bring your drawing in</h2>
          <p className="excalidraw-import-filename" title={filename}>{filename}</p>
          <div className="excalidraw-import-stats"><span>{scene.elements.length} elements</span><span>{images} {images === 1 ? 'image' : 'images'}</span><span>{frames} {frames === 1 ? 'frame' : 'frames'}</span></div>
        </div>
        <p id="excalidraw-import-description">Your shapes, text, connections, styles, and images stay editable in Architecture mode.</p>
        <div className="excalidraw-import-choices">
          <button className="excalidraw-import-choice" onClick={onInsert}>
            <span className="excalidraw-import-choice-title">Insert into current diagram <span aria-hidden="true">↗</span></span>
            <span className="excalidraw-import-choice-detail">Keep your work and add the drawing as one unit.</span>
          </button>
          <button className="excalidraw-import-choice" onClick={onOpen}>
            <span className="excalidraw-import-choice-title">Open as new diagram <span aria-hidden="true">→</span></span>
            <span className="excalidraw-import-choice-detail">Replace the current diagram and fit the drawing into view.</span>
          </button>
        </div>
        <div className="excalidraw-import-footer"><span>Either change can be undone.</span><button ref={cancelRef} onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  )
}
