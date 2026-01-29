import { useState, useCallback } from 'react'
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
} from 'reactflow'
import 'reactflow/dist/style.css'
import './App.css'
import Toolbar from './components/Toolbar'
import StepNode from './components/nodes/StepNode'
import DecisionNode from './components/nodes/DecisionNode'
import NoteNode from './components/nodes/NoteNode'
import PreviewMode from './components/PreviewMode'

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
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
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
    </div>
  )
}

export default App
