import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Node, Edge } from 'reactflow'
import type { ArchitectureScene } from '../shared/architectureScene'
import { validateArchitectureScene } from '../shared/architectureScene'
import { graphFromElements, graphSignature, mergeGraphElements } from '../utils/architectureBridge'
import { createElement, deleteElements, duplicateSelection, expandSelection, getElementBounds, getSceneBounds, getWorldPoints, moveElements, newDrawId, rerouteBindings, resizeElement, rotateElements, rotatePoint, setElementProperties, type Bounds, type DrawElement, type Point } from '../utils/drawScene'
import DrawSceneSvg from './DrawSceneSvg'
import DrawToolIcon from './DrawToolIcon'
import DrawLibrary from './DrawLibrary'
import './DrawCanvas.css'

export interface DrawCanvasApi {
  viewportToScenePoint: (point: Point) => Point
  fitScene: () => void
  getScene: () => ArchitectureScene
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
  viewMode?: boolean
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

type Tool = 'selection' | 'hand' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'freedraw' | 'text' | 'image' | 'eraser' | 'frame'
interface Viewport { x: number; y: number; zoom: number }
interface Gesture {
  kind: 'create' | 'move' | 'pan' | 'marquee' | 'resize' | 'rotate' | 'point' | 'erase'
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
}
interface TextEdit { id: string; value: string; before: ArchitectureScene }
interface ClipboardInput { target: EventTarget | null; clipboardData: DataTransfer | null; preventDefault: () => void }
const tools: Array<{ tool: Tool; name: string; shortcut: string; glyph: string }> = [
  { tool: 'selection', name: 'Selection', shortcut: 'V / 1', glyph: '↖' },
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
const empty = (): ArchitectureScene => ({ version: 1, elements: [], files: {}, appState: { viewBackgroundColor: '#ffffff', gridSize: 20 } })
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const live = (scene: ArchitectureScene) => (scene.elements as DrawElement[]).filter(element => !element.isDeleted)
const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]')
const intersection = (a: Bounds, b: Bounds) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
const inside = (point: Point, box: Bounds, padding = 0) => point.x >= box.x - padding && point.x <= box.x + box.width + padding && point.y >= box.y - padding && point.y <= box.y + box.height + padding
const patchElement = (scene: ArchitectureScene, id: string, patch: Partial<DrawElement>): ArchitectureScene => ({ ...scene, elements: scene.elements.map(element => element.id === id ? { ...element, ...patch } : element) })
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
  const [seeded] = useState<ArchitectureScene>(() => ({ ...(scene ?? empty()), elements: mergeGraphElements((scene?.elements ?? []) as DrawElement[], nodes, edges, darkMode) }))
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
  const [keepTool, setKeepTool] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedRef = useRef(selectedIds); selectedRef.current = selectedIds
  const [marquee, setMarquee] = useState<Bounds | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({})
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [defaults, setDefaults] = useState<Partial<DrawElement>>({ strokeColor: '#0f766e', backgroundColor: 'transparent', strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid', roughness: 0, opacity: 100, fontSize: 20, fontFamily: 2, textAlign: 'left', roundness: { type: 3 }, endArrowhead: 'arrow' })
  const [help, setHelp] = useState(false)
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
  const pasteEvents = useRef(0)
  const clipboardEvents = useRef<Record<'copy' | 'cut' | 'paste', (event: ClipboardInput) => void>>({ copy: () => {}, cut: () => {}, paste: () => {} })
  const gesture = useRef<Gesture | null>(null)
  const nudgeBefore = useRef<ArchitectureScene | null>(null)
  const heldSpace = useRef(false)
  const surface = useRef<SVGSVGElement>(null)
  const wrapper = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const preview = useCallback((next: ArchitectureScene) => { draftRef.current = next; setDraft(next) }, [])
  const worldPoint = useCallback((point: Point): Point => {
    const rect = surface.current?.getBoundingClientRect(), view = viewportRef.current
    return { x: (point.x - (rect?.left ?? 0) - view.x) / view.zoom, y: (point.y - (rect?.top ?? 0) - view.y) / view.zoom }
  }, [])
  const fitScene = useCallback(() => {
    const rect = surface.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const bounds = getSceneBounds(draftRef.current.elements)
    if (!bounds.width && !bounds.height) { setViewport({ x: 0, y: 0, zoom: 1 }); return }
    const zoom = Math.max(0.1, Math.min(1.4, (rect.width - 340) / Math.max(1, bounds.width), (rect.height - 170) / Math.max(1, bounds.height)))
    setViewport({ x: (rect.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (rect.height - bounds.height * zoom) / 2 - bounds.y * zoom + 18, zoom })
  }, [])

  const emit = useCallback((next: ArchitectureScene, record = true) => {
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
    if (latest.current.onUndo) { latest.current.onUndo(); return }
    if (historyIndex.current > 0) { historyIndex.current--; emit(copy(history.current[historyIndex.current]), false); setHistoryVersion(value => value + 1) }
  }, [emit])
  const redo = useCallback(() => {
    if (latest.current.onRedo) { latest.current.onRedo(); return }
    if (historyIndex.current + 1 < history.current.length) { historyIndex.current++; emit(copy(history.current[historyIndex.current]), false); setHistoryVersion(value => value + 1) }
  }, [emit])

  useEffect(() => {
    const serialized = scene ? JSON.stringify(scene) : '', signature = graphSignature(nodes, edges)
    if (serialized === lastEmitted.current && signature === lastGraph.current) return
    const next = { ...(scene ?? empty()), elements: mergeGraphElements((scene?.elements ?? []) as DrawElement[], nodes, edges, darkMode) }
    committed.current = copy(next); lastEmitted.current = serialized; lastGraph.current = signature
    gesture.current = null; setIsPanning(false); preview(next)
  }, [scene, nodes, edges, darkMode, preview])
  useEffect(() => { const frame = requestAnimationFrame(fitScene); return () => cancelAnimationFrame(frame) }, [fitScene])
  useEffect(() => { if (!viewMode) wrapper.current?.focus({ preventScroll: true }) }, [viewMode])
  useEffect(() => { if (textEdit) { textRef.current?.focus(); textRef.current?.select() } }, [textEdit?.id])

  const exportImage = useCallback(async (format: 'png' | 'svg' | 'gif', duration = 2) => {
    const content = surface.current?.querySelector('[data-draw-content]')
    if (!content || !live(draftRef.current).length) throw new Error('Draw something before exporting.')
    const bounds = getSceneBounds(draftRef.current.elements), padding = 32
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    svg.setAttribute('viewBox', `${bounds.x - padding} ${bounds.y - padding} ${Math.max(1, bounds.width) + padding * 2} ${Math.max(1, bounds.height) + padding * 2}`)
    svg.setAttribute('width', String(Math.max(1, bounds.width) + padding * 2)); svg.setAttribute('height', String(Math.max(1, bounds.height) + padding * 2))
    const background = document.createElementNS(svg.namespaceURI, 'rect')
    background.setAttribute('x', String(bounds.x - padding)); background.setAttribute('y', String(bounds.y - padding)); background.setAttribute('width', svg.getAttribute('width')!); background.setAttribute('height', svg.getAttribute('height')!); const stored = draftRef.current.appState?.viewBackgroundColor ?? '#ffffff'
    background.setAttribute('fill', darkMode && ['#fff', '#ffffff', 'white'].includes(stored.toLowerCase()) ? '#0f1211' : stored)
    svg.append(background, content.cloneNode(true))
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
        download(blob, 'drawing.png')
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
    onReady({ viewportToScenePoint: worldPoint, fitScene, getScene: () => copy(committed.current), replaceScene: (next, fit = false) => { emit(validateArchitectureScene(next)); if (fit) requestAnimationFrame(fitScene) }, exportImage })
    return () => onReady(null)
  }, [onReady, worldPoint, fitScene, emit, exportImage])

  const select = (ids: Iterable<string>) => setSelectedIds(new Set(ids))
  const setActiveTool = (next: Tool) => { setTool(next); if (next === 'image') fileInput.current?.click(); wrapper.current?.focus() }
  const applyProperties = (properties: Partial<DrawElement>) => {
    if (selectedRef.current.size) emit(setElementProperties(draftRef.current, selectedRef.current, properties))
    else setDefaults(current => ({ ...current, ...properties }))
  }
  const groupSelection = (ungroup = false) => {
    const id = newDrawId('group')
    emit({ ...draftRef.current, elements: draftRef.current.elements.map(raw => {
      const element = raw as DrawElement
      if (!selectedRef.current.has(element.id)) return element
      return { ...element, groupIds: ungroup ? (element.groupIds ?? []).slice(0, -1) : [...(element.groupIds ?? []), id] }
    }) })
  }
  const reorder = (direction: 'front' | 'back' | 'forward' | 'backward') => {
    const elements = [...draftRef.current.elements], selected = selectedRef.current
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
    const chosen = live(draftRef.current).filter(e => selectedRef.current.has(e.id) && !(e.containerId && selectedRef.current.has(e.containerId)))
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
  const duplicate = () => { const next = duplicateSelection(draftRef.current, selectedRef.current, undefined, true); select(next.selectedIds); emit(next.scene) }
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
    try {
      const valid = validateArchitectureScene(component), bounds = getSceneBounds(valid.elements), rect = surface.current?.getBoundingClientRect()
      const center = worldPoint({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 })
      const result = duplicateSelection(valid, live(valid).map(element => element.id), { x: center.x - bounds.x - bounds.width / 2 + offset, y: center.y - bounds.y - bounds.height / 2 + offset }, true)
      const originalIds = new Set(valid.elements.map(element => element.id)), added = result.scene.elements.filter(element => !originalIds.has(element.id))
      const fileIds = new Set(added.flatMap(raw => { const element = raw as DrawElement; return element.fileId ? [element.fileId] : [] }))
      const files = Object.fromEntries(Object.entries(result.scene.files).filter(([id]) => fileIds.has(id)))
      const next = validateArchitectureScene({ ...draftRef.current, elements: [...draftRef.current.elements, ...added], files: { ...draftRef.current.files, ...files } })
      if (!emit(next)) return false
      select(result.selectedIds); setTool('selection'); return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'This drawing could not be inserted.'); return false }
  }
  const pasteSelection = () => { if (clipboard.current?.elements.length) { pasteOffset.current += 24; insertComponent(clipboard.current, pasteOffset.current) } }
  const writeClipboard = (event: ClipboardInput, cut = false) => {
    if (editableTarget(event.target) || editableTarget(document.activeElement)) return
    const selected = copySelection()
    if (!selected?.elements.length || !event.clipboardData) return
    const serialized = JSON.stringify({ type: 'flowchart-drawing', scene: selected })
    event.clipboardData.setData('application/x-flowchart-drawing', serialized)
    event.clipboardData.setData('text/plain', serialized)
    event.preventDefault()
    if (cut) { emit(deleteElements(draftRef.current, selectedRef.current, true)); select([]) }
  }
  const readClipboard = (event: ClipboardInput) => {
    if (editableTarget(event.target) || editableTarget(document.activeElement) || !event.clipboardData) return
    pasteEvents.current++
    const text = event.clipboardData.getData('application/x-flowchart-drawing') || event.clipboardData.getData('text/plain')
    if (!text || text.length > 4 * 1024 * 1024) return
    try {
      const parsed = JSON.parse(text) as { type?: string; scene?: unknown }
      if (parsed.type !== 'flowchart-drawing') return
      const valid = validateArchitectureScene(parsed.scene)
      event.preventDefault(); clipboard.current = valid; pasteOffset.current = 0; pasteSelection()
    } catch { /* Other clipboard formats retain their browser behavior. */ }
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
      const fontSize = element?.fontSize ?? 20, lines = value.split('\n')
      emit(patchElement(draftRef.current, textEdit.id, { text: value, originalText: value, width: Math.max(24, Math.max(...lines.map(line => line.length)) * fontSize * 0.61), height: Math.max(fontSize * 1.3, lines.length * fontSize * 1.3) }))
    }
    setTextEdit(null); wrapper.current?.focus()
  }
  const beginText = (id?: string, point?: Point) => {
    const before = copy(committed.current)
    let next = draftRef.current, element = live(next).find(e => e.id === id)
    if (element && !['text', 'frame'].includes(element.type)) {
      const host = element
      element = live(next).find(e => e.type === 'text' && e.containerId === host.id)
      if (!element) {
        element = createElement('text', { x: host.x + 12, y: host.y + host.height / 2 - 13 }, undefined, { ...defaults, text: '', originalText: '', containerId: host.id, textAlign: 'center' })
        next = patchElement({ ...next, elements: [...next.elements, element] }, host.id, { boundElements: [...(host.boundElements ?? []), { id: element.id, type: 'text' }] })
      }
    }
    if (!element) {
      element = createElement('text', point ?? { x: 120, y: 120 }, undefined, { ...defaults, text: '', originalText: '' })
      next = { ...next, elements: [...next.elements, element] }
    }
    preview(next); select([element.id]); setTextEdit({ id: element.id, value: element.type === 'frame' ? String(element.name ?? '') : element.text ?? '', before })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (editableTarget(event.target)) return
    const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey
    if (event.key === 'Escape' && gesture.current?.kind === 'pan' && gesture.current.panButton === 2) { gesture.current = null; setIsPanning(false); return }
    if (event.key === 'Escape') { if (gesture.current) preview(gesture.current.before); gesture.current = null; setIsPanning(false); setMarquee(null); setHelp(false); select([]); setTool('selection'); return }
    if (key === '?' || (mod && key === '/')) { event.preventDefault(); setHelp(value => !value); return }
    if (event.code === 'Space') { event.preventDefault(); heldSpace.current = true; return }
    if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
    if (mod && key === 'y') { event.preventDefault(); redo(); return }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); const rect = surface.current?.getBoundingClientRect(), direction = event.key === 'PageDown' ? -1 : 1
      setViewport(view => ({ ...view, x: view.x + (event.shiftKey ? (rect?.width ?? 800) * direction : 0), y: view.y + (event.shiftKey ? 0 : (rect?.height ?? 600) * direction) })); return
    }
    if (viewMode) return
    if (mod && event.altKey && key === 'c') {
      event.preventDefault(); const element = live(draftRef.current).find(item => selectedRef.current.has(item.id))
      if (element) { const keys = ['strokeColor', 'backgroundColor', 'strokeWidth', 'strokeStyle', 'fillStyle', 'roughness', 'opacity', 'roundness', 'fontSize', 'fontFamily', 'textAlign', 'startArrowhead', 'endArrowhead', 'elbowed']; styleClipboard.current = Object.fromEntries(keys.filter(name => element[name] !== undefined).map(name => [name, copy(element[name])])) }
      return
    }
    if (mod && event.altKey && key === 'v') { event.preventDefault(); if (styleClipboard.current) applyProperties(styleClipboard.current); return }
    if (mod && event.shiftKey && (['Comma', 'Period'].includes(event.code) || ['<', '>'].includes(key))) {
      event.preventDefault(); const increase = event.code === 'Period' || key === '>', size = Number(live(draftRef.current).find(element => selectedRef.current.has(element.id) && element.type === 'text')?.fontSize ?? defaults.fontSize ?? 20)
      applyProperties({ fontSize: Math.max(8, Math.min(144, size + (increase ? 2 : -2))) }); return
    }
    if (event.shiftKey && !mod && key === 'f') { event.preventDefault(); setShowTextProperties(true); requestAnimationFrame(() => wrapper.current?.querySelector<HTMLElement>('[aria-label="Font family"]')?.focus()); return }
    if (mod && key === 'a') { event.preventDefault(); select(live(draftRef.current).filter(e => !e.locked).map(e => e.id)); return }
    if (mod && key === 'c') { copySelection(); return }
    if (mod && key === 'x') { copySelection(); return }
    if (mod && key === 'v') { const count = pasteEvents.current; if (clipboard.current) window.setTimeout(() => { if (pasteEvents.current === count) pasteSelection() }, 50); return }
    if (mod && key === 'd') { event.preventDefault(); duplicate(); return }
    if (mod && key === 'g') { event.preventDefault(); groupSelection(event.shiftKey); return }
    if (mod && event.shiftKey && key === 'l') { event.preventDefault(); const locked = live(draftRef.current).filter(e => selectedRef.current.has(e.id)).every(e => e.locked); applyProperties({ locked: !locked }); return }
    if (mod && (['[', ']'].includes(key) || ['BracketLeft', 'BracketRight'].includes(event.code))) { event.preventDefault(); const forward = event.code === 'BracketRight' || key === ']', extreme = event.shiftKey || (event.metaKey && event.altKey); reorder(forward ? extreme ? 'front' : 'forward' : extreme ? 'back' : 'backward'); return }
    if (mod && event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); align(event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : event.key === 'ArrowUp' ? 'top' : 'bottom'); return }
    if (mod && ['+', '=', '-', '0'].includes(key)) { event.preventDefault(); setViewport(view => ({ ...view, zoom: key === '0' ? 1 : Math.max(0.1, Math.min(5, view.zoom * (key === '-' ? 0.8 : 1.25))) })); return }
    if (event.shiftKey && (event.code === 'Digit1' || key === '1')) { event.preventDefault(); fitScene(); return }
    if (event.shiftKey && (event.code === 'Digit2' || key === '2')) {
      event.preventDefault(); const bounds = getSceneBounds(live(draftRef.current).filter(e => selectedRef.current.has(e.id))), rect = surface.current?.getBoundingClientRect()
      if (rect && (bounds.width || bounds.height)) { const zoom = Math.max(0.1, Math.min(3, (rect.width - 340) / Math.max(1, bounds.width), (rect.height - 170) / Math.max(1, bounds.height))); setViewport({ x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom }) }
      return
    }
    if (mod && key === "'") { event.preventDefault(); setGrid(value => !value); return }
    if (event.altKey && key === 's') { event.preventDefault(); setSnap(value => !value); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); emit(deleteElements(draftRef.current, selectedRef.current, true)); select([]); return }
    if (!mod && !event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); if (!selectedRef.current.size) return
      if (!nudgeBefore.current) nudgeBefore.current = copy(committed.current)
      const step = event.shiftKey ? 5 : 1
      preview(moveElements(draftRef.current, selectedRef.current, { x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0 }, true)); return
    }
    if (event.key === 'Enter' && selectedRef.current.size === 1) { event.preventDefault(); beginText([...selectedRef.current][0]); return }
    if (mod || event.altKey) return
    const aliases: Record<string, Tool> = { v: 'selection', '1': 'selection', h: 'hand', r: 'rectangle', '2': 'rectangle', d: 'diamond', '3': 'diamond', o: 'ellipse', '4': 'ellipse', a: 'arrow', '5': 'arrow', l: 'line', '6': 'line', p: 'freedraw', '7': 'freedraw', t: 'text', '8': 'text', '9': 'image', e: 'eraser', '0': 'eraser', f: 'frame' }
    if (aliases[key]) { event.preventDefault(); setActiveTool(aliases[key]) }
    else if (key === 'q') { event.preventDefault(); setKeepTool(value => !value) }
    else if (key === 's' || key === 'g') { event.preventDefault(); wrapper.current?.querySelector<HTMLElement>(key === 's' ? '[aria-label="Stroke color"]' : '[aria-label="Background color"]')?.focus() }
  }
  const onKeyUp = (event: KeyboardEvent<HTMLElement>) => {
    if (event.code === 'Space') heldSpace.current = false
    if (event.key.startsWith('Arrow') && nudgeBefore.current) { nudgeBefore.current = null; emit(draftRef.current) }
  }

  const hitElement = (point: Point, exclude?: string) => [...live(draftRef.current)].reverse().find(element => element.id !== exclude && inside(point, getElementBounds(element), ['line', 'arrow', 'freedraw'].includes(element.type) ? 6 / viewportRef.current.zoom : 0))
  const bindingFor = (point: Point, exclude: string) => {
    const host = [...live(draftRef.current)].reverse().find(element => element.id !== exclude && ['rectangle', 'ellipse', 'diamond', 'image'].includes(element.type) && inside(point, getElementBounds(element), 12 / viewportRef.current.zoom))
    if (!host) return null
    const local = rotatePoint(point, { x: host.x + host.width / 2, y: host.y + host.height / 2 }, -(host.angle ?? 0))
    return { elementId: host.id, focus: 0, gap: 0, fixedPoint: [Math.max(0, Math.min(1, (local.x - host.x) / Math.max(1, host.width))), Math.max(0, Math.min(1, (local.y - host.y) / Math.max(1, host.height)))] as [number, number] }
  }
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (textEdit && event.button !== 2) return
    event.preventDefault()
    // Panning must not blur/commit an in-progress text edit.
    if (!textEdit || event.button !== 2) wrapper.current?.focus()
    const point = worldPoint({ x: event.clientX, y: event.clientY }), before = copy(committed.current)
    const base: Gesture = { kind: 'move', start: point, screen: { x: event.clientX, y: event.clientY }, before, base: before, ids: [...selectedRef.current], viewport: { ...viewportRef.current } }
    const target = event.target as Element
    if (tool === 'hand' || heldSpace.current || event.button === 1 || event.button === 2 || viewMode) { gesture.current = { ...base, kind: 'pan', panButton: event.button }; setIsPanning(true) }
    else if (target.getAttribute('data-resize')) gesture.current = { ...base, kind: 'resize', bounds: getSceneBounds(live(before).filter(e => selectedRef.current.has(e.id))), corner: target.getAttribute('data-resize')! }
    else if (target.getAttribute('data-rotate')) gesture.current = { ...base, kind: 'rotate', bounds: getSceneBounds(live(before).filter(e => selectedRef.current.has(e.id))) }
    else if (target.getAttribute('data-point-index') !== null) gesture.current = { ...base, kind: 'point', elementId: target.getAttribute('data-element-handle')!, pointIndex: Number(target.getAttribute('data-point-index')) }
    else if (tool === 'text') { beginText(undefined, point); if (!keepTool) setTool('selection'); return }
    else if (tool === 'eraser') { const hit = hitElement(point); const next = hit ? deleteElements(before, [hit.id]) : before; preview(next); gesture.current = { ...base, kind: 'erase', base: next } }
    else if (tool !== 'selection' && tool !== 'image') {
      const element = createElement(tool, point, point, defaults)
      if (tool === 'arrow' && !event.ctrlKey && !event.metaKey) element.startBinding = bindingFor(point, element.id)
      const next = { ...before, elements: [...before.elements, element] }
      preview(next); select([element.id]); gesture.current = { ...base, kind: 'create', base: next, elementId: element.id }
    } else {
      const id = target.closest('[data-element-id]')?.getAttribute('data-element-id')
      const clicked = live(before).find(element => element.id === id)
      const hit = clicked?.containerId && !event.ctrlKey && !event.metaKey ? live(before).find(element => element.id === clicked.containerId) ?? clicked : clicked
      if (hit && (!hit.locked || event.ctrlKey || event.metaKey)) {
        const expanded = expandSelection(before, [hit.id], event.ctrlKey || event.metaKey)
        const chosen = event.shiftKey ? new Set([...selectedRef.current, ...expanded]) : selectedRef.current.has(hit.id) ? new Set(selectedRef.current) : new Set(expanded)
        if (event.shiftKey && selectedRef.current.has(hit.id)) for (const item of expanded) chosen.delete(item)
        let next = before, ids = [...chosen]
        if (event.altKey) { const duplicated = duplicateSelection(before, ids, { x: 0, y: 0 }, true); next = duplicated.scene; ids = duplicated.selectedIds; preview(next) }
        select(ids); gesture.current = { ...base, ids, base: next }
      } else { if (!event.shiftKey) select([]); gesture.current = { ...base, kind: 'marquee', ids: event.shiftKey ? [...selectedRef.current] : [] }; setMarquee({ ...point, width: 0, height: 0 }) }
    }
    surface.current?.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    if (!active) return
    const point = worldPoint({ x: event.clientX, y: event.clientY })
    if (active.kind === 'pan') {
      if (active.panButton === 2 && !(event.buttons & 2)) { gesture.current = null; setIsPanning(false); surface.current?.releasePointerCapture?.(event.pointerId); return }
      setViewport({ ...active.viewport, x: active.viewport.x + event.clientX - active.screen.x, y: active.viewport.y + event.clientY - active.screen.y }); return
    }
    if (active.kind === 'marquee') { setMarquee({ x: Math.min(active.start.x, point.x), y: Math.min(active.start.y, point.y), width: Math.abs(point.x - active.start.x), height: Math.abs(point.y - active.start.y) }); return }
    if (active.kind === 'move') {
      const delta = { x: point.x - active.start.x, y: point.y - active.start.y }
      if (event.shiftKey) { if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0; else delta.x = 0 }
      if (grid) { delta.x = Math.round(delta.x / 20) * 20; delta.y = Math.round(delta.y / 20) * 20 }
      if (snap) {
        const chosen = new Set(expandSelection(active.base, active.ids)), bounds = getSceneBounds(live(active.base).filter(element => chosen.has(element.id)))
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
      const unrotated = worldPoints.map(position => rotatePoint(position, { x: 0, y: 0 }, -(element.angle ?? 0)))
      const xs = unrotated.map(position => position.x), ys = unrotated.map(position => position.y)
      const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
      const worldCenter = rotatePoint(center, { x: 0, y: 0 }, element.angle ?? 0), origin = unrotated[0]
      const points = unrotated.map(position => [position.x - origin.x, position.y - origin.y] as [number, number])
      preview(patchElement(active.base, element.id, { x: worldCenter.x - center.x + origin.x, y: worldCenter.y - center.y + origin.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points, ...(active.pointIndex === 0 ? { startBinding: null } : active.pointIndex === points.length - 1 ? { endBinding: null } : {}) })); return
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
      preview(patchElement(active.base, element.id, { ...updated, x: path ? active.start.x : Math.min(active.start.x, end.x), y: path ? active.start.y : Math.min(active.start.y, end.y), width: Math.abs(end.x - active.start.x), height: Math.abs(end.y - active.start.y), ...(path ? { points: [[0, 0], [end.x - active.start.x, end.y - active.start.y]] } : {}) }))
    }
  }
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current; if (!active) return
    gesture.current = null; setIsPanning(false); setSnapGuides({}); surface.current?.releasePointerCapture?.(event.pointerId)
    if (active.kind === 'marquee') { if (marquee) select(expandSelection(draftRef.current, [...active.ids, ...live(draftRef.current).filter(e => !e.locked && intersection(getElementBounds(e), marquee)).map(e => e.id)])); setMarquee(null); return }
    if (active.kind === 'pan') return
    let next = draftRef.current
    if (active.kind === 'create' && active.elementId) {
      const element = live(next).find(e => e.id === active.elementId)!
      if (element.width < 3 && element.height < 3) { preview(active.before); return }
      if (element.type === 'arrow' && !event.ctrlKey && !event.metaKey) next = rerouteBindings(patchElement(next, element.id, { endBinding: bindingFor(worldPoint({ x: event.clientX, y: event.clientY }), element.id) }), [element.id])
      if (element.type === 'frame') next = { ...next, elements: next.elements.map(raw => { const item = raw as DrawElement; return item.id !== element.id && item.type !== 'frame' && inside({ x: item.x, y: item.y }, element) && inside({ x: item.x + item.width, y: item.y + item.height }, element) ? { ...item, frameId: element.id } : item }) }
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
    if (!file) return
    if (!file.type.startsWith('image/')) { setMessage('Choose an image file.'); return }
    if (file.size > 3 * 1024 * 1024) { setMessage('Choose an image smaller than 3 MB so the complete diagram can be saved.'); return }
    const dataURL = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
    const image = new Image(); image.src = dataURL
    try { await image.decode(); if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image') } catch { setMessage('This image could not be decoded. Choose a valid image file.'); return }
    const rect = surface.current?.getBoundingClientRect(), center = worldPoint({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 })
    const width = Math.min(360, image.naturalWidth || 240), height = width * (image.naturalHeight || 180) / (image.naturalWidth || 240), id = newDrawId('image')
    const element = createElement('image', { x: center.x - width / 2, y: center.y - height / 2 }, { x: center.x + width / 2, y: center.y + height / 2 }, { fileId: id, status: 'saved', scale: [1, 1] })
    try { const next = validateArchitectureScene({ ...draftRef.current, elements: [...draftRef.current.elements, element], files: { ...draftRef.current.files, [id]: { id, mimeType: file.type, dataURL, created: Date.now() } } }); emit(next); select([element.id]); setTool('selection') } catch (error) { setMessage(error instanceof Error ? error.message : 'The image could not be added.') }
  }

  const storedBackground = draft.appState?.viewBackgroundColor ?? '#ffffff'
  const canvasBackground = darkMode && ['#ffffff', '#fff', 'white'].includes(storedBackground.toLowerCase()) ? '#0f1211' : storedBackground
  const chosen = live(draft).filter(element => selectedIds.has(element.id)), first = chosen[0]
  const property = <K extends keyof DrawElement>(key: K, fallback: DrawElement[K]) => {
    const primary = ['fontSize', 'fontFamily', 'textAlign'].includes(String(key)) ? chosen.find(element => element.type === 'text') ?? first : first
    return primary?.[key] ?? defaults[key] ?? fallback
  }
  const selectionBounds = chosen.length ? getSceneBounds(chosen) : null
  const editElement = textEdit ? live(draft).find(e => e.id === textEdit.id) : undefined
  const textPosition = editElement ? { left: viewport.x + editElement.x * viewport.zoom, top: viewport.y + editElement.y * viewport.zoom } : undefined
  const canUndo = props.onUndo ? props.canUndo : historyIndex.current > 0
  const canRedo = props.onRedo ? props.canRedo : historyIndex.current + 1 < history.current.length
  void historyVersion

  return <section ref={wrapper} className={`draw-canvas ${darkMode ? 'draw-dark' : 'draw-light'} ${viewMode ? 'draw-presentation' : ''}`} aria-label="Draw canvas" tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onCopy={event => clipboardEvents.current.copy(event)} onCut={event => clipboardEvents.current.cut(event)} onPaste={event => clipboardEvents.current.paste(event)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) { heldSpace.current = false; if (nudgeBefore.current) { nudgeBefore.current = null; emit(draftRef.current) } } }}>
    {!viewMode && <div className="draw-tools" role="toolbar" aria-label="Drawing tools">
      {tools.map(item => <button key={item.tool} type="button" aria-label={`${item.name} tool`} aria-pressed={tool === item.tool} className={tool === item.tool ? 'active' : ''} title={`${item.name} (${item.shortcut})`} onClick={() => setActiveTool(item.tool)}><DrawToolIcon tool={item.tool} /><small>{item.shortcut.split(' / ').slice(-1)[0]}</small></button>)}
      <span className="draw-divider" />
      <button type="button" aria-label="Keep tool selected" aria-pressed={keepTool} title="Keep tool selected (Q)" onClick={() => setKeepTool(value => !value)}><DrawToolIcon tool={keepTool ? 'lock' : 'unlock'} /></button>
    </div>}
    <svg ref={surface} className={`draw-surface tool-${tool} ${isPanning ? 'is-panning' : ''}`} data-testid="draw-surface" role="application" aria-label="Drawing surface" width="100%" height="100%" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { if (gesture.current && gesture.current.kind !== 'pan') preview(gesture.current.before); gesture.current = null; setIsPanning(false); setMarquee(null) }} onLostPointerCapture={() => { if (gesture.current?.kind === 'pan') { gesture.current = null; setIsPanning(false) } }} onContextMenu={event => event.preventDefault()} onDoubleClick={event => { if (viewMode || event.button !== 0) return; const id = (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id'); beginText(id ?? undefined, worldPoint({ x: event.clientX, y: event.clientY })) }}>
      {grid && <defs><pattern id="draw-grid" patternUnits="userSpaceOnUse" x={viewport.x} y={viewport.y} width={20 * viewport.zoom} height={20 * viewport.zoom}><circle cx="1" cy="1" r="0.8" fill={darkMode ? '#465e55' : '#b6c9c1'} /></pattern></defs>}
      <rect width="100%" height="100%" fill={grid ? 'url(#draw-grid)' : canvasBackground} data-draw-background="true" />
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`} data-draw-viewport="true" data-drawing-layer="true">
        <g data-draw-content="true"><DrawSceneSvg elements={draft.elements} files={draft.files} darkMode={darkMode} backgroundColor={canvasBackground} selectedIds={selectedIds} /></g>
        {!viewMode && selectionBounds && <g className="draw-selection" fill="none" stroke="#17b895" strokeWidth={1.5 / viewport.zoom}>
          <rect x={selectionBounds.x - 3 / viewport.zoom} y={selectionBounds.y - 3 / viewport.zoom} width={selectionBounds.width + 6 / viewport.zoom} height={selectionBounds.height + 6 / viewport.zoom} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} pointerEvents="none" />
          <line x1={selectionBounds.x + selectionBounds.width / 2} y1={selectionBounds.y} x2={selectionBounds.x + selectionBounds.width / 2} y2={selectionBounds.y - 26 / viewport.zoom} />
          <circle data-rotate="true" aria-label="Rotate selection" cx={selectionBounds.x + selectionBounds.width / 2} cy={selectionBounds.y - 30 / viewport.zoom} r={5 / viewport.zoom} fill={darkMode ? '#123f34' : '#ffffff'} />
          {(['nw', 'ne', 'sw', 'se'] as const).map(corner => <rect key={corner} data-resize={corner} aria-label={`Resize ${corner}`} x={(corner.includes('w') ? selectionBounds.x : selectionBounds.x + selectionBounds.width) - 4 / viewport.zoom} y={(corner.includes('n') ? selectionBounds.y : selectionBounds.y + selectionBounds.height) - 4 / viewport.zoom} width={8 / viewport.zoom} height={8 / viewport.zoom} fill={darkMode ? '#123f34' : '#ffffff'} />)}
          {chosen.length === 1 && ['line', 'arrow'].includes(chosen[0].type) && getWorldPoints(chosen[0]).map((point, index) => <circle key={index} data-point-index={index} data-element-handle={chosen[0].id} aria-label={`Edit path point ${index + 1}`} cx={point.x} cy={point.y} r={5 / viewport.zoom} fill="#d7fff1" />)}
        </g>}
        {snapGuides.x !== undefined && <line x1={snapGuides.x} x2={snapGuides.x} y1={-100000} y2={100000} stroke="#14b895" strokeWidth={1 / viewport.zoom} strokeDasharray="4 4" pointerEvents="none" />}
        {snapGuides.y !== undefined && <line y1={snapGuides.y} y2={snapGuides.y} x1={-100000} x2={100000} stroke="#14b895" strokeWidth={1 / viewport.zoom} strokeDasharray="4 4" pointerEvents="none" />}
        {marquee && <rect {...marquee} fill="#17b89520" stroke="#17b895" strokeWidth={1 / viewport.zoom} pointerEvents="none" />}
      </g>
    </svg>
    {textEdit && editElement && <textarea ref={textRef} className="draw-text-editor" aria-label="Edit drawing text" style={{ ...textPosition, width: Math.max(180, editElement.width * viewport.zoom + 40), minHeight: Math.max(46, editElement.height * viewport.zoom + 20), fontSize: (editElement.fontSize ?? 20) * viewport.zoom }} value={textEdit.value} onChange={event => setTextEdit({ ...textEdit, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) { event.preventDefault(); finishText() } }} onBlur={() => finishText()} />}
    {!viewMode && <aside className="draw-properties" aria-label="Drawing properties">
      <div className="draw-properties-heading"><strong>{chosen.length ? `${chosen.length} selected` : 'Appearance'}</strong><span>{chosen.length ? 'Edit selection' : 'For new drawings'}</span></div>
      <div className="draw-property-pair"><label>Stroke<input aria-label="Stroke color" type="color" value={String(property('strokeColor', '#0f766e')).startsWith('#') ? String(property('strokeColor', '#0f766e')) : '#0f766e'} onChange={event => applyProperties({ strokeColor: event.target.value })} /></label><label>Fill<input aria-label="Background color" type="color" value={String(property('backgroundColor', 'transparent')).startsWith('#') ? String(property('backgroundColor', 'transparent')) : '#ffffff'} onChange={event => applyProperties({ backgroundColor: event.target.value })} /></label></div>
      <label className="draw-check"><input type="checkbox" checked={property('backgroundColor', 'transparent') === 'transparent'} onChange={event => applyProperties({ backgroundColor: event.target.checked ? 'transparent' : '#b2f2dc' })} />No fill</label>
      <label>Fill style<select aria-label="Fill style" value={String(property('fillStyle', 'solid'))} onChange={event => applyProperties({ fillStyle: event.target.value })}><option value="solid">Solid</option><option value="hachure">Hatch</option><option value="cross-hatch">Crosshatch</option></select></label>
      <div className="draw-property-pair"><label>Width<input aria-label="Stroke width" type="number" min="1" max="20" value={Number(property('strokeWidth', 2))} onChange={event => applyProperties({ strokeWidth: Math.max(1, Number(event.target.value)) })} /></label><label>Style<select aria-label="Stroke style" value={String(property('strokeStyle', 'solid'))} onChange={event => applyProperties({ strokeStyle: event.target.value })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label></div>
      <label>Sketch<select aria-label="Roughness" value={Number(property('roughness', 0))} onChange={event => applyProperties({ roughness: Number(event.target.value) })}><option value="0">Clean</option><option value="1">Sketch</option><option value="2">Loose</option></select></label>
      <label>Corners<select aria-label="Corners" value={property('roundness', null) ? 'rounded' : 'sharp'} onChange={event => applyProperties({ roundness: event.target.value === 'rounded' ? { type: 3 } : null })}><option value="rounded">Rounded</option><option value="sharp">Sharp</option></select></label>
      <label>Opacity <span>{Number(property('opacity', 100))}%</span><input aria-label="Opacity" type="range" min="0" max="100" value={Number(property('opacity', 100))} onChange={event => applyProperties({ opacity: Number(event.target.value) })} /></label>
      {(tool === 'text' || showTextProperties || chosen.some(e => e.type === 'text')) && <fieldset><legend>Text</legend><div className="draw-property-pair"><label>Size<input aria-label="Font size" type="number" min="8" max="144" value={Number(property('fontSize', 20))} onChange={event => applyProperties({ fontSize: Math.max(8, Number(event.target.value)) })} /></label><label>Font<select aria-label="Font family" value={Number(property('fontFamily', 2))} onChange={event => applyProperties({ fontFamily: Number(event.target.value) })}><option value="2">Sans</option><option value="1">Hand</option><option value="3">Mono</option>{![1, 2, 3].includes(Number(property('fontFamily', 2))) && <option value={Number(property('fontFamily', 2))}>Imported font {Number(property('fontFamily', 2))} (local fallback)</option>}</select></label></div><label>Alignment<select aria-label="Text alignment" value={String(property('textAlign', 'left'))} onChange={event => applyProperties({ textAlign: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></fieldset>}
      {(['line', 'arrow'].includes(tool) || chosen.some(e => ['line', 'arrow'].includes(e.type))) && <fieldset><legend>Connection</legend>{(['startArrowhead', 'endArrowhead'] as const).map(key => <label key={key}>{key === 'startArrowhead' ? 'Start' : 'End'}<select aria-label={key === 'startArrowhead' ? 'Start arrowhead' : 'End arrowhead'} value={String(property(key, key === 'endArrowhead' ? 'arrow' : null) ?? 'none')} onChange={event => applyProperties({ [key]: event.target.value === 'none' ? null : event.target.value })}>{['none', 'arrow', 'triangle', 'dot', 'bar', 'diamond'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}<label>Routing<select aria-label="Arrow routing" value={first?.elbowed ? 'elbow' : first?.roundness ? 'curved' : 'sharp'} onChange={event => applyProperties({ elbowed: event.target.value === 'elbow', roundness: event.target.value === 'curved' ? { type: 2 } : null })}><option value="sharp">Sharp</option><option value="curved">Curved</option><option value="elbow">Elbow</option></select></label></fieldset>}
      {chosen.length > 0 && <><label>Rotation<input aria-label="Rotation" type="number" value={Math.round(Number(first?.angle ?? 0) * 180 / Math.PI)} onChange={event => applyProperties({ angle: Number(event.target.value) * Math.PI / 180 })} /></label><div className="draw-action-grid"><button onClick={duplicate} title="Duplicate (Ctrl/Cmd+D)">Duplicate</button><button onClick={() => applyProperties({ locked: !chosen.every(e => e.locked) })}>{chosen.every(e => e.locked) ? 'Unlock' : 'Lock'}</button><button onClick={() => groupSelection()}>Group</button><button onClick={() => groupSelection(true)}>Ungroup</button><button onClick={() => reorder('back')}>To back</button><button onClick={() => reorder('front')}>To front</button></div>{chosen.length > 1 && <div className="draw-action-grid">{(['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as const).map(side => <button key={side} aria-label={`Align ${side}`} onClick={() => align(side)}>{side.replace('centerX', 'Center ↔').replace('centerY', 'Center ↕')}</button>)}</div>}<button className="draw-delete" onClick={() => { emit(deleteElements(draftRef.current, selectedIds, true)); select([]) }}>Delete selection</button></>}
    </aside>}
    <div className="draw-bottom-controls"><button aria-label="Zoom out" onClick={() => setViewport(view => ({ ...view, zoom: Math.max(0.1, view.zoom / 1.2) }))}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setViewport(view => ({ ...view, zoom: Math.min(5, view.zoom * 1.2) }))}>+</button><button aria-label="Fit drawing" title="Fit all (Shift+1)" onClick={fitScene}>Fit</button>{!viewMode && <><span className="draw-divider" /><button aria-label="Undo drawing" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>↶</button><button aria-label="Redo drawing" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canRedo} onClick={redo}>↷</button><button aria-label="Snap to grid" aria-pressed={grid} onClick={() => setGrid(value => !value)}>Grid</button><button aria-label="Snap to objects" aria-pressed={snap} onClick={() => setSnap(value => !value)}>Snap</button></>}</div>
    {!viewMode && <DrawLibrary scene={draft} selectedIds={selectedIds} onInsert={component => insertComponent(component)} />}
    {!viewMode && <button className="draw-help-toggle" aria-label="Keyboard shortcuts" onClick={() => setHelp(value => !value)}>?</button>}
    {message && <div className="draw-message" role="alert">{message}<button aria-label="Dismiss drawing message" onClick={() => setMessage(null)}>×</button></div>}
    {help && <div className="draw-help-overlay" onClick={() => setHelp(false)}><section className="draw-help-dialog" role="dialog" aria-modal="true" aria-labelledby="draw-help-title" onClick={event => event.stopPropagation()}><button className="draw-help-close" aria-label="Close keyboard shortcuts" onClick={() => setHelp(false)}>×</button><h2 id="draw-help-title">Drawing shortcuts</h2><p>Draw with the keyboard, then refine each object.</p><div className="draw-help-columns"><div><h3>Tools</h3>{tools.map(item => <p key={item.tool}><span>{item.name}</span><kbd>{item.shortcut}</kbd></p>)}<p><span>Keep tool selected</span><kbd>Q</kbd></p></div><div><h3>Edit</h3>{[['Undo / Redo', '⌘/Ctrl Z / ⇧ Z'], ['Duplicate', '⌘/Ctrl D · Alt drag'], ['Group / Ungroup', '⌘/Ctrl G / ⇧ G'], ['Lock / Unlock', '⌘/Ctrl ⇧ L'], ['Copy · Cut · Paste', '⌘/Ctrl C · X · V'], ['Label selection', 'Enter · double-click'], ['Finish text', '⌘/Ctrl Enter · Esc'], ['Text newline', 'Enter · ⇧ Enter'], ['Move', 'Arrows · ⇧ Arrows'], ['Align', '⌘/Ctrl ⇧ Arrows'], ['Layer order', '⌘/Ctrl [ / ]'], ['Front / Back', '⌘/Ctrl ⇧ [ / ]'], ['Pan', 'Right drag · Space drag · H'], ['Zoom', '⌘/Ctrl wheel · + / −'], ['Fit all / Selection', '⇧ 1 / ⇧ 2'], ['Proportional shape / Resize', 'Shift drag']].map(([label, keys]) => <p key={label}><span>{label}</span><kbd>{keys}</kbd></p>)}</div></div></section></div>}
    <input ref={fileInput} className="draw-image-input" aria-label="Choose drawing image" type="file" accept="image/*" onChange={event => { void uploadImage(event.target.files?.[0]).catch(error => setMessage(error instanceof Error ? error.message : 'The image could not be read.')); event.target.value = '' }} />
  </section>
}
