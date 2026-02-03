import { useState, useEffect, useCallback, useMemo } from 'react'
import ReactFlow, { Node, Edge, Background } from 'reactflow'
import 'reactflow/dist/style.css'
import './PreviewMode.css'
import StepNode from './nodes/StepNode'
import DecisionNode from './nodes/DecisionNode'
import NoteNode from './nodes/NoteNode'

interface PreviewModeProps {
  nodes: Node[]
  edges: Edge[]
  darkMode: boolean
  onExit: () => void
}

const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  note: NoteNode,
}

function PreviewMode({ nodes, edges, darkMode, onExit }: PreviewModeProps) {
  const [currentStep, setCurrentStep] = useState(0)

  const startNodeId = useMemo(() => {
    if (nodes.length === 0) return undefined
    const incomingTargets = new Set(edges.map((edge) => edge.target))
    const startNode = nodes.find((node) => !incomingTargets.has(node.id))
    return startNode ? startNode.id : nodes[0].id
  }, [edges, nodes])

  const orderedEdges = useMemo(() => {
    if (!startNodeId) return []

    const visited = new Set<string>([startNodeId])
    const queue: string[] = [startNodeId]
    const result: Edge[] = []

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) break

      const outgoingEdges = edges.filter((edge) => edge.source === current)
      outgoingEdges.forEach((edge) => {
        if (!visited.has(edge.target)) {
          result.push(edge)
          visited.add(edge.target)
          queue.push(edge.target)
        }
      })
    }

    return result
  }, [edges, startNodeId])

  const totalSteps = nodes.length > 0 ? orderedEdges.length + 1 : 0

  useEffect(() => {
    if (currentStep >= totalSteps && totalSteps > 0) {
      setCurrentStep(totalSteps - 1)
    }
  }, [currentStep, totalSteps])

  const visibleEdges = orderedEdges.slice(0, currentStep)
  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (startNodeId) {
      ids.add(startNodeId)
    }
    visibleEdges.forEach((edge) => {
      ids.add(edge.source)
      ids.add(edge.target)
    })
    return ids
  }, [startNodeId, visibleEdges])

  const activeNodeId = useMemo(() => {
    if (!startNodeId) return undefined
    if (currentStep === 0) return startNodeId
    return orderedEdges[currentStep - 1]?.target
  }, [currentStep, orderedEdges, startNodeId])

  const highlightedNodes = useMemo(() => {
    return nodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => ({
        ...node,
        data: {
          ...node.data,
        },
        selected: activeNodeId === node.id,
        style: {
          ...node.style,
          opacity: activeNodeId === node.id ? 1 : 0.55,
        },
      }))
  }, [activeNodeId, nodes, visibleNodeIds])

  // Handle navigation
  const handleNext = useCallback(() => {
    if (totalSteps === 0) return
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1))
  }, [totalSteps])

  const handlePrevious = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0))
  }, [])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        handlePrevious()
      } else if (e.key === 'Escape') {
        onExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNext, handlePrevious, onExit])

  return (
    <div className={`preview-mode ${darkMode ? 'dark' : 'light'}`}>
      <div className="preview-header">
        <div className="preview-title">Presentation Mode</div>
        <div className="preview-counter">
          {totalSteps === 0 ? 0 : currentStep + 1} / {totalSteps}
        </div>
        <button className="exit-button" onClick={onExit}>
          ✕ Exit
        </button>
      </div>
      <ReactFlow
        nodes={highlightedNodes}
        edges={visibleEdges}
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
          disabled={currentStep === 0}
        >
          ← Previous
        </button>
        <button
          className="nav-button"
          onClick={handleNext}
          disabled={currentStep >= totalSteps - 1}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

export default PreviewMode
