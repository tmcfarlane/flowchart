import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  type Edge,
  type Node,
} from 'reactflow'
import { nodeTypes, edgeTypes } from '../flow/registry'
import { sortParentsFirst } from '../utils/nesting'
import './AISelectionEditDialog.css'

export interface SelectionEditChange {
  kind: 'node' | 'edge'
  action: 'added' | 'updated' | 'removed'
  id: string
  label: string
  details: string[]
}

export interface SelectionEditPreview {
  summary: string
  beforeNodes: Node[]
  beforeEdges: Edge[]
  nodes: Node[]
  edges: Edge[]
  changes: SelectionEditChange[]
}

export interface AISelectionEditDialogProps {
  selectedNodes: Array<{ id: string; label: string }>
  boundaryEdges: Array<{ id: string; label: string; sourceLabel: string; targetLabel: string }>
  busy: boolean
  error?: string | null
  stale?: boolean
  preview?: SelectionEditPreview | null
  darkMode: boolean
  onGenerate: (instruction: string, includeBoundaryConnections: boolean) => void
  onApply: () => void
  onCancel: () => void
}

const actionLabels = { added: 'Added', updated: 'Updated', removed: 'Removed' } as const
const actionColors = { added: '#2563eb', updated: '#059669', removed: '#dc2626' } as const
const noEdit = () => {}

function EditDiagram({ preview, darkMode }: { preview: SelectionEditPreview; darkMode: boolean }) {
  const { nodes, edges } = useMemo(() => {
    const changedNodes = new Map(preview.changes.filter(change => change.kind === 'node').map(change => [change.id, change.action]))
    const changedEdges = new Map(preview.changes.filter(change => change.kind === 'edge').map(change => [change.id, change.action]))
    const proposedIds = new Set(preview.nodes.map(node => node.id))
    const proposedEdgeIds = new Set(preview.edges.map(edge => edge.id))
    const displayNodes = [...preview.nodes, ...preview.beforeNodes.filter(node => !proposedIds.has(node.id))]
    const displayEdges = [...preview.edges, ...preview.beforeEdges.filter(edge => !proposedEdgeIds.has(edge.id))]
    return {
      nodes: sortParentsFirst(displayNodes).map(node => {
        const action = changedNodes.get(node.id)
        return {
          ...node,
          selected: false,
          dragging: false,
          draggable: false,
          selectable: false,
          connectable: false,
          focusable: false,
          data: { ...node.data, onLabelChange: noEdit },
          className: `ai-selection-preview-node ${action ? `change-${action}` : 'change-unchanged'}`,
          style: {
            ...node.style,
            ...(action ? { outline: `3px ${action === 'removed' ? 'dashed' : 'solid'} ${actionColors[action]}`, outlineOffset: 5, borderRadius: 8 } : {}),
            ...(action === 'removed' ? { opacity: 0.55 } : {}),
          },
        }
      }),
      edges: displayEdges.map(edge => {
        const action = changedEdges.get(edge.id)
        return {
          ...edge,
          selected: false,
          animated: false,
          selectable: false,
          focusable: false,
          data: { ...edge.data, onLabelChange: noEdit },
          className: `ai-selection-preview-edge ${action ? `change-${action}` : 'change-unchanged'}`,
          style: {
            ...edge.style,
            ...(action ? { stroke: actionColors[action], strokeWidth: 3 } : {}),
            ...(action === 'removed' ? { strokeDasharray: '7 5', opacity: 0.6 } : {}),
          },
        }
      }),
    }
  }, [preview])

  return <div className="ai-selection-edit-diagram" aria-label="Preview changes on the current diagram" onDoubleClickCapture={event => { event.preventDefault(); event.stopPropagation() }}>
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        className={darkMode ? 'react-flow-dark' : ''}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={darkMode ? '#31413b' : '#dbe5e0'} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  </div>
}

export default function AISelectionEditDialog({
  selectedNodes,
  boundaryEdges,
  busy,
  error,
  stale = false,
  preview,
  darkMode,
  onGenerate,
  onApply,
  onCancel,
}: AISelectionEditDialogProps) {
  const [instruction, setInstruction] = useState('')
  const [includeBoundaryConnections, setIncludeBoundaryConnections] = useState(false)
  const [submitted, setSubmitted] = useState<{ instruction: string; includeBoundaryConnections: boolean } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const applyRef = useRef<HTMLButtonElement>(null)
  const previousPreview = useRef<SelectionEditPreview | null | undefined>(preview)
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`
  const instructionId = `${id}-instruction`
  const scopeId = `${id}-scope`
  const selectedCount = selectedNodes.length
  const canGenerate = selectedCount > 0 && instruction.trim().length > 0 && !busy
  const requestChanged = !!preview && !!submitted && (instruction.trim() !== submitted.instruction || includeBoundaryConnections !== submitted.includeBoundaryConnections)
  const canApply = selectedCount > 0 && !!preview?.changes.length && !busy && !stale && !error && !requestChanged
  const latest = useRef({ onCancel })
  latest.current = { onCancel }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 0)
    const onFocus = (event: FocusEvent) => {
      if (dialogRef.current && event.target instanceof Element && !dialogRef.current.contains(event.target)) {
        const first = dialogRef.current.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]')
        ;(first ?? dialogRef.current).focus()
      }
    }
    document.addEventListener('focusin', onFocus)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('focusin', onFocus)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    if (preview && preview !== previousPreview.current && !busy) applyRef.current?.focus()
    previousPreview.current = preview
  }, [preview, busy])

  const generate = () => {
    if (!canGenerate) return
    setSubmitted({ instruction: instruction.trim(), includeBoundaryConnections })
    onGenerate(instruction.trim(), includeBoundaryConnections)
  }
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep the app's canvas shortcuts outside the modal's editing context.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      latest.current.onCancel()
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      generate()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])
      .filter(control => control.getAttribute('aria-hidden') !== 'true')
    const first = controls[0], last = controls[controls.length - 1]
    if (!first || !last) { event.preventDefault(); dialogRef.current?.focus(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }

  const counts = preview?.changes.reduce((total, change) => {
    total[change.action]++
    return total
  }, { added: 0, updated: 0, removed: 0 })

  return <div className={`ai-selection-edit-overlay ${darkMode ? 'dark' : 'light'}`}>
    <div
      className={`ai-selection-edit-dialog ${preview ? 'has-preview' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={handleKeys}
    >
      <header className="ai-selection-edit-header">
        <div>
          <span className="ai-selection-edit-eyebrow">Edit your diagram</span>
          <h2 id={titleId}>Edit with AI</h2>
          <p id={descriptionId}>Review the changes, then apply them to your selected nodes.</p>
        </div>
        <button type="button" className="ai-selection-edit-close" onClick={onCancel} aria-label="Close AI edit dialog">×</button>
      </header>

      <div className="ai-selection-edit-body">
        <aside className="ai-selection-edit-request">
          <section className="ai-selection-edit-scope" aria-labelledby={scopeId}>
            <div className="ai-selection-edit-section-heading">
              <h3 id={scopeId}>Edit scope</h3>
              <span className="ai-selection-edit-count">{selectedCount} {selectedCount === 1 ? 'node' : 'nodes'}</span>
            </div>
            <ul className="ai-selection-edit-node-list" aria-label="Nodes included in this edit">
              {selectedNodes.map(node => <li key={node.id} title={node.label || 'Untitled node'}>{node.label || 'Untitled node'}</li>)}
            </ul>
            <p className="ai-selection-edit-help">Other nodes stay read-only. This request keeps its original selection.</p>
          </section>

          {!!boundaryEdges.length && <section className="ai-selection-edit-connections">
            <label className="ai-selection-edit-checkbox">
              <input type="checkbox" checked={includeBoundaryConnections} disabled={busy} onChange={event => setIncludeBoundaryConnections(event.target.checked)} />
              <span>Include {boundaryEdges.length} {boundaryEdges.length === 1 ? 'connection' : 'connections'} to other nodes</span>
            </label>
            <ul className="ai-selection-edit-connection-list" aria-label="Connections to other nodes">
              {boundaryEdges.map(edge => <li key={edge.id}>
                <span>{edge.sourceLabel || 'Untitled node'} <span aria-hidden="true">→</span><span className="ai-selection-edit-visually-hidden">to</span> {edge.targetLabel || 'Untitled node'}</span>
                {edge.label && <small>{edge.label}</small>}
              </li>)}
            </ul>
            <p className="ai-selection-edit-help">Include these connections to let AI change or remove them.</p>
          </section>}

          <form className="ai-selection-edit-form" onSubmit={event => { event.preventDefault(); generate() }}>
            <label htmlFor={instructionId}>What should change?</label>
            <textarea
              id={instructionId}
              ref={inputRef}
              value={instruction}
              onChange={event => setInstruction(event.target.value)}
              placeholder="Rename these nodes and make their labels shorter…"
              maxLength={12000}
              rows={5}
              disabled={busy || !selectedCount}
            />
            <span className="ai-selection-edit-shortcut">Ctrl/⌘ + Enter to preview</span>
            <button type="submit" className="ai-selection-edit-button generate" disabled={!canGenerate}>
              {busy ? <><span className="ai-selection-edit-spinner" aria-hidden="true" />Preparing changes…</> : preview ? 'Regenerate preview' : 'Preview changes'}
            </button>
          </form>

          {!selectedCount && <p className="ai-selection-edit-message error" role="alert">Select at least one node to edit with AI.</p>}
          {error && <p className="ai-selection-edit-message error" role="alert">{error}</p>}
          {stale && <p className="ai-selection-edit-message stale" role="alert">The affected diagram content changed. Regenerate the preview before applying.</p>}
          {requestChanged && <p className="ai-selection-edit-message stale" role="status">The instruction or connection scope changed. Regenerate the preview before applying.</p>}
        </aside>

        {preview ? <section className="ai-selection-edit-review" aria-label="Proposed changes">
          <div className="ai-selection-edit-review-heading">
            <div>
              <h3>Preview changes</h3>
              <p>{preview.summary}</p>
            </div>
            <div className="ai-selection-edit-legend" aria-label="Change colors">
              <span className="added">Added{counts ? ` ${counts.added}` : ''}</span>
              <span className="updated">Updated{counts ? ` ${counts.updated}` : ''}</span>
              <span className="removed">Removed{counts ? ` ${counts.removed}` : ''}</span>
            </div>
          </div>
          <EditDiagram preview={preview} darkMode={darkMode} />
          <div className="ai-selection-edit-change-list">
            <h3>Changes to apply</h3>
            {preview.changes.length ? <ol>
              {preview.changes.map(change => <li key={`${change.kind}-${change.id}`}>
                <div className="ai-selection-edit-change-title"><span className={`ai-selection-edit-change-badge ${change.action}`}>{actionLabels[change.action]}</span><strong>{change.label || `${change.kind} ${change.id}`}</strong><small>{change.kind}</small></div>
                {change.details.map((detail, index) => <p key={index}>{detail}</p>)}
              </li>)}
            </ol> : <p className="ai-selection-edit-help">AI proposed no changes to this selection.</p>}
          </div>
        </section> : <section className="ai-selection-edit-empty" aria-live="polite">
          <div className="ai-selection-edit-empty-icon" aria-hidden="true">✦</div>
          <h3>{busy ? 'Preparing your edit' : 'A focused edit, ready to review'}</h3>
          <p>{busy ? 'Your canvas stays unchanged while AI prepares the preview.' : 'Describe the change. You’ll see it on your diagram before applying it.'}</p>
          <div className="ai-selection-edit-empty-steps" aria-hidden="true"><span>Describe</span><i>→</i><span>Review</span><i>→</i><span>Apply</span></div>
        </section>}
      </div>

      <footer className="ai-selection-edit-footer">
        <p>{busy ? 'You can cancel while the request runs.' : 'Apply updates the existing diagram in one undoable step.'}</p>
        <button type="button" className="ai-selection-edit-button cancel" onClick={onCancel}>Cancel</button>
        {preview && <button ref={applyRef} type="button" className="ai-selection-edit-button apply" disabled={!canApply} onClick={onApply}>Apply changes</button>}
      </footer>
    </div>
  </div>
}
