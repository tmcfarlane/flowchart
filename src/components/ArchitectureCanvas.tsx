import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, MainMenu, CaptureUpdateAction, restoreElements, convertToExcalidrawElements, exportToBlob, exportToSvg, exportToCanvas, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles, LibraryItems } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { Node, Edge } from 'reactflow'
import type { ArchitectureScene } from '../shared/architectureScene'
import { mergeGraphElements, graphFromElements, graphSignature, bridgeData } from '../utils/architectureBridge'
import '@excalidraw/excalidraw/index.css'
import './ArchitectureCanvas.css'

// Fonts are copied from the installed editor package by our dev/build scripts.
;(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = `${import.meta.env.BASE_URL}excalidraw-assets/`

export interface ArchitectureCanvasApi {
  viewportToScenePoint: (point: { x: number; y: number }) => { x: number; y: number }
  fitScene: () => void
  exportImage: (format: 'png' | 'svg' | 'gif', duration?: number) => Promise<void>
  getScene: () => ArchitectureScene
  replaceScene: (scene: ArchitectureScene, fit?: boolean) => void
}

interface Props {
  scene?: ArchitectureScene
  nodes: Node[]
  edges: Edge[]
  darkMode: boolean
  onChange: (scene: ArchitectureScene, nodes: Node[], edges: Edge[]) => void
  onReady?: (api: ArchitectureCanvasApi | null) => void
  viewMode?: boolean
}

const LIBRARY_KEY = 'flowchart-architecture-library-v1'
const snapshot = (elements: readonly ExcalidrawElement[], state: Pick<AppState, 'viewBackgroundColor' | 'gridSize'>, files: BinaryFiles): ArchitectureScene => {
  const referenced = new Set(elements.flatMap(e => e.type === 'image' && e.fileId ? [e.fileId] : []))
  const usedFiles = Object.fromEntries(Object.entries(files).filter(([id]) => referenced.has(id as never)))
  return JSON.parse(JSON.stringify({ version: 1, elements, files: usedFiles, appState: { viewBackgroundColor: state.viewBackgroundColor, gridSize: state.gridSize } }))
}
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function readLibrary(): LibraryItems {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]') as LibraryItems } catch { return [] }
}

/** The official editor supplies drawing geometry, bindings, history and hotkeys. */
export default function ArchitectureCanvas({ scene, nodes, edges, darkMode, onChange, onReady, viewMode = false }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef({ nodes, edges, onChange, scene })
  latest.current = { nodes, edges, onChange, scene }
  const lastEmitted = useRef('')
  const lastGraph = useRef(graphSignature(nodes, edges))
  const lastSelection = useRef('')
  const applying = useRef(false)
  const initial = useRef({
    elements: mergeGraphElements(restoreElements((scene?.elements ?? []) as unknown as ExcalidrawElement[], null), nodes, edges, darkMode),
    appState: { ...scene?.appState, gridSize: scene?.appState?.gridSize ?? 20, viewBackgroundColor: scene?.appState?.viewBackgroundColor ?? '#ffffff' },
    files: scene?.files as unknown as BinaryFiles,
    libraryItems: readLibrary(),
    scrollToContent: true,
  })

  const handleChange = useCallback((elements: readonly OrderedExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (applying.current || state.isLoading) return
    const current = latest.current
    const graph = graphFromElements(elements, current.nodes, current.edges)
    const nextScene = snapshot(graph.elements, state, files)
    const serialized = JSON.stringify(nextScene)
    const selected = elements.filter(e => !e.isDeleted && state.selectedElementIds[e.id]).map(bridgeData).filter(Boolean)
    const selection = JSON.stringify(selected.map(m => [m!.kind, m!.id]))
    if (serialized === lastEmitted.current && selection === lastSelection.current) return
    lastSelection.current = selection
    lastEmitted.current = serialized
    lastGraph.current = graphSignature(graph.nodes, graph.edges)
    current.onChange(nextScene, graph.nodes.map(n => ({ ...n, selected: selected.some(m => m!.kind === 'node' && m!.id === n.id) })), graph.edges.map(e => ({ ...e, selected: selected.some(m => m!.kind === 'edge' && m!.id === e.id) })))
  }, [])

  useEffect(() => {
    if (!api) return
    const serialized = scene ? JSON.stringify(scene) : ''
    const signature = graphSignature(nodes, edges)
    if (serialized === lastEmitted.current && signature === lastGraph.current) return
    const externalScene = serialized !== lastEmitted.current
    const native = externalScene ? restoreElements((scene?.elements ?? []) as unknown as ExcalidrawElement[], null) : api.getSceneElementsIncludingDeleted()
    const elements = mergeGraphElements(native, nodes, edges, darkMode)
    lastEmitted.current = serialized
    lastGraph.current = signature
    applying.current = true
    if (scene?.files) api.addFiles(Object.values(scene.files) as unknown as Parameters<typeof api.addFiles>[0])
    api.updateScene({ elements, appState: { viewBackgroundColor: scene?.appState?.viewBackgroundColor ?? api.getAppState().viewBackgroundColor, gridSize: scene?.appState?.gridSize ?? api.getAppState().gridSize }, captureUpdate: externalScene ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER })
    applying.current = false
  }, [api, scene, nodes, edges, darkMode])

  useEffect(() => {
    if (!api) return
    let cancelled = false
    const addIcons = async () => {
      const current = api.getSceneElementsIncludingDeleted()
      const extra: ExcalidrawElement[] = []
      const updated = [...current]
      for (const node of nodes) {
        const source = node.data?.imageUrl
        if (typeof source !== 'string' || !source) continue
        const shape = current.find(e => !e.isDeleted && bridgeData(e)?.kind === 'node' && bridgeData(e)?.id === node.id)
        if (!shape || current.some(e => !e.isDeleted && bridgeData(e)?.kind === 'icon' && bridgeData(e)?.id === node.id)) continue
        try {
          const response = await fetch(source)
          if (!response.ok) continue
          const blob = await response.blob()
          const dataURL = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
          if (cancelled) return
          const fileId = `fc-icon-${node.id}`
          api.addFiles([{ id: fileId, dataURL, mimeType: blob.type, created: Date.now() }] as unknown as Parameters<typeof api.addFiles>[0])
          const groupId = `fc-icon-group-${node.id}`
          const shapeIndex = updated.findIndex(e => e.id === shape.id)
          updated[shapeIndex] = { ...shape, groupIds: [...shape.groupIds, groupId] }
          extra.push(...convertToExcalidrawElements([{ id: `fc-icon-element-${node.id}`, type: 'image', fileId: fileId as never, x: shape.x + 10, y: shape.y + 10, width: 28, height: 28, groupIds: [...shape.groupIds, groupId], customData: { flowchart: { kind: 'icon', id: node.id } } }], { regenerateIds: false }))
        } catch { /* Original icon URL remains in semantic metadata and exports. */ }
      }
      if (!cancelled && extra.length) {
        const live = [...api.getSceneElementsIncludingDeleted()]
        for (let i = 0; i < live.length; i++) {
          const withIcon = updated.find(e => e.id === live[i].id)
          if (withIcon && extra.some(e => bridgeData(e)?.id === bridgeData(live[i])?.id)) live[i] = { ...live[i], groupIds: withIcon.groupIds }
        }
        const liveIds = new Set(live.map(e => e.id))
        api.updateScene({ elements: [...live, ...extra.filter(e => !liveIds.has(e.id))] as OrderedExcalidrawElement[], captureUpdate: CaptureUpdateAction.NEVER })
      }
    }
    void addIcons()
    return () => { cancelled = true }
  }, [api, nodes])

  useEffect(() => {
    if (!api || !onReady) return
    const getScene = () => snapshot(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles())
    onReady({
      getScene,
      viewportToScenePoint: point => viewportCoordsToSceneCoords({ clientX: point.x, clientY: point.y }, api.getAppState()),
      fitScene: () => api.scrollToContent(undefined, { fitToContent: true, animate: true }),
      replaceScene: (next, fit = false) => {
        api.addFiles(Object.values(next.files) as unknown as Parameters<typeof api.addFiles>[0])
        api.updateScene({ elements: restoreElements(next.elements as unknown as ExcalidrawElement[], null), appState: { viewBackgroundColor: next.appState?.viewBackgroundColor ?? api.getAppState().viewBackgroundColor, gridSize: next.appState?.gridSize ?? api.getAppState().gridSize }, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
        if (fit) api.scrollToContent(undefined, { fitToContent: true, animate: true })
      },
      exportImage: async (format, duration = 2) => {
        const elements = api.getSceneElements()
        if (!elements.length) throw new Error('Draw something before exporting an image.')
        const options = { elements, appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: darkMode }, files: api.getFiles() }
        if (format === 'svg') {
          const svg = await exportToSvg(options)
          download(new Blob([svg.outerHTML], { type: 'image/svg+xml' }), 'architecture.svg')
        } else if (format === 'gif') {
          const [{ default: GIF }, canvas] = await Promise.all([import('gif.js'), exportToCanvas(options)])
          await new Promise<void>((resolve, reject) => {
            const gif = new GIF({ workers: 2, quality: 10, workerScript: '/gif.worker.js', repeat: 0, width: canvas.width, height: canvas.height })
            gif.addFrame(canvas, { copy: true, delay: Math.max(100, duration * 1000) })
            gif.on('finished', (blob: Blob) => { download(blob, 'architecture.gif'); resolve() })
            gif.on('error', reject)
            gif.render()
          })
        } else download(await exportToBlob({ ...options, mimeType: 'image/png' }), 'architecture.png')
      },
    })
    return () => onReady(null)
  }, [api, darkMode, onReady])

  const handleDuplicate = (next: readonly ExcalidrawElement[], previous: readonly ExcalidrawElement[]) => {
    const previousIds = new Set(previous.map(e => e.id))
    const duplicatedIds = new Map<string, string>()
    for (const element of next) {
      const metadata = bridgeData(element)
      if (metadata && metadata.kind !== 'icon' && !previousIds.has(element.id)) duplicatedIds.set(metadata.id, `native-${element.id}`)
    }
    return next.map(element => {
      const metadata = bridgeData(element)
      if (!metadata || previousIds.has(element.id)) return element
      const id = metadata.kind === 'icon' ? duplicatedIds.get(metadata.id) ?? metadata.id : `native-${element.id}`
      return { ...element, customData: { ...element.customData, flowchart: { ...metadata, id, snapshot: metadata.snapshot ? { ...metadata.snapshot, id, ...('parentNode' in metadata.snapshot && metadata.snapshot.parentNode ? { parentNode: duplicatedIds.get(metadata.snapshot.parentNode) ?? metadata.snapshot.parentNode } : {}), ...('source' in metadata.snapshot ? { source: duplicatedIds.get(metadata.snapshot.source) ?? metadata.snapshot.source, target: duplicatedIds.get(metadata.snapshot.target) ?? metadata.snapshot.target } : {}) } : undefined } } }
    })
  }

  return <section className={`architecture-canvas ${viewMode ? 'architecture-presentation' : ''}`} aria-label="Architecture drawing canvas">
    {error && <div className="architecture-error" role="alert">{error}<button onClick={() => setError(null)} aria-label="Dismiss drawing error">×</button></div>}
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={initial.current}
      onChange={handleChange}
      onDuplicate={handleDuplicate}
      theme={darkMode ? 'dark' : 'light'}
      viewModeEnabled={viewMode}
      zenModeEnabled={viewMode}
      handleKeyboardGlobally={false}
      autoFocus
      aiEnabled={false}
      validateEmbeddable={false}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
      onLibraryChange={items => { try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(items)) } catch { setError('Your browser storage is full. Export the diagram before closing this tab.') } }}
      onLinkOpen={(_, event) => { event.preventDefault(); setError('Copy element links from the properties menu to open them separately.') }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  </section>
}
