import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense, type DragEvent } from 'react'
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
import Toolbar from './components/Toolbar'
import { nodeTypes, edgeTypes } from './flow/registry'
import PreviewMode from './components/PreviewMode'
import Explorer from './components/Explorer'
import AIChat from './components/AIChat'
import AIInsertPreviewDialog, { NativeProposalPreview } from './components/AIInsertPreviewDialog'
import { FlowGenerationContextSchema, normalizeGenerationProposal, parseGenerationResponse, type AIGenerationContext, type AIGenerationProposal } from './shared/aiGeneration'
import { captureDrawGenerationContext } from './utils/drawGeneration'
import { sceneFromDrawing, drawingFromScene } from './shared/drawDocument'
import { mergeGraphElements } from './utils/architectureBridge'
import ExcalidrawImportDialog from './components/ExcalidrawImportDialog'
import PatchNotesDialog from './components/PatchNotesDialog'
import { usePatchNotes } from './hooks/usePatchNotes'
import { resolveAzureIcons } from './utils/azureIconRegistry'
import { getMessages, addMessage as addThreadMessage } from './utils/conversationStore'
import { sortParentsFirst, getAbsolutePosition, remapPastedNodes } from './utils/nesting'
import ShareStatus from './components/ShareStatus'
import { useSharedFlow, type ApplyReason } from './hooks/useSharedFlow'
import { chartToFlow, changedNodeIds, flowToChart } from './utils/sharedFlow'
import { parseSharedLocation } from './utils/shareApi'
import { LIMITS, inferDiagramMode, nextNumericNodeId, type Chart, type DiagramMode } from './shared/flowTypes'
import { validateArchitectureScene, serializedByteLength, MAX_ARCHITECTURE_DOCUMENT_BYTES, type ArchitectureScene } from './shared/architectureScene'
import { applyDrawEdit, captureDrawEdit, drawEditIsCurrent, type DrawEditSnapshot } from './utils/drawSelectionEdit'
import { validateDrawEdit } from './shared/drawSelectionEdit'
import type { DrawEditResult } from './components/AIDrawEditDialog'
import type { DrawCanvasApi } from './components/DrawCanvas'
import { exportExcalidrawDrawing, parseFlowJson, serializeFlow } from './utils/exportUtils'
import { readDiagramFile } from './utils/diagramImport'
import { getExcalidrawCompatibilityNotes, prepareSceneInsertion, prepareSceneOpen } from './utils/excalidrawImport'
import type { SelectionEditProposal, SelectionEditScope } from './shared/selectionEdit'
import type { SelectionEditPreview } from './components/AISelectionEditDialog'
import { authoredGraphSignature, captureSelectionEditSnapshot, mergeSelectionEditResult, selectionEditChart, selectionEditContext, selectionEditPreview, selectionEditSnapshotIsCurrent, type SelectionEditSnapshot } from './utils/selectionEdit'

const AIDrawEditDialog = lazy(() => import('./components/AIDrawEditDialog'))
const DrawCanvas = lazy(() => import('./components/DrawCanvas'))
const AISelectionEditDialog = lazy(() => import('./components/AISelectionEditDialog'))
const EDITOR_DRAFT_KEY = 'flowchart-editor-draft-v3'
function readEditorDraft() {
  if (parseSharedLocation(window.location)) return undefined
  try {
    const saved = localStorage.getItem(EDITOR_DRAFT_KEY)
    return saved ? parseFlowJson(saved) : undefined
  } catch { return undefined }
}

export type EdgeStyle = 'default' | 'animated' | 'step'
export type HandlePosition = 'top' | 'right' | 'bottom' | 'left'
export type SidebarMode = 'none' | 'explorer'
export type { DiagramMode } from './shared/flowTypes'
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

interface HistoryState {
  nodes: FlowNode[]
  edges: Edge[]
  architectureScene?: ArchitectureScene
  diagramMode?: DiagramMode
}

function validateAIInsertion(nodes: FlowNode[], edges: Edge[], scene: ArchitectureScene | undefined, mode: DiagramMode) {
  if (nodes.length > LIMITS.maxNodes || edges.length > LIMITS.maxEdges) {
    throw new Error(`The combined diagram exceeds the ${LIMITS.maxNodes} node or ${LIMITS.maxEdges} edge limit.`)
  }
  const maxBytes = scene ? MAX_ARCHITECTURE_DOCUMENT_BYTES : LIMITS.maxChartBytes
  if (serializedByteLength(flowToChart(nodes, edges, scene, mode)) + 1024 > maxBytes) {
    throw new Error(`The combined diagram exceeds the ${scene ? '4 MiB' : '256 KiB'} document limit.`)
  }
}

interface DrawEditSession {
  snapshot: DrawEditSnapshot
  before: ArchitectureScene
  result: DrawEditResult
}

interface SelectionEditSession {
  nodeIds: string[]
  selectedNodes: Array<{ id: string; label: string }>
  boundaryEdges: Array<{ id: string; label: string; sourceLabel: string; targetLabel: string }>
}
interface PendingSelectionEdit {
  scope: SelectionEditScope
  snapshot: SelectionEditSnapshot
  proposal: SelectionEditProposal
  preview: SelectionEditPreview
}

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

  // Update edge label callback
  const updateEdgeLabel = useCallback((edgeId: string, label: string) => {
    setEdges((eds) =>
      eds.map((edge) =>
        edge.id === edgeId ? { ...edge, label } : edge
      )
    )
  }, [])

  const [initialDraft] = useState(readEditorDraft)
  const initialNodes: FlowNode[] = initialDraft?.nodes.map(n => ({ ...n, data: { ...n.data, onLabelChange: updateNodeLabel } })) ?? []

  const [nodes, setNodes] = useNodesState(initialNodes)
  const [edges, setEdges] = useEdgesState(initialDraft?.edges.map(e => ({ ...e, data: { ...e.data, onLabelChange: updateEdgeLabel } })) ?? [])
  const [architectureScene, setArchitectureScene] = useState<ArchitectureScene | undefined>(initialDraft?.architectureScene)
  const drawApi = useRef<DrawCanvasApi | null>(null)
  const pendingDrawFit = useRef(false)
  const handleDrawReady = useCallback((api: DrawCanvasApi | null) => {
    drawApi.current = api
    if (api && pendingDrawFit.current) { pendingDrawFit.current = false; api.fitScene() }
  }, [])
  const [draftError, setDraftError] = useState<string | null>(null)

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
  const [nodeIdCounter, setNodeIdCounter] = useState(() => Math.max(2, nextNumericNodeId(initialNodes)))
  const [diagramMode, setDiagramMode] = useState<DiagramMode>(initialDraft?.mode ?? 'flowchart')
  const [defaultEdgeStyle, setDefaultEdgeStyle] = useState<EdgeStyle>('animated')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none')
  const showGrid = true
  const [toolMode, setToolMode] = useState<ToolMode>('select')
  const [clipboard, setClipboard] = useState<{ nodes: FlowNode[]; edges: Edge[] }>({ nodes: [], edges: [] })
  const [pasteCount, setPasteCount] = useState(0)
  const [darkMode, setDarkMode] = useState(true)
  const [drawClearRequest, setDrawClearRequest] = useState(0)
  const [drawLocalView, setDrawLocalView] = useState(false)
  const drawLocalViewRef = useRef(false)
  useEffect(() => {
    if (diagramMode !== 'draw' && drawLocalViewRef.current) { drawLocalViewRef.current = false; setDrawLocalView(false) }
  }, [diagramMode])
  const [isAIBubbleOpen, setIsAIBubbleOpen] = useState(false)
  const [aiProposal, setAIProposal] = useState<AIGenerationProposal | null>(null)
  // A shared link (/f/:id) opens a chart, so skip the empty-canvas welcome prompt.
  const [showWelcomeAI, setShowWelcomeAI] = useState(() => !parseSharedLocation(window.location) && !initialDraft?.nodes.length && !initialDraft?.architectureScene?.elements.some(e => !e.isDeleted))
  const [generationPrompt, setGenerationPrompt] = useState('')
  const [refinementPrompt, setRefinementPrompt] = useState('')
  const [generationMode, setGenerationMode] = useState<DiagramMode>(initialDraft?.mode ?? 'flowchart')
  const [aiInsertError, setAIInsertError] = useState<string | null>(null)
  const [isRefining, setIsRefining] = useState(false)
  const refineRequest = useRef<{ id: number; controller?: AbortController }>({ id: 0 })
  const cancelRefinement = useCallback(() => {
    refineRequest.current.controller?.abort()
    refineRequest.current = { id: refineRequest.current.id + 1 }
    setIsRefining(false)
  }, [])
  const [aiThreadId, setAIThreadId] = useState<string | null>(null)
  const [proposalPreview, setProposalPreview] = useState<{ outputMode: 'draw'; scene: ArchitectureScene } | { outputMode: 'flowchart' | 'architecture'; nodes: FlowNode[]; edges: Edge[] } | null>(null)
  const [showMinimap, setShowMinimap] = useState(false)
  const [pendingImport, setPendingImport] = useState<{ filename: string; scene: ArchitectureScene; point?: { x: number; y: number } } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isFileDragOver, setIsFileDragOver] = useState(false)
  const importRequest = useRef(0)
  const fileDragDepth = useRef(0)
  const [selectionEdit, setSelectionEdit] = useState<SelectionEditSession | null>(null)
  const [selectionEditBusy, setSelectionEditBusy] = useState(false)
  const [selectionEditError, setSelectionEditError] = useState<string | null>(null)
  const [pendingSelectionEdit, setPendingSelectionEdit] = useState<PendingSelectionEdit | null>(null)
  const selectionEditRequest = useRef<{ id: number; controller?: AbortController }>({ id: 0 })
  const documentEpoch = useRef(0)
  const [drawEdit, setDrawEdit] = useState<DrawEditSession | null>(null)
  const [drawEditOpenError, setDrawEditOpenError] = useState<string | null>(null)
  const drawEditRequest = useRef<{ id: number; controller?: AbortController }>({ id: 0 })
  const revision = useRef({ signature: '', value: 0 })
  const authoredSignature = authoredGraphSignature(nodes, edges)
  if (authoredSignature !== revision.current.signature) revision.current = { signature: authoredSignature, value: revision.current.value + 1 }

  useEffect(() => { setGenerationMode(diagramMode) }, [diagramMode])
  const aiDocumentEpoch = documentEpoch.current
  useEffect(() => {
    cancelRefinement()
    setAIProposal(null)
    setRefinementPrompt('')
    setProposalPreview(null)
    setAIThreadId(null)
    setAIInsertError(null)
  }, [aiDocumentEpoch, cancelRefinement])
  useEffect(() => () => refineRequest.current.controller?.abort(), [])

  const getGenerationContext = useCallback((): AIGenerationContext | undefined => {
    if (diagramMode === 'draw') {
      const scene = drawApi.current?.getScene() ?? architectureScene
      return scene ? { drawContext: captureDrawGenerationContext(scene) } : undefined
    }
    const chart = flowToChart(nodes, edges)
    const context = FlowGenerationContextSchema.safeParse({
      nodes: chart.nodes.map(({ icon: _icon, ...node }) => ({ ...node, imageUrl: generationMode === 'draw' || node.imageUrl?.startsWith('data:') ? undefined : node.imageUrl })),
      edges: chart.edges,
    })
    return context.success ? { flowContext: context.data } : undefined
  }, [nodes, edges, architectureScene, diagramMode, generationMode])

  const canvasPoint = useCallback((point: { x: number; y: number }) => {
    return diagramMode === 'draw' && drawApi.current
      ? drawApi.current.viewportToScenePoint(point)
      : screenToFlowPosition(point)
  }, [diagramMode, screenToFlowPosition])
  const centerCanvas = useCallback((x: number, y: number, options?: { duration?: number; zoom?: number }) => {
    if (diagramMode === 'draw') window.setTimeout(() => drawApi.current?.fitScene(), 50)
    else setCenter(x, y, options)
  }, [diagramMode, setCenter])

  const addImageNode = useCallback(
    (imageUrl: string, label: string) => {
      let position = { x: 200, y: 200 }
      if (reactFlowWrapper.current) {
        const rect = reactFlowWrapper.current.getBoundingClientRect()
        position = canvasPoint({
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
      centerCanvas(
        adjustedPosition.x + size.width / 2,
        adjustedPosition.y + size.height / 2,
        { duration: 300, zoom: 1 }
      )
    },
    [nodeIdCounter, setNodes, updateNodeLabel, canvasPoint, nodes, findAvailablePosition, centerCanvas]
  )

  // Undo/Redo history management
  const [history, setHistory] = useState<HistoryState[]>([{ nodes: initialNodes, edges: initialDraft?.edges ?? [], architectureScene: initialDraft?.architectureScene, diagramMode: initialDraft?.mode }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const isRestoringHistory = useRef(false)
  const MAX_HISTORY = 50

  // Save current state to history
  const saveToHistory = useCallback(() => {
    if (isRestoringHistory.current) return

    setHistory((prev) => {
      // Remove any future states if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1)
      // Add new state
      newHistory.push({ nodes: [...nodes], edges: [...edges], architectureScene, diagramMode })
      // Keep only last MAX_HISTORY states
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift()
        setHistoryIndex(MAX_HISTORY - 1)
        return newHistory
      }
      setHistoryIndex(newHistory.length - 1)
      return newHistory
    })
  }, [nodes, edges, architectureScene, diagramMode, historyIndex])

  // Undo handler
  const undo = useCallback(() => {
    if (drawLocalViewRef.current) return
    if (historyIndex > 0) {
      documentEpoch.current++
      const newIndex = historyIndex - 1
      const state = history[newIndex]
      isRestoringHistory.current = true
      setNodes(state.nodes)
      setEdges(state.edges)
      setArchitectureScene(state.architectureScene)
      if (state.diagramMode) setDiagramMode(state.diagramMode)
      setHistoryIndex(newIndex)
      setTimeout(() => {
        isRestoringHistory.current = false
      }, 0)
    }
  }, [historyIndex, history, setNodes, setEdges])

  // Redo handler
  const redo = useCallback(() => {
    if (drawLocalViewRef.current) return
    if (historyIndex < history.length - 1) {
      documentEpoch.current++
      const newIndex = historyIndex + 1
      const state = history[newIndex]
      isRestoringHistory.current = true
      setNodes(state.nodes)
      setEdges(state.edges)
      setArchitectureScene(state.architectureScene)
      if (state.diagramMode) setDiagramMode(state.diagramMode)
      setHistoryIndex(newIndex)
      setTimeout(() => {
        isRestoringHistory.current = false
      }, 0)
    }
  }, [historyIndex, history, setNodes, setEdges])

  // Opening another document is a single transaction, including the scene and
  // mode. Keep both sides so diagram Undo/Redo works across renderer switches.
  const commitDocument = useCallback((next: HistoryState, options: { fit?: boolean } = {}) => {
    if (drawLocalViewRef.current) return
    documentEpoch.current++
    const previous: HistoryState = { nodes, edges, architectureScene, diagramMode }
    const complete = { ...next, diagramMode: next.diagramMode ?? diagramMode }
    setHistory(current => {
      const past = current.slice(0, historyIndex + 1)
      if (JSON.stringify(past[past.length - 1]) !== JSON.stringify(previous)) past.push(previous)
      past.push(complete)
      const trimmed = past.slice(-MAX_HISTORY)
      setHistoryIndex(trimmed.length - 1)
      return trimmed
    })
    isRestoringHistory.current = true
    setNodes(sortParentsFirst(next.nodes.map(n => ({ ...n, data: { ...n.data, onLabelChange: updateNodeLabel } }))))
    setEdges(next.edges.map(e => ({ ...e, data: { ...e.data, onLabelChange: updateEdgeLabel } })))
    setArchitectureScene(next.architectureScene)
    setDiagramMode(complete.diagramMode)
    setNodeIdCounter(counter => Math.max(counter, nextNumericNodeId(next.nodes)))
    setShowWelcomeAI(false)
    pendingDrawFit.current = options.fit !== false && complete.diagramMode === 'draw'
    window.setTimeout(() => {
      isRestoringHistory.current = false
      if (options.fit === false) return
      if (complete.diagramMode === 'draw' && drawApi.current) { pendingDrawFit.current = false; drawApi.current.fitScene() }
      else if (complete.diagramMode !== 'draw') fitView({ padding: 0.2 })
    }, 100)
  }, [nodes, edges, architectureScene, diagramMode, historyIndex, setNodes, setEdges, updateNodeLabel, updateEdgeLabel, fitView])

  // Async file reads must apply to the current document, even when an older
  // callback began decoding while the user was still editing.
  const importTarget = useRef({ nodes, edges, architectureScene, diagramMode, darkMode, canvasPoint, commitDocument })
  importTarget.current = { nodes, edges, architectureScene, diagramMode, darkMode, canvasPoint, commitDocument }
  const cancelImport = useCallback(() => {
    importRequest.current += 1
    setPendingImport(null)
    setImportError(null)
    setIsImporting(false)
  }, [])

  const readImportFile = useCallback(async (file: File, point?: { x: number; y: number }) => {
    const request = ++importRequest.current
    setIsImporting(true)
    setImportError(null)
    setPendingImport(null)
    try {
      const imported = await readDiagramFile(file)
      if (request !== importRequest.current) return
      if (imported.kind === 'excalidraw') {
        setPendingImport({ filename: file.name, scene: imported.scene, point })
      } else {
        const document = imported.document
        importTarget.current.commitDocument({ nodes: document.nodes, edges: document.edges, diagramMode: document.mode, architectureScene: document.architectureScene })
      }
    } catch (error) {
      if (request === importRequest.current) {
        const message = error instanceof Error ? error.message : 'Could not import this drawing.'
        setImportError(/^image\//.test(file.type) && message.includes('valid JSON') ? 'Use the Image tool to add images. To import an editable drawing, choose a .excalidraw or .json file.' : message)
      }
    } finally {
      if (request === importRequest.current) setIsImporting(false)
    }
  }, [])

  const applyExcalidrawImport = useCallback(async (destination: 'open' | 'insert') => {
    if (!pendingImport || isImporting) return
    const request = ++importRequest.current
    setIsImporting(true)
    setImportError(null)
    try {
      const before = importTarget.current
      let scene = destination === 'open' ? prepareSceneOpen(pendingImport.scene) : pendingImport.scene
      if (destination === 'insert') {
        const signature = JSON.stringify(flowToChart(before.nodes, before.edges, before.architectureScene, before.diagramMode))
        const { mergeGraphElements } = await import('./utils/architectureBridge')
        if (request !== importRequest.current) return
        const current = importTarget.current
        if (current.diagramMode !== before.diagramMode || JSON.stringify(flowToChart(current.nodes, current.edges, current.architectureScene, current.diagramMode)) !== signature) {
          throw new Error('The diagram changed while preparing the import. Try inserting again to use its latest contents.')
        }
        const existing = before.diagramMode === 'draw' && drawApi.current ? drawApi.current.getScene() : before.architectureScene
        const drawingElements = mergeGraphElements((existing?.elements ?? []) as unknown as Parameters<typeof mergeGraphElements>[0], before.nodes, before.edges, before.darkMode)
        const baseScene: ArchitectureScene = { version: 1, elements: JSON.parse(JSON.stringify(drawingElements)), files: existing?.files ?? {}, ...(existing?.appState ? { appState: existing.appState } : {}) }
        const rect = reactFlowWrapper.current?.getBoundingClientRect()
        const point = pendingImport.point ?? before.canvasPoint({ x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2, y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2 })
        scene = prepareSceneInsertion(scene, baseScene, point)
      }
      validateArchitectureScene(scene)
      const nextNodes = destination === 'insert' ? before.nodes : []
      const nextEdges = destination === 'insert' ? before.edges : []
      // Allow the same document to save/share immediately after importing.
      if (serializedByteLength(flowToChart(nextNodes, nextEdges, scene, 'draw')) + 1024 > MAX_ARCHITECTURE_DOCUMENT_BYTES) {
        throw new Error('The combined diagram exceeds the 4 MiB document limit. Open this drawing as a new diagram or use smaller images.')
      }
      if (request !== importRequest.current) return
      before.commitDocument({ nodes: nextNodes, edges: nextEdges, architectureScene: scene, diagramMode: 'draw' }, { fit: destination === 'open' })
      setPendingImport(null)
    } catch (error) {
      if (request === importRequest.current) setImportError(error instanceof Error ? error.message : 'Could not import this drawing.')
    } finally {
      if (request === importRequest.current) setIsImporting(false)
    }
  }, [pendingImport, isImporting])

  const isFileDrag = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer.types).includes('Files')
  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    fileDragDepth.current = 0
    setIsFileDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    event.preventDefault()
    event.stopPropagation()
    if (files.length !== 1) { setImportError('Drop one .json or .excalidraw drawing at a time.'); return }
    // Every diagram drop uses content validation and a deliberate destination;
    // raster/SVG image uploads stay available through the Draw Image tool.
    void readImportFile(files[0], canvasPoint({ x: event.clientX, y: event.clientY }))
  }

  // Track when to save history - save after changes stabilize
  const lastChangeTime = useRef<number>(0)
  const saveTimeoutRef = useRef<number>()

  useEffect(() => {
    if (isRestoringHistory.current || diagramMode === 'draw') return

    // Debounce history saves to avoid saving too frequently
    lastChangeTime.current = Date.now()

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      const currentState = history[historyIndex]
      const hasChanged =
        JSON.stringify(currentState?.nodes) !== JSON.stringify(nodes) ||
        JSON.stringify(currentState?.edges) !== JSON.stringify(edges) ||
        JSON.stringify(currentState?.architectureScene) !== JSON.stringify(architectureScene)

      if (hasChanged) {
        saveToHistory()
      }
    }, 500) // Save after 500ms of no changes

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [nodes, edges, architectureScene, diagramMode, history, historyIndex, saveToHistory])

  // Handle node changes (dragging, selection, etc.).
  // When a container is removed (e.g., via the Delete key), its children are
  // detached first so they survive at their absolute positions.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removedIds = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
      )
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
    [setNodes]
  )

  // Handle edge changes
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  )

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

  // Handle new connections. Architecture mode defaults to solid synchronous edges.
  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge = {
        ...connection,
        ...(diagramMode === 'architecture'
          ? getEdgeStyleProps('default', { commStyle: 'sync' })
          : getEdgeStyleProps(defaultEdgeStyle)),
      }
      setEdges((eds) => addEdge(newEdge as Edge, eds))
    },
    [setEdges, defaultEdgeStyle, getEdgeStyleProps, diagramMode]
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
    (type: PaletteNodeType) => {
      const size = getNodeDimensions(type)

      // Calculate center of the current viewport
      let position = { x: 200, y: 200 } // fallback
      if (reactFlowWrapper.current) {
        const rect = reactFlowWrapper.current.getBoundingClientRect()
        position = canvasPoint({
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
      centerCanvas(
        adjustedPosition.x + size.width / 2,
        adjustedPosition.y + size.height / 2,
        { duration: 300, zoom: 1 }
      )
    },
    [nodeIdCounter, setNodes, updateNodeLabel, canvasPoint, nodes, findAvailablePosition, getNodeDimensions, centerCanvas]
  )

  // Add an empty container at the viewport center. Containers are prepended so
  // they render behind existing nodes and keep the parents-first ordering valid.
  const addContainer = useCallback(() => {
    const size = { ...CONTAINER_DEFAULT_SIZE }

    let position = { x: 200, y: 200 }
    if (reactFlowWrapper.current) {
      const rect = reactFlowWrapper.current.getBoundingClientRect()
      position = canvasPoint({
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

    centerCanvas(
      position.x + size.width / 2,
      position.y + size.height / 2,
      { duration: 300, zoom: 1 }
    )
  }, [nodeIdCounter, setNodes, updateNodeLabel, canvasPoint, centerCanvas])

  // Wrap the selected nodes in a new container sized to their bounding box.
  // Positions are converted to parent-relative; nested selections keep their
  // existing parent when it is also selected.
  const wrapSelectionInContainer = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return

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
  }, [nodes, nodeIdCounter, getNodeDimensions, updateNodeLabel, setNodes])

  // Detach selected nodes from their container, keeping them in place
  const detachSelection = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.selected && n.parentNode
          ? { ...n, position: getAbsolutePosition(n, nds), parentNode: undefined, extent: undefined }
          : n
      )
    )
  }, [setNodes])

  // Change the kind of the selected container(s)
  const changeContainerKind = useCallback((kind: ContainerKind) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.selected && n.type === 'container'
          ? { ...n, data: { ...n.data, containerKind: kind } }
          : n
      )
    )
  }, [setNodes])

  // Delete selected nodes and edges. Children of deleted containers are
  // detached (kept at absolute positions), not cascade-deleted.
  const deleteSelected = useCallback(() => {
    setNodes((nds) => {
      const removedIds = new Set(nds.filter((n) => n.selected).map((n) => n.id))
      return nds
        .map((n) =>
          n.parentNode && removedIds.has(n.parentNode) && !removedIds.has(n.id)
            ? { ...n, position: getAbsolutePosition(n, nds), parentNode: undefined, extent: undefined }
            : n
        )
        .filter((n) => !n.selected)
    })
    setEdges((eds) => eds.filter((edge) => !edge.selected))
  }, [setNodes, setEdges])

  // Clear all nodes and edges
  const clearAll = useCallback(() => {
    commitDocument({ nodes: [], edges: [], architectureScene: undefined, diagramMode }, { fit: false })
  }, [commitDocument, diagramMode])

  // Get selected nodes and edges
  const getSelectedItems = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected)
    const selectedEdges = edges.filter((edge) => edge.selected)
    return { selectedNodes, selectedEdges }
  }, [nodes, edges])

  const editTarget = useRef({ nodes, edges, diagramMode, architectureScene, commitDocument, getEdgeStyleProps })
  editTarget.current = { nodes, edges, diagramMode, architectureScene, commitDocument, getEdgeStyleProps }

  const drawEditTarget = useRef({ nodes, edges, diagramMode, previewMode })
  drawEditTarget.current = { nodes, edges, diagramMode, previewMode }
  const closeDrawEdit = useCallback(() => {
    drawEditRequest.current.controller?.abort()
    drawEditRequest.current = { id: drawEditRequest.current.id + 1 }
    setDrawEdit(null)
  }, [])
  const openDrawEdit = useCallback(() => {
    const api = drawApi.current
    if (!api || drawEditTarget.current.diagramMode !== 'draw' || drawEditTarget.current.previewMode || drawLocalViewRef.current) return
    try {
      setDrawEditOpenError(null)
      const before = api.getScene(), snapshot = captureDrawEdit(before, api.getSelectedIds(), documentEpoch.current)
      closeDrawEdit()
      setDrawEdit({ snapshot, before, result: { status: 'prompt' } })
    } catch (error) { setDrawEditOpenError(error instanceof Error ? error.message : 'This selection cannot be edited with AI.') }
  }, [closeDrawEdit])
  const drawEditCurrent = useCallback((snapshot: DrawEditSnapshot) => {
    const api = drawApi.current, target = drawEditTarget.current
    return !!api && target.diagramMode === 'draw' && !target.previewMode && !drawLocalViewRef.current && drawEditIsCurrent(snapshot, api.getScene(), api.getSelectedIds(), documentEpoch.current)
  }, [])
  const generateDrawEdit = useCallback(async (instruction: string) => {
    if (!drawEdit || drawEditRequest.current.controller || !drawEditCurrent(drawEdit.snapshot)) return
    const controller = new AbortController(), requestId = drawEditRequest.current.id + 1, session = drawEdit
    drawEditRequest.current = { id: requestId, controller }
    setDrawEdit({ ...session, result: { status: 'loading' } })
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ mode: 'draw-edit', diagramMode: 'draw', messages: [{ role: 'user', content: instruction }], drawContext: session.snapshot.context }) })
      const data = await response.json()
      if (drawEditRequest.current.id !== requestId || controller.signal.aborted) return
      if (!drawEditCurrent(session.snapshot)) throw new Error('The drawing changed while AI was working. Start a new AI edit.')
      if (!response.ok) throw new Error(data.error || 'AI could not prepare changes. Try again.')
      if (data.finishReason === 'length') throw new Error('The AI response was cut off. Try a smaller edit.')
      const proposal = validateDrawEdit(session.snapshot.context, JSON.parse(data.message))
      const target = drawEditTarget.current
      const scene = applyDrawEdit(session.before, session.snapshot, proposal, target.nodes, target.edges)
      setDrawEdit({ ...session, result: { status: 'preview', proposal, scene, instruction } })
    } catch (error) {
      if (drawEditRequest.current.id === requestId && !controller.signal.aborted) setDrawEdit({ ...session, result: { status: 'error', error: error instanceof Error ? error.message : 'AI returned invalid changes.' } })
    } finally { if (drawEditRequest.current.id === requestId) drawEditRequest.current = { id: requestId } }
  }, [drawEdit, drawEditCurrent])
  const applyDrawSelectionEdit = useCallback(() => {
    if (!drawEdit || drawEdit.result.status !== 'preview') return
    try {
      if (!drawEditCurrent(drawEdit.snapshot) || !drawApi.current?.applySelectionEdit(drawEdit.snapshot, drawEdit.result.proposal)) throw new Error('The drawing changed. Start a new AI edit before applying.')
      closeDrawEdit()
    } catch (error) { setDrawEdit({ ...drawEdit, result: { status: 'error', error: error instanceof Error ? error.message : 'Unable to apply Draw changes.' } }) }
  }, [drawEdit, drawEditCurrent, closeDrawEdit])
  useEffect(() => { if (diagramMode !== 'draw' || previewMode || drawLocalView) closeDrawEdit() }, [diagramMode, previewMode, drawLocalView, closeDrawEdit])
  useEffect(() => () => { drawEditRequest.current.controller?.abort(); drawEditRequest.current.id++ }, [])

  const closeSelectionEdit = useCallback(() => {
    selectionEditRequest.current.controller?.abort()
    selectionEditRequest.current = { id: selectionEditRequest.current.id + 1 }
    setSelectionEdit(null)
    setPendingSelectionEdit(null)
    setSelectionEditBusy(false)
    setSelectionEditError(null)
  }, [])

  const openSelectionEdit = useCallback(() => {
    const current = editTarget.current
    const selected = current.nodes.filter(node => node.selected)
    if (current.diagramMode === 'draw' || selected.length === 0) return
    const ids = new Set(selected.map(node => node.id)), labels = new Map(current.nodes.map(node => [node.id, String(node.data.label ?? node.id)]))
    selectionEditRequest.current.controller?.abort()
    selectionEditRequest.current = { id: selectionEditRequest.current.id + 1 }
    setSelectionEdit({
      nodeIds: [...ids], selectedNodes: selected.map(node => ({ id: node.id, label: String(node.data.label ?? node.id) })),
      boundaryEdges: current.edges.filter(edge => ids.has(edge.source) !== ids.has(edge.target)).map(edge => ({ id: edge.id, label: typeof edge.label === 'string' ? edge.label : '', sourceLabel: labels.get(edge.source) ?? edge.source, targetLabel: labels.get(edge.target) ?? edge.target })),
    })
    setSelectionEditBusy(false)
    setSelectionEditError(null)
    setPendingSelectionEdit(null)
    setIsAIBubbleOpen(false)
  }, [])

  const generateSelectionEdit = useCallback(async (instruction: string, includeBoundaryConnections: boolean) => {
    if (!selectionEdit || selectionEditBusy) return
    const controller = new AbortController(), requestId = selectionEditRequest.current.id + 1
    selectionEditRequest.current = { id: requestId, controller }
    setSelectionEditBusy(true)
    setSelectionEditError(null)
    setPendingSelectionEdit(null)
    try {
      const current = editTarget.current
      if (current.diagramMode === 'draw') throw new Error('Edit with AI is available in Flowchart and Architecture modes.')
      const snapshot = captureSelectionEditSnapshot(current.nodes, current.edges, selectionEdit.nodeIds, documentEpoch.current)
      const selected = new Set(snapshot.nodeIds)
      const internalEdges = current.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)).map(edge => edge.id)
      const scope: SelectionEditScope = {
        nodeIds: snapshot.nodeIds, edgeIds: [...new Set([...internalEdges, ...(includeBoundaryConnections ? selectionEdit.boundaryEdges.map(edge => edge.id) : [])])],
        snapshotId: crypto.randomUUID(), revision: revision.current.value,
      }
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ mode: 'edit', diagramMode: current.diagramMode, messages: [{ role: 'user', content: instruction }], selection: scope, flowContext: selectionEditContext(current.nodes, current.edges, snapshot) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'The AI could not prepare these changes. Please try again.')
      if (data.finishReason === 'length') throw new Error('The AI response was cut off. Try a smaller edit.')
      let proposal: unknown
      try { proposal = JSON.parse(data.message) as unknown } catch { throw new Error('The AI returned invalid changes. Your diagram has not changed.') }
      const { validateSelectionEdit } = await import('./shared/selectionEdit')
      if (selectionEditRequest.current.id !== requestId) return
      const latest = editTarget.current
      if (!selectionEditSnapshotIsCurrent(snapshot, latest.nodes, latest.edges, documentEpoch.current)) throw new Error('The selected content changed while AI was working. Regenerate the proposal before applying.')
      const chart = selectionEditChart(latest.nodes, latest.edges)
      const validated = validateSelectionEdit(chart.nodes, chart.edges, scope, proposal)
      if (!validated.ok) throw new Error(validated.error)
      const next = mergeSelectionEditResult(latest.nodes, latest.edges, validated.result, { onLabelChange: updateNodeLabel, edgeProps: latest.getEdgeStyleProps })
      setPendingSelectionEdit({ scope, snapshot, proposal: validated.proposal, preview: selectionEditPreview(latest.nodes, latest.edges, next.nodes, next.edges, validated.proposal.summary) })
    } catch (error) {
      if (selectionEditRequest.current.id === requestId && !controller.signal.aborted) setSelectionEditError(error instanceof Error ? error.message : 'Unable to prepare changes. Your diagram has not changed.')
    } finally {
      if (selectionEditRequest.current.id === requestId) setSelectionEditBusy(false)
    }
  }, [selectionEdit, selectionEditBusy, updateNodeLabel])

  const applySelectionEdit = useCallback(async () => {
    if (!pendingSelectionEdit || selectionEditBusy) return
    const requestId = selectionEditRequest.current.id
    try {
      const { validateSelectionEdit } = await import('./shared/selectionEdit')
      if (selectionEditRequest.current.id !== requestId) return
      const current = editTarget.current
      if (!selectionEditSnapshotIsCurrent(pendingSelectionEdit.snapshot, current.nodes, current.edges, documentEpoch.current)) throw new Error('The selected content changed. Regenerate the proposal before applying.')
      const chart = selectionEditChart(current.nodes, current.edges)
      const validated = validateSelectionEdit(chart.nodes, chart.edges, pendingSelectionEdit.scope, pendingSelectionEdit.proposal)
      if (!validated.ok) throw new Error(validated.error)
      const next = mergeSelectionEditResult(current.nodes, current.edges, validated.result, { onLabelChange: updateNodeLabel, edgeProps: current.getEdgeStyleProps })
      current.commitDocument({ ...next, architectureScene: current.architectureScene, diagramMode: current.diagramMode }, { fit: false })
      closeSelectionEdit()
    } catch (error) { setSelectionEditError(error instanceof Error ? error.message : 'Unable to apply changes. Your diagram has not changed.') }
  }, [pendingSelectionEdit, selectionEditBusy, updateNodeLabel, closeSelectionEdit])

  useEffect(() => () => {
    selectionEditRequest.current.controller?.abort()
    selectionEditRequest.current.id++
  }, [])

  // Copy selected nodes and edges. Copying a container brings its descendants
  // along (with their internal edges); a copied child whose parent is NOT in
  // the copy set is flattened to its absolute position at copy time.
  const copySelection = useCallback(() => {
    const { selectedNodes, selectedEdges } = getSelectedItems()

    const copiedIds = new Set(selectedNodes.map((n) => n.id))
    const autoAddedIds = new Set<string>()
    let grew = true
    while (grew) {
      grew = false
      for (const n of nodes) {
        if (n.parentNode && copiedIds.has(n.parentNode) && !copiedIds.has(n.id)) {
          copiedIds.add(n.id)
          autoAddedIds.add(n.id)
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

    // Include edges internal to auto-added container contents; explicitly
    // selected edges keep today's behavior.
    const selectedEdgeIds = new Set(selectedEdges.map((e) => e.id))
    const internalEdges = edges.filter(
      (e) =>
        !selectedEdgeIds.has(e.id) &&
        copiedIds.has(e.source) &&
        copiedIds.has(e.target) &&
        (autoAddedIds.has(e.source) || autoAddedIds.has(e.target))
    )

    setClipboard({ nodes: sortParentsFirst(copiedNodes), edges: [...selectedEdges, ...internalEdges] })
    setPasteCount(0)
  }, [getSelectedItems, nodes, edges])

  // Paste nodes and edges from clipboard. Fresh ids come from counter
  // enumeration (never parsed out of existing ids, which may be non-numeric);
  // parentNode references are remapped and nesting is preserved.
  const pasteSelection = useCallback(() => {
    if (clipboard.nodes.length === 0) return

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
      centerCanvas(
        firstNode.position.x + size.width / 2,
        firstNode.position.y + size.height / 2,
        { duration: 300, zoom: 1 }
      )
    }
  }, [clipboard, nodeIdCounter, setNodes, setEdges, updateNodeLabel, pasteCount, nodes, findAvailablePosition, getNodeDimensions, centerCanvas])

  // Cut selected nodes and edges (copy + delete)
  const cutSelection = useCallback(() => {
    copySelection()
    deleteSelected()
  }, [copySelection, deleteSelected])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (diagramMode === 'draw') return
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
  }, [copySelection, pasteSelection, cutSelection, undo, redo, diagramMode])

  // Control + Scroll to Zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (diagramMode === 'draw') return
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
  }, [zoomIn, zoomOut, diagramMode])

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
    if (!isAIBubbleOpen) setGenerationMode(diagramMode)
    setIsAIBubbleOpen((prev) => !prev)
  }, [diagramMode, isAIBubbleOpen])

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
  const handleAIProposalReady = useCallback((proposal: AIGenerationProposal, threadId?: string) => {
    cancelRefinement()
    setAIInsertError(null)
    setProposalPreview(null)
    setAIProposal(proposal)
    setRefinementPrompt('')
    setAIThreadId(threadId ?? null)
  }, [cancelRefinement])

  // Insert AI proposal into canvas (insert-as-new algorithm)
  const insertAIProposal = useCallback(() => {
    if (!aiProposal) return

    setAIInsertError(null)
    try {
      if (aiProposal.outputMode === 'draw') {
        const existing = diagramMode === 'draw' && drawApi.current ? drawApi.current.getScene() : architectureScene
        const elements = mergeGraphElements((existing?.elements ?? []) as unknown as Parameters<typeof mergeGraphElements>[0], nodes, edges, darkMode)
        const baseScene: ArchitectureScene = { version: 1, elements: JSON.parse(JSON.stringify(elements)), files: existing?.files ?? {}, ...(existing?.appState ? { appState: existing.appState } : {}) }
        const rect = reactFlowWrapper.current?.getBoundingClientRect()
        const point = drawApi.current
          ? drawApi.current.viewportToScenePoint({ x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2, y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2 })
          : { x: 400, y: 300 }
        const scene = prepareSceneInsertion(sceneFromDrawing(aiProposal.drawing), baseScene, point)
        validateAIInsertion(nodes, edges, scene, 'draw')
        cancelRefinement()
        commitDocument({ nodes, edges, architectureScene: scene, diagramMode: 'draw' })
        setAIProposal(null)
        setAIThreadId(null)
        return
      }
      if (!aiProposal.nodes.length) throw new Error('This proposal has no content to insert.')

      const idMap = new Map<string, string>()
      let currentCounter = nodeIdCounter

      aiProposal.nodes.forEach((node) => {
        const newId = currentCounter.toString()
        idMap.set(node.id, newId)
        currentCounter++
      })

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

      const proposalCenterX = (minX + maxX) / 2
      const proposalCenterY = (minY + maxY) / 2

      let targetPosition = { x: 400, y: 300 }
      if (reactFlowWrapper.current) {
        const rect = reactFlowWrapper.current.getBoundingClientRect()
        targetPosition = canvasPoint({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
      }

      const offsetX = targetPosition.x - proposalCenterX
      const offsetY = targetPosition.y - proposalCenterY

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
            imageUrl: node.imageUrl,
            containerKind: node.containerKind,
            onLabelChange: updateNodeLabel,
          },
          style: node.width || node.height ? { width: node.width, height: node.height } : undefined,
        }
      })

      const newEdges: Edge[] = aiProposal.edges.map((edge, index) => {
        const newSource = idMap.get(edge.source)!
        const newTarget = idMap.get(edge.target)!

        const sourceHandle = edge.sourceHandle || 'bottom'
        const targetHandle = edge.targetHandle || 'top'

        return {
          id: `ai-${newSource}-${newTarget}-${index}`,
          source: newSource,
          target: newTarget,
          sourceHandle,
          targetHandle,
          label: edge.label,
          ...getEdgeStyleProps(edge.style || (edge.commStyle ? 'default' : 'animated'), { protocol: edge.protocol, commStyle: edge.commStyle }),
        }
      })

      const nextNodes = sortParentsFirst([...nodes, ...newNodes])
      const nextEdges = [...edges, ...newEdges]
      const retainedScene = diagramMode === 'draw' && drawApi.current ? drawApi.current.getScene() : architectureScene
      validateAIInsertion(nextNodes, nextEdges, retainedScene, aiProposal.outputMode)
      cancelRefinement()
      commitDocument({ nodes: nextNodes, edges: nextEdges, architectureScene: retainedScene, diagramMode: aiProposal.outputMode })
      setAIProposal(null)
      setAIThreadId(null)
    } catch (error) {
      setAIInsertError(error instanceof Error ? error.message : 'Could not insert this proposal.')
    }
  }, [aiProposal, nodeIdCounter, canvasPoint, updateNodeLabel, getEdgeStyleProps, nodes, edges, architectureScene, diagramMode, darkMode, cancelRefinement, commitDocument])

  const cancelAIProposal = useCallback(() => {
    cancelRefinement()
    setAIProposal(null)
    setRefinementPrompt('')
    setAIThreadId(null)
    setProposalPreview(null)
    setAIInsertError(null)
  }, [cancelRefinement])

  // Dismiss welcome AI prompt
  const dismissWelcomeAI = useCallback(() => {
    setShowWelcomeAI(false)
  }, [])

  const handleRefineProposal = useCallback(async (instruction: string): Promise<string | undefined> => {
    if (!aiProposal) return undefined
    cancelRefinement()
    const controller = new AbortController()
    const request = { id: refineRequest.current.id + 1, controller }
    refineRequest.current = request
    const epoch = documentEpoch.current
    setIsRefining(true)
    try {
      const messages = [
        ...(aiThreadId ? getMessages(aiThreadId).map(({ role, content }) => ({ role, content })) : []),
        { role: 'user', content: instruction },
      ]
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages,
          mode: 'refine',
          diagramMode: aiProposal.outputMode,
          ...(aiProposal.outputMode === 'draw'
            ? { drawProposal: aiProposal.proposal }
            : { flowContext: { nodes: aiProposal.nodes, edges: aiProposal.edges } }),
        }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API request failed with status ${response.status}`)
      }
      const data = await response.json()
      const parsed = parseGenerationResponse(data, aiProposal.outputMode)
      const refinedProposal = parsed.outputMode === 'draw' ? parsed : normalizeGenerationProposal({ ...resolveAzureIcons(parsed), outputMode: parsed.outputMode }, parsed.outputMode)
      if (controller.signal.aborted || refineRequest.current.id !== request.id || documentEpoch.current !== epoch) return undefined
      setAIProposal(refinedProposal)
      if (aiThreadId) {
        addThreadMessage(aiThreadId, { role: 'user', content: instruction })
        addThreadMessage(aiThreadId, { role: 'assistant', content: refinedProposal.summary })
      }
      return refinedProposal.summary
    } catch (error) {
      if (controller.signal.aborted || refineRequest.current.id !== request.id || documentEpoch.current !== epoch) return undefined
      throw error
    } finally {
      if (refineRequest.current.id === request.id) setIsRefining(false)
    }
  }, [aiProposal, aiThreadId, cancelRefinement])

  // Preview proposal in presentation mode
  const handlePreviewProposal = useCallback(() => {
    if (!aiProposal) return

    if (aiProposal.outputMode === 'draw') {
      setProposalPreview({ outputMode: 'draw', scene: sceneFromDrawing(aiProposal.drawing) })
      return
    }
    const strokeColor = darkMode ? '#78fcd6' : '#555'

    const previewNodes: FlowNode[] = aiProposal.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      parentNode: node.parentNode,
      extent: node.parentNode ? ('parent' as const) : undefined,
      data: {
        label: node.label,
        imageUrl: node.imageUrl,
        containerKind: node.containerKind,
        onLabelChange: () => {},
      },
      style: node.width || node.height ? { width: node.width, height: node.height } : undefined,
    }))

    const previewEdges: Edge[] = aiProposal.edges.map((edge) => ({
      id: edge.id || `e${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'bottom',
      targetHandle: edge.targetHandle || 'top',
      label: edge.label,
      type: edge.style === 'step' ? 'smoothstep' : 'default',
      animated: edge.commStyle ? edge.commStyle === 'async' : edge.style === 'animated',
      data: { protocol: edge.protocol, commStyle: edge.commStyle },
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
    }))

    setProposalPreview({ outputMode: aiProposal.outputMode, nodes: sortParentsFirst(previewNodes), edges: previewEdges })
  }, [aiProposal, darkMode])

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
        imageUrl: node.imageUrl,
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
      ...getEdgeStyleProps(edge.style || 'default'),
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
    // A newly adopted shared version is a replacement document, even when its
    // IDs are reused. Do not apply a proposal prepared against the older one.
    documentEpoch.current++
    setArchitectureScene(chart.architectureScene)
    setDiagramMode(inferDiagramMode(chart))
    const flow = chartToFlow(chart, { onLabelChange: updateNodeLabel, edgeProps: getEdgeStyleProps })
    setNodeIdCounter((counter) => Math.max(counter, nextNumericNodeId(flow.nodes)))

    if (reason === 'initial') {
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setShowWelcomeAI(false)
      setDiagramMode(inferDiagramMode(chart))
      // Undo should not step back to the empty canvas that existed before loading.
      setHistory([{ nodes: flow.nodes, edges: flow.edges, architectureScene: chart.architectureScene, diagramMode: inferDiagramMode(chart) }])
      setHistoryIndex(0)
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
  }, [updateNodeLabel, getEdgeStyleProps, setNodes, setEdges, getViewport, fitSharedChart])

  const shared = useSharedFlow({ nodes, edges, architectureScene, mode: diagramMode, applyChart: applySharedChart })
  const patchNotes = usePatchNotes(
    !previewMode && !proposalPreview && !drawLocalView &&
    ['idle', 'synced', 'saving'].includes(shared.state.status) &&
    !isAIBubbleOpen && !aiProposal && !isRefining &&
    !selectionEdit && !selectionEditBusy && !pendingSelectionEdit && !drawEdit &&
    !pendingImport && !isImporting && !importError,
  )

  const handleDrawChange = useCallback((scene: ArchitectureScene, drawingNodes: FlowNode[], drawingEdges: Edge[]) => {
    // Draw emits completed gestures. Store graph, drawing and mode together so
    // the same Undo/Redo controls also cover imports and renderer switches.
    commitDocument({ nodes: drawingNodes, edges: drawingEdges, architectureScene: scene, diagramMode: 'draw' }, { fit: false })
  }, [commitDocument])

  // Standalone diagrams autosave the complete document, including image assets.
  useEffect(() => {
    if (parseSharedLocation(window.location)) return
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(EDITOR_DRAFT_KEY, serializeFlow(nodes, edges, diagramMode, architectureScene))
        setDraftError(null)
      } catch { setDraftError('Browser storage is full. Export JSON or share the diagram to save your latest changes.') }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [nodes, edges, diagramMode, architectureScene])

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

  if (previewMode && diagramMode === 'draw') {
    return <div className={`app ${darkMode ? 'dark-mode' : 'light-mode'}`}>
      <Suspense fallback={<div className="draw-loading">Loading presentation…</div>}>
        <DrawCanvas scene={architectureScene} nodes={nodes} edges={edges} darkMode={darkMode} onChange={handleDrawChange} viewMode />
      </Suspense>
      <button className="draw-presentation-exit" onClick={togglePreview}>Exit presentation</button>
    </div>
  }

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
    if (proposalPreview.outputMode === 'draw') return <div className={`app ai-native-presentation ${darkMode ? 'dark-mode' : 'light-mode'}`}>
      <NativeProposalPreview scene={proposalPreview.scene} darkMode={darkMode} />
      <button className="draw-presentation-exit" onClick={() => setProposalPreview(null)}>Exit presentation</button>
    </div>
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
    <div className={`app ${darkMode ? 'dark-mode' : 'light-mode'} ${diagramMode === 'draw' ? 'draw-mode' : ''} ${drawLocalView ? 'draw-local-view' : ''}`}>
      {!drawLocalView && <Toolbar
        onAddNode={addNode}
        onAddContainer={addContainer}
        onAddImage={addImageNode}
        onTogglePreview={togglePreview}
        onToggleExplorer={toggleExplorer}
        sidebarMode={sidebarMode}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onClearAll={clearAll}
        clearRequest={drawClearRequest}
        toolMode={toolMode}
        onSetToolMode={setToolMode}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        diagramMode={diagramMode}
        onSetDiagramMode={setDiagramMode}
        reactFlowWrapper={reactFlowWrapper}
        nodes={nodes}
        edges={edges}
        architectureScene={architectureScene}
        onExportDraw={async (format, duration) => {
          if (!drawApi.current) throw new Error('Drawing editor is still loading.')
          await drawApi.current.exportImage(format, duration)
        }}
        onExportExcalidraw={() => {
          if (!drawApi.current) throw new Error('Drawing editor is still loading.')
          const current = drawApi.current.getScene()
          const elements = mergeGraphElements(current.elements as unknown as Parameters<typeof mergeGraphElements>[0], nodes, edges, darkMode)
          exportExcalidrawDrawing(drawingFromScene({ ...current, elements: JSON.parse(JSON.stringify(elements)) }))
        }}
        onImportJson={(importedNodes, importedEdges, importedMode, importedScene) => {
          commitDocument({ nodes: importedNodes, edges: importedEdges, diagramMode: importedMode, architectureScene: importedScene })
        }}
        onImportFile={readImportFile}
        onOpenPatchNotes={() => { setIsAIBubbleOpen(false); patchNotes.open() }}
        share={{
          isShared: !!shared.state.id,
          canEdit: shared.state.canEdit,
          viewUrl: shared.viewUrl,
          editUrl: shared.editUrl,
          creating: shared.state.creating,
          createError: shared.state.createError,
          onCreate: shared.createShare,
        }}
      />}
      {!drawLocalView && <ShareStatus shared={shared} />}
      {draftError && <div className="draw-draft-error" role="alert">{draftError}</div>}
      <div
        ref={reactFlowWrapper}
        className="react-flow-wrapper"
        onDragEnterCapture={(event) => {
          if (!isFileDrag(event)) return
          event.preventDefault()
          fileDragDepth.current += 1
          setIsFileDragOver(true)
        }}
        onDragOverCapture={(event) => {
          if (!isFileDrag(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeaveCapture={(event) => {
          if (!isFileDrag(event)) return
          fileDragDepth.current = Math.max(0, fileDragDepth.current - 1)
          if (!fileDragDepth.current) setIsFileDragOver(false)
        }}
        onDropCapture={handleFileDrop}
        onDragEnd={() => { fileDragDepth.current = 0; setIsFileDragOver(false) }}
      >
        {isFileDragOver && <div className="diagram-file-drop" role="status"><strong>Drop your drawing here</strong><span>Excalidraw scenes and Flowchart JSON files</span></div>}
        {diagramMode === 'draw' ? <Suspense fallback={<div className="draw-loading">Loading drawing tools…</div>}>
          <DrawCanvas scene={architectureScene} nodes={nodes} edges={edges} darkMode={darkMode} onChange={handleDrawChange} onReady={handleDrawReady} onEditSelection={openDrawEdit} onUndo={undo} onRedo={redo} canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1} onToggleTheme={toggleDarkMode} onRequestClear={() => setDrawClearRequest(value => value + 1)} onViewChange={viewing => { drawLocalViewRef.current = viewing; setDrawLocalView(viewing); if (viewing) closeDrawEdit() }} />
        </Suspense> : <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
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
        </ReactFlow>}
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
                {diagramMode !== 'draw' && selectedNodes.length > 0 && <button
                  className="selection-toolbar-button selection-ai-action"
                  onClick={openSelectionEdit}
                  title={`Edit ${selectedNodes.length} selected node${selectedNodes.length === 1 ? '' : 's'} with AI`}
                  aria-label="Edit with AI"
                >✦ <span>Edit with AI</span><span className="selection-ai-count">{selectedNodes.length} node{selectedNodes.length === 1 ? '' : 's'}</span></button>}
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
      {drawEditOpenError && <div className="diagram-import-notice error" role="alert"><span>{drawEditOpenError}</span><button onClick={() => setDrawEditOpenError(null)} aria-label="Dismiss Draw AI error">Dismiss</button></div>}
      {drawEdit && <Suspense fallback={<div className="draw-loading" role="status">Opening Draw AI editor…</div>}>
        <AIDrawEditDialog before={drawEdit.before} selectedIds={drawEdit.snapshot.selectedIds} result={drawEdit.result} stale={!drawEditCurrent(drawEdit.snapshot)} darkMode={darkMode} onGenerate={generateDrawEdit} onApply={applyDrawSelectionEdit} onCancel={closeDrawEdit} />
      </Suspense>}
      {selectionEdit && <Suspense fallback={<div className="draw-loading" role="status">Opening selected-node editor…</div>}>
        <AISelectionEditDialog
          selectedNodes={selectionEdit.selectedNodes}
          boundaryEdges={selectionEdit.boundaryEdges}
          busy={selectionEditBusy}
          error={selectionEditError}
          stale={!!pendingSelectionEdit && !selectionEditSnapshotIsCurrent(pendingSelectionEdit.snapshot, nodes, edges, documentEpoch.current)}
          preview={pendingSelectionEdit?.preview}
          darkMode={darkMode}
          onGenerate={generateSelectionEdit}
          onApply={applySelectionEdit}
          onCancel={closeSelectionEdit}
        />
      </Suspense>}
      {!drawLocalView && !patchNotes.isOpen && showWelcomeAI && nodes.length === 0 && !isAIBubbleOpen && !aiProposal && (
        <AIChat
          nodes={nodes}
          edges={edges}
          diagramMode={diagramMode}
          generationPrompt={generationPrompt}
          onGenerationPromptChange={setGenerationPrompt}
          generationMode={generationMode}
          onGenerationModeChange={setGenerationMode}
          getGenerationContext={getGenerationContext}
          generationRevision={aiDocumentEpoch}
          onProposalReady={handleAIProposalReady}
          isOpen={true}
          onClose={dismissWelcomeAI}
          variant="welcome"
          onDismiss={dismissWelcomeAI}
          onImportJson={(importedNodes, importedEdges, importedMode, importedScene) => {
            commitDocument({ nodes: importedNodes, edges: importedEdges, diagramMode: importedMode, architectureScene: importedScene })
          }}
          onImportFile={readImportFile}
        />
      )}
      {/* Full AI chat overlay (triggered by pill button) */}
      {!drawLocalView && <AIChat
        nodes={nodes}
        edges={edges}
        diagramMode={diagramMode}
        onEditSelection={diagramMode !== 'draw' ? openSelectionEdit : undefined}
        selectedCount={nodes.filter(node => node.selected).length}
        generationPrompt={generationPrompt}
        onGenerationPromptChange={setGenerationPrompt}
        generationMode={generationMode}
        onGenerationModeChange={setGenerationMode}
        getGenerationContext={getGenerationContext}
        generationRevision={aiDocumentEpoch}
        onProposalReady={handleAIProposalReady}
        isOpen={isAIBubbleOpen}
        onClose={() => setIsAIBubbleOpen(false)}
        variant="full"
      />}
      {!drawLocalView && aiProposal && (
        <AIInsertPreviewDialog
          proposal={aiProposal}
          onInsert={insertAIProposal}
          onCancel={cancelAIProposal}
          onPreview={handlePreviewProposal}
          onRefine={handleRefineProposal}
          refinementInput={refinementPrompt}
          onRefinementInputChange={setRefinementPrompt}
          isRefining={isRefining}
          onCancelRefine={cancelRefinement}
          error={aiInsertError}
          darkMode={darkMode}
        />
      )}
      {!drawLocalView && pendingImport && <ExcalidrawImportDialog filename={pendingImport.filename} scene={pendingImport.scene} onOpen={() => { void applyExcalidrawImport('open') }} onInsert={() => { void applyExcalidrawImport('insert') }} onCancel={cancelImport} busy={isImporting} error={importError} compatibilityNotes={getExcalidrawCompatibilityNotes(pendingImport.scene)} />}
      {isImporting && !pendingImport && <div className="diagram-import-notice" role="status"><span>Reading and validating your drawing…</span><button onClick={cancelImport}>Cancel</button></div>}
      {importError && !pendingImport && <div className="diagram-import-notice error" role="alert"><span><strong>Couldn’t import drawing</strong>{importError}</span><button onClick={() => setImportError(null)} aria-label="Dismiss import error">Dismiss</button></div>}
      {patchNotes.isOpen && <PatchNotesDialog onDismiss={patchNotes.dismiss} />}
      {/* Show pill when welcome prompt is not visible and AI bubble is not open */}
      {!drawLocalView && !patchNotes.isOpen && !isAIBubbleOpen && !(showWelcomeAI && nodes.length === 0 && !aiProposal) && (
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
