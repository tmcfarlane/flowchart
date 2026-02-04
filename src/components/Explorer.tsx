import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Node, Edge } from 'reactflow'
import './Explorer.css'
import { BaseFlow, BaseFlowEdge, BaseFlowNode, EdgeStyle, HandlePosition } from '../App'

interface ExplorerProps {
  nodes: Node[]
  edges: Edge[]
  onUpdateNodeLabel: (nodeId: string, label: string) => void
  onUpdateEdgeLabel: (edgeId: string, label: string) => void
  onReorderNodes: (fromIndex: number, toIndex: number) => void
  onApplyFlow: (flow: BaseFlow) => void
  onClose: () => void
}

function Explorer({ nodes, edges, onUpdateNodeLabel, onUpdateEdgeLabel, onReorderNodes, onApplyFlow, onClose }: ExplorerProps) {
  const [viewMode, setViewMode] = useState<'visual' | 'json'>('visual')
  const [baseText, setBaseText] = useState('')
  const [baseError, setBaseError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const handleNodeNameChange = (nodeId: string, newLabel: string) => {
    onUpdateNodeLabel(nodeId, newLabel)
  }

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
    // Add a slight delay to apply dragging class for visual feedback
    setTimeout(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.classList.add('dragging')
      }
    }, 0)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index)
    }
  }, [draggedIndex])

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, toIndex: number) => {
    e.preventDefault()
    const fromIndex = draggedIndex
    if (fromIndex !== null && fromIndex !== toIndex) {
      onReorderNodes(fromIndex, toIndex)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
  }, [draggedIndex, onReorderNodes])

  const getEdgeStyleFromEdge = useCallback((edge: Edge): EdgeStyle => {
    if (edge.animated) return 'animated'
    if (edge.type === 'step') return 'step'
    return 'default'
  }, [])

  const baseFlow = useMemo<BaseFlow>(() => {
    const baseNodes: BaseFlowNode[] = nodes.map((node) => {
      const width = typeof node.style?.width === 'number' ? node.style.width : undefined
      const height = typeof node.style?.height === 'number' ? node.style.height : undefined
      return {
        id: node.id,
        type: node.type || 'step',
        label: node.data.label || '',
        position: node.position,
        width,
        height,
        imageUrl: typeof node.data.imageUrl === 'string' ? node.data.imageUrl : undefined,
      }
    })

    const baseEdges: BaseFlowEdge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      style: getEdgeStyleFromEdge(edge),
      sourceHandle: typeof edge.sourceHandle === 'string' ? (edge.sourceHandle as HandlePosition) : undefined,
      targetHandle: typeof edge.targetHandle === 'string' ? (edge.targetHandle as HandlePosition) : undefined,
      label: typeof edge.label === 'string' ? edge.label : undefined,
    }))

    return { nodes: baseNodes, edges: baseEdges }
  }, [edges, nodes, getEdgeStyleFromEdge])

  const baseFlowText = useMemo(() => JSON.stringify(baseFlow, null, 2), [baseFlow])

  useEffect(() => {
    if (viewMode === 'json' && !isDirty) {
      setBaseText(baseFlowText)
    }
  }, [baseFlowText, isDirty, viewMode])

  const isEdgeStyle = (value: unknown): value is EdgeStyle => {
    return value === 'default' || value === 'animated' || value === 'step'
  }

  const isHandlePosition = (value: unknown): value is HandlePosition => {
    return value === 'top' || value === 'right' || value === 'bottom' || value === 'left'
  }

  const normalizeNode = (node: BaseFlowNode): BaseFlowNode | null => {
    if (!node || typeof node.id !== 'string') return null
    if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') return null
    return {
      id: node.id,
      type: node.type || 'step',
      label: node.label || '',
      position: node.position,
      width: typeof node.width === 'number' ? node.width : undefined,
      height: typeof node.height === 'number' ? node.height : undefined,
      imageUrl: typeof node.imageUrl === 'string' ? node.imageUrl : undefined,
    }
  }

  const normalizeEdge = (edge: BaseFlowEdge): BaseFlowEdge | null => {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') return null
    return {
      id: typeof edge.id === 'string' ? edge.id : undefined,
      source: edge.source,
      target: edge.target,
      style: isEdgeStyle(edge.style) ? edge.style : undefined,
      sourceHandle: isHandlePosition(edge.sourceHandle) ? edge.sourceHandle : undefined,
      targetHandle: isHandlePosition(edge.targetHandle) ? edge.targetHandle : undefined,
      label: typeof edge.label === 'string' ? edge.label : undefined,
    }
  }

  const handleCopyBase = async () => {
    try {
      await navigator.clipboard.writeText(baseText)
    } catch (error) {
      setBaseError('Unable to copy to clipboard. Select and copy manually.')
    }
  }

  const handleApplyBase = () => {
    try {
      const parsed = JSON.parse(baseText) as BaseFlow
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        throw new Error('Invalid JSON format')
      }

      const normalizedNodes = parsed.nodes
        .map((node) => normalizeNode(node as BaseFlowNode))
        .filter((node): node is BaseFlowNode => node !== null)

      const normalizedEdges = parsed.edges
        .map((edge) => normalizeEdge(edge as BaseFlowEdge))
        .filter((edge): edge is BaseFlowEdge => edge !== null)

      onApplyFlow({ nodes: normalizedNodes, edges: normalizedEdges })
      setIsDirty(false)
      setBaseError(null)
    } catch (error) {
      setBaseError('Invalid JSON. Please check the format and try again.')
    }
  }

  return (
    <>
      <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="explorer-sidebar">
        <div className="explorer-header">
          <div className="explorer-header-content">
            <h3>Explorer</h3>
            <div className="explorer-view-toggle" role="tablist" aria-label="Explorer view mode">
              <button
                className={`explorer-toggle-button ${viewMode === 'visual' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('visual')
                  setBaseError(null)
                }}
                type="button"
              >
                Visual
              </button>
              <button
                className={`explorer-toggle-button ${viewMode === 'json' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('json')
                  setIsDirty(false)
                  setBaseError(null)
                }}
                type="button"
              >
                JSON
              </button>
            </div>
          </div>
          <button className="explorer-close" onClick={onClose} title="Close sidebar">
            ×
          </button>
        </div>

        <div className="explorer-content">
          {viewMode === 'visual' ? (
            <>
              <div className="explorer-section">
                <h4>Nodes ({nodes.length})</h4>
                <div className="explorer-list">
                  {nodes.map((node, index) => (
                    <div
                      key={node.id}
                      ref={draggedIndex === index ? dragNodeRef : null}
                      className={`explorer-item draggable ${draggedIndex === index ? 'dragging' : ''
                        } ${dragOverIndex === index ? 'drag-over' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, index)}
                    >
                      <span className="drag-handle" title="Drag to reorder">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <circle cx="3" cy="2" r="1.2" />
                          <circle cx="9" cy="2" r="1.2" />
                          <circle cx="3" cy="6" r="1.2" />
                          <circle cx="9" cy="6" r="1.2" />
                          <circle cx="3" cy="10" r="1.2" />
                          <circle cx="9" cy="10" r="1.2" />
                        </svg>
                      </span>
                      <span className="node-type-badge">{node.type || 'default'}</span>
                      <input
                        type="text"
                        className="explorer-input"
                        value={node.data.label || ''}
                        onChange={(e) => handleNodeNameChange(node.id, e.target.value)}
                        placeholder="Node name"
                      />
                    </div>
                  ))}
                  {nodes.length === 0 && (
                    <div className="explorer-empty">No nodes yet</div>
                  )}
                </div>
              </div>

              <div className="explorer-section">
                <h4>Edges ({edges.length})</h4>
                <div className="explorer-list">
                  {edges.map((edge, index) => {
                    const sourceNode = nodes.find((n) => n.id === edge.source)
                    const targetNode = nodes.find((n) => n.id === edge.target)
                    return (
                      <div key={edge.id || index} className="explorer-item edge-item">
                        <div className="edge-info">
                          <span className="edge-source">{sourceNode?.data.label || edge.source}</span>
                          <span className="edge-arrow">→</span>
                          <span className="edge-target">{targetNode?.data.label || edge.target}</span>
                        </div>
                        <input
                          type="text"
                          className="explorer-edge-label-input"
                          value={typeof edge.label === 'string' ? edge.label : ''}
                          onChange={(e) => onUpdateEdgeLabel(edge.id, e.target.value)}
                          placeholder="Add label..."
                        />
                        <div className="edge-badges">
                          {edge.animated && <span className="edge-style-badge">animated</span>}
                          {edge.type && edge.type !== 'default' && (
                            <span className="edge-style-badge">{edge.type}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {edges.length === 0 && (
                    <div className="explorer-empty">No edges yet</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="explorer-json">
              <p className="explorer-json-hint">
                Paste JSON to recreate a flow or copy the current structure to reuse elsewhere.
              </p>
              <textarea
                className="explorer-json-input"
                value={baseText}
                onChange={(e) => {
                  setBaseText(e.target.value)
                  setIsDirty(true)
                  setBaseError(null)
                }}
                spellCheck={false}
              />
              {baseError && <div className="explorer-json-error">{baseError}</div>}
              <div className="explorer-json-actions">
                <button className="explorer-json-button" onClick={handleCopyBase} type="button">
                  Copy
                </button>
                <button className="explorer-json-button primary" onClick={handleApplyBase} type="button">
                  Apply Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default Explorer
