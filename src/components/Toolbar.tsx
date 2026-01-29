import './Toolbar.css'

interface ToolbarProps {
  onAddNode: (type: 'step' | 'decision' | 'note') => void
  onDeleteSelected: () => void
  onTogglePreview: () => void
}

function Toolbar({ onAddNode, onDeleteSelected, onTogglePreview }: ToolbarProps) {
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
