import { useState, useEffect } from 'react'
import './Toolbar.css'
import { SidebarMode, ToolMode } from '../App'
import ImagePicker from './ImagePicker'

interface ToolbarProps {
  onAddNode: (type: 'step' | 'decision' | 'note') => void
  onAddImage: (imageUrl: string, label: string) => void
  onTogglePreview: () => void
  onToggleExplorer: () => void
  sidebarMode: SidebarMode
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onClearAll: () => void
  toolMode: ToolMode
  onSetToolMode: (mode: ToolMode) => void
  darkMode: boolean
  onToggleDarkMode: () => void
}

function Toolbar({
  onAddNode,
  onAddImage,
  onTogglePreview,
  onToggleExplorer,
  sidebarMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClearAll,
  toolMode,
  onSetToolMode,
  darkMode,
  onToggleDarkMode,
}: ToolbarProps) {
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)

  const handleClearClick = () => {
    setIsClearConfirmOpen(true)
  }

  const handleCancelClear = () => {
    setIsClearConfirmOpen(false)
  }

  const handleConfirmClear = () => {
    setIsClearConfirmOpen(false)
    onClearAll()
  }

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isClearConfirmOpen) {
        setIsClearConfirmOpen(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isClearConfirmOpen])

  return (
    <>
      <div className="floating-toolbar">
        <div className="toolbar-group">
          <button
            className={`toolbar-button ${toolMode === 'select' ? 'active' : ''}`}
            onClick={() => onSetToolMode('select')}
            title="Select Tool (V)"
            aria-label="Selection Tool"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 1l10 8-4 1-2 4-1-5-3-8z" />
            </svg>
          </button>
          <button
            className={`toolbar-button ${toolMode === 'hand' ? 'active' : ''}`}
            onClick={() => onSetToolMode('hand')}
            title="Hand Tool (H) - Pan canvas"
            aria-label="Hand Tool"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.4 3.2c.5 0 1 .4 1 1v6.4h.8V3.8c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v6.8h.8V4.6c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v6.3h.8V6.8c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v6.5c0 2.2-1.5 3.7-3.8 3.7H9.1c-2.1 0-3.5-1.4-3.8-3.6L4.7 9.9c-.2-1 .5-1.9 1.5-2.1.1 0 .2 0 .2 0z" />
            </svg>
          </button>
          <button
            className={`toolbar-button ${toolMode === 'arrow' ? 'active' : ''}`}
            onClick={() => onSetToolMode('arrow')}
            title="Arrow Tool (A) - Connect nodes only"
            aria-label="Arrow Tool"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10h10" />
              <path d="M11 6l4 4-4 4" />
            </svg>
          </button>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <button
            className="toolbar-button add-node"
            onClick={() => onAddNode('step')}
            title="Add Step Node (S)"
            aria-label="Add Step Node"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          <button
            className="toolbar-button add-node"
            onClick={() => onAddNode('decision')}
            title="Add Decision Node (D)"
            aria-label="Add Decision Node"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2L14 8L8 14L2 8Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          <button
            className="toolbar-button add-node"
            onClick={() => onAddNode('note')}
            title="Add Note (N)"
            aria-label="Add Note"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2h10v9l-3 3H3V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M10 11v3l3-3h-3z" fill="currentColor" />
            </svg>
          </button>
          <button
            className="toolbar-button add-image"
            onClick={() => setIsImagePickerOpen(true)}
            title="Add Image (I)"
            aria-label="Add Image"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
              <path d="M2 11.5l3-3 2 2 3.5-3.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <button
            className="toolbar-button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 8l4-4v2.5c4 0 6 2 6 5.5-1-2-3-3-6-3V11L4 8z" />
            </svg>
          </button>
          <button
            className="toolbar-button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12 8l-4-4v2.5c-4 0-6 2-6 5.5 1-2 3-3 6-3V11l4-3z" />
            </svg>
          </button>
          <button
            className="toolbar-button clear"
            onClick={handleClearClick}
            title="Clear All"
            aria-label="Clear All"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3h12v1H2V3zm1 2h10l-.5 9H3.5L3 5zm3 2v5h1V7H6zm3 0v5h1V7H9z" />
            </svg>
          </button>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <button
            className={`toolbar-button dark-mode-toggle ${darkMode ? 'is-dark' : 'is-light'}`}
            onClick={onToggleDarkMode}
            title={darkMode ? "Light Mode" : "Dark Mode"}
            aria-label="Toggle Dark Mode"
          >
            {darkMode ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="5" fill="currentColor" stroke="currentColor" strokeWidth="1" />
                <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="1" x2="12" y2="4" />
                  <line x1="12" y1="20" x2="12" y2="23" />
                  <line x1="1" y1="12" x2="4" y2="12" />
                  <line x1="20" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" />
                  <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
                  <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" />
                  <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
                </g>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
                  fill="#E9E9E9"
                  stroke="#757575"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <button
            className={`toolbar-button ${sidebarMode === 'explorer' ? 'active' : ''}`}
            onClick={onToggleExplorer}
            title="Explorer Panel"
            aria-label="Toggle Explorer"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3h12v2H2V3zm0 4h12v2H2V7zm0 4h12v2H2v-2z" />
            </svg>
          </button>
          <button
            className="toolbar-button preview"
            onClick={onTogglePreview}
            title="Preview Mode"
            aria-label="Enter Preview Mode"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 4l8 4-8 4V4z" />
            </svg>
          </button>
        </div>
      </div>

      {isClearConfirmOpen && (
        <div
          className="confirm-overlay"
          onClick={handleCancelClear}
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-confirm-title"
        >
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 id="clear-confirm-title" className="confirm-title">Clear the entire board?</h2>
            <p className="confirm-body">This cannot be undone.</p>
            <div className="confirm-actions">
              <button
                className="confirm-button confirm-cancel"
                onClick={handleCancelClear}
              >
                Cancel
              </button>
              <button
                className="confirm-button confirm-delete"
                onClick={handleConfirmClear}
              >
                Clear board
              </button>
            </div>
          </div>
        </div>
      )}

      {isImagePickerOpen && (
        <ImagePicker
          isOpen={isImagePickerOpen}
          onClose={() => setIsImagePickerOpen(false)}
          onSelectImage={onAddImage}
        />
      )}
    </>
  )
}

export default Toolbar
