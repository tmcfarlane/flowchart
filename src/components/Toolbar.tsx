import { useState, useEffect, useRef } from 'react'
import './Toolbar.css'
import { SidebarMode, ToolMode, DiagramMode, PaletteNodeType } from '../App'
import ImagePicker from './ImagePicker'
import { exportToPng, exportToSvg, exportToGif, exportToJson, parseFlowJson } from '../utils/exportUtils'
import type { Node as FlowNode, Edge } from 'reactflow'

interface ToolbarProps {
  onAddNode: (type: PaletteNodeType) => void
  onAddContainer: () => void
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
  diagramMode: DiagramMode
  onSetDiagramMode: (mode: DiagramMode) => void
  reactFlowWrapper: React.RefObject<HTMLDivElement>
  nodes: FlowNode[]
  edges: Edge[]
  onImportJson: (nodes: FlowNode[], edges: Edge[], mode?: DiagramMode) => void
}

function Toolbar({
  onAddNode,
  onAddContainer,
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
  diagramMode,
  onSetDiagramMode,
  reactFlowWrapper,
  nodes,
  edges,
  onImportJson,
}: ToolbarProps) {
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [gifDuration, setGifDuration] = useState(2)
  const [gifProgress, setGifProgress] = useState<{ frame: number; total: number } | null>(null)
  const [isEncoding, setIsEncoding] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleExportPng = async () => {
    if (!reactFlowWrapper.current) return
    setExportError(null)
    try {
      await exportToPng(reactFlowWrapper.current, darkMode)
      setIsExportOpen(false)
    } catch {
      setExportError('Export failed')
    }
  }

  const handleExportSvg = async () => {
    if (!reactFlowWrapper.current) return
    setExportError(null)
    try {
      await exportToSvg(reactFlowWrapper.current, darkMode)
      setIsExportOpen(false)
    } catch {
      setExportError('Export failed')
    }
  }

  const handleExportGif = async () => {
    if (!reactFlowWrapper.current) return
    setExportError(null)
    setGifProgress({ frame: 0, total: Math.round(gifDuration * 10) })
    try {
      await exportToGif(
        reactFlowWrapper.current,
        darkMode,
        gifDuration,
        (frame, total) => {
          setGifProgress({ frame, total })
          if (frame === total) {
            setIsEncoding(true)
          }
        },
      )
      setIsExportOpen(false)
    } catch {
      setExportError('GIF export failed')
    } finally {
      setGifProgress(null)
      setIsEncoding(false)
    }
  }

  const handleExportJson = () => {
    exportToJson(nodes, edges, diagramMode)
    setIsExportOpen(false)
  }

  const handleImportJson = () => {
    setExportError(null)
    fileInputRef.current?.click()
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const result = parseFlowJson(event.target?.result as string)
        onImportJson(result.nodes, result.edges, result.mode)
        setIsExportOpen(false)
        setExportError(null)
      } catch (err) {
        setIsExportOpen(false)
        setExportError(err instanceof Error ? err.message : 'Failed to import file.')
      }
    }
    reader.onerror = () => {
      setIsExportOpen(false)
      setExportError('Could not read the selected file.')
    }
    reader.readAsText(file)

    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  // Close export dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setIsExportOpen(false)
      }
    }
    if (isExportOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExportOpen])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isClearConfirmOpen) setIsClearConfirmOpen(false)
        if (isExportOpen) setIsExportOpen(false)
        if (exportError) setExportError(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isClearConfirmOpen, isExportOpen, exportError])

  return (
    <>
      <div className="floating-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group mode-switcher" role="group" aria-label="Diagram mode">
            <button
              className={`toolbar-button mode-option ${diagramMode === 'flowchart' ? 'active' : ''}`}
              onClick={() => onSetDiagramMode('flowchart')}
              title="Flowchart Mode"
              aria-label="Flowchart Mode"
              aria-pressed={diagramMode === 'flowchart'}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="1.5" width="8" height="4" rx="1" />
                <path d="M8 5.5v2" />
                <path d="M8 7.5L11.5 11L8 14.5L4.5 11L8 7.5z" />
              </svg>
              <span className="mode-option-label">Flowchart</span>
            </button>
            <button
              className={`toolbar-button mode-option ${diagramMode === 'architecture' ? 'active' : ''}`}
              onClick={() => onSetDiagramMode('architecture')}
              title="Architecture Mode"
              aria-label="Architecture Mode"
              aria-pressed={diagramMode === 'architecture'}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
                <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
                <rect x="5.25" y="9" width="5.5" height="5.5" rx="1" />
                <path d="M4.5 7v1.5M11.5 7v1.5" />
              </svg>
              <span className="mode-option-label">Architecture</span>
            </button>
          </div>

          <div className="toolbar-separator" />

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
            {diagramMode === 'flowchart' ? (
              <>
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
              </>
            ) : (
              <>
                <button
                  className="toolbar-button add-node"
                  onClick={() => onAddNode('service')}
                  title="Add Service Node"
                  aria-label="Add Service Node"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="2" width="12" height="12" rx="2" />
                    <path d="M2 6h12" />
                  </svg>
                </button>
                <button
                  className="toolbar-button add-node"
                  onClick={() => onAddNode('database')}
                  title="Add Database Node"
                  aria-label="Add Database Node"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
                    <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" />
                    <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
                  </svg>
                </button>
                <button
                  className="toolbar-button add-node"
                  onClick={() => onAddNode('queue')}
                  title="Add Queue Node"
                  aria-label="Add Queue Node"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
                    <path d="M5 4v8M8.5 4v8" />
                    <path d="M11 8h2" />
                  </svg>
                </button>
                <button
                  className="toolbar-button add-node"
                  onClick={() => onAddNode('cache')}
                  title="Add Cache Node"
                  aria-label="Add Cache Node"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" />
                  </svg>
                </button>
                <button
                  className="toolbar-button add-node"
                  onClick={() => onAddNode('apiGateway')}
                  title="Add API Gateway Node"
                  aria-label="Add API Gateway Node"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 1.5h7l3 6.5-3 6.5h-7l-3-6.5 3-6.5z" />
                    <path d="M5.5 8h5M8.5 6l2 2-2 2" />
                  </svg>
                </button>
                <button
                  className="toolbar-button add-node"
                  onClick={() => onAddNode('externalActor')}
                  title="Add External Actor Node"
                  aria-label="Add External Actor Node"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="8" cy="4.5" r="2.5" />
                    <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
                  </svg>
                </button>
                <button
                  className="toolbar-button add-node"
                  onClick={onAddContainer}
                  title="Add Container"
                  aria-label="Add Container"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="1.5" y="1.5" width="13" height="13" rx="2" strokeDasharray="3 2" />
                    <rect x="4.5" y="6.5" width="3" height="3" rx="0.5" />
                    <rect x="9" y="6.5" width="3" height="3" rx="0.5" />
                  </svg>
                </button>
              </>
            )}
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
        </div>

        <div className="toolbar-row">
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
            <div className="export-wrapper" ref={exportRef}>
              <button
                className={`toolbar-button export ${isExportOpen ? 'active' : ''}`}
                onClick={() => setIsExportOpen(!isExportOpen)}
                title="Export"
                aria-label="Export"
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 10V2" />
                  <path d="M4 6l4 4 4-4" />
                  <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
                </svg>
              </button>
              {isExportOpen && (
                <div className="export-dropdown">
                  {gifProgress || isEncoding ? (
                    <div className="export-progress">
                      {isEncoding ? (
                        <span>Encoding...</span>
                      ) : (
                        <span>Capturing... {gifProgress!.frame}/{gifProgress!.total}</span>
                      )}
                    </div>
                  ) : (
                    <>
                      <button className="export-option export-import-btn" onClick={handleImportJson}>
                        Import from JSON
                      </button>
                      <div className="export-divider" />
                      <button className="export-option" onClick={handleExportJson}>
                        Export as JSON
                      </button>
                      <button className="export-option" onClick={handleExportPng}>
                        Export as PNG
                      </button>
                      <button className="export-option" onClick={handleExportSvg}>
                        Export as SVG
                      </button>
                      <div className="export-divider" />
                      <div className="export-gif-section">
                        <div className="export-gif-row">
                          <span className="export-gif-label">Duration</span>
                          <input
                            type="number"
                            className="export-gif-input"
                            value={gifDuration}
                            onChange={(e) => {
                              const v = Math.max(1, Math.min(10, Number(e.target.value) || 1))
                              setGifDuration(v)
                            }}
                            min={1}
                            max={10}
                            aria-label="GIF duration in seconds"
                          />
                          <span className="export-gif-unit">sec</span>
                        </div>
                        <button className="export-option export-gif-btn" onClick={handleExportGif}>
                          Record GIF
                        </button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={handleFileSelected}
                        style={{ display: 'none' }}
                        aria-label="Import JSON file"
                      />
                    </>
                  )}
                </div>
              )}
            </div>
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

          <div className="toolbar-separator" />

          <a
            href="https://github.com/tmcfarlane/flowchart"
            target="_blank"
            rel="noopener noreferrer"
            className="toolbar-github-link"
            title="View source on GitHub"
            aria-label="Open-Source on GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span style={{ whiteSpace: 'nowrap' }}>Open-Source</span>
          </a>
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

      {exportError && (
        <div
          className="confirm-overlay"
          onClick={() => setExportError(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-error-title"
        >
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 id="import-error-title" className="confirm-title">Invalid JSON Format</h2>
            <p className="confirm-body">{exportError}</p>
            <div className="confirm-actions">
              <button
                className="confirm-button confirm-cancel"
                onClick={() => setExportError(null)}
              >
                OK
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
