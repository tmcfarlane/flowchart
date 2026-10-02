import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import ReactFlow, {
  Node as FlowNode,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
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
  useNodesInitialized,
  getRectOfNodes,
  getTransformForBounds,
} from 'reactflow'
import 'reactflow/dist/style.css'
import 'reactflow/dist/base.css'
import './App.css'
import './components/DraftRecovery.css'
import Toolbar from './components/Toolbar'
import { nodeTypes, edgeTypes } from './flow/registry'
import PreviewMode from './components/PreviewMode'
import Explorer from './components/Explorer'
import AIChat, { type ProposalIntent } from './components/AIChat'
import TemplateGallery from './components/TemplateGallery'
import PremiumStudio from './components/PremiumStudio'
import CommandPalette from './components/CommandPalette'
import ChatGPTAccount from './components/ChatGPTAccount'
import { getIconUrl } from './utils/azureIconIds'
import { parseAIProposal, contextForAI, preserveCanvasImages, getPreservedImageNodeIds } from './shared/aiProposal'
import type { DiagramTemplate } from './shared/diagramTemplates'
import AIInsertPreviewDialog from './components/AIInsertPreviewDialog'
import { resolveAzureIcons } from './utils/azureIconRegistry'
import { getMessages, addMessage as addThreadMessage } from './utils/conversationStore'
import { sortParentsFirst, getAbsolutePosition, remapPastedNodes } from './utils/nesting'
import { arrangeSelectedNodes, getSelectionArrangementAvailability, type SelectionArrangeAction } from './utils/selectionArrangement'
import ShareStatus from './components/ShareStatus'
import LocalCopyDialog from './components/LocalCopyDialog'
import { useSharedFlow, type ApplyReason } from './hooks/useSharedFlow'
import { LOCAL_DRAFT_KEY, useLocalDraft } from './hooks/useLocalDraft'
import { prepareDraftBackup, type DraftBackup } from './utils/localDraftBackup'
import { useDiagramHistory } from './hooks/useDiagramHistory'
import { chartToFlow, changedNodeIds, flowToChart, contentFingerprint, type ChartContentShape } from './utils/sharedFlow'
import { parseSharedLocation } from './utils/shareApi'
import { isArchitectureChart, nextNumericNodeId, type Chart } from './shared/flowTypes'

const DiagramInsights = lazy(() => import('./components/DiagramInsights'))

export type EdgeStyle = 'default' | 'animated' | 'step'
export type HandlePosition = 'top' | 'right' | 'bottom' | 'left'
export type SidebarMode = 'none' | 'explorer'
export type DiagramMode = 'flowchart' | 'architecture'
export type ArchNodeType = 'service' | 'database' | 'queue' | 'cache' | 'apiGateway' | 'externalActor'
export type PaletteNodeType = 'step' | 'decision' | 'note' | ArchNodeType
export type EdgeProtocol = 'HTTPS' | 'gRPC' | 'REST' | 'SQL' | 'WebSocket' | 'event'
export type CommStyle = 'sync' | 'async'
export type ContainerKind = 'vpc' | 'cluster' | 'region' | 'zone' | 'trustBoundary' | 'group'

export const EDGE_PROTOCOLS: EdgeProtocol[] = ['HTTPS', 'gRPC', 'REST', 'SQL', 'WebSocket', 'event']

export const CONTAINER_KINDS: { value: ContainerKind; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'vpc', label: 'VPC' },
  { value: 'cluster', label: 'Cluster' },
  { value: 'region', label: 'Region' },
  { value: 'zone', label: 'Zone' },
  { value: 'trustBoundary', label: 'Trust boundary' },
]

const CONTAINER_DEFAULT_SIZE = { width: 420, height: 300 }

export interface FlowProposal {
  summary?: string
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}
export type ToolMode = 'select' | 'hand' | 'arrow'

export interface BaseFlowNode {
  id: string
  type: string
  label: string
  position: { x: number; y: number }
  width?: number
  height?: number
  imageUrl?: string
  icon?: string
  parentNode?: string
  containerKind?: string
}

export interface BaseFlowEdge {
  id?: string
  source: string
  target: string
  style?: EdgeStyle
  sourceHandle?: HandlePosition
  targetHandle?: HandlePosition
  label?: string
  protocol?: EdgeProtocol
  commStyle?: CommStyle
}

export interface BaseFlow {
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}

interface DiagramHistoryState {
  content: ChartContentShape
  diagramMode: DiagramMode
}
const diagramHistoryKey = (state: DiagramHistoryState) => `${state.diagramMode}:${contentFingerprint(state.content)}`

const ARCH_NODE_DIMENSIONS: Record<ArchNodeType, { width: number; height: number }> = {
  service: { width: 180, height: 90 },
  database: { width: 160, height: 110 },
  queue: { width: 200, height: 80 },
  cache: { width: 160, height: 90 },
  apiGateway: { width: 180, height: 100 },
  externalActor: { width: 150, height: 110 },
}

const DEFAULT_NODE_LABELS: Record<PaletteNodeType, string> = {
  step: 'Step',
  decision: 'Decision?',
  note: 'Note',
  service: 'Service',
  database: 'Database',
  queue: 'Queue',
  cache: 'Cache',
  apiGateway: 'API Gateway',
  externalActor: 'External Actor',
}

function FlowChartEditor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, zoomIn, zoomOut, setCenter, fitView, getViewport, setViewport } = useReactFlow()

  const getNodeDimensions = useCallback((nodeType?: string, style?: FlowNode['style']) => {
    const width = typeof style?.width === 'number' ? style.width : undefined
    const height = typeof style?.height === 'number' ? style.height : undefined

    if (width && height) {
      return { width, height }
    }

    if (nodeType === 'decision') {
      return { width: 160, height: 160 }
    }

    if (nodeType && nodeType in ARCH_NODE_DIMENSIONS) {
      return ARCH_NODE_DIMENSIONS[nodeType as ArchNodeType]
    }

    if (nodeType === 'container') {
      return { ...CONTAINER_DEFAULT_SIZE }
    }

    return { width: 180, height: 80 }
  }, [])

  const findAvailablePosition = useCallback((
    startPosition: { x: number; y: number },
    size: { width: number; height: number },
    occupiedNodes: FlowNode[]
  ) => {
    const step = 3
    let position = { ...startPosition }
    let attempts = 0

    const overlaps = (candidate: { x: number; y: number }) => {
      return occupiedNodes.some((node) => {
        // Containers are meant to enclose other nodes, not repel them
        if (node.type === 'container') return false
        const nodeSize = getNodeDimensions(node.type, node.style)
        const nodeAbs = getAbsolutePosition(node, occupiedNodes)
        const nodeBox = {
          left: nodeAbs.x,
          right: nodeAbs.x + nodeSize.width,
          top: nodeAbs.y,
          bottom: nodeAbs.y + nodeSize.height,
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

  const initialNodes: FlowNode[] = []

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

  // Reorder nodes callback
  const reorderNodes = useCallback((fromIndex: number, toIndex: number) => {
    setNodes((nds) => {
      const newNodes = [...nds]
      const [movedNode] = newNodes.splice(fromIndex, 1)
      newNodes.splice(toIndex, 0, movedNode)
      return newNodes
    })
  }, [setNodes])

  const [previewMode, setPreviewMode] = useState(false)
  const wasPreviewMode = useRef(false)
  const [nodeIdCounter, setNodeIdCounter] = useState(2)
  const [diagramMode, setDiagramMode] = useState<DiagramMode>('flowchart')
  const [defaultEdgeStyle, setDefaultEdgeStyle] = useState<EdgeStyle>('animated')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none')
  const showGrid = true
  const [toolMode, setToolMode] = useState<ToolMode>('select')
  const [clipboard, setClipboard] = useState<{ nodes: FlowNode[]; edges: Edge[] }>({ nodes: [], edges: [] })
  const [pasteCount, setPasteCount] = useState(0)
  const [darkMode, setDarkMode] = useState(true)
  const [isAIBubbleOpen, setIsAIBubbleOpen] = useState(false)
  const [activeAIProposal, setActiveAIProposal] = useState<{ proposal: FlowProposal; intent: ProposalIntent; baseline: string | null; threadId: string | null; requestId: number; source?: 'draft' } | null>(null)
  const aiProposal = activeAIProposal?.proposal ?? null
  const aiIntent = activeAIProposal?.intent ?? 'insert'
  const aiBaseline = activeAIProposal?.baseline ?? null
  const aiThreadId = activeAIProposal?.threadId ?? null
  const aiRequestSequence = useRef(0)
  const refinementAbort = useRef<AbortController | null>(null)
  const [aiApplyError, setAIApplyError] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [layoutBusy, setLayoutBusy] = useState(false)
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null)
  const layoutSequence = useRef(0)
  const canvasFingerprint = contentFingerprint(flowToChart(nodes, edges))
  const latestCanvasFingerprint = useRef(canvasFingerprint)
  latestCanvasFingerprint.current = canvasFingerprint
  const [premiumOpen, setPremiumOpen] = useState(() => ['success', 'cancelled'].includes(new URLSearchParams(window.location.search).get('premium') ?? ''))
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  // A shared link (/f/:id) opens a chart, so skip the empty-canvas welcome prompt.
  const [showWelcomeAI, setShowWelcomeAI] = useState(() => !parseSharedLocation(window.location))
  const [isRefining, setIsRefining] = useState(false)
  const [proposalPreview, setProposalPreview] = useState<{ nodes: FlowNode[]; edges: Edge[] } | null>(null)
  const [showMinimap, setShowMinimap] = useState(false)
  const draft = useLocalDraft({ nodes, edges, diagramMode, enabled: !parseSharedLocation(window.location) })
  const [localCopyReview, setLocalCopyReview] = useState<({ raw: string } & DraftBackup) | null>(null)
  const [localCopyError, setLocalCopyError] = useState<string | null>(null)
  const focusAfterLocalCopy = useRef(false)

  const installAIProposal = useCallback((proposal: FlowProposal, intent: ProposalIntent, baseline?: string, threadId?: string, source?: 'draft') => {
    refinementAbort.current?.abort()
    const requestId = ++aiRequestSequence.current
    setActiveAIProposal({ proposal, intent, baseline: baseline ?? null, threadId: threadId ?? null, requestId, source })
    setIsRefining(false)
    setAIApplyError(null)
  }, [])
  const clearAIProposal = useCallback(() => {
    refinementAbort.current?.abort()
    ++aiRequestSequence.current
    setActiveAIProposal(null)
    setIsRefining(false)
    setAIApplyError(null)
  }, [])
  useEffect(() => () => { refinementAbort.current?.abort(); ++aiRequestSequence.current }, [])
  useEffect(() => () => { ++layoutSequence.current }, [])

  const getEdgeStyleProps = useCallback((
    style: EdgeStyle,
    options?: { protocol?: EdgeProtocol; commStyle?: CommStyle },
  ) => {
    // Communication style, when set, decides solid (sync) vs dashed+animated (async);
    // otherwise the edge style keeps its existing dash behavior.
    const dashed = options?.commStyle ? options.commStyle === 'async' : style === 'animated'
    return {
      type: style === 'step' ? 'smoothstep' : 'default',
      animated: dashed,
      style: dashed
        ? { strokeDasharray: '5 5', stroke: darkMode ? '#78fcd6' : '#555' }
        : { stroke: darkMode ? '#78fcd6' : undefined },
      data: {
        onLabelChange: updateEdgeLabel,
        protocol: options?.protocol,
        commStyle: options?.commStyle,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: darkMode ? '#78fcd6' : '#555',
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
  }, [darkMode, updateEdgeLabel])

  const historySnapshot = useMemo(() => ({ content: flowToChart(nodes, edges), diagramMode }), [nodes, edges, diagramMode])
  const restoreHistory = useCallback((snapshot: DiagramHistoryState) => {
    const flow = chartToFlow(snapshot.content, { onLabelChange: updateNodeLabel, edgeProps: getEdgeStyleProps })
    setNodes(current => {
      const selectedIds = new Set(current.filter(node => node.selected).map(node => node.id))
      return flow.nodes.map(node => selectedIds.has(node.id) ? { ...node, selected: true } : node)
    })
    setEdges(flow.edges)
    setDiagramMode(snapshot.diagramMode)
    setNodeIdCounter((counter) => Math.max(counter, nextNumericNodeId(flow.nodes)))
  }, [updateNodeLabel, getEdgeStyleProps, setNodes, setEdges])
  const { capture: saveToHistory, undo, redo, canUndo, canRedo, reset: resetHistory } = useDiagramHistory({
    value: historySnapshot, fingerprint: diagramHistoryKey, onRestore: restoreHistory,
  })

  const changeDiagramMode = useCallback((mode: DiagramMode) => {
    if (mode === diagramMode) return
    saveToHistory()
    setDiagramMode(mode)
  }, [diagramMode, saveToHistory])

  const addImageNode = useCallback(
    (imageUrl: string, label: string) => {
      saveToHistory()
      setShowWelcomeAI(false)
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

      const newNode: FlowNode = {
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

      // Center on the new image node
      setCenter(
        adjustedPosition.x + size.width / 2,
        adjustedPosition.y + size.height / 2,
        { duration: 300, zoom: 1 }
      )
    },
    [nodeIdCounter, setNodes, updateNodeLabel, screenToFlowPosition, nodes, findAvailablePosition, setCenter, saveToHistory]
  )

  // Handle node changes (dragging, selection, etc.).
  // When a container is removed (e.g., via the Delete key), its children are
  // detached first so they survive at their absolute positions.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removedIds = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
      )
      if (removedIds.size) saveToHistory()
      setNodes((nds) => {
        const base = removedIds.size === 0
          ? nds
          : nds.map((n) =>
              n.parentNode && removedIds.has(n.parentNode) && !removedIds.has(n.id)
                ? { ...n, position: getAbsolutePosition(n, nds), parentNode: undefined, extent: undefined }
                : n
            )
        return applyNodeChanges(changes, base)
      })
    },
    [setNodes, saveToHistory]
  )

  // Handle edge changes
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some(change => change.type === 'remove')) saveToHistory()
      setEdges((eds) => applyEdgeChanges(changes, eds))
    },
    [setEdges, saveToHistory]
  )

  // Handle new connections. Architecture mode defaults to solid synchronous edges.
  const onConnect = useCallback(
    (connection: Connection) => {
      saveToHistory()
      const newEdge = {
        ...connection,
        ...(diagramMode === 'architecture'
          ? getEdgeStyleProps('default', { commStyle: 'sync' })
          : getEdgeStyleProps(defaultEdgeStyle)),
      }
      setEdges((eds) => addEdge(newEdge as Edge, eds))
    },
    [setEdges, defaultEdgeStyle, getEdgeStyleProps, diagramMode, saveToHistory]
  )

  // Handle edge reconnection
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      saveToHistory()
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els))
    },
    [setEdges, saveToHistory]
  )

  // Add a new node
  const addNode = useCallback(
    (type: PaletteNodeType) => {
      saveToHistory()
      setShowWelcomeAI(false)
      const size = getNodeDimensions(type)

      // Calculate center of the current viewport
      let position = { x: 200, y: 200 } // fallback
      if (reactFlowWrapper.current) {
        const rect = reactFlowWrapper.current.getBoundingClientRect()
        position = screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
        // Offset slightly so the node is centered (not top-left at center)
        position.x -= size.width / 2
        position.y -= size.height / 2
      }

      const adjustedPosition = findAvailablePosition(position, size, nodes)

      const newNode: FlowNode = {
        id: nodeIdCounter.toString(),
        type,
        position: adjustedPosition,
        data: {
          label: DEFAULT_NODE_LABELS[type],
          onLabelChange: updateNodeLabel,
        },
        style: {
          width: size.width,
          height: size.height
        },
      }
      setNodes((nds) => [...nds, newNode])
      setNodeIdCounter((id) => id + 1)

      // Center on the new node
      setCenter(
        adjustedPosition.x + size.width / 2,
        adjustedPosition.y + size.height / 2,
        { duration: 300, zoom: 1 }
      )
    },
    [nodeIdCounter, setNodes, updateNodeLabel, screenToFlowPosition, nodes, findAvailablePosition, getNodeDimensions, setCenter, saveToHistory]
  )

  // Add an empty container at the viewport center. Containers are prepended so
  // they render behind existing nodes and keep the parents-first ordering valid.
  const addContainer = useCallback(() => {
    saveToHistory()
    setShowWelcomeAI(false)
    const size = { ...CONTAINER_DEFAULT_SIZE }

    let position = { x: 200, y: 200 }
    if (reactFlowWrapper.current) {
      const rect = reactFlowWrapper.current.getBoundingClientRect()
      position = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
      position.x -= size.width / 2
      position.y -= size.height / 2
    }

    const newNode: FlowNode = {
      id: nodeIdCounter.toString(),
      type: 'container',
      position,
      data: {
        label: 'Container',
        containerKind: 'group',
        onLabelChange: updateNodeLabel,
      },
      style: { width: size.width, height: size.height },
    }
    setNodes((nds) => [newNode, ...nds])
    setNodeIdCounter((id) => id + 1)

    setCenter(
      position.x + size.width / 2,
      position.y + size.height / 2,
      { duration: 300, zoom: 1 }
    )
  }, [nodeIdCounter, setNodes, updateNodeLabel, screenToFlowPosition, setCenter, saveToHistory])

  // Wrap the selected nodes in a new container sized to their bounding box.
  // Positions are converted to parent-relative; nested selections keep their
  // existing parent when it is also selected.
  const wrapSelectionInContainer = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return
    saveToHistory()

    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    const toWrap = selectedNodes.filter((n) => !(n.parentNode && selectedIds.has(n.parentNode)))

    const PAD = 24
    const PAD_TOP = 48 // room for the container header
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of toWrap) {
      const abs = getAbsolutePosition(n, nodes)
      const dims = getNodeDimensions(n.type, n.style)
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + dims.width)
      maxY = Math.max(maxY, abs.y + dims.height)
    }

    const containerId = nodeIdCounter.toString()
    const containerPos = { x: minX - PAD, y: minY - PAD_TOP }
    const container: FlowNode = {
      id: containerId,
      type: 'container',
      position: containerPos,
      selected: true,
      data: {
        label: 'Container',
        containerKind: 'group',
        onLabelChange: updateNodeLabel,
      },
      style: {
        width: maxX - minX + PAD * 2,
        height: maxY - minY + PAD_TOP + PAD,
      },
    }

    setNodes((nds) => {
      const updated = nds.map((n) => {
        if (!selectedIds.has(n.id)) return n
        if (n.parentNode && selectedIds.has(n.parentNode)) {
          return { ...n, selected: false }
        }
        const abs = getAbsolutePosition(n, nds)
        return {
          ...n,
          parentNode: containerId,
          extent: 'parent' as const,
          position: { x: abs.x - containerPos.x, y: abs.y - containerPos.y },
          selected: false,
        }
      })
      return sortParentsFirst([container, ...updated])
    })
    setNodeIdCounter((id) => id + 1)
  }, [nodes, nodeIdCounter, getNodeDimensions, updateNodeLabel, setNodes, saveToHistory])

  // Detach selected nodes from their container, keeping them in place
  const detachSelection = useCallback(() => {
    saveToHistory()
    setNodes((nds) =>
      nds.map((n) =>
        n.selected && n.parentNode
          ? { ...n, position: getAbsolutePosition(n, nds), parentNode: undefined, extent: undefined }
          : n
      )
    )
  }, [setNodes, saveToHistory])

  // Change the kind of the selected container(s)
  const changeContainerKind = useCallback((kind: ContainerKind) => {
    saveToHistory()
    setNodes((nds) =>
      nds.map((n) =>
        n.selected && n.type === 'container'
          ? { ...n, data: { ...n.data, containerKind: kind } }
          : n
      )
    )
  }, [setNodes, saveToHistory])

  // Delete selected nodes and edges. Children of deleted containers are
  // detached (kept at absolute positions), not cascade-deleted.
  const deleteSelected = useCallback(() => {
    saveToHistory()
    const removedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id))
    setNodes((nds) => {
      return nds
        .map((n) =>
          n.parentNode && removedIds.has(n.parentNode) && !removedIds.has(n.id)
            ? { ...n, position: getAbsolutePosition(n, nds), parentNode: undefined, extent: undefined }
            : n
        )
        .filter((n) => !n.selected)
    })
    setEdges((eds) => eds.filter((edge) => !edge.selected && !removedIds.has(edge.source) && !removedIds.has(edge.target)))
  }, [nodes, setNodes, setEdges, saveToHistory])

  // Clear all nodes and edges
  const clearAll = useCallback(() => {
    draft.clearDraft()
    setNodes([])
    setEdges([])
    resetHistory({ content: { nodes: [], edges: [] }, diagramMode })
    clearAIProposal()
  }, [setNodes, setEdges, draft.clearDraft, resetHistory, diagramMode, clearAIProposal])

  // Get selected nodes and edges
  const getSelectedItems = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected)
    const selectedEdges = edges.filter((edge) => edge.selected)
    return { selectedNodes, selectedEdges }
  }, [nodes, edges])

  // Copy selected nodes and edges. Copying a container brings its descendants
  // along (with their internal edges); a copied child whose parent is NOT in
  // the copy set is flattened to its absolute position at copy time.
  const copySelection = useCallback(() => {
    const { selectedNodes, selectedEdges } = getSelectedItems()

    const copiedIds = new Set(selectedNodes.map((n) => n.id))
    let grew = true
    while (grew) {
      grew = false
      for (const n of nodes) {
        if (n.parentNode && copiedIds.has(n.parentNode) && !copiedIds.has(n.id)) {
          copiedIds.add(n.id)
          grew = true
        }
      }
    }

    const copiedNodes = nodes
      .filter((n) => copiedIds.has(n.id))
      .map((n) =>
        n.parentNode && !copiedIds.has(n.parentNode)
          ? { ...n, position: getAbsolutePosition(n, nodes), parentNode: undefined, extent: undefined }
          : n
      )

    // A copied container keeps connections among its contents even when a
    // user explicitly selected those children as well as their container.
    // Independent nodes still include only explicitly selected connections.
    const containerContentsIds = new Set(copiedNodes.filter(node => node.parentNode && copiedIds.has(node.parentNode)).map(node => node.id))
    const selectedEdgeIds = new Set(selectedEdges.map((e) => e.id))
    const internalEdges = edges.filter(
      (e) =>
        !selectedEdgeIds.has(e.id) &&
        copiedIds.has(e.source) &&
        copiedIds.has(e.target) &&
        (containerContentsIds.has(e.source) || containerContentsIds.has(e.target))
    )

    const copied = { nodes: sortParentsFirst(copiedNodes), edges: [...selectedEdges, ...internalEdges] }
    setClipboard(copied)
    setPasteCount(0)
    return copied
  }, [getSelectedItems, nodes, edges])

  // Paste nodes and edges from clipboard. Fresh ids come from counter
  // enumeration (never parsed out of existing ids, which may be non-numeric);
  // parentNode references are remapped and nesting is preserved.
  const pasteSelection = useCallback(() => {
    if (clipboard.nodes.length === 0) return
    saveToHistory()
    setShowWelcomeAI(false)

    const offset = 3
    const { nodes: remappedNodes, edges: pastedEdges, nextCounter } = remapPastedNodes(
      clipboard.nodes,
      clipboard.edges,
      nodeIdCounter
    )

    const occupiedNodes = [...nodes]
    const pastedNodes: FlowNode[] = remappedNodes.map((node) => {
      // Children keep their parent-relative position; they move with the parent
      if (node.parentNode) {
        return { ...node, data: { ...node.data, onLabelChange: updateNodeLabel } }
      }

      const desiredPosition = {
        x: node.position.x + offset,
        y: node.position.y + offset,
      }
      const size = getNodeDimensions(node.type, node.style)
      const adjustedPosition = findAvailablePosition(desiredPosition, size, occupiedNodes)

      const placed = {
        ...node,
        position: adjustedPosition,
        data: { ...node.data, onLabelChange: updateNodeLabel },
      }
      occupiedNodes.push(placed)
      return placed
    })

    setNodes((nds) => sortParentsFirst([...nds, ...pastedNodes]))
    setEdges((eds) => [...eds, ...pastedEdges])
    setNodeIdCounter(nextCounter)
    setPasteCount((count) => count + 1)

    // Center on the first pasted top-level node
    const firstNode = pastedNodes.find((n) => !n.parentNode) || pastedNodes[0]
    if (firstNode) {
      const size = getNodeDimensions(firstNode.type, firstNode.style)
      setCenter(
        firstNode.position.x + size.width / 2,
        firstNode.position.y + size.height / 2,
        { duration: 300, zoom: 1 }
      )
    }
  }, [clipboard, nodeIdCounter, setNodes, setEdges, updateNodeLabel, pasteCount, nodes, findAvailablePosition, getNodeDimensions, setCenter, saveToHistory])

  // Cut moves exactly the copied subtree. Delete alone keeps container children.
  const cutSelection = useCallback(() => {
    const copied = copySelection()
    if (!copied.nodes.length && !copied.edges.length) return
    saveToHistory()
    const removedIds = new Set(copied.nodes.map(node => node.id))
    setNodes(current => current.filter(node => !removedIds.has(node.id)))
    setEdges(current => current.filter(edge => !edge.selected && !removedIds.has(edge.source) && !removedIds.has(edge.target)))
  }, [copySelection, saveToHistory, setNodes, setEdges])

  useEffect(() => {
    // React Flow listens on document itself, so protect the canvas before its
    // Delete handler runs when focus is on a dialog heading or button.
    const protectModal = (event: KeyboardEvent) => {
      if (!['Delete', 'Backspace'].includes(event.key) || !document.querySelector('[aria-modal="true"]')) return
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea') || target.isContentEditable)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('keydown', protectModal, true)
    return () => document.removeEventListener('keydown', protectModal, true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewMode || proposalPreview) return
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        if (document.querySelector('[aria-modal="true"]')) return
        e.preventDefault()
        setCommandOpen((open) => !open)
        return
      }
      if (document.querySelector('[aria-modal="true"]')) return
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const isMod = e.ctrlKey || e.metaKey

      if (isMod && key === 'c') {
        e.preventDefault()
        copySelection()
      } else if (isMod && key === 'v') {
        e.preventDefault()
        pasteSelection()
      } else if (isMod && key === 'x') {
        e.preventDefault()
        cutSelection()
      } else if (isMod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (isMod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (key === 'v' && !isMod) {
        setToolMode('select')
      } else if (key === 'h' && !isMod) {
        setToolMode('hand')
      } else if (key === 'a' && !isMod) {
        setToolMode('arrow')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewMode, proposalPreview, copySelection, pasteSelection, cutSelection, undo, redo])

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

  useEffect(() => {
    if (wasPreviewMode.current && !previewMode) {
      document.querySelector<HTMLButtonElement>('[aria-label="Enter Preview Mode"]')?.focus({ preventScroll: true })
    }
    wasPreviewMode.current = previewMode
  }, [previewMode])

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
      // Change style for selected edges. Picking a style explicitly clears any
      // sync/async override (the user chose an appearance) but keeps the protocol.
      setEdges((eds) =>
        eds.map((edge) => {
          if (!edge.selected) return edge
          return {
            ...edge,
            ...getEdgeStyleProps(style, { protocol: edge.data?.protocol }),
          }
        })
      )
    } else {
      // Set default style for new edges
      setDefaultEdgeStyle(style)
    }
  }, [edges, setEdges, getEdgeStyleProps])

  // Set the protocol chip on selected edges (undefined clears it)
  const changeEdgeProtocol = useCallback((protocol?: EdgeProtocol) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (!edge.selected) return edge
        return {
          ...edge,
          ...getEdgeStyleProps(getEdgeStyleFromEdge(edge), {
            protocol,
            commStyle: edge.data?.commStyle,
          }),
        }
      })
    )
  }, [setEdges, getEdgeStyleProps, getEdgeStyleFromEdge])

  // Toggle sync/async rendering on selected edges (undefined clears the override)
  const changeEdgeCommStyle = useCallback((commStyle?: CommStyle) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (!edge.selected) return edge
        return {
          ...edge,
          ...getEdgeStyleProps(getEdgeStyleFromEdge(edge), {
            protocol: edge.data?.protocol,
            commStyle,
          }),
        }
      })
    )
  }, [setEdges, getEdgeStyleProps, getEdgeStyleFromEdge])

  // Toggle Explorer sidebar
  const toggleExplorer = useCallback(() => {
    setSidebarMode((prev) => (prev === 'explorer' ? 'none' : 'explorer'))
  }, [])

  // Toggle AI Bubble
  const toggleAI = useCallback(() => {
    setShowWelcomeAI(false)
    setIsAIBubbleOpen((prev) => !prev)
  }, [])

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev)
  }, [])

  // Custom fit view that accounts for the floating toolbar at the top
  const handleFitView = useCallback(() => {
    // Fit view instantly (no animation) to calculate correct viewport
    fitView({ padding: 0.2, maxZoom: 1.2, duration: 0 })
    // Then shift viewport down to account for toolbar and animate smoothly
    requestAnimationFrame(() => {
      const vp = getViewport()
      setViewport(
        { x: vp.x, y: vp.y + 35, zoom: vp.zoom },
        { duration: 500 }
      )
    })
  }, [fitView, getViewport, setViewport])

  // Handle AI proposal ready - open preview dialog
  const handleAIProposalReady = useCallback((proposal: FlowProposal, threadId?: string, intent: ProposalIntent = 'insert', baseline?: string) => {
    installAIProposal(proposal, intent, baseline, threadId)
  }, [installAIProposal])

  // Insert AI proposal into canvas (insert-as-new algorithm)
  const insertAIProposal = useCallback(() => {
    if (!aiProposal) return
    saveToHistory()

    // 1. Generate unique IDs for the new nodes
    const idMap = new Map<string, string>()
    let currentCounter = Math.max(nodeIdCounter, nextNumericNodeId(nodes))

    aiProposal.nodes.forEach((node) => {
      const newId = currentCounter.toString()
      idMap.set(node.id, newId)
      currentCounter++
    })

    // 2. Calculate bounding box of proposal nodes
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    aiProposal.nodes.forEach((node) => {
      const width = node.width || (node.type === 'decision' ? 160 : 180)
      const height = node.height || (node.type === 'decision' ? 160 : 80)
      const abs = getAbsolutePosition(node, aiProposal.nodes)

      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + width)
      maxY = Math.max(maxY, abs.y + height)
    })

    // 3. Calculate centroid of proposal
    const proposalCenterX = (minX + maxX) / 2
    const proposalCenterY = (minY + maxY) / 2

    // 4. Get viewport center position
    let targetPosition = { x: 400, y: 300 }
    if (reactFlowWrapper.current) {
      const rect = reactFlowWrapper.current.getBoundingClientRect()
      targetPosition = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    }

    // 5. Calculate offset to move proposal to viewport center
    const offsetX = targetPosition.x - proposalCenterX
    const offsetY = targetPosition.y - proposalCenterY

    // 6. Create new nodes with remapped IDs and offset positions.
    // Children of containers keep parent-relative positions (only top-level
    // nodes are offset); parentNode references are remapped.
    const newNodes: FlowNode[] = aiProposal.nodes.map((node) => {
      const newId = idMap.get(node.id)!
      const newParent = node.parentNode ? idMap.get(node.parentNode) : undefined
      return {
        id: newId,
        type: node.type,
        position: newParent
          ? node.position
          : {
              x: node.position.x + offsetX,
              y: node.position.y + offsetY,
            },
        parentNode: newParent,
        extent: newParent ? ('parent' as const) : undefined,
        data: {
          label: node.label,
          imageUrl: node.icon ? getIconUrl(node.icon) : node.imageUrl,
          icon: node.icon,
          containerKind: node.containerKind,
          onLabelChange: updateNodeLabel,
        },
        style: node.width || node.height ? { width: node.width, height: node.height } : undefined,
      }
    })

    // 7. Create new edges with remapped IDs and default handles
    const newEdges: Edge[] = aiProposal.edges.map((edge, index) => {
      const newSource = idMap.get(edge.source)!
      const newTarget = idMap.get(edge.target)!
      
      // Add default handles if not specified (bottom-to-top for vertical flows)
      const sourceHandle = edge.sourceHandle || 'bottom'
      const targetHandle = edge.targetHandle || 'top'
      
      return {
        id: `ai-edge-${newSource}-${newTarget}-${index}`,
        source: newSource,
        target: newTarget,
        sourceHandle,
        targetHandle,
        label: edge.label,
        ...getEdgeStyleProps(edge.style || 'animated', { protocol: edge.protocol, commStyle: edge.commStyle }),
      }
    })

    // 8. Add nodes and edges to existing state (parents before children)
    setNodes((nds) => sortParentsFirst([...nds, ...newNodes]))
    setEdges((eds) => [...eds, ...newEdges])
    setNodeIdCounter(currentCounter)
    setDiagramMode(isArchitectureChart([...flowToChart(nodes, []).nodes, ...aiProposal.nodes]) ? 'architecture' : 'flowchart')

    // 9. Close preview dialog
    clearAIProposal()
  }, [aiProposal, nodes, nodeIdCounter, reactFlowWrapper, screenToFlowPosition, updateNodeLabel, getEdgeStyleProps, setNodes, setEdges, clearAIProposal, saveToHistory])

  // Cancel AI proposal
  const cancelAIProposal = useCallback(() => {
    clearAIProposal()
    setAIApplyError(null)
  }, [clearAIProposal])

  // Dismiss welcome AI prompt
  const dismissWelcomeAI = useCallback(() => {
    setShowWelcomeAI(false)
  }, [])

  // Refine AI proposal via chat sidebar
  const handleRefineProposal = useCallback(async (instruction: string): Promise<string | undefined> => {
    if (!activeAIProposal || !aiProposal || isRefining) return undefined
    refinementAbort.current?.abort()
    const requestId = ++aiRequestSequence.current
    const controller = new AbortController()
    refinementAbort.current = controller
    setActiveAIProposal((current) => current ? { ...current, requestId } : current)
    setIsRefining(true)
    try {
      // Build messages: use thread history if available, otherwise single message
      let messages: { role: string; content: string }[]
      if (aiThreadId) {
        messages = [...getMessages(aiThreadId).filter(message => message.role !== 'system'), { role: 'user', content: instruction }].slice(-20)
      } else {
        messages = [{ role: 'user', content: instruction }]
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          mode: 'refine',
          flowContext: contextForAI(aiProposal),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API request failed with status ${response.status}`)
      }

      const data = await response.json()
      if (controller.signal.aborted || requestId !== aiRequestSequence.current) return undefined
      const content = data.message || ''

      const refinedProposal = resolveAzureIcons(preserveCanvasImages(parseAIProposal(content, data.finishReason, aiIntent === 'edit', { preservedImageNodeIds: getPreservedImageNodeIds(aiProposal.nodes) }), aiProposal.nodes), { intent: aiIntent })
      setActiveAIProposal((current) => current?.requestId === requestId ? { ...current, proposal: refinedProposal } : current)
      if (aiThreadId) {
        addThreadMessage(aiThreadId, { role: 'user', content: instruction })
        addThreadMessage(aiThreadId, { role: 'assistant', content: refinedProposal.summary || 'Refined diagram' })
      }
      return refinedProposal.summary
    } catch (err) {
      if (controller.signal.aborted || requestId !== aiRequestSequence.current) return undefined
      throw err instanceof Error ? err : new Error('The refinement could not finish. Please try again.')
    } finally {
      if (requestId === aiRequestSequence.current) setIsRefining(false)
    }
    return undefined
  }, [activeAIProposal, aiProposal, aiThreadId, aiIntent, isRefining])

  // Preview proposal in presentation mode
  const handlePreviewProposal = useCallback(() => {
    if (!aiProposal) return

    const previewNodes: FlowNode[] = sortParentsFirst(aiProposal.nodes).map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      parentNode: node.parentNode,
      extent: node.parentNode ? ('parent' as const) : undefined,
      data: {
        label: node.label,
        imageUrl: node.icon ? getIconUrl(node.icon) : node.imageUrl,
        icon: node.icon,
        containerKind: node.containerKind,
        onLabelChange: () => {},
      },
      style: node.width || node.height ? { width: node.width, height: node.height } : undefined,
    }))

    const previewEdges: Edge[] = aiProposal.edges.map((edge, index) => ({
      id: edge.id || `ai-edge-${index}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'bottom',
      targetHandle: edge.targetHandle || 'top',
      label: edge.label,
      ...getEdgeStyleProps(edge.style || 'default', { protocol: edge.protocol, commStyle: edge.commStyle }),
    }))

    setProposalPreview({ nodes: previewNodes, edges: previewEdges })
  }, [aiProposal, getEdgeStyleProps])

  useEffect(() => {
    document.body.className = darkMode ? 'dark-mode' : 'light-mode'
  }, [darkMode])

  const applyBaseFlow = useCallback((flow: BaseFlow) => {
    const nodesWithCallbacks: FlowNode[] = sortParentsFirst(flow.nodes).map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      parentNode: node.parentNode,
      extent: node.parentNode ? ('parent' as const) : undefined,
      data: {
        label: node.label,
        imageUrl: node.icon ? getIconUrl(node.icon) : node.imageUrl,
        icon: node.icon,
        containerKind: node.containerKind,
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
      ...getEdgeStyleProps(edge.style || 'default', { protocol: edge.protocol, commStyle: edge.commStyle }),
    }))

    setNodes(nodesWithCallbacks)
    setEdges(newEdges)
  }, [getEdgeStyleProps, setEdges, setNodes, updateNodeLabel])

  // Shared charts (/f/:id): render stored charts with the same node data and
  // edge styling as hand-made ones, and apply live updates from agents.
  const remoteHighlightTimer = useRef<number>()
  const fitAfterLoadRef = useRef(false)
  const nodesInitialized = useNodesInitialized()
  const { getNodes: getRenderedNodes } = useReactFlow()

  // Fit a loaded chart into the band between the toolbar and the AI pill.
  const fitSharedChart = useCallback(() => {
    const wrapper = reactFlowWrapper.current
    const rendered = getRenderedNodes()
    if (!wrapper || rendered.length === 0) return
    const { width, height } = wrapper.getBoundingClientRect()
    const top = 128
    const bottom = 96
    const side = 48
    const [x, y, zoom] = getTransformForBounds(
      getRectOfNodes(rendered),
      Math.max(200, width - side * 2),
      Math.max(200, height - top - bottom),
      0.1,
      1.2,
      0.04,
    )
    setViewport({ x: x + side, y: y + top, zoom }, { duration: 400 })
  }, [getRenderedNodes, setViewport])

  useEffect(() => {
    // Fit once the loaded nodes have been measured, so nothing ends up off-screen.
    if (!nodesInitialized || !fitAfterLoadRef.current) return
    fitAfterLoadRef.current = false
    fitSharedChart()
  }, [nodesInitialized, fitSharedChart])

  const applySharedChart = useCallback((chart: Chart, reason: ApplyReason) => {
    const flow = chartToFlow(chart, { onLabelChange: updateNodeLabel, edgeProps: getEdgeStyleProps })
    setNodeIdCounter((counter) => Math.max(counter, nextNumericNodeId(flow.nodes)))

    if (reason === 'initial') {
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setShowWelcomeAI(false)
      setDiagramMode(isArchitectureChart(chart.nodes) ? 'architecture' : 'flowchart')
      // Undo should not step back to the empty canvas that existed before loading.
      resetHistory({ content: { nodes: chart.nodes, edges: chart.edges }, diagramMode: isArchitectureChart(chart.nodes) ? 'architecture' : 'flowchart' })
      fitAfterLoadRef.current = true
      return
    }

    // Live update: keep the selection and briefly highlight what changed.
    // If the agent added nodes outside the visible area, bring them into view.
    const wrapper = reactFlowWrapper.current
    const viewport = getViewport()
    const isOffscreen = (node: FlowNode) => {
      if (!wrapper) return false
      const { width, height } = wrapper.getBoundingClientRect()
      const abs = getAbsolutePosition(node, flow.nodes)
      const w = typeof node.style?.width === 'number' ? node.style.width : 180
      const h = typeof node.style?.height === 'number' ? node.style.height : 80
      const left = -viewport.x / viewport.zoom
      const top = -viewport.y / viewport.zoom
      return abs.x < left || abs.y < top || abs.x + w > left + width / viewport.zoom || abs.y + h > top + height / viewport.zoom
    }
    setNodes((current) => {
      const previousIds = new Set(current.map((n) => n.id))
      if (current.length === 0 || flow.nodes.some((n) => !previousIds.has(n.id) && isOffscreen(n))) {
        fitAfterLoadRef.current = true
      }
      const changed = changedNodeIds(flowToChart(current, []), chart)
      const selected = new Set(current.filter((n) => n.selected).map((n) => n.id))
      return flow.nodes.map((n) => ({
        ...n,
        selected: selected.has(n.id),
        className: changed.has(n.id) ? 'flow-remote-change' : undefined,
      }))
    })
    // Fallback in case the new nodes were measured before the effect above noticed.
    window.setTimeout(() => {
      if (!fitAfterLoadRef.current) return
      fitAfterLoadRef.current = false
      fitSharedChart()
    }, 300)
    setEdges((current) => {
      const selected = new Set(current.filter((e) => e.selected).map((e) => e.id))
      return flow.edges.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e))
    })
    window.clearTimeout(remoteHighlightTimer.current)
    remoteHighlightTimer.current = window.setTimeout(() => {
      setNodes((nds) => nds.map((n) => (n.className === 'flow-remote-change' ? { ...n, className: undefined } : n)))
    }, 3400)
  }, [updateNodeLabel, getEdgeStyleProps, setNodes, setEdges, getViewport, fitSharedChart, resetHistory])

  const shared = useSharedFlow({ nodes, edges, applyChart: applySharedChart })

  const makeLocalCopy = useCallback((approvedRaw?: string) => {
    if (!shared.state.id || shared.state.canEdit || shared.state.version === 0) return
    let raw: string | null
    try { raw = window.localStorage.getItem(LOCAL_DRAFT_KEY) }
    catch { setLocalCopyError('Your saved browser draft could not be checked. Nothing has been replaced. Try again when browser storage is available.'); return }
    if (raw !== null && approvedRaw !== raw) {
      setLocalCopyReview({ raw, ...prepareDraftBackup(raw) })
      setLocalCopyError(approvedRaw === undefined ? null : 'The saved draft changed while you were reviewing it. Review this backup before replacing it.')
      return
    }
    // Only the exact reviewed backup can be removed. Re-read above also catches
    // a new draft written by another tab while the confirmation was open.
    if (raw !== null) {
      try { window.localStorage.removeItem(LOCAL_DRAFT_KEY) }
      catch { setLocalCopyError('The existing backup could not be replaced. Your shared canvas and saved draft are unchanged.'); return }
    }
    if (!shared.detachToLocal()) {
      if (raw !== null) {
        try { if (window.localStorage.getItem(LOCAL_DRAFT_KEY) === null) window.localStorage.setItem(LOCAL_DRAFT_KEY, raw) }
        catch { setLocalCopyError('This chart could not be copied. The reviewed backup is still available to download from this dialog.'); return }
      }
      setLocalCopyError('This chart is not ready to become a local copy. Nothing on the canvas has changed.')
      return
    }
    focusAfterLocalCopy.current = true
    setLocalCopyReview(null)
    setLocalCopyError(null)
    setShowWelcomeAI(false)
    setLayoutNotice('Editing a local copy. Changes are not saved to the original shared chart.')
  }, [shared.state.id, shared.state.canEdit, shared.state.version, shared.detachToLocal])

  const downloadPreviousDraft = useCallback(() => {
    if (!localCopyReview) return
    let url: string | undefined
    let anchor: HTMLAnchorElement | undefined
    try {
      url = URL.createObjectURL(new Blob([localCopyReview.content], { type: localCopyReview.portable ? 'application/json' : 'text/plain' }))
      anchor = document.createElement('a')
      anchor.href = url
      anchor.download = localCopyReview.filename
      document.body.appendChild(anchor)
      anchor.click()
    } catch { setLocalCopyError('The backup could not be downloaded. The saved draft is still unchanged.') }
    finally {
      anchor?.remove()
      if (url) {
        const revoke = URL.revokeObjectURL.bind(URL)
        window.setTimeout(() => revoke(url!), 1000)
      }
    }
  }, [localCopyReview])

  useEffect(() => {
    if (!shared.state.id && focusAfterLocalCopy.current) {
      focusAfterLocalCopy.current = false
      document.querySelector<HTMLButtonElement>('[aria-label="Find nodes and actions"]')?.focus()
    }
  }, [shared.state.id])

  const importDiagram = useCallback((importedNodes: FlowNode[], importedEdges: Edge[], importedMode?: DiagramMode) => {
    saveToHistory()
    const content = flowToChart(importedNodes, importedEdges)
    const hydrated = chartToFlow(content, { onLabelChange: updateNodeLabel, edgeProps: getEdgeStyleProps })
    setNodes(hydrated.nodes)
    setEdges(hydrated.edges)
    setNodeIdCounter((counter) => Math.max(counter, nextNumericNodeId(hydrated.nodes)))
    setDiagramMode(importedMode ?? (isArchitectureChart(content.nodes) ? 'architecture' : 'flowchart'))
    setShowWelcomeAI(false)
    clearAIProposal()
    fitAfterLoadRef.current = true
  }, [saveToHistory, updateNodeLabel, getEdgeStyleProps, setNodes, setEdges, clearAIProposal])

  const focusNode = useCallback((id: string) => {
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === id })))
    const position = getAbsolutePosition(node, nodes)
    const size = getNodeDimensions(node.type, node.style)
    setCenter(position.x + size.width / 2, position.y + size.height / 2, { zoom: 1, duration: 350 })
  }, [nodes, setNodes, getNodeDimensions, setCenter])

  const autoLayout = useCallback(async (direction: 'TB' | 'LR') => {
    if (!nodes.length || layoutBusy) return
    if (shared.state.id && !shared.state.canEdit) {
      setLayoutNotice('Make an editable copy or open the private edit link to rearrange this diagram.')
      return
    }
    const before = flowToChart(nodes, edges)
    const baseline = contentFingerprint(before)
    const requestId = ++layoutSequence.current
    setLayoutBusy(true)
    setLayoutNotice(null)
    try {
      const { arrangeChart } = await import('./shared/layout')
      const arranged = await arrangeChart(before.nodes, before.edges, { direction, relayout: true })
      if (requestId !== layoutSequence.current) return
      if (baseline !== latestCanvasFingerprint.current) {
        setLayoutNotice('Your diagram changed while arranging it. Try again with the latest canvas.')
        return
      }
      saveToHistory()
      applyBaseFlow(arranged)
      fitAfterLoadRef.current = true
      window.setTimeout(() => { if (requestId === layoutSequence.current) fitSharedChart() }, 100)
      setLayoutNotice('Diagram arranged. You can undo this change.')
    } catch {
      if (requestId === layoutSequence.current) setLayoutNotice('This diagram could not be arranged. Your canvas is unchanged.')
    } finally {
      if (requestId === layoutSequence.current) setLayoutBusy(false)
    }
  }, [nodes, edges, layoutBusy, shared.state.id, shared.state.canEdit, saveToHistory, applyBaseFlow, fitSharedChart])

  const arrangementAvailability = useMemo(() => {
    if (shared.state.id && !shared.state.canEdit) {
      const unavailable = { enabled: false, reason: 'Make an editable copy or open the private edit link to arrange nodes.' }
      return { align: unavailable, horizontal: unavailable, vertical: unavailable }
    }
    return getSelectionArrangementAvailability(nodes, { getNodeDimensions: node => getNodeDimensions(node.type, node.style) })
  }, [nodes, getNodeDimensions, shared.state.id, shared.state.canEdit])

  const arrangeSelection = useCallback((action: SelectionArrangeAction) => {
    if (shared.state.id && !shared.state.canEdit) {
      setLayoutNotice('Make an editable copy or open the private edit link to arrange nodes.')
      return
    }
    const result = arrangeSelectedNodes(nodes, action, { getNodeDimensions: node => getNodeDimensions(node.type, node.style) })
    if (result.error) { setLayoutNotice(result.error); return }
    if (!result.changed) { setLayoutNotice('Your selection is already arranged this way.'); return }
    saveToHistory()
    setNodes(result.nodes)
    setLayoutNotice(action.startsWith('align-') ? 'Selection aligned. You can undo this change.' : 'Selection spaced evenly. You can undo this change.')
  }, [nodes, getNodeDimensions, shared.state.id, shared.state.canEdit, saveToHistory, setNodes])

  const applyAIChanges = useCallback(() => {
    if (!aiProposal) return
    if (shared.state.id && !shared.state.canEdit) {
      setAIApplyError('Make an editable copy or open the private edit link to apply changes.')
      return
    }
    if (!aiBaseline || aiBaseline !== contentFingerprint(flowToChart(nodes, edges))) {
      setAIApplyError('Your canvas changed after this request. Cancel this proposal and ask again using the latest diagram.')
      return
    }
    saveToHistory()
    applyBaseFlow(aiProposal)
    setNodeIdCounter((counter) => Math.max(counter, nextNumericNodeId(aiProposal.nodes)))
    const restored = activeAIProposal?.source === 'draft' ? draft.restoreDraft() : null
    setDiagramMode(restored?.diagramMode ?? (isArchitectureChart(aiProposal.nodes) ? 'architecture' : 'flowchart'))
    clearAIProposal()
    setAIApplyError(null)
    setShowWelcomeAI(false)
  }, [aiProposal, aiBaseline, activeAIProposal?.source, draft.restoreDraft, shared.state.id, shared.state.canEdit, nodes, edges, saveToHistory, applyBaseFlow, clearAIProposal])

  const previewSavedDraft = useCallback(() => {
    if (!draft.recovery) return
    installAIProposal({ summary: 'Saved browser draft', nodes: draft.recovery.flow.nodes, edges: draft.recovery.flow.edges }, 'edit', contentFingerprint(flowToChart(nodes, edges)), undefined, 'draft')
  }, [draft.recovery, installAIProposal, nodes, edges])

  const selectTemplate = useCallback(async (template: DiagramTemplate) => {
    const requestId = ++aiRequestSequence.current
    refinementAbort.current?.abort()
    setIsRefining(false)
    setTemplateLoading(true)
    setTemplateError(null)
    try {
      const [layout, schema] = await Promise.all([import('./shared/layout'), import('./shared/flowSchema')])
      const arranged = await layout.arrangeChart(
        template.nodes.map(schema.nodeFromInput),
        template.edges.map((edge, index) => ({ ...schema.edgeFromInput(edge), id: edge.id ?? `template-edge-${index}` })),
        { direction: template.direction },
      )
      if (requestId !== aiRequestSequence.current) return
      installAIProposal({ summary: template.title, nodes: arranged.nodes, edges: arranged.edges }, 'insert')
      setShowWelcomeAI(false)
    } catch {
      setTemplateError('This template could not be arranged. Please try another one.')
    } finally { setTemplateLoading(false) }
  }, [installAIProposal])

  const editChangeSummary = useMemo(() => {
    if (!aiProposal || aiIntent !== 'edit') return undefined
    const old = new Set(nodes.map((node) => node.id))
    const next = new Set(aiProposal.nodes.map((node) => node.id))
    const added = aiProposal.nodes.filter((node) => !old.has(node.id)).length
    const removed = nodes.filter((node) => !next.has(node.id)).length
    return `Apply to the current diagram · ${added} nodes added · ${removed} removed. You can undo after applying.`
  }, [aiProposal, aiIntent, nodes])

  // Compute canvas pan boundaries so the minimap stays locked to the node area.
  // Padding scales with content size but stays tight so you can't pan into empty space.
  const translateExtent = useMemo((): [[number, number], [number, number]] => {
    if (nodes.length === 0) {
      return [[-500, -500], [500, 500]]
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of nodes) {
      const w = typeof node.style?.width === 'number' ? node.style.width : (node.type === 'decision' ? 160 : 180)
      const h = typeof node.style?.height === 'number' ? node.style.height : (node.type === 'decision' ? 160 : 80)
      const abs = getAbsolutePosition(node, nodes)
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }

    // Padding = half the content span, clamped between 300–600px
    const contentW = maxX - minX
    const contentH = maxY - minY
    const padding = Math.max(300, Math.min(600, Math.min(contentW, contentH) * 0.5))
    return [[minX - padding, minY - padding], [maxX + padding, maxY + padding]]
  }, [nodes])

  // Show the minimap only when nodes overflow the visible viewport
  const updateMinimapVisibility = useCallback(() => {
    if (nodes.length === 0) {
      setShowMinimap(false)
      return
    }

    const wrapper = reactFlowWrapper.current
    if (!wrapper) { setShowMinimap(false); return }

    const { zoom } = getViewport()
    const rect = wrapper.getBoundingClientRect()
    const visibleW = rect.width / zoom
    const visibleH = rect.height / zoom

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of nodes) {
      const w = typeof node.style?.width === 'number' ? node.style.width : (node.type === 'decision' ? 160 : 180)
      const h = typeof node.style?.height === 'number' ? node.style.height : (node.type === 'decision' ? 160 : 80)
      const abs = getAbsolutePosition(node, nodes)
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }

    const contentW = maxX - minX
    const contentH = maxY - minY

    // Show when content exceeds 70% of the visible area in either dimension
    setShowMinimap(contentW > visibleW * 0.7 || contentH > visibleH * 0.7)
  }, [nodes, getViewport])

  // Recheck visibility whenever nodes change
  useEffect(() => {
    updateMinimapVisibility()
  }, [updateMinimapVisibility])

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

  // Preview proposal in presentation mode (returns to proposal dialog on exit)
  if (proposalPreview) {
    return (
      <PreviewMode
        nodes={proposalPreview.nodes}
        edges={proposalPreview.edges}
        darkMode={darkMode}
        onExit={() => setProposalPreview(null)}
      />
    )
  }

  return (
    <div className={`app ${darkMode ? 'dark-mode' : 'light-mode'}`}>
      <div className="workspace-brand"><span aria-hidden="true">✦</span><div><strong>Flowchart</strong><small>Ideas, in their element.</small></div></div>
      <div className="workspace-status"><span role="status">{layoutBusy ? 'Arranging your diagram…' : templateLoading ? 'Arranging your template…' : layoutNotice ?? templateError ?? `${nodes.length} nodes · ${edges.length} connections`}</span><button className="workspace-search" onClick={() => setCommandOpen(true)} aria-label="Find nodes and actions" title="Find nodes and actions (⌘/Ctrl K)">⌕ <span>Find</span></button><button className="workspace-premium" onClick={() => setPremiumOpen(true)}>✧ Image studio</button><ChatGPTAccount /></div>
      <Toolbar
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenChat={() => setIsAIBubbleOpen(true)}
        onAddNode={addNode}
        onAddContainer={addContainer}
        onAddImage={addImageNode}
        onTogglePreview={togglePreview}
        onToggleExplorer={toggleExplorer}
        sidebarMode={sidebarMode}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onClearAll={clearAll}
        toolMode={toolMode}
        onSetToolMode={setToolMode}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        diagramMode={diagramMode}
        onSetDiagramMode={changeDiagramMode}
        reactFlowWrapper={reactFlowWrapper}
        nodes={nodes}
        edges={edges}
        onImportJson={importDiagram}
        share={{
          isShared: !!shared.state.id,
          canEdit: shared.state.canEdit,
          viewUrl: shared.viewUrl,
          editUrl: shared.editUrl,
          creating: shared.state.creating,
          createError: shared.state.createError,
          onCreate: shared.createShare,
        }}
      />
      <ShareStatus shared={shared} onMakeLocalCopy={() => makeLocalCopy()} copyError={localCopyReview ? null : localCopyError} />
      {localCopyReview && <LocalCopyDialog draft={localCopyReview.draft} portableBackup={localCopyReview.portable} nodeCount={nodes.length} edgeCount={edges.length} error={localCopyError} onCancel={() => { setLocalCopyReview(null); setLocalCopyError(null) }} onDownload={downloadPreviousDraft} onConfirm={() => makeLocalCopy(localCopyReview.raw)} />}
      {draft.recovery && <aside className="draft-recovery" aria-label="Saved diagram recovery"><div><strong>A thought is waiting for you.</strong><p>{draft.recovery.flow.nodes.length} saved nodes · {new Date(draft.recovery.savedAt).toLocaleString()}</p></div><button onClick={previewSavedDraft}>Preview saved draft</button><button className="draft-discard" onClick={draft.discardDraft}>Discard</button></aside>}
      {draft.error && <aside className="draft-recovery draft-error" role="alert"><p>{draft.error}</p></aside>}
      <div ref={reactFlowWrapper} className="react-flow-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onNodeDragStart={saveToHistory}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.2, duration: 600, maxZoom: 1.2 }}
          deleteKeyCode="Delete"
          snapToGrid={showGrid}
          snapGrid={[15, 15]}
          minZoom={0.1}
          maxZoom={2}
          translateExtent={translateExtent}
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
          onMoveEnd={updateMinimapVisibility}
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
          <Controls onFitView={handleFitView} />
          {showMinimap && (
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
          )}
        </ReactFlow>
      </div>
      {(() => {
        const { selectedNodes, selectedEdges } = getSelectedItems()
        const totalSelected = selectedNodes.length + selectedEdges.length
        if (totalSelected > 0) {
          return (
            <div className="selection-toolbar">
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
              {diagramMode === 'architecture' && selectedEdges.length > 0 && (() => {
                const firstProtocol = selectedEdges[0]?.data?.protocol
                const protocolValue = selectedEdges.every((e) => e.data?.protocol === firstProtocol)
                  ? (firstProtocol ?? '')
                  : ''
                const firstComm = selectedEdges[0]?.data?.commStyle
                const commValue = selectedEdges.every((e) => e.data?.commStyle === firstComm)
                  ? firstComm
                  : undefined
                return (
                  <div className="edge-protocol-controls">
                    <select
                      className="edge-protocol-select"
                      value={protocolValue}
                      onChange={(e) => changeEdgeProtocol((e.target.value || undefined) as EdgeProtocol | undefined)}
                      title="Edge protocol"
                      aria-label="Edge protocol"
                    >
                      <option value="">No protocol</option>
                      {EDGE_PROTOCOLS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <div className="edge-comm-toggle" role="group" aria-label="Edge communication style">
                      <button
                        className={`edge-comm-option ${commValue === 'sync' ? 'active' : ''}`}
                        onClick={() => changeEdgeCommStyle(commValue === 'sync' ? undefined : 'sync')}
                        title="Synchronous call (solid line)"
                        aria-label="Set edge to synchronous"
                        aria-pressed={commValue === 'sync'}
                      >
                        Sync
                      </button>
                      <button
                        className={`edge-comm-option ${commValue === 'async' ? 'active' : ''}`}
                        onClick={() => changeEdgeCommStyle(commValue === 'async' ? undefined : 'async')}
                        title="Asynchronous message (dashed line)"
                        aria-label="Set edge to asynchronous"
                        aria-pressed={commValue === 'async'}
                      >
                        Async
                      </button>
                    </div>
                  </div>
                )
              })()}
              {diagramMode === 'architecture' && selectedNodes.length > 0 && (() => {
                const selectedContainers = selectedNodes.filter((n) => n.type === 'container')
                const firstKind = selectedContainers[0]?.data?.containerKind || 'group'
                const kindValue = selectedContainers.every((n) => (n.data?.containerKind || 'group') === firstKind)
                  ? firstKind
                  : 'group'
                const anyHasParent = selectedNodes.some((n) => n.parentNode)
                return (
                  <div className="container-controls">
                    {selectedContainers.length > 0 && (
                      <select
                        className="edge-protocol-select"
                        value={kindValue}
                        onChange={(e) => changeContainerKind(e.target.value as ContainerKind)}
                        title="Container kind"
                        aria-label="Container kind"
                      >
                        {CONTAINER_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>{k.label}</option>
                        ))}
                      </select>
                    )}
                    <button
                      className="selection-toolbar-button"
                      onClick={wrapSelectionInContainer}
                      title="Wrap selection in container"
                      aria-label="Wrap selection in container"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <rect x="1.5" y="1.5" width="13" height="13" rx="2" strokeDasharray="3 2" />
                        <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
                      </svg>
                    </button>
                    {anyHasParent && (
                      <button
                        className="selection-toolbar-button"
                        onClick={detachSelection}
                        title="Detach from container"
                        aria-label="Detach from container"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="1.5" y="6.5" width="8" height="8" rx="1.5" strokeDasharray="3 2" />
                          <path d="M9 7l5-5" />
                          <path d="M10.5 2H14v3.5" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })()}
              <div className="selection-toolbar-actions">
                <button
                  className="selection-toolbar-button delete"
                  onClick={deleteSelected}
                  title="Delete selected items"
                  aria-label="Delete selected items"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5 3V2h6v1h4v1H1V3h4zM3 5h10l-.5 9H3.5L3 5zm3 1v6h1V6H6zm3 0v6h1V6H9z" />
                  </svg>
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
                </button>
              </div>
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
          onReorderNodes={reorderNodes}
          onApplyFlow={applyBaseFlow}
          onClose={() => setSidebarMode('none')}
        />
      )}
      {/* Welcome AI prompt on fresh empty canvas */}
      {showWelcomeAI && nodes.length === 0 && !isAIBubbleOpen && !aiProposal && (
        <AIChat
          nodes={nodes}
          edges={edges}
          onProposalReady={handleAIProposalReady}
          isOpen={true}
          onClose={dismissWelcomeAI}
          variant="welcome"
          onOpenTemplates={() => setTemplatesOpen(true)}
          diagramMode={diagramMode}
          onDismiss={dismissWelcomeAI}
          onImportJson={importDiagram}
        />
      )}
      {/* Full AI chat overlay (triggered by pill button) */}
      <AIChat
        nodes={nodes}
        edges={edges}
        onProposalReady={handleAIProposalReady}
        isOpen={isAIBubbleOpen}
        onClose={() => setIsAIBubbleOpen(false)}
        variant="full"
        canEdit={!shared.state.id || shared.state.canEdit}
        diagramMode={diagramMode}
      />
      {aiProposal && (
        <AIInsertPreviewDialog
          proposal={aiProposal}
          onInsert={aiIntent === 'edit' ? applyAIChanges : insertAIProposal}
          applyLabel={activeAIProposal?.source === 'draft' ? 'Restore saved draft' : aiIntent === 'edit' ? 'Apply changes' : 'Insert into Canvas'}
          changeSummary={editChangeSummary}
          applyError={aiApplyError ?? undefined}
          onCancel={cancelAIProposal}
          onPreview={handlePreviewProposal}
          onRefine={handleRefineProposal}
          isRefining={isRefining}
          darkMode={darkMode}
        />
      )}
      <PremiumStudio isOpen={premiumOpen} onClose={() => setPremiumOpen(false)} onInsertImage={addImageNode} />
      <CommandPalette isOpen={commandOpen} onClose={() => setCommandOpen(false)} nodes={nodes} onFocusNode={focusNode} onOpenTemplates={() => setTemplatesOpen(true)} onOpenChat={() => setIsAIBubbleOpen(true)} onOpenImageStudio={() => setPremiumOpen(true)} onOpenInsights={() => setInsightsOpen(true)} onAutoLayout={(direction) => { void autoLayout(direction) }} onArrangeSelection={arrangeSelection} arrangementAvailability={arrangementAvailability} />
      {insightsOpen && <Suspense fallback={<div className="workspace-status" role="status">Reading your diagram…</div>}><DiagramInsights nodes={nodes} edges={edges} onFocusNode={focusNode} onClose={() => setInsightsOpen(false)} /></Suspense>}
      <TemplateGallery isOpen={templatesOpen} onClose={() => setTemplatesOpen(false)} onSelect={(template) => { void selectTemplate(template) }} />
      {/* Show pill when welcome prompt is not visible and AI bubble is not open */}
      {!isAIBubbleOpen && !(showWelcomeAI && nodes.length === 0 && !aiProposal) && (
        <button className="ai-floating-pill" onClick={toggleAI} aria-label="Open AI Assistant">
          <img src={darkMode ? '/logo/logo_color.svg' : '/logo/logo_dark_pointer.svg'} alt="" className="ai-pill-logo" />
          <span className="ai-pill-brand">FlowChart</span>
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
