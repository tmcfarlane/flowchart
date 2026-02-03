import { useCallback, useEffect, useMemo, useState } from 'react'
import { Node, Edge } from 'reactflow'
import './Explorer.css'
import { BaseFlow, BaseFlowEdge, BaseFlowNode, EdgeStyle, HandlePosition } from '../App'

interface ExplorerProps {
  nodes: Node[]
  edges: Edge[]
  onUpdateNodeLabel: (nodeId: string, label: string) => void
  onApplyFlow: (flow: BaseFlow) => void
  onClose: () => void
}

function Explorer({ nodes, edges, onUpdateNodeLabel, onApplyFlow, onClose }: ExplorerProps) {
  const [viewMode, setViewMode] = useState<'visual' | 'json'>('visual')
  const [baseText, setBaseText] = useState('')
  const [baseError, setBaseError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const handleNodeNameChange = (nodeId: string, newLabel: string) => {
    onUpdateNodeLabel(nodeId, newLabel)
  }

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
                  {nodes.map((node) => (
                    <div key={node.id} className="explorer-item">
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
                        {edge.animated && <span className="edge-style-badge">animated</span>}
                        {edge.type && edge.type !== 'default' && (
                          <span className="edge-style-badge">{edge.type}</span>
                        )}
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
