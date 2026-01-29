import { useState, useCallback, useRef, useEffect } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  reconnectEdge,
  MarkerType,
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

interface HistoryState {
  nodes: Node[]
  edges: Edge[]
}

const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  note: NoteNode,
}

function App() {
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
    },
  ]

  const [nodes, setNodes] = useNodesState(initialNodes)
  const [edges, setEdges] = useEdgesState([])
  const [previewMode, setPreviewMode] = useState(false)
  const [nodeIdCounter, setNodeIdCounter] = useState(2)
  const [defaultEdgeStyle, setDefaultEdgeStyle] = useState<EdgeStyle>('animated')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none')

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
      const newNode: Node = {
        id: nodeIdCounter.toString(),
        type,
        position: { x: Math.random() * 300 + 100, y: Math.random() * 300 + 100 },
        data: { 
          label: type === 'decision' ? 'Decision?' : type === 'note' ? 'Note' : 'Step',
          onLabelChange: updateNodeLabel,
        },
      }
      setNodes((nds) => [...nds, newNode])
      setNodeIdCounter((id) => id + 1)
    },
    [nodeIdCounter, setNodes, updateNodeLabel]
  )

  // Delete selected nodes and edges
  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((node) => !node.selected))
    setEdges((eds) => eds.filter((edge) => !edge.selected))
  }, [setNodes, setEdges])

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
        onDeleteSelected={deleteSelected}
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
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
      >
        <Background />
        <Controls />
      </ReactFlow>
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

export default App
