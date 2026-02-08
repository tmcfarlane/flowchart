import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Background,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  ConnectionMode,
} from 'reactflow'
import 'reactflow/dist/style.css'
import './PreviewMode.css'
import StepNode from './nodes/StepNode'
import DecisionNode from './nodes/DecisionNode'
import NoteNode from './nodes/NoteNode'
import ImageNode from './nodes/ImageNode'

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
  image: ImageNode,
}

const defaultEdgeOptions = {
  style: { strokeWidth: 2 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 20,
    height: 20,
  },
}

function PreviewModeContent({ nodes, edges, darkMode, onExit }: PreviewModeProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const { fitView } = useReactFlow()
  const fitViewTimeoutRef = useRef<number>()

  // Presentation order follows the nodes array (JSON/Explorer order)
  const orderedNodeIds = useMemo(() => {
    return nodes.map((node) => node.id)
  }, [nodes])

  const totalSteps = orderedNodeIds.length

  useEffect(() => {
    if (currentStep >= totalSteps && totalSteps > 0) {
      setCurrentStep(totalSteps - 1)
    }
  }, [currentStep, totalSteps])

  // Get visible node IDs based on current step (all nodes up to and including current)
  const visibleNodeIds = useMemo(() => {
    return new Set(orderedNodeIds.slice(0, currentStep + 1))
  }, [orderedNodeIds, currentStep])

  // Get visible edges - only show edges where both source and target are visible
  const visibleEdges = useMemo((): Edge[] => {
    // Filter edges to only those connecting visible nodes
    const filtered = edges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    )

    const strokeColor = darkMode ? '#78fcd6' : '#555'

    // Style all edges for presentation visibility
    return filtered.map((edge): Edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      type: 'smoothstep',
      animated: Boolean(edge.animated),
      style: {
        stroke: strokeColor,
        strokeWidth: 3,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 24,
        height: 24,
        color: strokeColor,
      },
      labelStyle: {
        fill: darkMode ? '#e7eceb' : '#333',
        fontWeight: 600,
        fontSize: 14,
      },
      labelBgStyle: {
        fill: darkMode ? 'rgba(15, 18, 17, 0.9)' : 'rgba(255, 255, 255, 0.9)',
        stroke: darkMode ? 'rgba(120, 252, 214, 0.3)' : 'rgba(0, 0, 0, 0.1)',
        strokeWidth: 1,
      },
      labelBgPadding: [8, 6] as [number, number],
      labelBgBorderRadius: 4,
    }))
  }, [edges, visibleNodeIds, darkMode])

  // The active (most recently revealed) node
  const activeNodeId = orderedNodeIds[currentStep]

  // Create highlighted nodes with proper styling (no selection state in presentation)
  const highlightedNodes = useMemo(() => {
    return nodes
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => ({
        ...node,
        data: {
          ...node.data,
        },
        selected: false,
        style: {
          ...node.style,
          opacity: activeNodeId === node.id ? 1 : 0.55,
          transition: 'opacity 0.3s ease',
        },
      }))
  }, [activeNodeId, nodes, visibleNodeIds])

  // Center on the active node when step changes.
  // For the first couple of steps we show all revealed nodes (nice "build-up"),
  // but once there are 3+ visible nodes we lock the camera on the current node
  // so the audience can actually read it instead of zooming further and further out.
  useEffect(() => {
    if (fitViewTimeoutRef.current) {
      clearTimeout(fitViewTimeoutRef.current)
    }

    // Small delay to allow nodes to render
    fitViewTimeoutRef.current = window.setTimeout(() => {
      if (highlightedNodes.length > 0) {
        const shouldFocusActive = highlightedNodes.length > 2

        const targetNodes = shouldFocusActive
          ? [{ id: activeNodeId }]
          : highlightedNodes.map((n) => ({ id: n.id }))

        fitView({
          padding: shouldFocusActive ? 0.5 : 0.3,
          duration: 500,
          maxZoom: shouldFocusActive ? 1 : 1.5,
          minZoom: 0.3,
          nodes: targetNodes,
        })
      }
    }, 50)

    return () => {
      if (fitViewTimeoutRef.current) {
        clearTimeout(fitViewTimeoutRef.current)
      }
    }
  }, [currentStep, highlightedNodes, activeNodeId, fitView])

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
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
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
    <div className={`preview-mode fullscreen ${darkMode ? 'dark' : 'light'}`}>
      <ReactFlow
        nodes={highlightedNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={true}
        panOnDrag={true}
        proOptions={{ hideAttribution: true }}
        className={darkMode ? 'react-flow-dark' : ''}
      >
        <Background
          variant={BackgroundVariant.Dots}
          size={1}
          gap={18}
          color={darkMode ? 'rgba(231, 236, 235, 0.18)' : 'rgba(15, 18, 17, 0.12)'}
        />
      </ReactFlow>
      <div className="floating-controls">
        <div className="floating-bar">
          <button
            className="nav-button nav-button-sm"
            onClick={handlePrevious}
            disabled={currentStep === 0}
          >
            ←
          </button>
          <span className="floating-counter">
            {totalSteps === 0 ? 0 : currentStep + 1} / {totalSteps}
          </span>
          <button
            className="nav-button nav-button-sm"
            onClick={handleNext}
            disabled={currentStep >= totalSteps - 1}
          >
            →
          </button>
          <button className="exit-button exit-button-sm" onClick={onExit}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewMode(props: PreviewModeProps) {
  return (
    <ReactFlowProvider>
      <PreviewModeContent {...props} />
    </ReactFlowProvider>
  )
}

export default PreviewMode
