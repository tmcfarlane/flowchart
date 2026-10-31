import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Node, Edge } from 'reactflow'
import type { ArchitectureScene } from '../shared/architectureScene'
import { SUPPORTED_ARCHITECTURE_IMAGE_MIME_TYPES, validateArchitectureScene } from '../shared/architectureScene'
import { graphFromElements, graphSignature, mergeGraphScene } from '../utils/architectureBridge'
import { drawingFontFamily, drawingTextSize } from '../utils/drawText'
import { DRAW_FONT_FAMILY, DRAW_LINE_HEIGHT, isGeneratedDrawFont } from '../shared/drawFont'
import { cropImageElement, validImageCrop, type ImageCrop } from '../utils/drawMedia'
import { mermaidToScene, recognizeStroke, safeEmbedUrl, type PaintTarget } from '../utils/drawExtraTools'
import { createElement, deleteElements, duplicateSelection, editableSelection, expandSelection, lockedElementIds, getElementBounds, getElementCenter, getSceneBounds, getWorldPoints, moveElements, newDrawId, rerouteBindings, resizeElement, rotateElements, rotatePoint, setElementProperties, type Bounds, type DrawElement, type Point } from '../utils/drawScene'
import { createConnectedShape, directions, flipSelection, lassoSelection, navigateConnection, type Direction } from '../utils/drawGeometry'
import { applyDrawEdit, drawEditIsCurrent, type DrawEditSnapshot } from '../utils/drawSelectionEdit'
import type { DrawEditProposal } from '../shared/drawSelectionEdit'
import DrawSceneSvg from './DrawSceneSvg'
import DrawToolIcon from './DrawToolIcon'
import DrawLibrary from './DrawLibrary'
import { drawCommands, type DrawCommandId } from './drawCommands'
import './DrawCanvas.css'

export interface DrawCanvasApi {
  viewportToScenePoint: (point: Point) => Point
  fitScene: () => void
  getScene: () => ArchitectureScene
  getSelectedIds: () => string[]
  applySelectionEdit: (snapshot: DrawEditSnapshot, proposal: DrawEditProposal) => boolean
  replaceScene: (scene: ArchitectureScene, fit?: boolean) => void
  exportImage: (format: 'png' | 'svg' | 'gif', duration?: number) => Promise<void>
}
export type ArchitectureCanvasApi = DrawCanvasApi
export interface DrawCanvasProps {
  scene?: ArchitectureScene
  nodes: Node[]
  edges: Edge[]
  darkMode: boolean
  onChange: (scene: ArchitectureScene, nodes: Node[], edges: Edge[]) => void
  onReady?: (api: DrawCanvasApi | null) => void
  onEditSelection?: () => void
  viewMode?: boolean
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  onToggleTheme?: () => void
  onRequestClear?: () => void
  onViewChange?: (viewing: boolean) => void
}

type Tool = 'lasso' | 'laser' | 'eyedropper' | 'fill' | 'shape' | 'selection' | 'hand' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'freedraw' | 'text' | 'image' | 'eraser' | 'frame'
interface Viewport { x: number; y: number; zoom: number }
interface GestureBase {
  start: Point
  screen: Point
  before: ArchitectureScene
  base: ArchitectureScene
  ids: string[]
  viewport: Viewport
  bounds?: Bounds
  corner?: string
  elementId?: string
  pointIndex?: number
  panButton?: number
  deep?: boolean
  recognize?: boolean
}
type Gesture = GestureBase & (
  | { kind: 'lasso'; polygon: Point[]; additive: boolean }
  | { kind: 'create' | 'move' | 'pan' | 'marquee' | 'resize' | 'rotate' | 'point' | 'erase' | 'connector-click' | 'laser' }
)
interface LaserTrace { id: number; points: Point[]; finished: boolean }
interface TextEdit { id: string; value: string; before: ArchitectureScene }
interface PendingConnector { id: string; before: ArchitectureScene; fixed: Point[]; hover: Point; preventBinding: boolean }
interface PointEdit { id: string; index: number }
type DrawPanel =
  | { kind: 'closed' }
  | { kind: 'search'; query: string; activeId: string | null }
  | { kind: 'palette'; query: string }
  | { kind: 'statistics' }
  | { kind: 'link'; elementId: string; value: string }
interface CropEdit { id: string; before: ArchitectureScene; crop: ImageCrop }
interface CropDrag { point: Point; crop: ImageCrop; handle: 'move' | 'nw' | 'ne' | 'sw' | 'se' }
interface AsyncScene { scene: ArchitectureScene; generation: number; epoch: number; signature: string }
interface ClipboardInput { target: EventTarget | null; clipboardData: DataTransfer | null; preventDefault: () => void }
const tools: Array<{ tool: Tool; name: string; shortcut: string; glyph: string }> = [
  { tool: 'selection', name: 'Selection', shortcut: 'V / 1', glyph: '↖' },
  { tool: 'lasso', name: 'Lasso', shortcut: 'J', glyph: '◌' },
  { tool: 'hand', name: 'Hand', shortcut: 'H', glyph: '✋' },
  { tool: 'rectangle', name: 'Rectangle', shortcut: 'R / 2', glyph: '▭' },
  { tool: 'diamond', name: 'Diamond', shortcut: 'D / 3', glyph: '◇' },
  { tool: 'ellipse', name: 'Ellipse', shortcut: 'O / 4', glyph: '○' },
  { tool: 'arrow', name: 'Arrow', shortcut: 'A / 5', glyph: '↗' },
  { tool: 'line', name: 'Line', shortcut: 'L / 6', glyph: '╱' },
  { tool: 'freedraw', name: 'Pen', shortcut: 'P / 7', glyph: '〰' },
  { tool: 'text', name: 'Text', shortcut: 'T / 8', glyph: 'T' },
  { tool: 'image', name: 'Image', shortcut: '9', glyph: '▧' },
  { tool: 'eraser', name: 'Eraser', shortcut: 'E / 0', glyph: '⌫' },
  { tool: 'frame', name: 'Frame', shortcut: 'F', glyph: '▣' },
]
const extraTools: Array<{ tool: Tool; name: string; shortcut: string }> = [
  { tool: 'laser', name: 'Laser pointer', shortcut: 'K' },
  { tool: 'eyedropper', name: 'Eyedropper', shortcut: 'I' },
  { tool: 'fill', name: 'Fill', shortcut: 'B' },
  { tool: 'shape', name: 'Draw to shape', shortcut: '' },
]
const empty = (): ArchitectureScene => ({ version: 1, elements: [], files: {}, appState: { viewBackgroundColor: '#ffffff', gridSize: 20 } })
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const live = (scene: ArchitectureScene) => (scene.elements as DrawElement[]).filter(element => !element.isDeleted)
const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]')
const validLink = (value: string): string | null => {
  try {
    const url = new URL(value.trim())
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}
const intersection = (a: Bounds, b: Bounds) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
const inside = (point: Point, box: Bounds, padding = 0) => point.x >= box.x - padding && point.x <= box.x + box.width + padding && point.y >= box.y - padding && point.y <= box.y + box.height + padding
const patchElement = (scene: ArchitectureScene, id: string, patch: Partial<DrawElement>): ArchitectureScene => ({ ...scene, elements: scene.elements.map(element => element.id === id ? { ...element, ...patch } : element) })
const samePoint = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.001
const constrainedPoint = (start: Point, end: Point, constrained: boolean): Point => {
  if (!constrained) return end
  const dx = end.x - start.x, dy = end.y - start.y
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy)
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length }
}
/** Keep rotations and relationships when changing path geometry in world space. */
const withPathPoints = (scene: ArchitectureScene, id: string, world: Point[], bindingPatch: Partial<DrawElement> = {}, reroute = true): ArchitectureScene => {
  const element = live(scene).find(item => item.id === id)
  if (!element || world.length < 2) return scene
  const unrotated = world.map(position => rotatePoint(position, { x: 0, y: 0 }, -(element.angle ?? 0)))
  const xs = unrotated.map(position => position.x), ys = unrotated.map(position => position.y)
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  const worldCenter = rotatePoint(center, { x: 0, y: 0 }, element.angle ?? 0), origin = unrotated[0]
  const next = patchElement(scene, id, { x: worldCenter.x - center.x + origin.x, y: worldCenter.y - center.y + origin.y,
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    points: unrotated.map(position => [position.x - origin.x, position.y - origin.y]), ...bindingPatch })
  return reroute ? rerouteBindings(next, [id]) : next
}
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Flowchart's own drawing editor. Pointer previews stay local; each completed
 * gesture emits one document update and one undo transaction. */
export default function DrawCanvas(props: DrawCanvasProps) {
  const { nodes, edges, scene, darkMode, onReady, viewMode = false } = props
  const latest = useRef(props); latest.current = props
  const [seeded] = useState<ArchitectureScene>(() => mergeGraphScene(scene ?? empty(), nodes, edges, darkMode))
  const [draft, setDraft] = useState(seeded)
  const draftRef = useRef(draft)
  const committed = useRef(seeded)
  const [initialInputSignature] = useState(() => scene ? JSON.stringify(scene) : '')
  const [initialGraphSignature] = useState(() => graphSignature(nodes, edges))
  const lastEmitted = useRef(initialInputSignature)
  const lastGraph = useRef(initialGraphSignature)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const viewportRef = useRef(viewport); viewportRef.current = viewport
  const [tool, setTool] = useState<Tool>('selection')
  const [extraMenu, setExtraMenu] = useState(false)
  const [inspector, setInspector] = useState<null | 'properties' | 'components'>(null)
  const toolsShell = useRef<HTMLDivElement>(null)
  const moreToolsButton = useRef<HTMLButtonElement>(null)
  const propertiesButton = useRef<HTMLButtonElement>(null)
  const [extraDialog, setExtraDialog] = useState<'embed' | 'mermaid' | null>(null)
  const [extraInput, setExtraInput] = useState('')
  const [sampleTarget, setSampleTarget] = useState<PaintTarget>('strokeColor')
  const [laserTraces, setLaserTraces] = useState<LaserTrace[]>([])
  const laserCounter = useRef(0)
  const laserTimers = useRef(new Map<number, number>())
  const [liveEmbed, setLiveEmbed] = useState<string | null>(null)
  const [keepTool, setKeepTool] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedRef = useRef(selectedIds); selectedRef.current = selectedIds
  const [lasso, setLasso] = useState<Point[] | null>(null)
  const [marquee, setMarquee] = useState<Bounds | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({})
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  const [pointEdit, setPointEdit] = useState<PointEdit | null>(null)
  const [cropEdit, setCropEdit] = useState<CropEdit | null>(null)
  const cropDrag = useRef<CropDrag | null>(null)
  const [creatingConnector, setCreatingConnector] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const cropDialogRef = useRef<HTMLElement>(null)
  const cropReturnFocus = useRef<HTMLElement | null>(null)
  const [defaults, setDefaults] = useState<Partial<DrawElement>>({ strokeColor: '#0f766e', backgroundColor: 'transparent', strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid', roughness: 0, opacity: 100, fontSize: 20, fontFamily: 2, textAlign: 'left', roundness: { type: 3 }, endArrowhead: 'arrow' })
  const [help, setHelp] = useState(false)
  const [panel, setPanel] = useState<DrawPanel>({ kind: 'closed' })
  const [localView, setLocalView] = useState(false)
  const [zen, setZen] = useState(false)
  const readOnly = viewMode || localView
  const readOnlyRef = useRef(readOnly); readOnlyRef.current = readOnly
  const [showTextProperties, setShowTextProperties] = useState(false)
  const styleClipboard = useRef<Partial<DrawElement> | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [grid, setGrid] = useState(false)
  const [snap, setSnap] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [initialHistory] = useState(() => [copy(seeded)])
  const history = useRef(initialHistory)
  const historyIndex = useRef(0)
  const clipboard = useRef<ArchitectureScene | null>(null)
  const pasteOffset = useRef(0)
  const clipboardEvents = useRef<Record<'copy' | 'cut' | 'paste', (event: ClipboardInput) => void>>({ copy: () => {}, cut: () => {}, paste: () => {} })
  const gesture = useRef<Gesture | null>(null)
  const pendingConnector = useRef<PendingConnector | null>(null)
  const pointEditRef = useRef(pointEdit); pointEditRef.current = pointEdit
  const nudgeBefore = useRef<ArchitectureScene | null>(null)
  const heldSpace = useRef(false)
  const surface = useRef<SVGSVGElement>(null)
  const wrapper = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const sceneEpoch = useRef(0)
  const interactionGeneration = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (!extraMenu) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!toolsShell.current?.contains(event.target as globalThis.Node)) setExtraMenu(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [extraMenu])

  const modalOpen = () => panel.kind !== 'closed' || help || !!cropEdit || !!textEdit || !!document.querySelector('[role="dialog"]')
  const preview = useCallback((next: ArchitectureScene) => { interactionGeneration.current++; draftRef.current = next; setDraft(next) }, [])
  const captureAsyncScene = (): AsyncScene | null => {
    const signature = JSON.stringify(committed.current)
    if (readOnlyRef.current || modalOpen() || pendingConnector.current || gesture.current || JSON.stringify(draftRef.current) !== signature) return null
    return { scene: copy(committed.current), generation: interactionGeneration.current, epoch: sceneEpoch.current, signature }
  }
  const asyncSceneIsCurrent = (source: AsyncScene) => mounted.current && !readOnlyRef.current && !modalOpen()
    && interactionGeneration.current === source.generation && sceneEpoch.current === source.epoch
    && JSON.stringify(committed.current) === source.signature && JSON.stringify(draftRef.current) === source.signature
  const cancelConnector = useCallback(() => {
    if (pendingConnector.current) preview(pendingConnector.current.before)
    pendingConnector.current = null; setCreatingConnector(false)
  }, [preview])
  const cancelLaser = useCallback(() => {
    if (gesture.current?.kind === 'laser') gesture.current = null
    for (const timer of laserTimers.current.values()) window.clearTimeout(timer)
    laserTimers.current.clear()
    setLaserTraces([])
  }, [])
  useEffect(() => {
    window.addEventListener('blur', cancelLaser)
    return () => {
      window.removeEventListener('blur', cancelLaser)
      for (const timer of laserTimers.current.values()) window.clearTimeout(timer)
      laserTimers.current.clear()
    }
  }, [cancelLaser])
  const worldPoint = useCallback((point: Point): Point => {
    const rect = surface.current?.getBoundingClientRect(), view = viewportRef.current
    return { x: (point.x - (rect?.left ?? 0) - view.x) / view.zoom, y: (point.y - (rect?.top ?? 0) - view.y) / view.zoom }
  }, [])
  const fitScene = useCallback(() => {
    const canvas = surface.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const bounds = getSceneBounds(draftRef.current.elements)
    if (!bounds.width && !bounds.height) { setViewport({ x: 0, y: 0, zoom: 1 }); return }
    const inlineReserve = Number(getComputedStyle(canvas).getPropertyValue('--draw-fit-inline-reserve'))
    const zoom = Math.max(0.1, Math.min(1.4, (rect.width - inlineReserve) / Math.max(1, bounds.width), (rect.height - 170) / Math.max(1, bounds.height)))
    setViewport({ x: (rect.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (rect.height - bounds.height * zoom) / 2 - bounds.y * zoom + 18, zoom })
  }, [])

  const emit = useCallback((next: ArchitectureScene, record = true) => {
    if (readOnlyRef.current) return false
    const current = latest.current
    let graph: ReturnType<typeof graphFromElements>, complete: ArchitectureScene
    try {
      graph = graphFromElements(next.elements as DrawElement[], current.nodes, current.edges)
      complete = validateArchitectureScene({ ...next, elements: [...graph.elements] })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This change could not be saved.')
      preview(copy(committed.current)); return false
    }
    if (JSON.stringify(complete) === JSON.stringify(committed.current)) { preview(complete); return true }
    if (record && !current.onUndo) {
      history.current = [...history.current.slice(0, historyIndex.current + 1), copy(complete)].slice(-100)
      historyIndex.current = history.current.length - 1
      setHistoryVersion(value => value + 1)
    }
    committed.current = copy(complete)
    lastEmitted.current = JSON.stringify(complete)
    lastGraph.current = graphSignature(graph.nodes, graph.edges)
    preview(complete)
    current.onChange(complete, graph.nodes, graph.edges)
    return true
  }, [preview])

  const undo = useCallback(() => {
    cancelLaser()
    if (readOnlyRef.current) return
    if (pendingConnector.current) { cancelConnector(); return }
    setPointEdit(null)
    if (latest.current.onUndo) { latest.current.onUndo(); return }
    if (historyIndex.current > 0) { historyIndex.current--; emit(copy(history.current[historyIndex.current]), false); setHistoryVersion(value => value + 1) }
  }, [emit, cancelConnector, cancelLaser])
  const redo = useCallback(() => {
    cancelLaser()
    if (readOnlyRef.current) return
    cancelConnector(); setPointEdit(null)
    if (latest.current.onRedo) { latest.current.onRedo(); return }
    if (historyIndex.current + 1 < history.current.length) { historyIndex.current++; emit(copy(history.current[historyIndex.current]), false); setHistoryVersion(value => value + 1) }
  }, [emit, cancelConnector, cancelLaser])

  useEffect(() => {
    const serialized = scene ? JSON.stringify(scene) : '', signature = graphSignature(nodes, edges)
    if (serialized === lastEmitted.current && signature === lastGraph.current) return
    const next = mergeGraphScene(scene ?? empty(), nodes, edges, darkMode)
    sceneEpoch.current++
    committed.current = copy(next); lastEmitted.current = serialized; lastGraph.current = signature
    cancelLaser(); gesture.current = null; setLasso(null); setCropEdit(null); pendingConnector.current = null; setCreatingConnector(false); setPointEdit(null); nudgeBefore.current = null; setIsPanning(false); setLiveEmbed(null); preview(next)
  }, [scene, nodes, edges, darkMode, preview, cancelLaser])
  useEffect(() => { const frame = requestAnimationFrame(fitScene); return () => cancelAnimationFrame(frame) }, [fitScene])
  useEffect(() => { if (!viewMode) wrapper.current?.focus({ preventScroll: true }) }, [viewMode])
  useEffect(() => { if (readOnly) { sceneEpoch.current++; cancelConnector(); cancelLaser(); setPointEdit(null); gesture.current = null; setLasso(null); setCropEdit(null); nudgeBefore.current = null; setTextEdit(null); setIsPanning(false); setLiveEmbed(null); preview(copy(committed.current)) } }, [readOnly, cancelConnector, cancelLaser, preview])
  useEffect(() => { if (textEdit) { textRef.current?.focus(); textRef.current?.select() } }, [textEdit?.id])
  useEffect(() => { if (cropEdit) cropDialogRef.current?.querySelector('input')?.focus() }, [cropEdit?.id])

  const exportImage = useCallback(async (format: 'png' | 'svg' | 'gif', duration = 2, selectedOnly = false) => {
    const content = surface.current?.querySelector('[data-draw-content]')
    const source = copy(draftRef.current)
    const ids = selectedOnly ? new Set(expandSelection(source, selectedRef.current, true)) : null
    const elements = live(source).filter(element => !ids || ids.has(element.id))
    if (!content || !elements.length) throw new Error(selectedOnly ? 'Select a drawing object before copying PNG.' : 'Draw something before exporting.')
    if (elements.some(element => isGeneratedDrawFont(element.customData))) await document.fonts.load(`16px "${DRAW_FONT_FAMILY}"`)
    const snapshot = content.cloneNode(true) as Element
    if (ids) for (const item of snapshot.querySelectorAll('[data-element-id]')) if (!ids.has(item.getAttribute('data-element-id') ?? '')) item.remove()
    const bounds = getSceneBounds(elements), padding = 32
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    svg.setAttribute('viewBox', `${bounds.x - padding} ${bounds.y - padding} ${Math.max(1, bounds.width) + padding * 2} ${Math.max(1, bounds.height) + padding * 2}`)
    svg.setAttribute('width', String(Math.max(1, bounds.width) + padding * 2)); svg.setAttribute('height', String(Math.max(1, bounds.height) + padding * 2))
    const background = document.createElementNS(svg.namespaceURI, 'rect')
    background.setAttribute('x', String(bounds.x - padding)); background.setAttribute('y', String(bounds.y - padding)); background.setAttribute('width', svg.getAttribute('width')!); background.setAttribute('height', svg.getAttribute('height')!); const stored = source.appState?.viewBackgroundColor ?? '#ffffff'
    background.setAttribute('fill', darkMode && ['#fff', '#ffffff', 'white'].includes(stored.toLowerCase()) ? '#0f1211' : stored)
    svg.append(background, snapshot)
    // Only the on-canvas editor hides its original label; exports keep it.
    for (const label of svg.querySelectorAll('[data-editing-text]')) {
      label.removeAttribute('visibility'); label.removeAttribute('data-editing-text')
    }
    // Projected architecture icons may reference local bundled SVG assets.
    // Make the exported scene self-contained before either vector or raster export.
    await Promise.all(Array.from(svg.getElementsByTagName('image')).map(async asset => {
      const href = asset.getAttribute('href') || asset.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      if (!href || href.startsWith('data:')) return
      const url = new URL(href, window.location.href)
      if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && url.origin !== window.location.origin)) throw new Error('An image cannot be embedded in this export.')
      const response = await fetch(url, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('A drawing image could not be loaded for export.')
      const blob = await response.blob()
      const dataURL = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('A drawing image could not be embedded.')); reader.readAsDataURL(blob) })
      asset.setAttribute('href', dataURL)
      asset.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
    }))
    const serialized = new XMLSerializer().serializeToString(svg)
    if (format === 'svg') { download(new Blob([serialized], { type: 'image/svg+xml' }), 'drawing.svg'); return }
    const image = new Image(), url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml' }))
    try {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Drawing could not be rendered for export.')); image.src = url })
      const canvas = document.createElement('canvas'), maxSide = 4096
      const scale = Math.min(2, maxSide / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.ceil(image.width * scale)); canvas.height = Math.max(1, Math.ceil(image.height * scale))
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      if (format === 'png') {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed.')), 'image/png'))
        if (selectedOnly) {
          if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('PNG clipboard access is unavailable in this browser.')
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) }
          catch { throw new Error('Could not copy PNG. Allow clipboard access and try again.') }
        } else download(blob, 'drawing.png')
      } else {
        const { default: GIF } = await import('gif.js')
        await new Promise<void>((resolve, reject) => {
          const gif = new GIF({ workers: 2, quality: 10, workerScript: '/gif.worker.js', width: canvas.width, height: canvas.height, repeat: 0 })
          gif.addFrame(canvas, { copy: true, delay: Math.max(100, duration * 1000) }); gif.on('finished', (blob: Blob) => { download(blob, 'drawing.gif'); resolve() }); gif.on('error', reject); gif.render()
        })
      }
    } finally { URL.revokeObjectURL(url) }
  }, [darkMode])

  useEffect(() => {
    if (!onReady) return
    onReady({ viewportToScenePoint: worldPoint, fitScene, getScene: () => copy(committed.current), getSelectedIds: () => [...selectedRef.current],
      applySelectionEdit: (snapshot, proposal) => {
        if (readOnlyRef.current || cropEdit || textEdit || extraDialog || gesture.current || pendingConnector.current || nudgeBefore.current || JSON.stringify(draftRef.current) !== JSON.stringify(committed.current)
          || !drawEditIsCurrent(snapshot, committed.current, [...selectedRef.current], snapshot.epoch)) return false
        return emit(applyDrawEdit(committed.current, snapshot, proposal, latest.current.nodes, latest.current.edges))
      }, replaceScene: (next, fit = false) => { sceneEpoch.current++; cancelConnector(); cancelLaser(); setPointEdit(null); setCropEdit(null); emit(validateArchitectureScene(next)); if (fit) requestAnimationFrame(fitScene) }, exportImage })
    return () => onReady(null)
  }, [onReady, worldPoint, fitScene, emit, exportImage, cancelConnector, cancelLaser])

  const select = (ids: Iterable<string>) => { const selected = new Set(ids); selectedRef.current = selected; setSelectedIds(selected); pointEditRef.current = null; setPointEdit(null) }
  const setActiveTool = (next: Tool, paintTarget: PaintTarget = 'strokeColor') => { if (gesture.current?.kind === 'lasso') { select(gesture.current.ids); gesture.current = null; setLasso(null) } cancelConnector(); cancelLaser(); if (next === 'eyedropper') setSampleTarget(paintTarget); setPointEdit(null); setTool(next); setExtraMenu(false); setLiveEmbed(null); if (next === 'image') fileInput.current?.click(); wrapper.current?.focus() }
  const openExtraDialog = (next: 'embed' | 'mermaid') => { if (gesture.current?.kind === 'lasso') { select(gesture.current.ids); gesture.current = null; setLasso(null) } cancelConnector(); cancelLaser(); setExtraDialog(next); setExtraInput(''); setExtraMenu(false) }
  const applyProperties = (properties: Partial<DrawElement>) => {
    if (selectedRef.current.size) {
      const next = setElementProperties(draftRef.current, selectedRef.current, properties)
      if (pendingConnector.current) preview(next); else emit(next)
    }
    else setDefaults(current => ({ ...current, ...properties }))
  }
  const groupSelection = (ungroup = false) => {
    const id = newDrawId('group'), editable = new Set(editableSelection(draftRef.current, selectedRef.current))
    if (!editable.size) return
    emit({ ...draftRef.current, elements: draftRef.current.elements.map(raw => {
      const element = raw as DrawElement
      if (!editable.has(element.id)) return element
      return { ...element, groupIds: ungroup ? (element.groupIds ?? []).slice(0, -1) : [...(element.groupIds ?? []), id] }
    }) })
  }
  const reorder = (direction: 'front' | 'back' | 'forward' | 'backward') => {
    const elements = [...draftRef.current.elements], selected = new Set(editableSelection(draftRef.current, selectedRef.current))
    if (!selected.size) return
    if (direction === 'front' || direction === 'back') {
      const chosen = elements.filter(e => selected.has(String(e.id))), rest = elements.filter(e => !selected.has(String(e.id)))
      emit({ ...draftRef.current, elements: direction === 'front' ? [...rest, ...chosen] : [...chosen, ...rest] }); return
    }
    const step = direction === 'forward' ? -1 : 1
    for (let i = step === -1 ? elements.length - 2 : 1; step === -1 ? i >= 0 : i < elements.length; i += step) {
      const neighbor = i - step
      if (selected.has(String(elements[i].id)) && !selected.has(String(elements[neighbor].id))) [elements[i], elements[neighbor]] = [elements[neighbor], elements[i]]
    }
    emit({ ...draftRef.current, elements })
  }
  const align = (side: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY') => {
    const editable = new Set(editableSelection(draftRef.current, selectedRef.current))
    const chosen = live(draftRef.current).filter(e => editable.has(e.id) && !(e.containerId && editable.has(e.containerId)))
    if (chosen.length < 2) return
    const bounds = getSceneBounds(chosen)
    let next = draftRef.current
    for (const element of chosen) {
      const box = getElementBounds(element)
      const x = side === 'left' ? bounds.x - box.x : side === 'right' ? bounds.x + bounds.width - box.x - box.width : side === 'centerX' ? bounds.x + bounds.width / 2 - box.x - box.width / 2 : 0
      const y = side === 'top' ? bounds.y - box.y : side === 'bottom' ? bounds.y + bounds.height - box.y - box.height : side === 'centerY' ? bounds.y + bounds.height / 2 - box.y - box.height / 2 : 0
      next = moveElements(next, [element.id], { x, y }, true)
    }
    emit(next)
  }
  const duplicate = () => { const ids = editableSelection(draftRef.current, selectedRef.current); if (!ids.length) return; const next = duplicateSelection(draftRef.current, ids, undefined, true, true); select(next.selectedIds); emit(next.scene) }
  const copySelection = () => {
    const ids = new Set(expandSelection(draftRef.current, selectedRef.current, true))
    if (!ids.size) return null
    const graphIds = new Set(live(draftRef.current).filter(element => ids.has(element.id)).flatMap(element => { const metadata = element.customData?.flowchart as Record<string, unknown> | undefined; return metadata?.kind === 'node' && typeof metadata.id === 'string' ? [metadata.id] : [] }))
    const elements = draftRef.current.elements.filter(e => ids.has(String(e.id))).map(raw => {
      const element = copy(raw) as DrawElement
      const metadata = element.customData?.flowchart as Record<string, unknown> | undefined
      if (metadata && element.customData) {
        const saved = metadata.snapshot as Record<string, unknown> | undefined
        if ((metadata.kind === 'edge' && (!graphIds.has(String(saved?.source)) || !graphIds.has(String(saved?.target)))) || (metadata.kind === 'icon' && !graphIds.has(String(metadata.id)))) delete element.customData.flowchart
        else if (metadata.kind === 'node' && saved && typeof saved.parentNode === 'string' && !graphIds.has(saved.parentNode)) { const { parentNode: _parent, ...detached } = saved; element.customData.flowchart = { ...metadata, snapshot: detached } }
      }
      return { ...element, frameId: element.frameId && ids.has(element.frameId) ? element.frameId : null, containerId: element.containerId && ids.has(element.containerId) ? element.containerId : null,
        boundElements: element.boundElements?.filter(bound => ids.has(bound.id)) ?? null,
        startBinding: element.startBinding && ids.has(element.startBinding.elementId) ? element.startBinding : null,
        endBinding: element.endBinding && ids.has(element.endBinding.elementId) ? element.endBinding : null }
    })
    const fileIds = new Set(elements.flatMap(element => element.fileId ? [element.fileId] : []))
    clipboard.current = { ...copy(draftRef.current), elements, files: Object.fromEntries(Object.entries(draftRef.current.files).filter(([id]) => fileIds.has(id))) }
    pasteOffset.current = 0
    return clipboard.current
  }
  const insertComponent = (component: ArchitectureScene, offset = 0) => {
    if (readOnlyRef.current) return false
    try {
      const valid = validateArchitectureScene(component), bounds = getSceneBounds(valid.elements), rect = surface.current?.getBoundingClientRect()
      const center = worldPoint({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 })
      const result = duplicateSelection(valid, live(valid).map(element => element.id), { x: center.x - bounds.x - bounds.width / 2 + offset, y: center.y - bounds.y - bounds.height / 2 + offset }, true)
      const originalIds = new Set(valid.elements.map(element => element.id)), added = result.scene.elements.filter(element => !originalIds.has(element.id))
      const fileIds = new Set(added.flatMap(raw => { const element = raw as DrawElement; return element.fileId ? [element.fileId] : [] }))
      const files = Object.fromEntries(Object.entries(result.scene.files).filter(([id]) => fileIds.has(id)))
      const source = committed.current
      const next = validateArchitectureScene({ ...source, elements: [...source.elements, ...added], files: { ...source.files, ...files } })
      if (!emit(next)) return false
      select(result.selectedIds); setTool('selection'); return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'This drawing could not be inserted.'); return false }
  }
  const submitExtra = () => {
    if (readOnlyRef.current) return
    try {
      if (extraDialog === 'embed') {
        const url = safeEmbedUrl(extraInput)
        const rect = surface.current?.getBoundingClientRect()
        const center = worldPoint({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 })
        const element = createElement('embeddable', { x: center.x - 160, y: center.y - 100 }, { x: center.x + 160, y: center.y + 100 }, { link: url })
        if (emit({ ...committed.current, elements: [...committed.current.elements, element] })) select([element.id])
      } else if (extraDialog === 'mermaid') insertComponent(mermaidToScene(extraInput))
      setExtraDialog(null); setExtraInput('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add this content.') }
  }
  const pasteSelection = () => { if (!readOnlyRef.current && !modalOpen() && clipboard.current?.elements.length) { pasteOffset.current += 24; insertComponent(clipboard.current, pasteOffset.current) } }
  const pasteText = (text: string) => {
    if (!text || readOnlyRef.current || modalOpen()) return
    if (text.length > 100_000) { setMessage('Paste a shorter text selection.'); return }
    const rect = surface.current?.getBoundingClientRect()
    const point = worldPoint({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 })
    const lines = text.split(/\r\n|\n|\r/)
    const fontSize = defaults.fontSize ?? 20
    const width = Math.max(24, lines.reduce((longest, line) => Math.max(longest, line.length), 0) * fontSize * 0.61)
    const height = Math.max(fontSize * 1.3, lines.length * fontSize * 1.3)
    const element = createElement('text', { x: point.x - width / 2, y: point.y - height / 2 }, undefined, { ...defaults, text, originalText: text, width, height })
    const source = committed.current
    if (emit({ ...source, elements: [...source.elements, element] })) { select([element.id]); setTool('selection') }
  }
  const writeClipboard = (event: ClipboardInput, cut = false) => {
    if (editableTarget(event.target) || editableTarget(document.activeElement)) return
    if (modalOpen()) { if (cut) event.preventDefault(); return }
    if (cut && readOnlyRef.current) { event.preventDefault(); return }
    if (pendingConnector.current) { cancelConnector(); select([]); return }
    const selected = copySelection()
    if (!selected?.elements.length || !event.clipboardData) return
    const serialized = JSON.stringify({ type: 'flowchart-drawing', scene: selected })
    try {
      event.clipboardData.setData('application/x-flowchart-drawing', serialized)
      event.clipboardData.setData('text/plain', serialized)
    } catch { setMessage('Could not copy the drawing. Allow clipboard access and try again.'); return }
    event.preventDefault()
    if (cut) { emit(deleteElements(draftRef.current, selectedRef.current, true)); select([]) }
  }
  const readClipboard = (event: ClipboardInput) => {
    if (editableTarget(event.target) || editableTarget(document.activeElement)) return
    if (modalOpen()) { event.preventDefault(); return }
    if (cropEdit || textEdit) { event.preventDefault(); return }
    if (!event.clipboardData) return
    if (readOnlyRef.current) { event.preventDefault(); return }
    cancelConnector(); setPointEdit(null)
    const own = event.clipboardData.getData('application/x-flowchart-drawing')
    if (own) {
      event.preventDefault()
      try {
        const parsed = JSON.parse(own) as { type?: string; scene?: unknown }
        if (parsed.type !== 'flowchart-drawing') throw new Error('The drawing clipboard data is invalid.')
        clipboard.current = validateArchitectureScene(parsed.scene); pasteOffset.current = 0; pasteSelection()
      } catch (error) { setMessage(error instanceof Error ? error.message : 'The drawing clipboard data is invalid.') }
      return
    }
    const image = Array.from(event.clipboardData.files).find(file => file.type.startsWith('image/'))
    if (image) { event.preventDefault(); void uploadImage(image).catch(() => { if (mounted.current) setMessage('This clipboard image could not be read.') }); return }
    const text = event.clipboardData.getData('text/plain')
    if (text) { event.preventDefault(); pasteText(text) }
  }
  clipboardEvents.current = { copy: event => writeClipboard(event), cut: event => writeClipboard(event, true), paste: readClipboard }
  useEffect(() => {
    // Some browsers dispatch non-editable canvas clipboard events on body.
    const listeners = (['copy', 'cut', 'paste'] as const).map(type => {
      const listener = (event: globalThis.ClipboardEvent) => {
        if (!event.defaultPrevented && wrapper.current?.contains(document.activeElement) && !wrapper.current.contains(event.target as globalThis.Node | null)) clipboardEvents.current[type](event)
      }
      document.addEventListener(type, listener)
      return { type, listener }
    })
    return () => { for (const { type, listener } of listeners) document.removeEventListener(type, listener) }
  }, [])
  const finishText = () => {
    if (!textEdit) return
    const element = draftRef.current.elements.find(e => e.id === textEdit.id) as DrawElement | undefined
    const value = textEdit.value.trimEnd()
    if (!value && !textEdit.before.elements.some(element => element.id === textEdit.id)) preview(textEdit.before)
    else if (!value) emit(deleteElements(draftRef.current, [textEdit.id], true))
    else if (element?.type === 'frame') emit(patchElement(draftRef.current, element.id, { name: value }))
    else {
      const next = patchElement(draftRef.current, textEdit.id, { text: value, originalText: value, ...drawingTextSize(value, element ?? {}) })
      emit(element?.containerId ? rerouteBindings(next, [element.id]) : next)
    }
    setTextEdit(null); wrapper.current?.focus()
  }
  const beginText = (id?: string, point?: Point) => {
    const before = copy(committed.current)
    let next = draftRef.current, element = live(next).find(e => e.id === id)
    if (element && lockedElementIds(next).has(element.id)) return
    if (element && !['text', 'frame'].includes(element.type)) {
      const host = element
      element = live(next).find(e => e.type === 'text' && e.containerId === host.id)
      if (!element) {
        const center = getElementCenter(host), width = ['rectangle', 'ellipse', 'diamond'].includes(host.type) ? Math.max(24, host.width - 24) : 180
        const height = (defaults.fontSize ?? 20) * 1.3
        element = createElement('text', { x: center.x - width / 2, y: center.y - height / 2 }, undefined, { ...defaults, width, height, text: '', originalText: '', containerId: host.id, textAlign: 'center', verticalAlign: 'middle' })
        next = patchElement({ ...next, elements: [...next.elements, element] }, host.id, { boundElements: [...(host.boundElements ?? []), { id: element.id, type: 'text' }] })
      }
    }
    if (!element) {
      element = createElement('text', point ?? { x: 120, y: 120 }, undefined, { ...defaults, text: '', originalText: '' })
      next = { ...next, elements: [...next.elements, element] }
    }
    if (lockedElementIds(next).has(element.id)) return
    if (element.containerId) next = rerouteBindings(next, [element.id])
    preview(next); select([element.id]); setTextEdit({ id: element.id, value: element.type === 'frame' ? String(element.name ?? '') : element.text ?? '', before })
  }

  const searchResults = (query: string) => query.trim() ? live(draftRef.current).filter(element =>
    [element.text, element.name, element.id].some(value => typeof value === 'string' && value.toLowerCase().includes(query.trim().toLowerCase()))) : []
  const reveal = (id: string) => {
    const element = live(draftRef.current).find(item => item.id === id), rect = surface.current?.getBoundingClientRect()
    if (!element || !rect) return
    const center = getElementCenter(element)
    setViewport(view => ({ ...view, x: rect.width / 2 - center.x * view.zoom, y: rect.height / 2 - center.y * view.zoom }))
    select([id])
  }
  const runCommand = (id: DrawCommandId) => {
    if (readOnly && id !== 'link' && drawCommands.find(command => command.id === id)?.mutates) return
    if (id !== 'palette' && id !== 'search' && id !== 'statistics' && id !== 'link') setPanel({ kind: 'closed' })
    if (id === 'palette') setPanel({ kind: 'palette', query: '' })
    else if (id === 'search') setPanel({ kind: 'search', query: '', activeId: null })
    else if (id === 'statistics') setPanel({ kind: 'statistics' })
    else if (id === 'zen') setZen(value => !value)
    else if (id === 'view') { const next = !localView; readOnlyRef.current = viewMode || next; setLocalView(next); latest.current.onViewChange?.(next) }
    else if (id === 'theme') latest.current.onToggleTheme?.()
    else if (id === 'clear') latest.current.onRequestClear?.()
    else if (id === 'link') {
      const element = live(draftRef.current).find(item => selectedRef.current.has(item.id) && (readOnly || !lockedElementIds(draftRef.current).has(item.id)))
      if (element) setPanel({ kind: 'link', elementId: element.id, value: typeof element.link === 'string' ? element.link : '' })
    }
  }
  const saveLink = (elementId: string, value: string) => {
    const element = live(draftRef.current).find(item => item.id === elementId)
    if (!element || lockedElementIds(draftRef.current).has(element.id) || readOnlyRef.current) return
    const link = value.trim() ? validLink(value) : null
    if (value.trim() && !link) { setMessage('Use an http, https, or mailto link.'); return }
    if (emit(patchElement(draftRef.current, elementId, { link }))) { setMessage(null); setPanel({ kind: 'closed' }) }
  }
  const previousPanelKind = useRef(panel.kind)
  useEffect(() => {
    if (panel.kind === 'closed' && previousPanelKind.current !== 'closed' && !document.querySelector('[aria-modal="true"]')) wrapper.current?.focus()
    else if (panel.kind !== 'closed') wrapper.current?.querySelector<HTMLElement>('.draw-command-input, .draw-panel-close')?.focus()
    previousPanelKind.current = panel.kind
  }, [panel.kind])
  const wasHelpOpen = useRef(help)
  useEffect(() => {
    if (help) wrapper.current?.querySelector<HTMLButtonElement>('.draw-help-close')?.focus()
    else if (wasHelpOpen.current && !document.querySelector('[aria-modal="true"]')) wrapper.current?.focus()
    wasHelpOpen.current = help
  }, [help])
  const previousExtraDialog = useRef(extraDialog)
  useEffect(() => {
    if (!extraDialog && previousExtraDialog.current && !document.querySelector('[aria-modal="true"]')) wrapper.current?.focus()
    previousExtraDialog.current = extraDialog
  }, [extraDialog])
  const beginCrop = async (id: string) => {
    const element = live(committed.current).find(item => item.id === id && item.type === 'image' && !lockedElementIds(committed.current).has(item.id))
    if (!element || readOnlyRef.current) return
    const file = element.fileId ? committed.current.files[element.fileId] : null
    if (!file || typeof file.dataURL !== 'string') return
    const source = captureAsyncScene()
    if (!source) return
    const image = new Image(); image.src = file.dataURL
    try { await image.decode() } catch { setMessage('This image could not be decoded for cropping.'); return }
    if (!asyncSceneIsCurrent(source) || !selectedRef.current.has(id)) return
    const crop: ImageCrop = validImageCrop(element.crop) ? element.crop : { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }
    if (!validImageCrop(crop)) { setMessage('This image has invalid crop dimensions.'); return }
    cropReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    interactionGeneration.current++
    setCropEdit({ id, before: source.scene, crop })
  }
  const updateCropRect = (next: ImageCrop) => {
    if (!cropEdit) return
    if (!validImageCrop(next)) return
    const element = live(draftRef.current).find(item => item.id === cropEdit.id)
    if (!element) return
    try {
      preview(rerouteBindings(patchElement(draftRef.current, element.id, cropImageElement(element, cropEdit.crop, next)), [element.id]))
      setCropEdit({ ...cropEdit, crop: next })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Crop could not be changed.') }
  }
  const updateCrop = (field: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (cropEdit && Number.isFinite(value)) updateCropRect({ ...cropEdit.crop, [field]: value })
  }
  const cropPoint = (event: PointerEvent<SVGSVGElement>): Point => {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(event.currentTarget.getScreenCTM()!.inverse())
    return { x: point.x, y: point.y }
  }
  const moveCrop = (event: PointerEvent<SVGSVGElement>) => {
    if (!cropDrag.current) return
    const start = cropDrag.current, point = cropPoint(event), dx = point.x - start.point.x, dy = point.y - start.point.y
    const crop = start.crop, right = crop.x + crop.width, bottom = crop.y + crop.height
    const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
    if (start.handle === 'move') {
      updateCropRect({ ...crop, x: clamp(crop.x + dx, 0, crop.naturalWidth - crop.width), y: clamp(crop.y + dy, 0, crop.naturalHeight - crop.height) })
      return
    }
    const left = start.handle.includes('w') ? clamp(crop.x + dx, 0, right - 1) : crop.x
    const top = start.handle.includes('n') ? clamp(crop.y + dy, 0, bottom - 1) : crop.y
    const nextRight = start.handle.includes('e') ? clamp(right + dx, left + 1, crop.naturalWidth) : right
    const nextBottom = start.handle.includes('s') ? clamp(bottom + dy, top + 1, crop.naturalHeight) : bottom
    updateCropRect({ ...crop, x: left, y: top, width: nextRight - left, height: nextBottom - top })
  }
  const finishCrop = () => {
    if (!cropEdit) return
    cropDrag.current = null
    setCropEdit(null)
    emit(draftRef.current)
    if (cropReturnFocus.current?.isConnected) cropReturnFocus.current.focus()
    else wrapper.current?.focus()
  }
  const cancelCrop = () => {
    if (!cropEdit) return
    cropDrag.current = null
    preview(cropEdit.before); setCropEdit(null)
    if (cropReturnFocus.current?.isConnected) cropReturnFocus.current.focus()
    else wrapper.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (cropEdit) { if (!cropDialogRef.current?.contains(event.target as globalThis.Node)) event.preventDefault(); return }
    if (modalOpen()) return
    if (editableTarget(event.target)) return
    // Native buttons must keep their Enter/Space activation while focused.
    if (event.target instanceof HTMLElement && event.target.closest('button') && (event.key === 'Enter' || event.code === 'Space')) return
    const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey
    if (event.key === 'Escape' && gesture.current?.kind === 'pan' && gesture.current.panButton === 2) { gesture.current = null; setIsPanning(false); return }
    if (pendingConnector.current && (event.key === 'Escape' || event.key === 'Enter')) {
      event.preventDefault(); if (event.key === 'Escape') { cancelConnector(); select([]) } else finishConnector(); return
    }
    if (pointEditRef.current && (event.key === 'Escape' || event.key === 'Enter')) {
      event.preventDefault()
      if (gesture.current?.kind === 'point') { preview(gesture.current.before); gesture.current = null; return }
      if (nudgeBefore.current) { nudgeBefore.current = null; emit(draftRef.current) }
      setPointEdit(null); wrapper.current?.focus(); return
    }
    if (event.key === 'Escape' && gesture.current?.kind === 'lasso') { event.preventDefault(); select(gesture.current.ids); gesture.current = null; setLasso(null); return }
    if (event.key === 'Escape') { if (gesture.current && gesture.current.kind !== 'laser') preview(gesture.current.before); cancelLaser(); gesture.current = null; setIsPanning(false); setMarquee(null); setHelp(false); setPanel({ kind: 'closed' }); setExtraDialog(null); setExtraMenu(false); setLiveEmbed(null); select([]); setTool('selection'); return }
    if (gesture.current?.kind === 'lasso') return
    if (mod && (event.code === 'Slash' || (event.shiftKey && event.code === 'KeyP'))) { event.preventDefault(); runCommand('palette'); return }
    if (event.altKey && !mod && event.code === 'Slash') { event.preventDefault(); runCommand('statistics'); return }
    if (event.altKey && !mod && event.code === 'KeyZ') { event.preventDefault(); runCommand('zen'); return }
    if (event.altKey && !mod && event.code === 'KeyR') { event.preventDefault(); runCommand('view'); return }
    if (event.altKey && event.shiftKey && !mod && event.code === 'KeyD') { event.preventDefault(); runCommand('theme'); return }
    if (mod && event.code === 'KeyF') { event.preventDefault(); runCommand('search'); return }
    if (mod && event.code === 'KeyK') { event.preventDefault(); runCommand('link'); return }
    if (mod && (event.code === 'Delete' || (event.metaKey && event.code === 'Backspace'))) { event.preventDefault(); runCommand('clear'); return }
    if (key === '?') { event.preventDefault(); setHelp(value => !value); return }
    if (event.code === 'Space') { event.preventDefault(); heldSpace.current = true; return }
    if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
    if (mod && key === 'y') { event.preventDefault(); redo(); return }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); const rect = surface.current?.getBoundingClientRect(), direction = event.key === 'PageDown' ? -1 : 1
      setViewport(view => ({ ...view, x: view.x + (event.shiftKey ? (rect?.width ?? 800) * direction : 0), y: view.y + (event.shiftKey ? 0 : (rect?.height ?? 600) * direction) })); return
    }
    if (mod && ['+', '=', '-', '0'].includes(key)) { event.preventDefault(); setViewport(view => ({ ...view, zoom: key === '0' ? 1 : Math.max(0.1, Math.min(5, view.zoom * (key === '-' ? 0.8 : 1.25))) })); return }
    if (event.shiftKey && event.code === 'Digit1') { event.preventDefault(); fitScene(); return }
    if (readOnly) return
    if (mod && event.shiftKey && key === 'v') {
      event.preventDefault()
      if (pendingConnector.current) { cancelConnector(); select([]) }
      if (!navigator.clipboard?.readText) { setMessage('Plain-text clipboard access is unavailable in this browser.'); return }
      const source = captureAsyncScene()
      if (!source) return
      void navigator.clipboard.readText().then(text => {
        if (asyncSceneIsCurrent(source) && !modalOpen()) pasteText(text)
      }).catch(() => { if (mounted.current) setMessage('Could not paste plain text. Allow clipboard access and try again.') })
      return
    }
    if (event.shiftKey && event.altKey && !mod && (key === 'c' || event.code === 'KeyC')) {
      event.preventDefault()
      void exportImage('png', 2, true).catch(error => setMessage(error instanceof Error ? error.message : 'Could not copy PNG.'))
      return
    }
    if (!mod && !event.altKey && event.shiftKey && (key === 's' || key === 'g')) { event.preventDefault(); setActiveTool('eyedropper', key === 's' ? 'strokeColor' : 'backgroundColor'); return }
    // A pending multi-click path is one transaction. Other editing commands
    // discard that preview before operating on the committed document.
    if (pendingConnector.current && !['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)
      && !(mod && ['+', '=', '-', '0', "'"].includes(key)) && !(event.altKey && (key === 's' || event.code === 'KeyS')) && key !== 'q') {
      cancelConnector(); select([])
    }
    if (mod && event.altKey && (key === 'c' || event.code === 'KeyC')) {
      event.preventDefault(); const element = live(draftRef.current).find(item => selectedRef.current.has(item.id))
      if (element) { const keys = ['strokeColor', 'backgroundColor', 'strokeWidth', 'strokeStyle', 'fillStyle', 'roughness', 'opacity', 'roundness', 'fontSize', 'fontFamily', 'textAlign', 'startArrowhead', 'endArrowhead', 'elbowed']; styleClipboard.current = Object.fromEntries(keys.filter(name => element[name] !== undefined).map(name => [name, copy(element[name])])) }
      return
    }
    if (mod && event.altKey && (key === 'v' || event.code === 'KeyV')) { event.preventDefault(); if (styleClipboard.current) applyProperties(styleClipboard.current); return }
    if (mod && event.shiftKey && (['Comma', 'Period'].includes(event.code) || ['<', '>'].includes(key))) {
      event.preventDefault(); const increase = event.code === 'Period' || key === '>', size = Number(live(draftRef.current).find(element => selectedRef.current.has(element.id) && element.type === 'text')?.fontSize ?? defaults.fontSize ?? 20)
      applyProperties({ fontSize: Math.max(8, Math.min(144, size + (increase ? 2 : -2))) }); return
    }
    if (event.shiftKey && !mod && key === 'f') { event.preventDefault(); setShowTextProperties(true); requestAnimationFrame(() => wrapper.current?.querySelector<HTMLElement>('[aria-label="Font family"]')?.focus()); return }
    if (mod && key === 'a') { event.preventDefault(); select(live(draftRef.current).filter(e => !e.locked).map(e => e.id)); return }
    if (mod && key === 'c') { copySelection(); return }
    if (mod && key === 'x') { copySelection(); return }
    if (mod && key === 'v') return
    if (mod && key === 'd') { event.preventDefault(); duplicate(); return }
    if (mod && key === 'g') { event.preventDefault(); groupSelection(event.shiftKey); return }
    if (mod && event.shiftKey && key === 'l') { event.preventDefault(); const lockedIds = lockedElementIds(draftRef.current), locked = live(draftRef.current).filter(e => selectedRef.current.has(e.id)).every(e => lockedIds.has(e.id)); applyProperties({ locked: !locked }); return }
    if (mod && (['[', ']'].includes(key) || ['BracketLeft', 'BracketRight'].includes(event.code))) { event.preventDefault(); const forward = event.code === 'BracketRight' || key === ']', extreme = event.shiftKey || (event.metaKey && event.altKey); reorder(forward ? extreme ? 'front' : 'forward' : extreme ? 'back' : 'backward'); return }
    if (mod && event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); align(event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : event.key === 'ArrowUp' ? 'top' : 'bottom'); return }
    if (!event.shiftKey && Object.prototype.hasOwnProperty.call(directions, event.key) && (mod || event.altKey)) {
      event.preventDefault()
      const direction = event.key as Direction
      if (event.altKey && !mod) { const ids = navigateConnection(draftRef.current, selectedRef.current, direction); if (ids) select(ids) }
      else if (mod && !event.altKey && !event.repeat) { const result = createConnectedShape(draftRef.current, selectedRef.current, direction); if (result && emit(result.scene)) select(result.selectedIds) }
      return
    }
    if (event.shiftKey && !mod && !event.altKey && (key === 'h' || key === 'v')) { event.preventDefault(); if (!event.repeat) emit(flipSelection(draftRef.current, selectedRef.current, key === 'h' ? 'horizontal' : 'vertical')); return }
    if (mod && ['+', '=', '-', '0'].includes(key)) { event.preventDefault(); setViewport(view => ({ ...view, zoom: key === '0' ? 1 : Math.max(0.1, Math.min(5, view.zoom * (key === '-' ? 0.8 : 1.25))) })); return }
    if (event.shiftKey && (event.code === 'Digit1' || key === '1')) { event.preventDefault(); fitScene(); return }
    if (event.shiftKey && (event.code === 'Digit2' || key === '2')) {
      event.preventDefault(); const bounds = getSceneBounds(live(draftRef.current).filter(e => selectedRef.current.has(e.id))), rect = surface.current?.getBoundingClientRect()
      if (rect && (bounds.width || bounds.height)) { const zoom = Math.max(0.1, Math.min(3, (rect.width - 340) / Math.max(1, bounds.width), (rect.height - 170) / Math.max(1, bounds.height))); setViewport({ x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom }) }
      return
    }
    if (mod && key === "'") { event.preventDefault(); setGrid(value => !value); return }
    if (event.altKey && (key === 's' || event.code === 'KeyS')) { event.preventDefault(); setSnap(value => !value); return }
    if (pointEditRef.current && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deletePathPoint(); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); emit(deleteElements(draftRef.current, selectedRef.current, true)); select([]); return }
    if (!mod && !event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); if (!editableSelection(draftRef.current, selectedRef.current).length) return
      if (!nudgeBefore.current) nudgeBefore.current = copy(committed.current)
      const step = event.shiftKey ? 5 : 1
      if (pointEditRef.current) {
        const active = pointEditRef.current, element = live(draftRef.current).find(item => item.id === active.id)
        if (!element || element.locked) return
        const points = getWorldPoints(element), point = points[active.index]
        if (!point) return
        points[active.index] = { x: point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }
        preview(withPathPoints(draftRef.current, active.id, points, active.index === 0 ? { startBinding: null } : active.index === points.length - 1 ? { endBinding: null } : {})); return
      }
      preview(moveElements(draftRef.current, selectedRef.current, { x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0 }, true)); return
    }
    if (mod && event.key === 'Enter') {
      const selected = live(draftRef.current).filter(item => selectedRef.current.has(item.id)), paths = selected.filter(item => ['line', 'arrow'].includes(item.type) && !lockedElementIds(draftRef.current).has(item.id))
      if (paths.length === 1 && selected.every(item => item.id === paths[0].id || (item.type === 'text' && item.containerId === paths[0].id))) {
        event.preventDefault(); setPointEdit({ id: paths[0].id, index: 0 }); requestAnimationFrame(() => surface.current?.querySelector<SVGElement>('[aria-label="Edit path point 1"]')?.focus()); return
      }
    }
    if (event.key === 'Enter' && !mod) {
      const selected = live(draftRef.current).filter(item => selectedRef.current.has(item.id))
      const primary = selected.filter(item => !item.containerId || !selectedRef.current.has(item.containerId))
      if (primary.length === 1 && selected.every(item => item.id === primary[0].id || (item.type === 'text' && item.containerId === primary[0].id))) {
        event.preventDefault(); if (primary[0].type === 'image') void beginCrop(primary[0].id); else beginText(primary[0].id); return
      }
    }
    if (mod || event.altKey) return
    const aliases: Record<string, Tool> = { j: 'lasso', v: 'selection', '1': 'selection', h: 'hand', r: 'rectangle', '2': 'rectangle', d: 'diamond', '3': 'diamond', o: 'ellipse', '4': 'ellipse', a: 'arrow', '5': 'arrow', l: 'line', '6': 'line', p: 'freedraw', '7': 'freedraw', t: 'text', '8': 'text', '9': 'image', e: 'eraser', '0': 'eraser', f: 'frame', k: 'laser', i: 'eyedropper', b: 'fill' }
    if (aliases[key]) { event.preventDefault(); setActiveTool(aliases[key]) }
    else if (key === 'q') { event.preventDefault(); setKeepTool(value => !value) }
    else if (key === 's' || key === 'g') { event.preventDefault(); wrapper.current?.querySelector<HTMLElement>(key === 's' ? '[aria-label="Stroke color"]' : '[aria-label="Background color"]')?.focus() }
  }
  const onKeyUp = (event: KeyboardEvent<HTMLElement>) => {
    if (event.code === 'Space') heldSpace.current = false
    if (event.key.startsWith('Arrow') && nudgeBefore.current) { nudgeBefore.current = null; emit(draftRef.current) }
  }

  const hitElement = (point: Point, exclude?: string) => [...live(draftRef.current)].reverse().find(element => element.id !== exclude && inside(point, getElementBounds(element), ['line', 'arrow', 'freedraw'].includes(element.type) ? 6 / viewportRef.current.zoom : 0))
  const shapeAt = (point: Point) => [...live(draftRef.current)].reverse().find(element => {
    if (!['rectangle', 'ellipse', 'diamond'].includes(element.type) || !element.width || !element.height) return false
    const center = getElementCenter(element), local = rotatePoint(point, center, -(element.angle ?? 0))
    const x = Math.abs(local.x - center.x) / (element.width / 2), y = Math.abs(local.y - center.y) / (element.height / 2)
    return element.type === 'ellipse' ? x * x + y * y <= 1 : element.type === 'diamond' ? x + y <= 1 : x <= 1 && y <= 1
  })
  const bindingFor = (point: Point, exclude: string) => {
    const host = [...live(draftRef.current)].reverse().find(element => element.id !== exclude && ['rectangle', 'ellipse', 'diamond', 'image'].includes(element.type) && inside(point, getElementBounds(element), 12 / viewportRef.current.zoom))
    if (!host) return null
    const local = rotatePoint(point, { x: host.x + host.width / 2, y: host.y + host.height / 2 }, -(host.angle ?? 0))
    return { elementId: host.id, focus: 0, gap: 0, fixedPoint: [Math.max(0, Math.min(1, (local.x - host.x) / Math.max(1, host.width))), Math.max(0, Math.min(1, (local.y - host.y) / Math.max(1, host.height)))] as [number, number] }
  }
  const previewConnector = (session: PendingConnector, point: Point) => {
    session.hover = point
    const points = [...session.fixed]
    if (points.length === 1 || !samePoint(points[points.length - 1], point)) points.push(point)
    preview(withPathPoints(draftRef.current, session.id, points, {}, false))
  }
  const finishConnector = () => {
    const session = pendingConnector.current
    if (!session) return
    const points = [...session.fixed]
    if (!samePoint(points[points.length - 1], session.hover)) points.push(session.hover)
    pendingConnector.current = null; setCreatingConnector(false); gesture.current = null
    if (points.length < 2 || !points.some(point => Math.hypot(point.x - points[0].x, point.y - points[0].y) >= 3 / viewportRef.current.zoom)) { preview(session.before); select([]); return }
    const element = live(draftRef.current).find(item => item.id === session.id)
    if (!element) return
    const bindings = element.type === 'arrow' ? { endBinding: session.preventBinding ? null : bindingFor(points[points.length - 1], session.id) } : {}
    if (emit(withPathPoints(draftRef.current, session.id, points, bindings))) select([session.id])
    if (!keepTool) setTool('selection')
  }
  const focusPathPoint = (id: string, index: number) => {
    const next = { id, index }; pointEditRef.current = next; setPointEdit(next)
    requestAnimationFrame(() => [...(surface.current?.querySelectorAll<SVGElement>(`[data-point-index="${index}"]`) ?? [])].find(handle => handle.getAttribute('data-element-handle') === id)?.focus())
  }
  const addPathPoint = () => {
    const active = pointEditRef.current, element = active && live(draftRef.current).find(item => item.id === active.id)
    if (!active || !element || element.locked) return
    const points = getWorldPoints(element), segment = Math.min(active.index, points.length - 2)
    if (segment < 0) return
    points.splice(segment + 1, 0, { x: (points[segment].x + points[segment + 1].x) / 2, y: (points[segment].y + points[segment + 1].y) / 2 })
    if (emit(withPathPoints(draftRef.current, element.id, points))) focusPathPoint(element.id, segment + 1)
  }
  const deletePathPoint = () => {
    const active = pointEditRef.current, element = active && live(draftRef.current).find(item => item.id === active.id)
    if (!active || !element || element.locked) return
    const points = getWorldPoints(element)
    if (active.index <= 0 || active.index >= points.length - 1) return
    points.splice(active.index, 1)
    if (emit(withPathPoints(draftRef.current, element.id, points))) focusPathPoint(element.id, Math.min(active.index, points.length - 1))
  }
  const finishPointEditing = () => {
    if (nudgeBefore.current) { nudgeBefore.current = null; emit(draftRef.current) }
    setPointEdit(null); wrapper.current?.focus()
  }
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (textEdit && event.button !== 2) return
    event.preventDefault()
    // Panning must not blur/commit an in-progress text edit.
    if (!textEdit || event.button !== 2) wrapper.current?.focus()
    const point = worldPoint({ x: event.clientX, y: event.clientY }), before = copy(committed.current)
    const base: Gesture = { kind: 'move', start: point, screen: { x: event.clientX, y: event.clientY }, before, base: before, ids: [...selectedRef.current], viewport: { ...viewportRef.current } }
    const target = event.target as Element
    if (pointEditRef.current && !target.hasAttribute('data-point-index') && tool !== 'hand' && !heldSpace.current && event.button === 0) setPointEdit(null)
    if (tool === 'hand' || heldSpace.current || event.button === 1 || event.button === 2 || readOnly) { gesture.current = { ...base, kind: 'pan', panButton: event.button }; setIsPanning(true) }
    else if (tool === 'lasso') { gesture.current = { ...base, kind: 'lasso', polygon: [point], additive: event.shiftKey, deep: event.ctrlKey || event.metaKey }; setLasso([point]); if (!event.shiftKey) select([]) }
    else if (tool === 'laser') {
      const id = ++laserCounter.current
      setLaserTraces(traces => [...traces, { id, points: [point], finished: false }])
      gesture.current = { ...base, kind: 'laser', elementId: String(id) }
    }
    else if (tool === 'eyedropper') {
      const source = hitElement(point)
      const paint = source?.[sampleTarget] ?? (sampleTarget === 'backgroundColor' ? draftRef.current.appState?.viewBackgroundColor : defaults.strokeColor)
      if (typeof paint === 'string' && (/^#[0-9a-f]{3,8}$/i.test(paint) || paint === 'transparent')) {
        const ids = live(before).filter(item => selectedRef.current.has(item.id) && !item.locked).map(item => item.id)
        if (ids.length) emit(setElementProperties(before, ids, { [sampleTarget]: paint }))
        else if (!selectedRef.current.size) setDefaults(current => ({ ...current, [sampleTarget]: paint }))
        setMessage(`${sampleTarget === 'strokeColor' ? 'Stroke' : 'Fill'} sampled: ${paint}`)
      }
      if (!keepTool) setTool('selection')
      return
    }
    else if (tool === 'fill') {
      const shape = shapeAt(point)
      if (shape && !shape.locked) {
        const paint = String(defaults.backgroundColor ?? 'transparent')
        emit(setElementProperties(before, [shape.id], { backgroundColor: paint === 'transparent' ? '#b2f2dc' : paint }))
        select([shape.id])
      }
      return
    }
    else if (pendingConnector.current) { gesture.current = { ...base, before: pendingConnector.current.before, kind: 'connector-click' } }
    else if (target.getAttribute('data-resize')) gesture.current = { ...base, kind: 'resize', bounds: getSceneBounds(live(before).filter(e => selectedRef.current.has(e.id))), corner: target.getAttribute('data-resize')! }
    else if (target.getAttribute('data-rotate')) gesture.current = { ...base, kind: 'rotate', bounds: getSceneBounds(live(before).filter(e => selectedRef.current.has(e.id))) }
    else if (target.getAttribute('data-point-index') !== null) {
      const elementId = target.getAttribute('data-element-handle')!, pointIndex = Number(target.getAttribute('data-point-index'))
      if (pointEditRef.current) focusPathPoint(elementId, pointIndex)
      gesture.current = { ...base, kind: 'point', elementId, pointIndex }
    }
    else if (tool === 'text') { beginText(undefined, point); if (!keepTool) setTool('selection'); return }
    else if (tool === 'eraser') { const hit = hitElement(point); const next = hit ? deleteElements(before, [hit.id]) : before; preview(next); gesture.current = { ...base, kind: 'erase', base: next } }
    else if (tool !== 'selection' && tool !== 'image') {
      const element = createElement(tool === 'shape' ? 'freedraw' : tool, point, point, defaults)
      if (tool === 'arrow' && !event.ctrlKey && !event.metaKey) element.startBinding = bindingFor(point, element.id)
      const next = { ...before, elements: [...before.elements, element] }
      preview(next); select([element.id]); gesture.current = { ...base, kind: 'create', base: next, elementId: element.id, recognize: tool === 'shape' }
    } else {
      const id = target.closest('[data-element-id]')?.getAttribute('data-element-id')
      const clicked = live(before).find(element => element.id === id)
      const hit = clicked?.containerId && !event.ctrlKey && !event.metaKey ? live(before).find(element => element.id === clicked.containerId) ?? clicked : clicked
      if (hit) {
        const expanded = expandSelection(before, [hit.id], event.ctrlKey || event.metaKey)
        const chosen = event.shiftKey ? new Set([...selectedRef.current, ...expanded]) : selectedRef.current.has(hit.id) ? new Set(selectedRef.current) : new Set(expanded)
        if (event.shiftKey && selectedRef.current.has(hit.id)) for (const item of expanded) chosen.delete(item)
        let next = before, ids = [...chosen]
        if (lockedElementIds(before).has(hit.id)) { select(ids); return }
        if (event.altKey) { const duplicated = duplicateSelection(before, editableSelection(before, ids), { x: 0, y: 0 }, true, true); next = duplicated.scene; ids = duplicated.selectedIds; preview(next) }
        select(ids); gesture.current = { ...base, ids: editableSelection(next, ids), base: next }
      } else { if (!event.shiftKey) select([]); gesture.current = { ...base, kind: 'marquee', ids: event.shiftKey ? [...selectedRef.current] : [], deep: event.ctrlKey || event.metaKey }; setMarquee({ ...point, width: 0, height: 0 }) }
    }
    surface.current?.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    const point = worldPoint({ x: event.clientX, y: event.clientY })
    if (!active || active.kind === 'connector-click') {
      const session = pendingConnector.current
      if (session) { session.preventBinding = event.ctrlKey || event.metaKey; previewConnector(session, constrainedPoint(session.fixed[session.fixed.length - 1], point, event.shiftKey)) }
      return
    }
    if (active.kind === 'pan') {
      if (active.panButton === 2 && !(event.buttons & 2)) { gesture.current = null; setIsPanning(false); surface.current?.releasePointerCapture?.(event.pointerId); return }
      setViewport({ ...active.viewport, x: active.viewport.x + event.clientX - active.screen.x, y: active.viewport.y + event.clientY - active.screen.y }); return
    }
    if (active.kind === 'lasso') { active.polygon = [...(active.polygon), point]; setLasso(active.polygon); return }
    if (active.kind === 'laser') {
      const id = Number(active.elementId)
      setLaserTraces(traces => traces.map(trace => trace.id === id ? { ...trace, points: [...trace.points, point] } : trace))
      return
    }
    if (active.kind === 'marquee') { setMarquee({ x: Math.min(active.start.x, point.x), y: Math.min(active.start.y, point.y), width: Math.abs(point.x - active.start.x), height: Math.abs(point.y - active.start.y) }); return }
    if (active.kind === 'move') {
      const delta = { x: point.x - active.start.x, y: point.y - active.start.y }
      if (event.shiftKey) { if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0; else delta.x = 0 }
      if (grid) { delta.x = Math.round(delta.x / 20) * 20; delta.y = Math.round(delta.y / 20) * 20 }
      if (snap) {
        const chosen = new Set(expandSelection(active.base, active.ids, true)), bounds = getSceneBounds(live(active.base).filter(element => chosen.has(element.id)))
        const xAnchors = [bounds.x + delta.x, bounds.x + bounds.width / 2 + delta.x, bounds.x + bounds.width + delta.x]
        const yAnchors = [bounds.y + delta.y, bounds.y + bounds.height / 2 + delta.y, bounds.y + bounds.height + delta.y]
        const tolerance = 8 / viewportRef.current.zoom
        let xSnap: { distance: number; coordinate: number } | undefined, ySnap: { distance: number; coordinate: number } | undefined
        for (const element of live(active.base).filter(item => !chosen.has(item.id) && !(item.containerId && chosen.has(item.containerId)))) {
          const box = getElementBounds(element)
          for (const coordinate of [box.x, box.x + box.width / 2, box.x + box.width]) for (const anchor of xAnchors) { const distance = coordinate - anchor; if (Math.abs(distance) <= tolerance && (!xSnap || Math.abs(distance) < Math.abs(xSnap.distance))) xSnap = { distance, coordinate } }
          for (const coordinate of [box.y, box.y + box.height / 2, box.y + box.height]) for (const anchor of yAnchors) { const distance = coordinate - anchor; if (Math.abs(distance) <= tolerance && (!ySnap || Math.abs(distance) < Math.abs(ySnap.distance))) ySnap = { distance, coordinate } }
        }
        if (xSnap) delta.x += xSnap.distance
        if (ySnap) delta.y += ySnap.distance
        setSnapGuides({ x: xSnap?.coordinate, y: ySnap?.coordinate })
      }
      preview(moveElements(active.base, active.ids, delta, true)); return
    }
    if (active.kind === 'erase') { const hit = hitElement(point); if (hit) preview(deleteElements(draftRef.current, [hit.id])); return }
    if (active.kind === 'rotate' && active.bounds) {
      const center = { x: active.bounds.x + active.bounds.width / 2, y: active.bounds.y + active.bounds.height / 2 }
      let angle = Math.atan2(point.y - center.y, point.x - center.x) - Math.atan2(active.start.y - center.y, active.start.x - center.x)
      if (event.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12
      preview(rotateElements(active.base, active.ids, angle, center, true)); return
    }
    if (active.kind === 'resize' && active.bounds) {
      const bounds = active.bounds, left = active.corner!.includes('w') ? point.x : bounds.x, top = active.corner!.includes('n') ? point.y : bounds.y
      let width = active.corner!.includes('w') ? bounds.x + bounds.width - point.x : point.x - bounds.x, height = active.corner!.includes('n') ? bounds.y + bounds.height - point.y : point.y - bounds.y
      if (event.shiftKey) height = width * bounds.height / Math.max(1, bounds.width)
      width = Math.max(8, width); height = Math.max(8, height)
      let next = active.base
      for (const element of live(active.base).filter(e => active.ids.includes(e.id))) {
        next = resizeElement(next, element.id, { x: left + (element.x - bounds.x) * width / Math.max(1, bounds.width), y: top + (element.y - bounds.y) * height / Math.max(1, bounds.height), width: Math.max(8, element.width * width / Math.max(1, bounds.width)), height: Math.max(8, element.height * height / Math.max(1, bounds.height)) })
      }
      preview(next); return
    }
    if (active.kind === 'point' && active.elementId) {
      const element = live(active.base).find(e => e.id === active.elementId)!
      const worldPoints = getWorldPoints(element)
      worldPoints[active.pointIndex!] = point
      preview(withPathPoints(active.base, element.id, worldPoints, active.pointIndex === 0 ? { startBinding: null } : active.pointIndex === worldPoints.length - 1 ? { endBinding: null } : {})); return
    }
    if (active.kind === 'create' && active.elementId) {
      const element = live(active.base).find(e => e.id === active.elementId)!
      if (element.type === 'freedraw') {
        const current = live(draftRef.current).find(e => e.id === element.id)!
        const points = [...(current.points ?? [[0, 0]]), [point.x - element.x, point.y - element.y] as [number, number]]
        preview(patchElement(draftRef.current, element.id, { points, width: Math.max(1, Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]))), height: Math.max(1, Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]))) })); return
      }
      let end = point
      if (event.shiftKey) { const dx = point.x - active.start.x, dy = point.y - active.start.y; if (['line', 'arrow'].includes(element.type)) { const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy); end = { x: active.start.x + Math.cos(angle) * length, y: active.start.y + Math.sin(angle) * length } } else { const side = Math.max(Math.abs(dx), Math.abs(dy)); end = { x: active.start.x + Math.sign(dx || 1) * side, y: active.start.y + Math.sign(dy || 1) * side } } }
      const updated = createElement(element.type, active.start, end, { ...element, id: element.id })
      // Constructor defaults may contain original geometry; update explicitly.
      const path = ['line', 'arrow'].includes(element.type)
      const origin = event.altKey && !path ? { x: active.start.x - (end.x - active.start.x), y: active.start.y - (end.y - active.start.y) } : active.start
      preview(patchElement(active.base, element.id, { ...updated, x: path ? active.start.x : Math.min(origin.x, end.x), y: path ? active.start.y : Math.min(origin.y, end.y), width: Math.abs(end.x - origin.x), height: Math.abs(end.y - origin.y), ...(path ? { points: [[0, 0], [end.x - active.start.x, end.y - active.start.y]] } : {}) }))
    }
  }
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current; if (!active) return
    gesture.current = null; setIsPanning(false); setSnapGuides({}); surface.current?.releasePointerCapture?.(event.pointerId)
    if (active.kind === 'lasso') { const polygon = [...(active.polygon), worldPoint({ x: event.clientX, y: event.clientY })]; select([...(active.additive ? active.ids : []), ...lassoSelection(active.before, polygon, active.deep)]); setLasso(null); return }
    if (active.kind === 'marquee') { if (marquee) select(expandSelection(draftRef.current, [...active.ids, ...live(draftRef.current).filter(e => !e.locked && intersection(getElementBounds(e), marquee)).map(e => e.id)], active.deep)); setMarquee(null); return }
    if (active.kind === 'pan') return
    if (active.kind === 'laser') {
      const id = Number(active.elementId)
      setLaserTraces(traces => traces.map(trace => trace.id === id ? { ...trace, finished: true } : trace))
      laserTimers.current.set(id, window.setTimeout(() => {
        laserTimers.current.delete(id)
        setLaserTraces(traces => traces.filter(trace => trace.id !== id))
      }, 900))
      return
    }
    if (active.kind === 'connector-click') {
      const session = pendingConnector.current
      if (session) {
        const point = constrainedPoint(session.fixed[session.fixed.length - 1], worldPoint({ x: event.clientX, y: event.clientY }), event.shiftKey)
        if (!samePoint(session.fixed[session.fixed.length - 1], point)) session.fixed.push(point)
        session.preventBinding = event.ctrlKey || event.metaKey; previewConnector(session, point)
      }
      return
    }
    let next = draftRef.current
    if (active.kind === 'create' && active.elementId) {
      const element = live(next).find(e => e.id === active.elementId)!
      if (['arrow', 'line'].includes(element.type) && Math.hypot(event.clientX - active.screen.x, event.clientY - active.screen.y) < 3) {
        const session = { id: element.id, before: active.before, fixed: [active.start], hover: active.start, preventBinding: event.ctrlKey || event.metaKey }
        pendingConnector.current = session; setCreatingConnector(true); previewConnector(session, active.start); return
      }
      if (element.width < 3 && element.height < 3) { preview(active.before); return }
      if (active.recognize && element.points) {
        const points = element.points.map(([x, y]) => ({ x: element.x + x, y: element.y + y }))
        const recognized = recognizeStroke(points)
        if (recognized) {
          const xs = points.map(p => p.x), ys = points.map(p => p.y)
          const { points: _points, pressures: _pressures, simulatePressure: _simulatePressure, ...style } = element
          const replacement = recognized === 'line'
            ? { ...style, type: 'line', x: points[0].x, y: points[0].y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points: [[0, 0], [points[points.length - 1].x - points[0].x, points[points.length - 1].y - points[0].y]] }
            : { ...style, type: recognized, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
          next = { ...next, elements: next.elements.map(item => item.id === element.id ? replacement : item) }
          setMessage(`Converted to ${recognized}.`)
        } else setMessage('Kept the freehand stroke.')
      }
      if (element.type === 'arrow' && !event.ctrlKey && !event.metaKey) next = rerouteBindings(patchElement(next, element.id, { endBinding: bindingFor(worldPoint({ x: event.clientX, y: event.clientY }), element.id) }), [element.id])
      if (element.type === 'frame') { const locked = lockedElementIds(next); next = { ...next, elements: next.elements.map(raw => { const item = raw as DrawElement; return item.id !== element.id && !locked.has(item.id) && item.type !== 'frame' && inside({ x: item.x, y: item.y }, element) && inside({ x: item.x + item.width, y: item.y + item.height }, element) ? { ...item, frameId: element.id } : item }) } }
      if (!keepTool) setTool('selection')
    }
    if (active.kind === 'point' && active.elementId && !event.ctrlKey && !event.metaKey) {
      const element = live(next).find(item => item.id === active.elementId)!
      const endpoint = active.pointIndex === 0 ? 'startBinding' : active.pointIndex === (element.points?.length ?? 0) - 1 ? 'endBinding' : null
      if (endpoint) next = rerouteBindings(patchElement(next, element.id, { [endpoint]: bindingFor(worldPoint({ x: event.clientX, y: event.clientY }), element.id) }), [element.id])
    }
    emit(next)
  }

  useEffect(() => {
    const target = surface.current
    if (!target) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const point = worldPoint({ x: event.clientX, y: event.clientY }), rect = target.getBoundingClientRect()
        setViewport(view => { const zoom = Math.max(0.1, Math.min(5, view.zoom * Math.exp(-event.deltaY * 0.002))); return { x: event.clientX - rect.left - point.x * zoom, y: event.clientY - rect.top - point.y * zoom, zoom } })
      } else setViewport(view => ({ ...view, x: view.x - (event.shiftKey ? event.deltaY : event.deltaX), y: view.y - (event.shiftKey ? 0 : event.deltaY) }))
    }
    target.addEventListener('wheel', wheel, { passive: false }); return () => target.removeEventListener('wheel', wheel)
  }, [worldPoint])

  const uploadImage = async (file?: File) => {
    if (!file || readOnlyRef.current) return
    if (!(SUPPORTED_ARCHITECTURE_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) { setMessage('Choose an image file.'); return }
    if (file.size > 3 * 1024 * 1024) { setMessage('Choose an image smaller than 3 MB so the complete diagram can be saved.'); return }
    const source = captureAsyncScene()
    if (!source) return
    const dataURL = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
    const image = new Image(); image.src = dataURL
    try { await image.decode(); if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image') } catch { setMessage('This image could not be decoded. Choose a valid image file.'); return }
    if (!asyncSceneIsCurrent(source)) return
    const rect = surface.current?.getBoundingClientRect(), center = worldPoint({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 })
    const width = Math.min(360, image.naturalWidth || 240), height = width * (image.naturalHeight || 180) / (image.naturalWidth || 240), id = newDrawId('image')
    const element = createElement('image', { x: center.x - width / 2, y: center.y - height / 2 }, { x: center.x + width / 2, y: center.y + height / 2 }, { fileId: id, status: 'saved', scale: [1, 1] })
    try { const next = validateArchitectureScene({ ...source.scene, elements: [...source.scene.elements, element], files: { ...source.scene.files, [id]: { id, mimeType: file.type, dataURL, created: Date.now() } } }); emit(next); select([element.id]); setTool('selection') } catch (error) { setMessage(error instanceof Error ? error.message : 'The image could not be added.') }
  }

  const storedBackground = draft.appState?.viewBackgroundColor ?? '#ffffff'
  const matches = panel.kind === 'search' ? searchResults(panel.query) : []
  const paletteCommands = panel.kind === 'palette' ? drawCommands.filter(command =>
    (!readOnly || !command.mutates || command.id === 'link') && `${command.label} ${command.shortcut}`.toLowerCase().includes(panel.query.toLowerCase())) : []
  const canvasBackground = darkMode && ['#ffffff', '#fff', 'white'].includes(storedBackground.toLowerCase()) ? '#0f1211' : storedBackground
  const chosen = live(draft).filter(element => selectedIds.has(element.id)), lockedIds = lockedElementIds(draft)
  const editable = chosen.filter(element => !lockedIds.has(element.id)), hasLocked = editable.length !== chosen.length
  const lockedOnly = chosen.length > 0 && !editable.length, first = editable[0] ?? chosen[0]
  const selectedPaths = editable.filter(element => ['line', 'arrow'].includes(element.type))
  const editablePath = !hasLocked && selectedPaths.length === 1 && chosen.every(element => element.id === selectedPaths[0].id || element.containerId === selectedPaths[0].id) ? selectedPaths[0] : undefined
  const activePathPointCount = pointEdit && editablePath?.id === pointEdit.id ? getWorldPoints(editablePath).length : 0
  const property = <K extends keyof DrawElement>(key: K, fallback: DrawElement[K]) => {
    const primary = ['fontSize', 'fontFamily', 'textAlign'].includes(String(key)) ? editable.find(element => element.type === 'text') ?? first : first
    return primary?.[key] ?? defaults[key] ?? fallback
  }
  const selectionBounds = chosen.length ? getSceneBounds(chosen) : null
  const editElement = textEdit ? live(draft).find(e => e.id === textEdit.id) : undefined
  const cropElement = cropEdit ? live(draft).find(e => e.id === cropEdit.id) : undefined
  const cropSource = cropElement?.fileId ? draft.files[cropElement.fileId]?.dataURL : undefined
  const editHost = editElement?.containerId ? live(draft).find(element => element.id === editElement.containerId) : undefined
  const boundText = editElement?.type === 'text' && !!editHost
  const generatedEditingFont = !!editElement && (editElement.fontFamily === 2 || editElement.fontFamily === undefined) && isGeneratedDrawFont(editElement.customData)
  const editorLineHeight = generatedEditingFont ? DRAW_LINE_HEIGHT : 1.3
  const editorFontSize = (editElement?.fontSize ?? 20) * viewport.zoom
  const contentWidth = generatedEditingFont ? drawingTextSize(textEdit?.value ?? '', { ...editElement, fontSize: editorFontSize }).width : Math.max(0, ...(textEdit?.value.split('\n').map(line => line.length * editorFontSize * 0.61) ?? []))
  const hostWidth = editHost && ['rectangle', 'ellipse', 'diamond'].includes(editHost.type) ? Math.max(24, editHost.width - 24) * viewport.zoom : 0
  const editorWidth = boundText ? Math.max(80, (editElement?.width ?? 0) * viewport.zoom + 20, contentWidth + 20, hostWidth + 20) : Math.max(180, (editElement?.width ?? 0) * viewport.zoom + 40)
  const editorHeight = Math.max(46, (textEdit?.value.split('\n').length ?? 1) * editorFontSize * editorLineHeight + 18)
  const editorFontStyle = generatedEditingFont ? { fontFamily: drawingFontFamily(editElement.fontFamily, editElement.customData), fontKerning: 'none', fontVariantLigatures: 'none', lineHeight: editorLineHeight } as const : {}
  const textPosition = editElement ? boundText ? {
    left: viewport.x + getElementCenter(editElement).x * viewport.zoom,
    top: viewport.y + getElementCenter(editElement).y * viewport.zoom,
    transform: `translate(-50%, -50%) rotate(${editElement.angle ?? 0}rad)`,
    textAlign: editElement.textAlign as 'left' | 'center' | 'right' | undefined,
    fontFamily: drawingFontFamily(editElement.fontFamily, editElement.customData),
    height: editorHeight,
    paddingTop: Math.max(8, (editorHeight - 2 - (textEdit?.value.split('\n').length ?? 1) * editorFontSize * editorLineHeight) / 2),
  } : { left: viewport.x + editElement.x * viewport.zoom, top: viewport.y + editElement.y * viewport.zoom } : undefined
  const canUndo = props.onUndo ? props.canUndo : historyIndex.current > 0
  const canRedo = props.onRedo ? props.canRedo : historyIndex.current + 1 < history.current.length
  const activeEmbed = liveEmbed && selectedIds.has(liveEmbed) ? live(draft).find(element => element.id === liveEmbed && ['embeddable', 'iframe'].includes(element.type)) : undefined
  let activeEmbedUrl: string | undefined
  try { if (activeEmbed) activeEmbedUrl = safeEmbedUrl(String(activeEmbed.link ?? '')) } catch { activeEmbedUrl = undefined }
  void historyVersion

  return <section ref={wrapper} className={`draw-canvas ${darkMode ? 'draw-dark' : 'draw-light'} ${viewMode ? 'draw-presentation' : ''} ${zen ? 'draw-zen' : ''}`} aria-label="Draw canvas" tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onCopy={event => clipboardEvents.current.copy(event)} onCut={event => clipboardEvents.current.cut(event)} onPaste={event => clipboardEvents.current.paste(event)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) { heldSpace.current = false; if (nudgeBefore.current) { nudgeBefore.current = null; emit(draftRef.current) } } }}>
    {!readOnly && !zen && <div ref={toolsShell} className="draw-tools draw-tools-shell" role="toolbar" aria-label="Drawing tools">
      <div className="draw-tools-scroll">
      {tools.map(item => <button key={item.tool} type="button" aria-label={`${item.name} tool`} aria-pressed={tool === item.tool} className={tool === item.tool ? 'active' : ''} title={`${item.name} (${item.shortcut})`} onClick={() => setActiveTool(item.tool)}><DrawToolIcon tool={item.tool} /><small>{item.shortcut.split(' / ').slice(-1)[0]}</small></button>)}
      </div>
      <button ref={moreToolsButton} type="button" aria-label="More drawing tools" aria-expanded={extraMenu} aria-controls="draw-extra-menu" aria-pressed={extraTools.some(item => item.tool === tool)} onClick={() => setExtraMenu(open => !open)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setExtraMenu(false) } }}><DrawToolIcon tool="more" /></button>
      <span className="draw-divider" />
      <button type="button" aria-label="Keep tool selected" aria-pressed={keepTool} title="Keep tool selected (Q)" onClick={() => setKeepTool(value => !value)}><DrawToolIcon tool={keepTool ? 'lock' : 'unlock'} /></button>
        {extraMenu && <div id="draw-extra-menu" className="draw-extra-menu" role="menu" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setExtraMenu(false); moreToolsButton.current?.focus() } }} aria-label="More drawing tools">{extraTools.map(item => <button type="button" role="menuitem" key={item.tool} onClick={() => setActiveTool(item.tool)}><DrawToolIcon tool={item.tool} /><span>{item.name}</span><kbd>{item.shortcut}</kbd></button>)}<hr /><button type="button" role="menuitem" onClick={() => openExtraDialog('embed')}><DrawToolIcon tool="embed" /><span>Embed URL</span></button><button type="button" role="menuitem" onClick={() => openExtraDialog('mermaid')}><DrawToolIcon tool="mermaid" /><span>Import Mermaid</span></button></div>}
    </div>}
    {!readOnly && !zen && <button ref={propertiesButton} className="draw-properties-toggle" aria-expanded={inspector === 'properties'} aria-controls="drawing-properties" onClick={() => setInspector(value => value === 'properties' ? null : 'properties')}>{chosen.length ? 'Selection' : 'Appearance'}</button>}
    <svg ref={surface} className={`draw-surface tool-${tool} ${isPanning ? 'is-panning' : ''}`} data-testid="draw-surface" role="application" aria-label="Drawing surface" width="100%" height="100%" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { if (gesture.current?.kind === 'laser') cancelLaser(); if (gesture.current?.kind === 'lasso') select(gesture.current.ids); setLasso(null); if (pendingConnector.current && gesture.current?.kind !== 'pan') cancelConnector(); else if (gesture.current && gesture.current.kind !== 'pan') preview(gesture.current.before); gesture.current = null; setIsPanning(false); setMarquee(null) }} onLostPointerCapture={() => { if (gesture.current?.kind === 'laser') cancelLaser(); if (gesture.current?.kind === 'lasso') { select(gesture.current.ids); gesture.current = null; setLasso(null) } if (gesture.current?.kind === 'pan') { gesture.current = null; setIsPanning(false) } }} onContextMenu={event => event.preventDefault()} onDoubleClick={event => {
      if (readOnly || event.button !== 0) return
      if (pendingConnector.current) { pendingConnector.current.preventBinding = event.ctrlKey || event.metaKey; finishConnector(); return }
      if (pointEditRef.current) { finishPointEditing(); return }
      if (tool !== 'selection') return
      const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY) ?? event.target as Element
      if (target.closest('[data-resize], [data-rotate], [data-point-index]')) return
      const point = worldPoint({ x: event.clientX, y: event.clientY })
      const id = target.closest('[data-element-id]')?.getAttribute('data-element-id') ?? shapeAt(point)?.id
      const element = live(draftRef.current).find(item => item.id === id)
      if (element?.type === 'image') void beginCrop(element.id)
      else beginText(id, point)
    }}>
      {grid && <defs><pattern id="draw-grid" patternUnits="userSpaceOnUse" x={viewport.x} y={viewport.y} width={20 * viewport.zoom} height={20 * viewport.zoom}><circle cx="1" cy="1" r="0.8" fill={darkMode ? '#465e55' : '#b6c9c1'} /></pattern></defs>}
      <rect width="100%" height="100%" fill={grid ? 'url(#draw-grid)' : canvasBackground} data-draw-background="true" />
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`} data-draw-viewport="true" data-drawing-layer="true">
        <g data-draw-content="true"><DrawSceneSvg elements={draft.elements} files={draft.files} darkMode={darkMode} backgroundColor={canvasBackground} selectedIds={selectedIds} editingTextId={textEdit?.id} /></g>
        {!readOnly && selectionBounds && <g className="draw-selection" fill="none" stroke="#17b895" strokeWidth={1.5 / viewport.zoom}>
          <rect x={selectionBounds.x - 3 / viewport.zoom} y={selectionBounds.y - 3 / viewport.zoom} width={selectionBounds.width + 6 / viewport.zoom} height={selectionBounds.height + 6 / viewport.zoom} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} pointerEvents="none" />
          {!hasLocked && !pointEdit && !creatingConnector && <><line x1={selectionBounds.x + selectionBounds.width / 2} y1={selectionBounds.y} x2={selectionBounds.x + selectionBounds.width / 2} y2={selectionBounds.y - 26 / viewport.zoom} pointerEvents="none" />
            <circle data-rotate="true" aria-label="Rotate selection" cx={selectionBounds.x + selectionBounds.width / 2} cy={selectionBounds.y - 30 / viewport.zoom} r={5 / viewport.zoom} fill={darkMode ? '#123f34' : '#ffffff'} />
            {(['nw', 'ne', 'sw', 'se'] as const).map(corner => <rect key={corner} data-resize={corner} aria-label={`Resize ${corner}`} x={(corner.includes('w') ? selectionBounds.x : selectionBounds.x + selectionBounds.width) - 4 / viewport.zoom} y={(corner.includes('n') ? selectionBounds.y : selectionBounds.y + selectionBounds.height) - 4 / viewport.zoom} width={8 / viewport.zoom} height={8 / viewport.zoom} fill={darkMode ? '#123f34' : '#ffffff'} />)}</>}
          {!creatingConnector && editablePath && getWorldPoints(editablePath).map((point, index) => <circle key={index} data-point-index={index} data-element-handle={editablePath.id} aria-label={`Edit path point ${index + 1}`} role={pointEdit ? 'button' : undefined} tabIndex={pointEdit ? 0 : undefined} aria-pressed={pointEdit ? pointEdit.index === index : undefined} onFocus={() => { if (pointEdit) { const next = { id: editablePath.id, index }; pointEditRef.current = next; setPointEdit(next) } }} onClick={() => { if (pointEdit) focusPathPoint(editablePath.id, index) }} cx={point.x} cy={point.y} r={(pointEdit?.index === index ? 7 : 5) / viewport.zoom} fill={pointEdit?.index === index ? '#17b895' : '#d7fff1'} />)}
        </g>}
        {snapGuides.x !== undefined && <line x1={snapGuides.x} x2={snapGuides.x} y1={-100000} y2={100000} stroke="#14b895" strokeWidth={1 / viewport.zoom} strokeDasharray="4 4" pointerEvents="none" />}
        {snapGuides.y !== undefined && <line y1={snapGuides.y} y2={snapGuides.y} x1={-100000} x2={100000} stroke="#14b895" strokeWidth={1 / viewport.zoom} strokeDasharray="4 4" pointerEvents="none" />}
        {lasso && <polygon data-testid="draw-lasso" points={lasso.map(point => `${point.x},${point.y}`).join(' ')} fill="#17b89520" stroke="#17b895" strokeWidth={1 / viewport.zoom} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} pointerEvents="none" />}
        {marquee && <rect {...marquee} fill="#17b89520" stroke="#17b895" strokeWidth={1 / viewport.zoom} pointerEvents="none" />}
        {laserTraces.map(trace => <polyline key={trace.id} points={trace.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ff5555" strokeWidth={4 / viewport.zoom} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" className={trace.finished ? 'draw-laser-trace is-fading' : 'draw-laser-trace'} />)}
      </g>
    </svg>
    {activeEmbed && activeEmbedUrl && !viewMode && <div className="draw-live-embed" style={{ left: viewport.x + activeEmbed.x * viewport.zoom, top: viewport.y + activeEmbed.y * viewport.zoom, width: activeEmbed.width * viewport.zoom, height: activeEmbed.height * viewport.zoom }}><button type="button" aria-label="Close live embed" onClick={() => setLiveEmbed(null)}>Close preview</button><iframe title="Live web embed" src={activeEmbedUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" /></div>}
    {textEdit && editElement && <textarea ref={textRef} className={`draw-text-editor ${boundText ? 'is-bound' : ''}`} aria-label="Edit drawing text" wrap={boundText ? 'off' : undefined} style={{ ...textPosition, width: editorWidth, minHeight: boundText ? undefined : Math.max(46, editElement.height * viewport.zoom + 20), fontSize: editorFontSize, ...editorFontStyle }} value={textEdit.value} onChange={event => setTextEdit({ ...textEdit, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) { event.preventDefault(); finishText() } }} onBlur={() => finishText()} />}
    {cropEdit && <div className="draw-crop-overlay"><section ref={cropDialogRef} className="draw-crop-dialog" role="dialog" aria-modal="true" aria-label="Crop image" onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input,button'))
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      } else if (event.key === 'Escape' || (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement))) {
        event.preventDefault(); finishCrop()
      }
    }}>
      <h2>Crop image</h2><p>Adjust the visible source pixels. Rotation and flips are preserved.</p>
      {typeof cropSource === 'string' && <svg className="draw-crop-preview" role="img" aria-label="Image crop preview" viewBox={`0 0 ${cropEdit.crop.naturalWidth} ${cropEdit.crop.naturalHeight}`} style={{ aspectRatio: `${cropEdit.crop.naturalWidth} / ${cropEdit.crop.naturalHeight}` }} onPointerDown={event => {
        const handle = (event.target as Element).getAttribute('data-crop-handle') as CropDrag['handle'] | null
        if (!handle) return
        cropDrag.current = { point: cropPoint(event), crop: cropEdit.crop, handle }
        event.currentTarget.setPointerCapture(event.pointerId)
      }} onPointerMove={moveCrop} onPointerUp={event => { cropDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { cropDrag.current = null }}>
        <image href={cropSource} width={cropEdit.crop.naturalWidth} height={cropEdit.crop.naturalHeight} preserveAspectRatio="none" />
        <path fill="#07140cb0" fillRule="evenodd" d={`M0 0H${cropEdit.crop.naturalWidth}V${cropEdit.crop.naturalHeight}H0Z M${cropEdit.crop.x} ${cropEdit.crop.y}V${cropEdit.crop.y + cropEdit.crop.height}H${cropEdit.crop.x + cropEdit.crop.width}V${cropEdit.crop.y}Z`} pointerEvents="none" />
        <rect data-crop-handle="move" x={cropEdit.crop.x} y={cropEdit.crop.y} width={cropEdit.crop.width} height={cropEdit.crop.height} fill="transparent" stroke="#16b995" strokeWidth={Math.max(1, cropEdit.crop.naturalWidth / 180)} />
        {(['nw', 'ne', 'sw', 'se'] as const).map(handle => <circle key={handle} data-crop-handle={handle} cx={cropEdit.crop.x + (handle.includes('e') ? cropEdit.crop.width : 0)} cy={cropEdit.crop.y + (handle.includes('s') ? cropEdit.crop.height : 0)} r={Math.max(3, cropEdit.crop.naturalWidth / 75)} fill="#ffffff" stroke="#087f67" strokeWidth={Math.max(1, cropEdit.crop.naturalWidth / 220)} />)}
      </svg>}
      <div className="draw-crop-fields">{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}>{field === 'x' ? 'Left' : field === 'y' ? 'Top' : field === 'width' ? 'Width' : 'Height'}<input aria-label={`Crop ${field}`} type="number" step="any" min={field === 'width' || field === 'height' ? 1 : 0} max={field === 'x' || field === 'width' ? cropEdit.crop.naturalWidth : cropEdit.crop.naturalHeight} value={Math.round(cropEdit.crop[field] * 100) / 100} onChange={event => updateCrop(field, Number(event.target.value))} /></label>)}</div>
      <p>{cropEdit.crop.naturalWidth} × {cropEdit.crop.naturalHeight} source pixels</p>
      <div className="draw-crop-actions"><button type="button" onClick={cancelCrop}>Cancel crop</button><button type="button" onClick={finishCrop}>Finish crop</button></div>
    </section></div>}
    {!readOnly && <aside id="drawing-properties" className="draw-properties" data-mobile-open={inspector === 'properties'} aria-label="Drawing properties" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { setInspector(null); propertiesButton.current?.focus() } }}>
      <div className="draw-properties-heading"><strong>{chosen.length ? `${chosen.length} selected` : 'Appearance'}</strong><span>{lockedOnly ? 'Locked selection' : hasLocked ? 'Editing unlocked objects' : chosen.length ? 'Edit selection' : 'For new drawings'}</span><button className="draw-properties-close" aria-label="Close drawing properties" onClick={() => { setInspector(null); propertiesButton.current?.focus() }}>×</button></div>
      <div className="draw-properties-body">
      {hasLocked && !creatingConnector && <div className="draw-locked-selection"><p>{chosen.some(element => !element.locked && lockedIds.has(element.id)) ? 'Unlock also unlocks the containing frame or shape.' : lockedOnly ? 'Unlock to edit this selection.' : 'Locked objects stay unchanged.'}</p><button type="button" onClick={() => applyProperties({ locked: false })}>Unlock</button></div>}
      {!lockedOnly && <>
        {first && ['embeddable', 'iframe'].includes(first.type) && <div className="draw-embed-actions"><button type="button" onClick={() => { try { safeEmbedUrl(String(first.link ?? '')); setLiveEmbed(first.id) } catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid embed URL.') } }}>Load live content</button><span>Live content loads only when you choose it.</span></div>}
        {pointEdit && editablePath?.id === pointEdit.id && <fieldset className="draw-point-editor"><legend>Connector points</legend><p role="status">Editing connector points</p><p>Arrows move the active point. Enter or Escape finishes.</p><div className="draw-action-grid"><button type="button" onClick={addPathPoint}>Add path point</button><button type="button" disabled={pointEdit.index <= 0 || pointEdit.index >= activePathPointCount - 1} onClick={deletePathPoint}>Delete path point</button><button type="button" onClick={finishPointEditing}>Finish point editing</button></div></fieldset>}
        <div className="draw-property-pair"><label>Stroke<input aria-label="Stroke color" type="color" value={String(property('strokeColor', '#0f766e')).startsWith('#') ? String(property('strokeColor', '#0f766e')) : '#0f766e'} onChange={event => applyProperties({ strokeColor: event.target.value })} /></label><label>Fill<input aria-label="Background color" type="color" value={String(property('backgroundColor', 'transparent')).startsWith('#') ? String(property('backgroundColor', 'transparent')) : '#ffffff'} onChange={event => applyProperties({ backgroundColor: event.target.value })} /></label></div>
        <label className="draw-check"><input type="checkbox" checked={property('backgroundColor', 'transparent') === 'transparent'} onChange={event => applyProperties({ backgroundColor: event.target.checked ? 'transparent' : '#b2f2dc' })} />No fill</label>
        <label>Fill style<select aria-label="Fill style" value={String(property('fillStyle', 'solid'))} onChange={event => applyProperties({ fillStyle: event.target.value })}><option value="solid">Solid</option><option value="hachure">Hatch</option><option value="cross-hatch">Crosshatch</option></select></label>
        <div className="draw-property-pair"><label>Width<input aria-label="Stroke width" type="number" min="1" max="20" value={Number(property('strokeWidth', 2))} onChange={event => applyProperties({ strokeWidth: Math.max(1, Number(event.target.value)) })} /></label><label>Style<select aria-label="Stroke style" value={String(property('strokeStyle', 'solid'))} onChange={event => applyProperties({ strokeStyle: event.target.value })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label></div>
        <label>Sketch<select aria-label="Roughness" value={Number(property('roughness', 0))} onChange={event => applyProperties({ roughness: Number(event.target.value) })}><option value="0">Clean</option><option value="1">Sketch</option><option value="2">Loose</option></select></label>
        <label>Corners<select aria-label="Corners" value={property('roundness', null) ? 'rounded' : 'sharp'} onChange={event => applyProperties({ roundness: event.target.value === 'rounded' ? { type: 3 } : null })}><option value="rounded">Rounded</option><option value="sharp">Sharp</option></select></label>
        <label>Opacity <span>{Number(property('opacity', 100))}%</span><input aria-label="Opacity" type="range" min="0" max="100" value={Number(property('opacity', 100))} onChange={event => applyProperties({ opacity: Number(event.target.value) })} /></label>
        {(tool === 'text' || showTextProperties || chosen.some(e => e.type === 'text')) && <fieldset><legend>Text</legend><div className="draw-property-pair"><label>Size<input aria-label="Font size" type="number" min="8" max="144" value={Number(property('fontSize', 20))} onChange={event => applyProperties({ fontSize: Math.max(8, Number(event.target.value)) })} /></label><label>Font<select aria-label="Font family" value={Number(property('fontFamily', 2))} onChange={event => applyProperties({ fontFamily: Number(event.target.value) })}><option value="2">Sans</option><option value="1">Hand</option><option value="3">Mono</option>{![1, 2, 3].includes(Number(property('fontFamily', 2))) && <option value={Number(property('fontFamily', 2))}>Imported font {Number(property('fontFamily', 2))} (local fallback)</option>}</select></label></div><label>Alignment<select aria-label="Text alignment" value={String(property('textAlign', 'left'))} onChange={event => applyProperties({ textAlign: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></fieldset>}
        {(['line', 'arrow'].includes(tool) || chosen.some(e => ['line', 'arrow'].includes(e.type))) && <fieldset><legend>Connection</legend>{(['startArrowhead', 'endArrowhead'] as const).map(key => <label key={key}>{key === 'startArrowhead' ? 'Start' : 'End'}<select aria-label={key === 'startArrowhead' ? 'Start arrowhead' : 'End arrowhead'} value={String(property(key, key === 'endArrowhead' ? 'arrow' : null) ?? 'none')} onChange={event => applyProperties({ [key]: event.target.value === 'none' ? null : event.target.value })}>{['none', 'arrow', 'triangle', 'dot', 'bar', 'diamond'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}<label>Routing<select aria-label="Arrow routing" value={first?.elbowed ? 'elbow' : first?.roundness ? 'curved' : 'sharp'} onChange={event => applyProperties({ elbowed: event.target.value === 'elbow', roundness: event.target.value === 'curved' ? { type: 2 } : null })}><option value="sharp">Sharp</option><option value="curved">Curved</option><option value="elbow">Elbow</option></select></label></fieldset>}
        {chosen.length > 0 && !creatingConnector && <><label>Rotation<input aria-label="Rotation" type="number" value={Math.round(Number(first?.angle ?? 0) * 180 / Math.PI)} onChange={event => applyProperties({ angle: Number(event.target.value) * Math.PI / 180 })} /></label><div className="draw-action-grid"><button onClick={duplicate} title="Duplicate (Ctrl/Cmd+D)">Duplicate</button><button onClick={() => applyProperties({ locked: true })}>Lock</button><button onClick={() => groupSelection()}>Group</button><button onClick={() => groupSelection(true)}>Ungroup</button><button onClick={() => reorder('back')}>To back</button><button onClick={() => reorder('front')}>To front</button></div>{chosen.length > 1 && <div className="draw-action-grid">{(['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as const).map(side => <button key={side} aria-label={`Align ${side}`} onClick={() => align(side)}>{side.replace('centerX', 'Center ↔').replace('centerY', 'Center ↕')}</button>)}</div>}{props.onEditSelection && <button className="draw-ai-action" onClick={props.onEditSelection} disabled={hasLocked}>Edit selection with AI</button>}<button className="draw-delete" onClick={() => { emit(deleteElements(draftRef.current, selectedIds, true)); select([]) }}>Delete selection</button></>}
      </>}
      </div>
    </aside>}
    {!zen && <div className="draw-bottom-controls"><button aria-label="Zoom out" onClick={() => setViewport(view => ({ ...view, zoom: Math.max(0.1, view.zoom / 1.2) }))}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setViewport(view => ({ ...view, zoom: Math.min(5, view.zoom * 1.2) }))}>+</button><button aria-label="Fit drawing" title="Fit all (Shift+1)" onClick={fitScene}>Fit</button>{!readOnly && <><span className="draw-divider" /><button aria-label="Undo drawing" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>↶</button><button aria-label="Redo drawing" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canRedo} onClick={redo}>↷</button><button aria-label="Snap to grid" aria-pressed={grid} onClick={() => setGrid(value => !value)}>Grid</button><button aria-label="Snap to objects" aria-pressed={snap} onClick={() => setSnap(value => !value)}>Snap</button></>}</div>}
    {!readOnly && !zen && !creatingConnector && <DrawLibrary scene={draft} selectedIds={selectedIds} onInsert={component => insertComponent(component)} open={inspector === 'components'} onOpenChange={open => setInspector(value => open ? 'components' : value === 'components' ? null : value)} />}
    {!zen && <button className="draw-help-toggle" aria-label="Keyboard shortcuts" onClick={() => setHelp(value => !value)}>?</button>}
    {localView && <span className="draw-view-badge">View mode · Alt/Option R to edit</span>}
    {message && <div className="draw-message" role="alert">{message}<button aria-label="Dismiss drawing message" onClick={() => setMessage(null)}>×</button></div>}
    {extraDialog && <div className="draw-help-overlay" onClick={() => setExtraDialog(null)}><form className="draw-extra-dialog" role="dialog" aria-modal="true" aria-label={extraDialog === 'embed' ? 'Embed a web page' : 'Import Mermaid flowchart'} onClick={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); setExtraDialog(null) }
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input,textarea,button'))
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }} onSubmit={event => { event.preventDefault(); submitExtra() }}><h2>{extraDialog === 'embed' ? 'Embed a web page' : 'Import Mermaid flowchart'}</h2><p>{extraDialog === 'embed' ? 'Add an HTTPS link as a static card. Load the live page when you choose to preview it.' : 'Add editable shapes and connectors from a supported Mermaid flowchart.'}</p>{extraDialog === 'embed' ? <input autoFocus aria-label="Embed URL" type="url" value={extraInput} onChange={event => setExtraInput(event.target.value)} placeholder="https://example.com" /> : <textarea autoFocus aria-label="Mermaid source" value={extraInput} onChange={event => setExtraInput(event.target.value)} placeholder={'flowchart TB\nA[Start] --> B{Decide}\nB -->|yes| C(Done)'} />}<div><button type="button" onClick={() => setExtraDialog(null)}>Cancel</button><button type="submit">{extraDialog === 'embed' ? 'Add card' : 'Import shapes'}</button></div></form></div>}
    {help && <div className="draw-help-overlay" onClick={() => setHelp(false)}><section className="draw-help-dialog" role="dialog" aria-modal="true" aria-labelledby="draw-help-title" onClick={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setHelp(false) } if (event.key === 'Tab') { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('.draw-help-close')?.focus() } }}><button className="draw-help-close" aria-label="Close keyboard shortcuts" onClick={() => setHelp(false)}>×</button><h2 id="draw-help-title">Drawing shortcuts</h2><p>Draw with the keyboard, then refine each object.</p><div className="draw-help-columns"><div><h3>Tools</h3>{tools.map(item => <p key={item.tool}><span>{item.name}</span><kbd>{item.shortcut}</kbd></p>)}{extraTools.map(item => <p key={item.tool}><span>{item.name}</span><kbd>{item.shortcut || 'Menu'}</kbd></p>)}<p><span>Eyedropper stroke / fill</span><kbd>Shift+S / Shift+G</kbd></p><p><span>Keep tool selected</span><kbd>Q</kbd></p></div><div><h3>Edit</h3>{[['Undo / Redo', '⌘/Ctrl Z / ⇧ Z'], ['Duplicate', '⌘/Ctrl D · Alt drag'], ['Group / Ungroup', '⌘/Ctrl G / ⇧ G'], ['Lock / Unlock', '⌘/Ctrl ⇧ L'], ['Copy · Cut · Paste', '⌘/Ctrl C · X · V'], ['Label selection', 'Enter · double-click'], ['Edit connector points', '⌘/Ctrl Enter'], ['Finish connector', 'Enter · double-click'], ['Draw from center', 'Alt drag'], ['Deep marquee', '⌘/Ctrl drag'], ['Finish text', '⌘/Ctrl Enter · Esc'], ['Text newline', 'Enter · ⇧ Enter'], ['Move', 'Arrows · ⇧ Arrows'], ['Align', '⌘/Ctrl ⇧ Arrows'], ['Connected shape', '⌘/Ctrl Arrows'], ['Follow connection', 'Alt/Option Arrows'], ['Flip horizontal / vertical', '⇧ H / ⇧ V'], ['Layer order', '⌘/Ctrl [ / ]'], ['Front / Back', '⌘/Ctrl ⇧ [ / ]'], ['Pan', 'Right drag · Space drag · H'], ['Zoom', '⌘/Ctrl wheel · + / −'], ['Fit all / Selection', '⇧ 1 / ⇧ 2'], ['Proportional shape / Resize', 'Shift drag']].map(([label, keys]) => <p key={label}><span>{label}</span><kbd>{keys}</kbd></p>)}{drawCommands.map(command => <p key={command.id}><span>{command.label}</span><kbd>{command.shortcut}</kbd></p>)}</div></div></section></div>}
    {panel.kind !== 'closed' && <div className="draw-panel-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setPanel({ kind: 'closed' }) }}><section className="draw-command-panel" role="dialog" aria-modal="true" aria-label={panel.kind === 'palette' ? 'Drawing commands' : panel.kind === 'search' ? 'Find in drawing' : panel.kind === 'statistics' ? 'Drawing statistics' : 'Edit link'} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); setPanel({ kind: 'closed' }) }
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]'))
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <button className="draw-panel-close" aria-label="Close panel" onClick={() => setPanel({ kind: 'closed' })}>×</button>
      {panel.kind === 'palette' && <><h2>Drawing commands</h2><input className="draw-command-input" aria-label="Search commands" value={panel.query} onChange={event => setPanel({ kind: 'palette', query: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && paletteCommands[0]) { event.preventDefault(); runCommand(paletteCommands[0].id) } }} />{paletteCommands.map(command => <button key={command.id} className="draw-command-row" onClick={() => runCommand(command.id)}><span>{command.label}</span><kbd>{command.shortcut}</kbd></button>)}</>}
      {panel.kind === 'search' && <><h2>Find in drawing</h2><input className="draw-command-input" aria-label="Search drawing" value={panel.query} onChange={event => { const query = event.target.value, first = searchResults(query)[0]; setPanel({ kind: 'search', query, activeId: first?.id ?? null }); if (first) reveal(first.id) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const index = matches.findIndex(item => item.id === panel.activeId), next = matches[(index + (event.shiftKey ? matches.length - 1 : 1)) % matches.length]; if (next) { reveal(next.id); setPanel({ ...panel, activeId: next.id }) } } }} /><p role="status">{matches.length} results</p><div className="draw-search-results">{matches.map(element => <button key={element.id} aria-current={panel.activeId === element.id ? 'true' : undefined} onClick={() => { reveal(element.id); setPanel({ ...panel, activeId: element.id }) }}>{String(element.text || element.name || element.id)}</button>)}</div></>}
      {panel.kind === 'statistics' && <><h2>Drawing statistics</h2><p>{live(draft).length} elements</p><p>{Object.keys(draft.files).length} files</p><p>{new Blob([JSON.stringify(draft)]).size.toLocaleString()} bytes</p></>}
      {panel.kind === 'link' && <><h2>{readOnly ? 'Element link' : 'Edit link'}</h2><input className="draw-command-input" aria-label="Element link" type="url" readOnly={readOnly} value={panel.value} onChange={event => { setMessage(null); setPanel({ ...panel, value: event.target.value }) }} onKeyDown={event => { if (event.key === 'Enter' && !readOnly) { event.preventDefault(); saveLink(panel.elementId, panel.value) } }} /><div className="draw-panel-actions">{!readOnly && <><button onClick={() => saveLink(panel.elementId, panel.value)}>Save link</button><button onClick={() => saveLink(panel.elementId, '')}>Remove link</button></>}{validLink(panel.value) && <a href={validLink(panel.value)!} target="_blank" rel="noopener noreferrer">Open link</a>}</div></>}
    </section></div>}
    <input ref={fileInput} className="draw-image-input" aria-label="Choose drawing image" type="file" accept="image/*" onChange={event => { void uploadImage(event.target.files?.[0]).catch(error => setMessage(error instanceof Error ? error.message : 'The image could not be read.')); event.target.value = '' }} />
  </section>
}
