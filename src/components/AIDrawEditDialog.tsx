import { useEffect, useRef, useState } from 'react'
import type { ArchitectureScene } from '../shared/architectureScene'
import type { DrawEditProposal } from '../shared/drawSelectionEdit'
import { getSceneBounds, type Bounds } from '../utils/drawScene'
import DrawSceneSvg from './DrawSceneSvg'
import './AISelectionEditDialog.css'
import './AIDrawEditDialog.css'

export type DrawEditResult = { status: 'prompt' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'preview'; proposal: DrawEditProposal; scene: ArchitectureScene; instruction: string }
interface Props {
  before: ArchitectureScene
  selectedIds: string[]
  result: DrawEditResult
  stale: boolean
  darkMode: boolean
  onGenerate: (instruction: string) => void
  onApply: () => void
  onCancel: () => void
}
function Drawing({ scene, bounds, darkMode, label }: { scene: ArchitectureScene; bounds: Bounds; darkMode: boolean; label: string }) {
  return <figure><figcaption>{label}</figcaption><svg role="img" aria-label={label} viewBox={`${bounds.x - 40} ${bounds.y - 40} ${Math.max(160, bounds.width + 80)} ${Math.max(120, bounds.height + 80)}`}>
    <DrawSceneSvg elements={scene.elements} files={scene.files} darkMode={darkMode} />
  </svg></figure>
}
export default function AIDrawEditDialog({ before, selectedIds, result, stale, darkMode, onGenerate, onApply, onCancel }: Props) {
  const [instruction, setInstruction] = useState('')
  const dialog = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null)
  const bounds = getSceneBounds([...before.elements, ...(result.status === 'preview' ? result.scene.elements : [])].filter(element => selectedIds.includes(String(element.id))))
  const busy = result.status === 'loading'
  const changed = result.status === 'preview' && instruction.trim() !== result.instruction
  const canGenerate = !!instruction.trim() && !busy && !stale
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    input.current?.focus()
    const containFocus = (event: FocusEvent) => { if (event.target instanceof Element && !dialog.current?.contains(event.target)) dialog.current?.focus() }
    document.addEventListener('focusin', containFocus)
    return () => { document.removeEventListener('focusin', containFocus); if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className={`ai-selection-edit-overlay ${darkMode ? 'dark' : 'light'}`}>
    <div className="ai-selection-edit-dialog has-preview ai-draw-edit" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ai-draw-edit-title" aria-busy={busy} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canGenerate) { event.preventDefault(); onGenerate(instruction.trim()) }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled])') ?? [])
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="ai-selection-edit-header"><div><span className="ai-selection-edit-eyebrow">Selected drawing objects</span><h2 id="ai-draw-edit-title">Edit Draw selection with AI</h2><p>Preview your changes, then apply them together.</p></div><button className="ai-selection-edit-close" aria-label="Close Draw AI editor" onClick={onCancel}>×</button></header>
      <div className="ai-selection-edit-body">
        <aside className="ai-selection-edit-request">
          <h3>{selectedIds.length} selected {selectedIds.length === 1 ? 'object' : 'objects'}</h3>
          <p className="ai-selection-edit-help">Change colors, appearance or selected text. Move and resize standalone shapes. Attached shapes keep their geometry.</p>
          <form className="ai-selection-edit-form" onSubmit={event => { event.preventDefault(); if (canGenerate) onGenerate(instruction.trim()) }}>
            <label htmlFor="ai-draw-instruction">What should change?</label>
            <textarea id="ai-draw-instruction" ref={input} value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={12000} rows={5} disabled={busy} placeholder="Make these shapes blue and shorten their labels…" />
            <span className="ai-selection-edit-shortcut">Ctrl/⌘ + Enter to preview</span>
            <button type="submit" className="ai-selection-edit-button generate" disabled={!canGenerate}>{busy ? 'Preparing changes…' : result.status === 'preview' ? 'Regenerate preview' : 'Preview changes'}</button>
          </form>
          {result.status === 'error' && !stale && <p role="alert" className="ai-selection-edit-message error">{result.error}</p>}
          {stale && <p role="alert" className="ai-selection-edit-message stale">The drawing or selection changed. Close this editor and start a new AI edit.</p>}
          {changed && <p role="status" className="ai-selection-edit-message stale">The instruction changed. Regenerate the preview before applying.</p>}
        </aside>
        <section className="ai-selection-edit-review" aria-label="Draw edit preview">
          <div className="ai-draw-preview"><Drawing scene={before} bounds={bounds} darkMode={darkMode} label="Before" />{result.status === 'preview' && <Drawing scene={result.scene} bounds={bounds} darkMode={darkMode} label="Proposed" />}</div>
          {result.status === 'preview' && <div className="ai-selection-edit-change-list"><h3>Changes to apply</h3><p>{result.proposal.summary}</p>{result.proposal.operations.length ? <ol>{result.proposal.operations.map(operation => <li key={operation.id}><strong>{String(before.elements.find(element => element.id === operation.id)?.type)}</strong>{Object.entries(operation.changes).map(([key, value]) => <p key={key}>{key}: {String(before.elements.find(element => element.id === operation.id)?.[key] ?? 'default')} → {String(value)}</p>)}</li>)}</ol> : <p>No changes proposed.</p>}</div>}
        </section>
      </div>
      <footer className="ai-selection-edit-footer"><p>Only Apply changes saves this edit.</p><button className="ai-selection-edit-button cancel" onClick={onCancel}>Cancel</button><button className="ai-selection-edit-button apply" disabled={result.status !== 'preview' || !result.proposal.operations.length || stale || changed} onClick={onApply}>Apply changes</button></footer>
    </div>
  </div>
}
