import { useState, useCallback, useRef, useEffect } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  Connection,
  ConnectionMode,
  SelectionMode,
  addEdge,
  useNodesState,
  useEdgesState,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  reconnectEdge,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import 'reactflow/dist/base.css'
import './App.css'
import Toolbar from './components/Toolbar'
import StepNode from './components/nodes/StepNode'
import DecisionNode from './components/nodes/DecisionNode'
import NoteNode from './components/nodes/NoteNode'
import ImageNode from './components/nodes/ImageNode'
import PreviewMode from './components/PreviewMode'
import Explorer from './components/Explorer'
import AIChat from './components/AIChat'

export type EdgeStyle = 'default' | 'animated' | 'step'
export type HandlePosition = 'top' | 'right' | 'bottom' | 'left'
export type SidebarMode = 'none' | 'explorer' | 'ai'
export type ToolMode = 'select' | 'hand' | 'arrow'

export interface BaseFlowNode {
  id: string
  type: string
  label: string
  position: { x: number; y: number }
  width?: number
  height?: number
  imageUrl?: string
}

export interface BaseFlowEdge {
  id?: string
  source: string
  target: string
  style?: EdgeStyle
  sourceHandle?: HandlePosition
  targetHandle?: HandlePosition
  label?: string
}

export interface BaseFlow {
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}

interface HistoryState {
  nodes: Node[]
  edges: Edge[]
}

const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  note: NoteNode,
  image: ImageNode,
}

function FlowChartEditor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, zoomIn, zoomOut } = useReactFlow()

  const getNodeDimensions = useCallback((nodeType?: string, style?: Node['style']) => {
    const width = typeof style?.width === 'number' ? style.width : undefined
    const height = typeof style?.height === 'number' ? style.height : undefined

    if (width && height) {
      return { width, height }
    }

    if (nodeType === 'decision') {
      return { width: 160, height: 160 }
    }

    return { width: 180, height: 80 }
  }, [])

  const findAvailablePosition = useCallback((
    startPosition: { x: number; y: number },
    size: { width: number; height: number },
    occupiedNodes: Node[]
  ) => {
    const step = 24
    let position = { ...startPosition }
    let attempts = 0

    const overlaps = (candidate: { x: number; y: number }) => {
      return occupiedNodes.some((node) => {
        const nodeSize = getNodeDimensions(node.type, node.style)
        const nodeBox = {
          left: node.position.x,
          right: node.position.x + nodeSize.width,
          top: node.position.y,
          bottom: node.position.y + nodeSize.height,
        }
        const candidateBox = {
          left: candidate.x,
          right: candidate.x + size.width,
          top: candidate.y,
          bottom: candidate.y + size.height,
        }

        return (
          candidateBox.left < nodeBox.right &&
          candidateBox.right > nodeBox.left &&
          candidateBox.top < nodeBox.bottom &&
          candidateBox.bottom > nodeBox.top
        )
      })
    }

    while (attempts < 50 && overlaps(position)) {
      position = { x: position.x + step, y: position.y + step }
      attempts += 1
    }

    return position
  }, [getNodeDimensions])

  // Update node label callback
  const updateNodeLabel = useCallback((nodeId: string, label: string) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, label } } : node
      )
    )
  }, [])

  const initialNodes: Node[] = [
    {
      id: '1',
      type: 'step',
      position: { x: 250, y: 100 },
      data: { label: 'Start', onLabelChange: updateNodeLabel },
      style: { width: 180, height: 80 },
    },
  ]

  const [nodes, setNodes] = useNodesState(initialNodes)
  const [edges, setEdges] = useEdgesState([])

  // Update edge label callback
  const updateEdgeLabel = useCallback((edgeId: string, label: string) => {
    setEdges((eds) =>
      eds.map((edge) =>
        edge.id === edgeId ? { ...edge, label } : edge
      )
    )
  }, [setEdges])

  const [previewMode, setPreviewMode] = useState(false)
  const [nodeIdCounter, setNodeIdCounter] = useState(2)
  const [defaultEdgeStyle, setDefaultEdgeStyle] = useState<EdgeStyle>('animated')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none')
  const showGrid = true
  const [toolMode, setToolMode] = useState<ToolMode>('select')
  const [clipboard, setClipboard] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })
  const [pasteCount, setPasteCount] = useState(0)
  const [darkMode, setDarkMode] = useState(true)

  const addImageNode = useCallback(
    (imageUrl: string, label: string) => {
      let position = { x: 200, y: 200 }
      if (reactFlowWrapper.current) {
        const rect = reactFlowWrapper.current.getBoundingClientRect()
        position = screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
        const nodeWidth = 180
        const nodeHeight = 80
        position.x -= nodeWidth / 2
        position.y -= nodeHeight / 2
      }

      const size = { width: 140, height: 140 }
      const adjustedPosition = findAvailablePosition(position, size, nodes)

      const newNode: Node = {
        id: nodeIdCounter.toString(),
        type: 'image',
        position: adjustedPosition,
        data: {
          label,
          imageUrl,
          onLabelChange: updateNodeLabel,
        },
        style: {
          width: size.width,
          height: size.height
        },
      }
      setNodes((nds) => [...nds, newNode])
      setNodeIdCounter((id) => id + 1)
    },
    [nodeIdCounter, setNodes, updateNodeLabel, screenToFlowPosition, nodes, findAvailablePosition]
  )

  // Undo/Redo history management
  const [history, setHistory] = useState<HistoryState[]>([{ nodes: initialNodes, edges: [] }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const isRestoringHistory = useRef(false)
  const MAX_HISTORY = 10

  // Save current state to history
  const saveToHistory = useCallback(() => {
    if (isRestoringHistory.current) return

    setHistory((prev) => {
      // Remove any future states if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1)
      // Add new state
      newHistory.push({ nodes: [...nodes], edges: [...edges] })
      // Keep only last MAX_HISTORY states
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift()
        setHistoryIndex(MAX_HISTORY - 1)
        return newHistory
      }
      setHistoryIndex(newHistory.length - 1)
      return newHistory
    })
  }, [nodes, edges, historyIndex])

  // Undo handler
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      const state = history[newIndex]
      isRestoringHistory.current = true
      setNodes(state.nodes)
      setEdges(state.edges)
      setHistoryIndex(newIndex)
      setTimeout(() => {
        isRestoringHistory.current = false
      }, 0)
    }
  }, [historyIndex, history, setNodes, setEdges])

  // Redo handler
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      const state = history[newIndex]
      isRestoringHistory.current = true
      setNodes(state.nodes)
      setEdges(state.edges)
      setHistoryIndex(newIndex)
      setTimeout(() => {
        isRestoringHistory.current = false
      }, 0)
    }
  }, [historyIndex, history, setNodes, setEdges])

  // Track when to save history - save after changes stabilize
  const lastChangeTime = useRef<number>(0)
  const saveTimeoutRef = useRef<number>()

  useEffect(() => {
    if (isRestoringHistory.current) return

    // Debounce history saves to avoid saving too frequently
    lastChangeTime.current = Date.now()

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      const currentState = history[historyIndex]
      const hasChanged =
        JSON.stringify(currentState?.nodes) !== JSON.stringify(nodes) ||
        JSON.stringify(currentState?.edges) !== JSON.stringify(edges)

      if (hasChanged) {
        saveToHistory()
      }
    }, 500) // Save after 500ms of no changes

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [nodes, edges, history, historyIndex, saveToHistory])

  // Handle node changes (dragging, selection, etc.)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes]
  )

  // Handle edge changes
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  )

  const getEdgeStyleProps = useCallback((style: EdgeStyle) => {
    return {
      type: style === 'step' ? 'smoothstep' : 'default',
      animated: style === 'animated',
      style: style === 'animated'
        ? { strokeDasharray: '5 5', stroke: darkMode ? '#78fcd6' : '#555' }
        : {},
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
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
    }
  }, [darkMode])

  // Handle new connections
  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge = {
        ...connection,
        ...getEdgeStyleProps(defaultEdgeStyle),
      }
      setEdges((eds) => addEdge(newEdge as Edge, eds))
    },
    [setEdges, defaultEdgeStyle, getEdgeStyleProps]
  )

  // Handle edge reconnection
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els))
    },
    [setEdges]
  )

  // Add a new node
  const addNode = useCallback(
    (type: 'step' | 'decision' | 'note') => {
      // Calculate center of the current viewport
      let position = { x: 200, y: 200 } // fallback
      if (reactFlowWrapper.current) {
        const rect = reactFlowWrapper.current.getBoundingClientRect()
        position = screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
        // Offset slightly so the node is centered (not top-left at center)
        const nodeWidth = type === 'decision' ? 160 : 180
        const nodeHeight = type === 'decision' ? 160 : 80
        position.x -= nodeWidth / 2
        position.y -= nodeHeight / 2
      }

      const size = getNodeDimensions(type)
      const adjustedPosition = findAvailablePosition(position, size, nodes)

      const newNode: Node = {
        id: nodeIdCounter.toString(),
        type,
        position: adjustedPosition,
        data: {
          label: type === 'decision' ? 'Decision?' : type === 'note' ? 'Note' : 'Step',
          onLabelChange: updateNodeLabel,
        },
        style: {
          width: size.width,
          height: size.height
        },
      }
      setNodes((nds) => [...nds, newNode])
      setNodeIdCounter((id) => id + 1)
    },
    [nodeIdCounter, setNodes, updateNodeLabel, screenToFlowPosition, nodes, findAvailablePosition, getNodeDimensions]
  )

  // Delete selected nodes and edges
  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((node) => !node.selected))
    setEdges((eds) => eds.filter((edge) => !edge.selected))
  }, [setNodes, setEdges])

  // Clear all nodes and edges
  const clearAll = useCallback(() => {
    setNodes([])
    setEdges([])
  }, [setNodes, setEdges])

  // Get selected nodes and edges
  const getSelectedItems = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected)
    const selectedEdges = edges.filter((edge) => edge.selected)
    return { selectedNodes, selectedEdges }
  }, [nodes, edges])

  // Copy selected nodes and edges
  const copySelection = useCallback(() => {
    const { selectedNodes, selectedEdges } = getSelectedItems()
    setClipboard({ nodes: selectedNodes, edges: selectedEdges })
    setPasteCount(0)
  }, [getSelectedItems])

  // Paste nodes and edges from clipboard
  const pasteSelection = useCallback(() => {
    if (clipboard.nodes.length === 0) return

    const offset = 50 * (pasteCount + 1)

    // Create ID mapping for pasted nodes
    const idMapping: Record<string, string> = {}
    const occupiedNodes = [...nodes]
    const pastedNodes: Node[] = clipboard.nodes.map((node) => {
      const newId = (nodeIdCounter + parseInt(node.id)).toString()
      idMapping[node.id] = newId

      const desiredPosition = {
        x: node.position.x + offset,
        y: node.position.y + offset,
      }
      const size = getNodeDimensions(node.type, node.style)
      const adjustedPosition = findAvailablePosition(desiredPosition, size, occupiedNodes)

      const newNode = {
        ...node,
        id: newId,
        position: adjustedPosition,
        selected: false,
        data: {
          ...node.data,
          onLabelChange: updateNodeLabel,
        },
      }

      occupiedNodes.push({
        ...newNode,
        position: adjustedPosition,
        style: node.style,
      })

      return newNode
    })

    // Update edges to use new node IDs
    const pastedEdges: Edge[] = clipboard.edges
      .filter((edge) => idMapping[edge.source] && idMapping[edge.target])
      .map((edge) => ({
        ...edge,
        id: `e${idMapping[edge.source]}-${idMapping[edge.target]}`,
        source: idMapping[edge.source],
        target: idMapping[edge.target],
        selected: false,
      }))

    setNodes((nds) => [...nds, ...pastedNodes])
    setEdges((eds) => [...eds, ...pastedEdges])
    setNodeIdCounter((id) => id + clipboard.nodes.length)
    setPasteCount((count) => count + 1)
  }, [clipboard, nodeIdCounter, setNodes, setEdges, updateNodeLabel, pasteCount, nodes, findAvailablePosition, getNodeDimensions])

  // Cut selected nodes and edges (copy + delete)
  const cutSelection = useCallback(() => {
    copySelection()
    deleteSelected()
  }, [copySelection, deleteSelected])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const isMod = e.ctrlKey || e.metaKey

      if (isMod && e.key === 'c') {
        e.preventDefault()
        copySelection()
      } else if (isMod && e.key === 'v') {
        e.preventDefault()
        pasteSelection()
      } else if (isMod && e.key === 'x') {
        e.preventDefault()
        cutSelection()
      } else if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (e.key === 'v' && !isMod) {
        setToolMode('select')
      } else if (e.key === 'h' && !isMod) {
        setToolMode('hand')
      } else if (e.key === 'a' && !isMod) {
        setToolMode('arrow')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [copySelection, pasteSelection, cutSelection, undo, redo])

  // Control + Scroll to Zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const wrapper = reactFlowWrapper.current
      if (!wrapper || !wrapper.contains(e.target as Node)) {
        return
      }

      if (e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        
        if (e.deltaY < 0) {
          zoomIn({ duration: 100 })
        } else if (e.deltaY > 0) {
          zoomOut({ duration: 100 })
        }
      }
    }

    document.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [zoomIn, zoomOut])

  // Toggle preview mode
  const togglePreview = useCallback(() => {
    setPreviewMode((prev) => !prev)
  }, [])

  const getEdgeStyleFromEdge = useCallback((edge: Edge): EdgeStyle => {
    if (edge.animated) return 'animated'
    if (edge.type === 'step' || edge.type === 'smoothstep') return 'step'
    return 'default'
  }, [])

  const getSelectedEdgeStyle = useCallback((): EdgeStyle | null => {
    const selectedEdges = edges.filter(edge => edge.selected)
    if (selectedEdges.length === 0) return null

    const firstStyle = getEdgeStyleFromEdge(selectedEdges[0])
    const allSame = selectedEdges.every(edge => getEdgeStyleFromEdge(edge) === firstStyle)
    return allSame ? firstStyle : null
  }, [edges, getEdgeStyleFromEdge])

  const selectedEdgeStyle = getSelectedEdgeStyle()

  // Change edge style for selected edges or set default
  const changeEdgeStyle = useCallback((style: EdgeStyle) => {
    const selectedEdges = edges.filter(edge => edge.selected)
    if (selectedEdges.length > 0) {
      // Change style for selected edges
      setEdges((eds) =>
        eds.map((edge) => {
          if (!edge.selected) return edge
          return {
            ...edge,
            ...getEdgeStyleProps(style),
          }
        })
      )
    } else {
      // Set default style for new edges
      setDefaultEdgeStyle(style)
    }
  }, [edges, setEdges, getEdgeStyleProps])

  // Toggle Explorer sidebar
  const toggleExplorer = useCallback(() => {
    setSidebarMode((prev) => (prev === 'explorer' ? 'none' : 'explorer'))
  }, [])

  // Toggle AI Chat sidebar
  const toggleAI = useCallback(() => {
    setSidebarMode((prev) => (prev === 'ai' ? 'none' : 'ai'))
  }, [])

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev)
  }, [])

  useEffect(() => {
    document.body.className = darkMode ? 'dark-mode' : 'light-mode'
  }, [darkMode])

  const applyBaseFlow = useCallback((flow: BaseFlow) => {
    const nodesWithCallbacks: Node[] = flow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        label: node.label,
        imageUrl: node.imageUrl,
        onLabelChange: updateNodeLabel,
      },
      style: node.width || node.height ? { width: node.width, height: node.height } : undefined,
    }))

    const newEdges: Edge[] = flow.edges.map((edge) => ({
      id: edge.id || `e${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      ...getEdgeStyleProps(edge.style || 'default'),
    }))

    setNodes(nodesWithCallbacks)
    setEdges(newEdges)
  }, [getEdgeStyleProps, setEdges, setNodes, updateNodeLabel])

  if (previewMode) {
    return (
      <PreviewMode
        nodes={nodes}
        edges={edges}
        darkMode={darkMode}
        onExit={togglePreview}
      />
    )
  }

  return (
    <div className={`app ${darkMode ? 'dark-mode' : 'light-mode'}`}>
      <Toolbar
        onAddNode={addNode}
        onAddImage={addImageNode}
        onTogglePreview={togglePreview}
        onToggleExplorer={toggleExplorer}
        sidebarMode={sidebarMode}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onClearAll={clearAll}
        toolMode={toolMode}
        onSetToolMode={setToolMode}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
      />
      <div ref={reactFlowWrapper} className="react-flow-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.2, duration: 600, maxZoom: 1.2 }}
          deleteKeyCode="Delete"
          snapToGrid={showGrid}
          snapGrid={[15, 15]}
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          panOnScroll={toolMode !== 'arrow'}
          panOnScrollSpeed={0.8}
          zoomOnDoubleClick={false}
          selectionOnDrag={toolMode === 'select'}
          selectionMode={SelectionMode.Partial}
          panOnDrag={toolMode === 'hand' ? true : toolMode === 'arrow' ? false : [1, 2]}
          nodesDraggable={toolMode === 'select'}
          elementsSelectable={toolMode === 'select'}
          connectOnClick={toolMode !== 'arrow'}
          zoomActivationKeyCode=""
          className={`${darkMode ? 'react-flow-dark' : ''} ${toolMode === 'hand' ? 'hand-mode' : ''} ${toolMode === 'arrow' ? 'arrow-mode' : ''}`}
        >
          {showGrid && (
            <Background
              variant={BackgroundVariant.Dots}
              size={1}
              gap={18}
              color={darkMode ? 'rgba(231, 236, 235, 0.18)' : 'rgba(15, 18, 17, 0.12)'}
            />
          )}
          <Controls />
        </ReactFlow>
      </div>
      {(() => {
        const { selectedNodes, selectedEdges } = getSelectedItems()
        const totalSelected = selectedNodes.length + selectedEdges.length
        if (totalSelected > 0) {
          return (
            <div className="selection-toolbar">
              <span className="selection-toolbar-text">
                {totalSelected} item{totalSelected !== 1 ? 's' : ''} selected
              </span>
              {selectedEdges.length === 1 && (
                <div className="edge-label-editor">
                  <input
                    type="text"
                    className="edge-label-input"
                    value={typeof selectedEdges[0].label === 'string' ? selectedEdges[0].label : ''}
                    onChange={(e) => updateEdgeLabel(selectedEdges[0].id, e.target.value)}
                    placeholder="Edge label..."
                  />
                </div>
              )}
              {selectedEdges.length > 0 && (
                <div className="edge-style-picker">
                  <button
                    className={`edge-style-option ${selectedEdgeStyle === 'animated' ? 'active' : ''}`}
                    onClick={() => changeEdgeStyle('animated')}
                    title="Animated Dashed"
                    aria-label="Set edge style to Animated Dashed"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M4 12L20 12" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    className={`edge-style-option ${selectedEdgeStyle === 'default' ? 'active' : ''}`}
                    onClick={() => changeEdgeStyle('default')}
                    title="Default"
                    aria-label="Set edge style to Default"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M4 16C8 8 16 8 20 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    className={`edge-style-option ${selectedEdgeStyle === 'step' ? 'active' : ''}`}
                    onClick={() => changeEdgeStyle('step')}
                    title="Step"
                    aria-label="Set edge style to Step"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M4 12L10 12V6M14 12L10 12V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M14 12L20 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}
              <button
                className="selection-toolbar-button delete"
                onClick={deleteSelected}
                title="Delete selected items"
                aria-label="Delete selected items"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3V2h6v1h4v1H1V3h4zM3 5h10l-.5 9H3.5L3 5zm3 1v6h1V6H6zm3 0v6h1V6H9z" />
                </svg>
                Delete
              </button>
              <button
                className="selection-toolbar-button copy"
                onClick={copySelection}
                title="Copy selected items"
                aria-label="Copy selected items"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2h8v1H4V2zm0 2h8v8H4V4zm1 1v6h6V5H5z" fillRule="evenodd" />
                  <path d="M2 4v9h9v1H1V4h1z" opacity="0.6" />
                </svg>
                Copy
              </button>
              <button
                className="selection-toolbar-button paste"
                onClick={pasteSelection}
                title="Paste copied items"
                aria-label="Paste copied items"
                disabled={clipboard.nodes.length === 0}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 1h6v1h2v12H3V2h2V1zm1 1v1h4V2H6zM4 3v10h8V3H4z" fillRule="evenodd" />
                  <path d="M6 6h4v1H6V6zm0 2h4v1H6V8z" />
                </svg>
                Paste
              </button>
            </div>
          )
        }
        return null
      })()}
      {sidebarMode === 'explorer' && (
        <Explorer
          nodes={nodes}
          edges={edges}
          onUpdateNodeLabel={updateNodeLabel}
          onUpdateEdgeLabel={updateEdgeLabel}
          onApplyFlow={applyBaseFlow}
          onClose={() => setSidebarMode('none')}
        />
      )}
      {sidebarMode === 'ai' && (
        <AIChat
          nodes={nodes}
          edges={edges}
          onApplyFlow={applyBaseFlow}
          onClose={() => setSidebarMode('none')}
        />
      )}
      {sidebarMode !== 'ai' && (
        <button className="ai-floating-pill" onClick={toggleAI} aria-label="Open AI Chat">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <circle cx="5.5" cy="6.5" r="1.1" />
            <circle cx="12.5" cy="6.5" r="1.1" />
            <path d="M9 2.3a6.8 6.8 0 0 0-6.8 6.8c0 2.5 1.4 4.6 3.4 5.9V17l2.3-1.1 2.3 1.1v-2c2-1.3 3.4-3.4 3.4-5.9A6.8 6.8 0 0 0 9 2.3z" stroke="currentColor" strokeWidth="1.6" fill="none" />
            <path d="M6.2 10.8c.6.6 1.7 1.1 2.8 1.1s2.2-.5 2.8-1.1" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
          Chat with AI
        </button>
      )}
    </div>
  )
}

function App() {
  return (
    <ReactFlowProvider>
      <FlowChartEditor />
    </ReactFlowProvider>
  )
}

export default App
