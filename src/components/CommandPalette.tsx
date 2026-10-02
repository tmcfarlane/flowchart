import { useEffect, useId, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import { getSelectionArrangementAvailability, type SelectionArrangeAction, type SelectionArrangementAvailability } from '../utils/selectionArrangement'
import './CommandPalette.css'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  nodes: Node[]
  onFocusNode: (id: string) => void
  onOpenTemplates: () => void
  onOpenChat: () => void
  onOpenImageStudio: () => void
  onOpenInsights?: () => void
  onAutoLayout: (direction: 'TB' | 'LR') => void
  onArrangeSelection?: (action: SelectionArrangeAction) => void
  arrangementAvailability?: SelectionArrangementAvailability
}

interface Command {
  id: string
  label: string
  description: string
  kind: 'action' | 'node'
  symbol: string
  run: () => void
  disabled?: boolean
}

const arrangementCommands: { action: SelectionArrangeAction; label: string; description: string; symbol: string; eligibility: keyof SelectionArrangementAvailability }[] = [
  { action: 'align-left', label: 'Align selected nodes left', description: 'Line up the left edges within the selection', symbol: '⇤', eligibility: 'align' },
  { action: 'align-center', label: 'Align selected nodes center', description: 'Line up the horizontal centers within the selection', symbol: '↔', eligibility: 'align' },
  { action: 'align-right', label: 'Align selected nodes right', description: 'Line up the right edges within the selection', symbol: '⇥', eligibility: 'align' },
  { action: 'align-top', label: 'Align selected nodes top', description: 'Line up the top edges within the selection', symbol: '⤒', eligibility: 'align' },
  { action: 'align-middle', label: 'Align selected nodes middle', description: 'Line up the vertical centers within the selection', symbol: '↕', eligibility: 'align' },
  { action: 'align-bottom', label: 'Align selected nodes bottom', description: 'Line up the bottom edges within the selection', symbol: '⤓', eligibility: 'align' },
  { action: 'distribute-horizontal', label: 'Distribute selected nodes horizontally', description: 'Equal horizontal gaps · keep the two end nodes in place', symbol: '↔', eligibility: 'horizontal' },
  { action: 'distribute-vertical', label: 'Distribute selected nodes vertically', description: 'Equal vertical gaps · keep the two end nodes in place', symbol: '↕', eligibility: 'vertical' },
]

function PaletteContents({ onClose, nodes, onFocusNode, onOpenTemplates, onOpenChat, onOpenImageStudio, onOpenInsights, onAutoLayout, onArrangeSelection, arrangementAvailability }: Omit<CommandPaletteProps, 'isOpen'>) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  const id = useId()
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const availability = onArrangeSelection ? arrangementAvailability ?? getSelectionArrangementAvailability(nodes) : undefined
  const actions: Command[] = [
    { id: 'templates', label: 'Explore diagram templates', description: 'Start from a curated process, architecture, or creative world', kind: 'action', symbol: '▦', run: onOpenTemplates },
    { id: 'chat', label: 'Edit your diagram with AI', description: 'Describe a change and review it before applying', kind: 'action', symbol: '✦', run: onOpenChat },
    { id: 'images', label: 'Open image studio', description: 'Create original artwork for your diagrams with Premium', kind: 'action', symbol: '◈', run: onOpenImageStudio },
    ...(onOpenInsights ? [{ id: 'insights', label: 'Check diagram insights', description: 'Find disconnected paths, unclear decisions, and other useful improvements', kind: 'action' as const, symbol: '◎', run: onOpenInsights }] : []),
    { id: 'layout-tb', label: 'Arrange from top to bottom', description: 'Auto layout · vertical flow', kind: 'action', symbol: '↓', run: () => onAutoLayout('TB') },
    { id: 'layout-lr', label: 'Arrange from left to right', description: 'Auto layout · horizontal flow', kind: 'action', symbol: '→', run: () => onAutoLayout('LR') },
    ...(onArrangeSelection && availability ? arrangementCommands.map(({ action, label, description, symbol, eligibility }) => ({
      id: action, label, symbol, kind: 'action' as const,
      description: availability[eligibility].enabled ? description : availability[eligibility].reason ?? 'This selection cannot be arranged.',
      disabled: !availability[eligibility].enabled,
      run: () => onArrangeSelection(action),
    })) : []),
  ]
  const filteredActions = actions.filter((action) => `${action.label} ${action.description}`.toLocaleLowerCase().includes(normalizedQuery))
  const matchingNodes = nodes.filter((node) => `${node.data?.label ?? ''} ${node.type ?? ''} ${node.id}`.toLocaleLowerCase().includes(normalizedQuery))
  const displayedNodes: Command[] = matchingNodes.slice(0, normalizedQuery ? 30 : 12).map((node) => ({
    id: `node-${node.id}`,
    label: typeof node.data?.label === 'string' && node.data.label.trim() ? node.data.label : 'Untitled node',
    description: `${node.type ?? 'node'} · ${node.id}`,
    kind: 'node',
    symbol: node.type === 'decision' ? '◇' : node.type === 'database' ? '◉' : '□',
    run: () => onFocusNode(node.id),
  }))
  const commands = [...filteredActions, ...displayedNodes]
  const selectedIndex = commands.length ? Math.min(activeIndex, commands.length - 1) : -1
  const selectedId = selectedIndex < 0 ? undefined : `${id}-option-${selectedIndex}`

  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), input')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    document.getElementById(selectedId)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  const activate = (command: Command) => {
    if (command.disabled) return
    onClose()
    command.run()
  }

  return (
    <div className="command-palette-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="command-palette-topline"><span id={`${id}-title`}>Follow a thought.</span><button type="button" onClick={onClose} aria-label="Close command palette"><span aria-hidden="true">×</span></button></div>
        <div className="command-palette-search">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (commands.length) setActiveIndex((previous) => (Math.min(previous, commands.length - 1) + (event.key === 'ArrowDown' ? 1 : commands.length - 1)) % commands.length)
            } else if (event.key === 'Home' && commands.length) {
              event.preventDefault(); setActiveIndex(0)
            } else if (event.key === 'End' && commands.length) {
              event.preventDefault(); setActiveIndex(commands.length - 1)
            } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (selectedIndex >= 0) activate(commands[selectedIndex])
            }
          }} placeholder="Find a node, or choose your next move…" aria-label="Find a node or action" role="combobox" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={selectedId} aria-autocomplete="list" autoComplete="off" maxLength={120} />
        </div>
        <div className="command-palette-results" id={`${id}-results`} role="listbox" aria-label="Nodes and workspace actions">
          {commands.length ? commands.map((command, index) => (
            <div key={command.id}>
              {(index === 0 || command.kind !== commands[index - 1].kind) ? <div className="command-palette-section" aria-hidden="true">{command.kind === 'action' ? 'Make a move' : 'On your canvas'}</div> : null}
              <button id={`${id}-option-${index}`} className={`command-palette-option ${index === selectedIndex ? 'selected' : ''}`} type="button" role="option" aria-selected={index === selectedIndex} aria-disabled={command.disabled || undefined} disabled={command.disabled} tabIndex={-1} onPointerMove={() => setActiveIndex(index)} onClick={() => activate(command)}>
                <span className={`command-palette-symbol kind-${command.kind}`} aria-hidden="true">{command.symbol}</span>
                <span className="command-palette-copy"><strong>{command.label}</strong><small>{command.description}</small></span>
                <span className="command-palette-enter" aria-hidden="true">{command.disabled ? '—' : '↵'}</span>
              </button>
            </div>
          )) : <div className="command-palette-empty"><span aria-hidden="true">⌕</span><strong>No matching thought yet.</strong><p>Try a node name, “templates”, “image”, or “layout”.</p></div>}
          {matchingNodes.length > displayedNodes.length ? <p className="command-palette-more">Showing {displayedNodes.length} of {matchingNodes.length} nodes. Keep typing to narrow the view.</p> : null}
        </div>
        <div className="command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to explore <kbd>↵</kbd> to choose</span><span><kbd>esc</kbd> to close</span></div>
        <span className="command-palette-announcement" role="status" aria-live="polite">{commands.length} results{matchingNodes.length > displayedNodes.length ? `, ${matchingNodes.length} matching nodes in total` : ''}</span>
      </div>
    </div>
  )
}

export default function CommandPalette({ isOpen, ...props }: CommandPaletteProps) {
  return isOpen ? <PaletteContents {...props} /> : null
}
