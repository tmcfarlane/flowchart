import './Toolbar.css'
import { EdgeStyle, SidebarMode } from '../App'

interface ToolbarProps {
  onAddNode: (type: 'step' | 'decision' | 'note') => void
  onDeleteSelected: () => void
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
  onDeleteSelected, 
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
  showGrid
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
        >
          ↶
        </button>
        <button
          className="toolbar-button icon-button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>
        <button
          className="toolbar-button clear"
          onClick={onClearAll}
          title="Clear All Nodes and Edges"
        >
          Clear All
        </button>
        <button
          className={`toolbar-button icon-button ${showGrid ? 'active' : ''}`}
          onClick={onToggleGrid}
          title="Toggle Grid"
        >
          ⊞
        </button>
      </div>
      <div className="toolbar-section">
        <button
          className="toolbar-button"
          onClick={() => onAddNode('step')}
          title="Add Step Node"
        >
          + Step
        </button>
        <button
          className="toolbar-button"
          onClick={() => onAddNode('decision')}
          title="Add Decision Node"
        >
          + Decision
        </button>
        <button
          className="toolbar-button"
          onClick={() => onAddNode('note')}
          title="Add Note"
        >
          + Note
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
          className="toolbar-button delete"
          onClick={onDeleteSelected}
          title="Delete Selected (or press Delete key)"
        >
          🗑 Delete
        </button>
        <button
          className={`toolbar-button explorer ${sidebarMode === 'explorer' ? 'active' : ''}`}
          onClick={onToggleExplorer}
          title="Toggle Explorer Sidebar"
        >
          📋 Explorer
        </button>
        <button
          className={`toolbar-button ai ${sidebarMode === 'ai' ? 'active' : ''}`}
          onClick={onToggleAI}
          title="Toggle AI Assistant"
        >
          🤖 AI
        </button>
        <button
          className="toolbar-button preview"
          onClick={onTogglePreview}
          title="Enter Preview Mode"
        >
          ▶ Preview
        </button>
      </div>
    </div>
  )
}

export default Toolbar
