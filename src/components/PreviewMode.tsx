import { useState, useEffect, useCallback } from 'react'
import ReactFlow, { Node, Edge, Background } from 'reactflow'
import 'reactflow/dist/style.css'
import './PreviewMode.css'
import StepNode from './nodes/StepNode'
import DecisionNode from './nodes/DecisionNode'
import NoteNode from './nodes/NoteNode'

interface PreviewModeProps {
  nodes: Node[]
  edges: Edge[]
  onExit: () => void
}

const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  note: NoteNode,
}

function PreviewMode({ nodes, edges, onExit }: PreviewModeProps) {
  const [currentNodeIndex, setCurrentNodeIndex] = useState(0)
  const [orderedNodes, setOrderedNodes] = useState<Node[]>([])

  // Sort nodes in a deterministic order (by position, top to bottom, left to right)
  useEffect(() => {
    const sorted = [...nodes].sort((a, b) => {
      if (Math.abs(a.position.y - b.position.y) < 50) {
        return a.position.x - b.position.x
      }
      return a.position.y - b.position.y
    })
    setOrderedNodes(sorted)
  }, [nodes])

  // Create highlighted nodes array
  const highlightedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      // Remove edit callback in preview mode
    },
    selected: orderedNodes[currentNodeIndex]?.id === node.id,
    style: {
      ...node.style,
      opacity: orderedNodes[currentNodeIndex]?.id === node.id ? 1 : 0.3,
    },
  }))

  // Handle navigation
  const handleNext = useCallback(() => {
    setCurrentNodeIndex((prev) => Math.min(prev + 1, orderedNodes.length - 1))
  }, [orderedNodes.length])

  const handlePrevious = useCallback(() => {
    setCurrentNodeIndex((prev) => Math.max(prev - 1, 0))
  }, [])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        handleNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        handlePrevious()
      } else if (e.key === 'Escape') {
        onExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNext, handlePrevious, onExit])

  return (
    <div className="preview-mode">
      <div className="preview-header">
        <div className="preview-title">Presentation Mode</div>
        <div className="preview-counter">
          {currentNodeIndex + 1} / {orderedNodes.length}
        </div>
        <button className="exit-button" onClick={onExit}>
          ✕ Exit
        </button>
      </div>
      <ReactFlow
        nodes={highlightedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
      >
        <Background />
      </ReactFlow>
      <div className="preview-controls">
        <button
          className="nav-button"
          onClick={handlePrevious}
          disabled={currentNodeIndex === 0}
        >
          ← Previous
        </button>
        <button
          className="nav-button"
          onClick={handleNext}
          disabled={currentNodeIndex === orderedNodes.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

export default PreviewMode
