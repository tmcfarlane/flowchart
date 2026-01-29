import './Toolbar.css'
import { EdgeStyle } from '../App'

interface ToolbarProps {
  onAddNode: (type: 'step' | 'decision' | 'note') => void
  onDeleteSelected: () => void
  onTogglePreview: () => void
  onChangeEdgeStyle: (style: EdgeStyle) => void
  currentEdgeStyle: EdgeStyle
}

function Toolbar({ onAddNode, onDeleteSelected, onTogglePreview, onChangeEdgeStyle, currentEdgeStyle }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <h2>FlowChart Designer</h2>
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
