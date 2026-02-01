import { useState, useCallback, useRef, useEffect } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
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
import './App.css'
import Toolbar from './components/Toolbar'
import StepNode from './components/nodes/StepNode'
import DecisionNode from './components/nodes/DecisionNode'
import NoteNode from './components/nodes/NoteNode'
import PreviewMode from './components/PreviewMode'
import Explorer from './components/Explorer'
import AIChat from './components/AIChat'

export type EdgeStyle = 'default' | 'animated' | 'step' | 'smoothstep'
export type SidebarMode = 'none' | 'explorer' | 'ai'
export type ToolMode = 'select' | 'hand'

interface HistoryState {
  nodes: Node[]
  edges: Edge[]
}

const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  note: NoteNode,
}

function FlowChartEditor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

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
  const [previewMode, setPreviewMode] = useState(false)
  const [nodeIdCounter, setNodeIdCounter] = useState(2)
  const [defaultEdgeStyle, setDefaultEdgeStyle] = useState<EdgeStyle>('animated')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none')
  const showGrid = true
  const [toolMode, setToolMode] = useState<ToolMode>('select')
  const [clipboard, setClipboard] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })

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

  // Handle new connections
  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge = {
        ...connection,
        type: defaultEdgeStyle === 'default' ? 'default' :
          defaultEdgeStyle === 'animated' ? 'default' :
            defaultEdgeStyle,
        animated: defaultEdgeStyle === 'animated',
        style: defaultEdgeStyle === 'animated'
          ? { strokeDasharray: '5 5', stroke: '#555' }
          : {},
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
      }
      setEdges((eds) => addEdge(newEdge as Edge, eds))
    },
    [setEdges, defaultEdgeStyle]
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

      const newNode: Node = {
        id: nodeIdCounter.toString(),
        type,
        position,
        data: {
          label: type === 'decision' ? 'Decision?' : type === 'note' ? 'Note' : 'Step',
          onLabelChange: updateNodeLabel,
        },
        style: {
          width: type === 'decision' ? 160 : 180,
          height: type === 'decision' ? 160 : 80
        },
      }
      setNodes((nds) => [...nds, newNode])
      setNodeIdCounter((id) => id + 1)
    },
    [nodeIdCounter, setNodes, updateNodeLabel, screenToFlowPosition]
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
  }, [getSelectedItems])

  // Paste nodes and edges from clipboard
  const pasteSelection = useCallback(() => {
    if (clipboard.nodes.length === 0) return

    // Create ID mapping for pasted nodes
    const idMapping: Record<string, string> = {}
    const pastedNodes: Node[] = clipboard.nodes.map((node) => {
      const newId = (nodeIdCounter + parseInt(node.id)).toString()
      idMapping[node.id] = newId
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + 50,
          y: node.position.y + 50,
        },
        selected: false,
        data: {
          ...node.data,
          onLabelChange: updateNodeLabel,
        },
      }
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
  }, [clipboard, nodeIdCounter, setNodes, setEdges, updateNodeLabel])

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
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [copySelection, pasteSelection, cutSelection, undo, redo])

  // Toggle preview mode
  const togglePreview = useCallback(() => {
    setPreviewMode((prev) => !prev)
  }, [])

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
            type: style === 'default' || style === 'animated' ? 'default' : style,
            animated: style === 'animated',
            style: style === 'animated'
              ? { strokeDasharray: '5 5', stroke: '#555' }
              : {},
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 20,
              height: 20,
            },
          }
        })
      )
    } else {
      // Set default style for new edges
      setDefaultEdgeStyle(style)
    }
  }, [edges, setEdges])

  // Toggle Explorer sidebar
  const toggleExplorer = useCallback(() => {
    setSidebarMode((prev) => (prev === 'explorer' ? 'none' : 'explorer'))
  }, [])

  // Toggle AI Chat sidebar
  const toggleAI = useCallback(() => {
    setSidebarMode((prev) => (prev === 'ai' ? 'none' : 'ai'))
  }, [])

  // Update flow from AI (future enhancement for direct modifications)
  const updateFlowFromAI = useCallback((newNodes: Node[], newEdges: Edge[]) => {
    // Ensure all nodes have the onLabelChange callback
    const nodesWithCallbacks = newNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        onLabelChange: updateNodeLabel,
      },
    }))
    setNodes(nodesWithCallbacks)
    setEdges(newEdges)
  }, [setNodes, setEdges, updateNodeLabel])

  if (previewMode) {
    return (
      <PreviewMode
        nodes={nodes}
        edges={edges}
        onExit={togglePreview}
      />
    )
  }

  return (
    <div className="app">
      <Toolbar
        onAddNode={addNode}
        onTogglePreview={togglePreview}
        onChangeEdgeStyle={changeEdgeStyle}
        currentEdgeStyle={defaultEdgeStyle}
        onToggleExplorer={toggleExplorer}
        onToggleAI={toggleAI}
        sidebarMode={sidebarMode}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onClearAll={clearAll}
        toolMode={toolMode}
        onSetToolMode={setToolMode}
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
          panOnScroll={true}
          panOnScrollSpeed={0.8}
          zoomOnDoubleClick={false}
          selectionOnDrag={toolMode === 'select'}
          selectionMode={SelectionMode.Partial}
          panOnDrag={toolMode === 'hand' ? true : [1, 2]}
          nodesDraggable={toolMode === 'select'}
          elementsSelectable={toolMode === 'select'}
          zoomActivationKeyCode=""
          className={toolMode === 'hand' ? 'hand-mode' : ''}
        >
          {showGrid && <Background />}
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
              <button
                className="selection-toolbar-button delete"
                onClick={deleteSelected}
                title="Delete selected items"
                aria-label="Delete selected items"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3V2h6v1h4v1H1V3h4zM3 5h10l-.5 9H3.5L3 5zm3 1v6h1V6H6zm3 0v6h1V6H9z"/>
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
                  <path d="M4 2h8v1H4V2zm0 2h8v8H4V4zm1 1v6h6V5H5z" fillRule="evenodd"/>
                  <path d="M2 4v9h9v1H1V4h1z" opacity="0.6"/>
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
                  <path d="M5 1h6v1h2v12H3V2h2V1zm1 1v1h4V2H6zM4 3v10h8V3H4z" fillRule="evenodd"/>
                  <path d="M6 6h4v1H6V6zm0 2h4v1H6V8z"/>
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
          onClose={() => setSidebarMode('none')}
        />
      )}
      {sidebarMode === 'ai' && (
        <AIChat
          nodes={nodes}
          edges={edges}
          onUpdateFlow={updateFlowFromAI}
          onClose={() => setSidebarMode('none')}
        />
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
