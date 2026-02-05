import { useEffect, useCallback } from 'react'
import ReactFlow, {
  Node as FlowNode,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
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

interface FlowProposal {
  summary?: string
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}

interface AIInsertPreviewDialogProps {
  proposal: FlowProposal
  onInsert: () => void
  onCancel: () => void
  darkMode: boolean
}

function AIInsertPreviewDialogContent({ proposal, onInsert, onCancel, darkMode }: AIInsertPreviewDialogProps) {
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

  const nodes: FlowNode[] = proposal.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      label: node.label,
      imageUrl: node.imageUrl,
      onLabelChange: () => {}, // Read-only, no-op
    },
    style: node.width || node.height ? { width: node.width, height: node.height } : undefined,
  }))

  const edges: Edge[] = proposal.edges.map((edge) => ({
    id: edge.id || `e${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || 'bottom',
    targetHandle: edge.targetHandle || 'top',
    label: edge.label,
    ...getEdgeStyleProps(edge.style),
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

  return (
    <div
      className="ai-preview-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-preview-title"
    >
      <div className="ai-preview-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ai-preview-header">
          <div>
            <h2 id="ai-preview-title" className="ai-preview-title">Preview AI Proposal</h2>
            {proposal.summary && (
              <p className="ai-preview-summary">{proposal.summary}</p>
            )}
          </div>
          <button className="ai-preview-close" onClick={onCancel} title="Close" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l14 14M15 1L1 15" />
            </svg>
          </button>
        </div>

        <div className="ai-preview-content">
          <div className="ai-preview-flow">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1.5 }}
              nodesDraggable={false}
              elementsSelectable={false}
              nodesConnectable={false}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              panOnDrag={false}
              panOnScroll={false}
              className={darkMode ? 'react-flow-dark' : ''}
            >
              <Background
                variant={BackgroundVariant.Dots}
                size={1}
                gap={18}
                color={darkMode ? 'rgba(231, 236, 235, 0.12)' : 'rgba(15, 18, 17, 0.08)'}
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <div className="ai-preview-info">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
              <path d="M7 7h2v5H7z" />
              <circle cx="8" cy="4.5" r="1" />
            </svg>
            <span>This will be inserted into your canvas. Nodes: {proposal.nodes.length} | Edges: {proposal.edges.length}</span>
          </div>
        </div>

        <div className="ai-preview-actions">
          <button
            className="ai-preview-button cancel"
            onClick={onCancel}
          >
            Cancel
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
