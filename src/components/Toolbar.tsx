import './Toolbar.css'
import { EdgeStyle, SidebarMode } from '../App'

interface ToolbarProps {
  onAddNode: (type: 'step' | 'decision' | 'note') => void
  onTogglePreview: () => void
  onChangeEdgeStyle: (style: EdgeStyle) => void
  currentEdgeStyle: EdgeStyle
  onToggleExplorer: () => void
  onToggleAI: () => void
  sidebarMode: SidebarMode
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onClearAll: () => void
  onToggleGrid: () => void
  showGrid: boolean
}

function Toolbar({ 
  onAddNode, 
  onTogglePreview, 
  onChangeEdgeStyle, 
  currentEdgeStyle, 
  onToggleExplorer, 
  onToggleAI, 
  sidebarMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClearAll,
  onToggleGrid,
  showGrid,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <h2>FlowChart Designer</h2>
      </div>
      <div className="toolbar-section">
        <button
          className="toolbar-button icon-button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8h-1A5.5 5.5 0 1 0 8 13.5V11l3.5 3L8 17v-2.5A6.5 6.5 0 0 1 8 1.5z"/>
          </svg>
        </button>
        <button
          className="toolbar-button icon-button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1.5A6.5 6.5 0 0 0 1.5 8h1A5.5 5.5 0 1 1 8 13.5V11L4.5 14 8 17v-2.5A6.5 6.5 0 0 0 8 1.5z"/>
          </svg>
        </button>
        <button
          className="toolbar-button clear"
          onClick={onClearAll}
          title="Clear All Nodes and Edges"
          aria-label="Clear All"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
            <path d="M2 3h12v1H2V3zm1 2h10l-.5 9H3.5L3 5zm3 2v5h1V7H6zm3 0v5h1V7H9z"/>
          </svg>
          Clear
        </button>
        <button
          className={`toolbar-button icon-button ${showGrid ? 'active' : ''}`}
          onClick={onToggleGrid}
          title="Toggle Grid"
          aria-label="Toggle Grid"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1h5v5H1V1zm0 7h5v5H1V8zm7-7h5v5H8V1zm0 7h5v5H8V8z" fillRule="evenodd"/>
          </svg>
        </button>

      </div>
      <div className="toolbar-section">
        <button
          className="toolbar-button add-node"
          onClick={() => onAddNode('step')}
          title="Add Step Node"
          aria-label="Add Step Node"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
          Step
        </button>
        <button
          className="toolbar-button add-node"
          onClick={() => onAddNode('decision')}
          title="Add Decision Node"
          aria-label="Add Decision Node"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
            <path d="M8 2L14 8L8 14L2 8Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
          Decision
        </button>
        <button
          className="toolbar-button add-node"
          onClick={() => onAddNode('note')}
          title="Add Note"
          aria-label="Add Note"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
            <path d="M3 2h10v9l-3 3H3V2z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <path d="M10 11v3l3-3h-3z" fill="currentColor"/>
          </svg>
          Note
        </button>
      </div>
      <div className="toolbar-section">
        <label htmlFor="edge-style" className="toolbar-label">Edge Style:</label>
        <select
          id="edge-style"
          className="toolbar-select"
          value={currentEdgeStyle}
          onChange={(e) => onChangeEdgeStyle(e.target.value as EdgeStyle)}
          title="Select edge style (applies to new edges or selected edges)"
        >
          <option value="animated">Animated Dashed</option>
          <option value="default">Default</option>
          <option value="step">Step</option>
          <option value="smoothstep">Smooth Step</option>
        </select>
      </div>
      <div className="toolbar-section">
        <button
          className={`toolbar-button explorer ${sidebarMode === 'explorer' ? 'active' : ''}`}
          onClick={onToggleExplorer}
          title="Toggle Explorer Sidebar"
          aria-label="Toggle Explorer"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
            <path d="M2 3h12v2H2V3zm0 4h12v2H2V7zm0 4h12v2H2v-2z"/>
          </svg>
          Explorer
        </button>
        <button
          className={`toolbar-button ai ${sidebarMode === 'ai' ? 'active' : ''}`}
          onClick={onToggleAI}
          title="Toggle AI Assistant"
          aria-label="Toggle AI Assistant"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
            <circle cx="5" cy="6" r="1"/>
            <circle cx="11" cy="6" r="1"/>
            <path d="M8 2a6 6 0 0 0-6 6c0 2.2 1.2 4.1 3 5.2V15l2-1 2 1v-1.8c1.8-1.1 3-3 3-5.2a6 6 0 0 0-6-6z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <path d="M5.5 9.5c.5.5 1.5 1 2.5 1s2-.5 2.5-1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>
          AI
        </button>
        <button
          className="toolbar-button preview"
          onClick={onTogglePreview}
          title="Enter Preview Mode"
          aria-label="Enter Preview Mode"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
            <path d="M3 4l8 4-8 4V4z"/>
          </svg>
          Preview
        </button>
      </div>
    </div>
  )
}

export default Toolbar
