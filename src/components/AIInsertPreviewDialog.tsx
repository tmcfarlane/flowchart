import { useEffect, useCallback, useMemo, useState, useRef } from 'react'
import ReactFlow, {
  Node as FlowNode,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlowProvider,
  MarkerType,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import StepNode from './nodes/StepNode'
import DecisionNode from './nodes/DecisionNode'
import NoteNode from './nodes/NoteNode'
import ImageNode from './nodes/ImageNode'
import { EditableEdge, EditableSmoothStepEdge } from './edges/EditableEdge'
import { BaseFlowNode, BaseFlowEdge, EdgeStyle } from '../App'
import './AIInsertPreviewDialog.css'

const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  note: NoteNode,
  image: ImageNode,
}

const edgeTypes = {
  default: EditableEdge,
  smoothstep: EditableSmoothStepEdge,
  step: EditableSmoothStepEdge,
}

// Estimate rendered size of a node based on its type and explicit dimensions.
// Uses tight estimates matching CSS min-width/min-height to avoid over-spacing.
function estimateNodeSize(node: FlowNode): { w: number; h: number } {
  const style = node.style as { width?: number; height?: number } | undefined
  if (style?.width && style?.height) {
    return { w: style.width, h: style.height }
  }

  switch (node.type) {
    case 'decision':
      return { w: style?.width ?? 140, h: style?.height ?? 140 }
    case 'note':
      return { w: style?.width ?? 160, h: style?.height ?? 80 }
    case 'image':
      return { w: style?.width ?? 100, h: style?.height ?? 100 }
    default: // step
      return { w: style?.width ?? 160, h: style?.height ?? 70 }
  }
}

// Resolve overlapping nodes by nudging them apart just enough.
// Only corrects actual overlaps — does not enforce a large gap.
function resolveOverlaps(inputNodes: FlowNode[]): FlowNode[] {
  const MIN_GAP = 20 // small breathing room, not a big forced gap

  const nodes = inputNodes.map(n => ({
    ...n,
    position: { x: n.position.x, y: n.position.y },
  }))

  for (let pass = 0; pass < 10; pass++) {
    let moved = false

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      const sA = estimateNodeSize(a)

      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        const sB = estimateNodeSize(b)

        // Calculate actual overlap on each axis (positive = overlapping)
        const overlapX = Math.min(a.position.x + sA.w, b.position.x + sB.w) - Math.max(a.position.x, b.position.x)
        const overlapY = Math.min(a.position.y + sA.h, b.position.y + sB.h) - Math.max(a.position.y, b.position.y)

        // Only fix if both axes actually overlap (nodes are on top of each other)
        if (overlapX > 0 && overlapY > 0) {
          moved = true

          // Push apart along the axis with less overlap to preserve layout intent
          if (overlapY <= overlapX) {
            // Push vertically
            if (a.position.y <= b.position.y) {
              b.position.y = a.position.y + sA.h + MIN_GAP
            } else {
              a.position.y = b.position.y + sB.h + MIN_GAP
            }
          } else {
            // Push horizontally
            if (a.position.x <= b.position.x) {
              b.position.x = a.position.x + sA.w + MIN_GAP
            } else {
              a.position.x = b.position.x + sB.w + MIN_GAP
            }
          }
        }
      }
    }

    if (!moved) break
  }

  return nodes
}

interface FlowProposal {
  summary?: string
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}

interface AIInsertPreviewDialogProps {
  proposal: FlowProposal
  onInsert: () => void
  onCancel: () => void
  onPreview: () => void
  onRefine: (instruction: string) => Promise<string | undefined>
  isRefining?: boolean
  darkMode: boolean
}

interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
}

function AIInsertPreviewDialogContent({ proposal, onInsert, onCancel, onPreview, onRefine, isRefining, darkMode }: AIInsertPreviewDialogProps) {
  const [isFullscreen, setIsFullscreen] = useState(proposal.nodes.length >= 8)
  const [refinementInput, setRefinementInput] = useState('')
  const [showChat, setShowChat] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatBubble[]>([])
  const { fitView } = useReactFlow()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)

  // Convert proposal nodes/edges to React Flow format
  const getEdgeStyleProps = useCallback((style?: EdgeStyle) => {
    switch (style) {
      case 'animated':
        return { animated: true, type: 'default' as const }
      case 'step':
        return { type: 'step' as const }
      default:
        return { type: 'default' as const }
    }
  }, [])

  const nodes: FlowNode[] = useMemo(() => {
    const rawNodes: FlowNode[] = proposal.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        label: node.label,
        imageUrl: node.imageUrl,
        onLabelChange: () => { }, // Read-only, no-op
      },
      style: node.width || node.height ? { width: node.width, height: node.height } : undefined,
    }))

    return resolveOverlaps(rawNodes)
  }, [proposal.nodes])

  // Lock the canvas pan boundaries to the node area so the minimap stays focused
  const translateExtent = useMemo((): [[number, number], [number, number]] => {
    if (nodes.length === 0) {
      return [[-500, -500], [500, 500]]
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of nodes) {
      const w = typeof node.style?.width === 'number' ? node.style.width : (node.type === 'decision' ? 160 : 180)
      const h = typeof node.style?.height === 'number' ? node.style.height : (node.type === 'decision' ? 160 : 80)
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + w)
      maxY = Math.max(maxY, node.position.y + h)
    }

    const contentW = maxX - minX
    const contentH = maxY - minY
    const padding = Math.max(200, Math.min(400, Math.min(contentW, contentH) * 0.5))
    return [[minX - padding, minY - padding], [maxX + padding, maxY + padding]]
  }, [nodes])

  const strokeColor = darkMode ? '#78fcd6' : '#555'

  const edges: Edge[] = proposal.edges.map((edge) => ({
    id: edge.id || `e${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || 'bottom',
    targetHandle: edge.targetHandle || 'top',
    label: edge.label,
    ...getEdgeStyleProps(edge.style),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: strokeColor,
    },
    style: {
      stroke: strokeColor,
      strokeWidth: 2,
    },
    labelStyle: {
      fill: darkMode ? '#e7eceb' : '#333',
      fontWeight: 500,
      fontSize: 12,
    },
    labelBgStyle: {
      fill: darkMode ? 'rgba(15, 18, 17, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      stroke: darkMode ? 'rgba(120, 252, 214, 0.3)' : 'rgba(0, 0, 0, 0.1)',
      strokeWidth: 1,
    },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4,
  }))

  // Handle ESC key to cancel
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  // Refit view when nodes change (e.g., after refinement)
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.15, maxZoom: 1.5, duration: 300 })
    }, 100)
    return () => clearTimeout(timer)
  }, [nodes, fitView])

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }
  }, [chatMessages])

  const handleRefine = useCallback(async () => {
    const instruction = refinementInput.trim()
    if (!instruction || isRefining) return
    // Show user message immediately
    setChatMessages((prev) => [...prev, { role: 'user', content: instruction }])
    setRefinementInput('')
    const summary = await onRefine(instruction)
    // Show AI response after refinement completes
    if (summary) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: summary }])
    }
  }, [refinementInput, isRefining, onRefine])

  return (
    <div
      className={`ai-preview-overlay ${isFullscreen ? 'fullscreen' : ''}`}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-preview-title"
    >
      <div className={`ai-preview-dialog ${isFullscreen ? 'fullscreen' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="ai-preview-header">
          <div>
            <h2 id="ai-preview-title" className="ai-preview-title">Preview AI Proposal</h2>
            {proposal.summary && (
              <p className="ai-preview-summary">{proposal.summary}</p>
            )}
          </div>
          <div className="ai-preview-header-actions">
            <button
              className="ai-preview-close"
              onClick={() => setIsFullscreen((f) => !f)}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 1 6 6 1 6" />
                  <polyline points="10 15 10 10 15 10" />
                  <line x1="6" y1="6" x2="1" y2="1" />
                  <line x1="10" y1="10" x2="15" y2="15" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="10 1 15 1 15 6" />
                  <polyline points="6 15 1 15 1 10" />
                  <line x1="15" y1="1" x2="10" y2="6" />
                  <line x1="1" y1="15" x2="6" y2="10" />
                </svg>
              )}
            </button>
            <button className="ai-preview-close" onClick={onCancel} title="Close" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 1l14 14M15 1L1 15" />
              </svg>
            </button>
          </div>
        </div>

        <div className="ai-preview-content">
          <div className="ai-preview-content-row">
            <div className="ai-preview-flow">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.15, maxZoom: 1.5 }}
                nodesDraggable={false}
                elementsSelectable={false}
                nodesConnectable={false}
                zoomOnScroll={true}
                zoomOnDoubleClick={true}
                panOnDrag={true}
                panOnScroll={true}
                translateExtent={translateExtent}
                className={darkMode ? 'react-flow-dark' : ''}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  size={1}
                  gap={18}
                  color={darkMode ? 'rgba(231, 236, 235, 0.12)' : 'rgba(15, 18, 17, 0.08)'}
                />
                <Controls showInteractive={false} />
                <MiniMap
                  nodeColor={darkMode ? '#78fcd6' : '#10b981'}
                  nodeStrokeColor={darkMode ? 'rgba(120, 252, 214, 0.5)' : '#059669'}
                  maskColor={darkMode ? 'rgba(15, 18, 17, 0.85)' : 'rgba(240, 240, 240, 0.85)'}
                  style={{
                    background: darkMode ? '#1a1d1c' : '#f9fafb',
                    border: darkMode ? '1px solid rgba(120, 252, 214, 0.2)' : '1px solid #e5e7eb',
                    borderRadius: 6,
                    width: 120,
                    height: 90,
                  }}
                  pannable
                />
              </ReactFlow>
            </div>

            {showChat ? (
              <div className="ai-preview-chat-sidebar">
                <div className="ai-preview-chat-header">
                  <span>Refine this flowchart</span>
                  <button
                    className="ai-preview-chat-toggle"
                    onClick={() => setShowChat(false)}
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M9 3l4 4-4 4" />
                    </svg>
                  </button>
                </div>
                <div className="ai-preview-chat-body" ref={chatBodyRef}>
                  {proposal.summary && (
                    <div className="ai-preview-chat-summary">{proposal.summary}</div>
                  )}
                  {chatMessages.length > 0 && (
                    <div className="ai-preview-chat-messages">
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={`ai-preview-chat-bubble ${msg.role}`}>
                          <span className="ai-preview-chat-bubble-label">
                            {msg.role === 'user' ? 'You' : 'AI'}
                          </span>
                          <p className="ai-preview-chat-bubble-text">{msg.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    className="ai-preview-chat-input"
                    placeholder="Describe how to refine this flowchart…"
                    value={refinementInput}
                    onChange={(e) => setRefinementInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleRefine()
                      }
                    }}
                    disabled={isRefining}
                  />
                  <button
                    className="ai-preview-chat-send"
                    onClick={handleRefine}
                    disabled={isRefining || !refinementInput.trim()}
                  >
                    {isRefining ? (
                      <span className="ai-preview-chat-spinner">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="8" cy="8" r="6" opacity="0.25" />
                          <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
                        </svg>
                        Regenerating…
                      </span>
                    ) : (
                      'Regenerate'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="ai-preview-chat-expand"
                onClick={() => setShowChat(true)}
                title="Show refinement sidebar"
                aria-label="Show refinement sidebar"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M5 3l-4 4 4 4" />
                </svg>
              </button>
            )}
          </div>

        </div>

        <div className="ai-preview-actions">
          <span className="ai-preview-meta">
            {proposal.nodes.length} nodes · {proposal.edges.length} edges
          </span>
          <button
            className="ai-preview-button cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="ai-preview-button present"
            onClick={onPreview}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
            Present
          </button>
          <button
            className="ai-preview-button insert"
            onClick={onInsert}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Insert into Canvas
          </button>
        </div>
      </div>
    </div>
  )
}

function AIInsertPreviewDialog(props: AIInsertPreviewDialogProps) {
  return (
    <ReactFlowProvider>
      <AIInsertPreviewDialogContent {...props} />
    </ReactFlowProvider>
  )
}

export default AIInsertPreviewDialog
