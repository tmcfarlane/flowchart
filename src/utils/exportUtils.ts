import type GIF from 'gif.js'
import type { Node as FlowNode, Edge } from 'reactflow'
import type { DiagramMode } from '../App'
import { getIconId } from './azureIconIds'
import { getDiagramExportGeometry, type ExportBounds } from './exportGeometry'
export { parseFlowJson } from './importFlow'

export interface ImageExportOptions {
  area: 'diagram' | 'viewport'
  nodes: FlowNode[]
}

export interface GifExportMetadata {
  pixelWidth: number
  pixelHeight: number
  resolutionAdjusted: boolean
}

const GIF_FRAME_BYTE_BUDGET = 64 * 1024 * 1024

type ImageRenderer = typeof import('html-to-image')
type SnapshotCaptureOptions = NonNullable<Parameters<ImageRenderer['toPng']>[1]> & { width: number; height: number; pixelRatio: number }
async function loadImageRenderer(): Promise<ImageRenderer> {
  try { return await import('html-to-image') }
  catch { throw new Error('Image export tools could not be loaded. Check your connection and try exporting again.') }
}
async function loadGifEncoder(): Promise<typeof GIF> {
  try { return (await import('gif.js')).default }
  catch { throw new Error('GIF export tools could not be loaded. Check your connection and try exporting again.') }
}

// gif.js 0.2.0 returns finished workers to freeWorkers. abort() only drains
// activeWorkers, so its public abort alone retains idle workers and the copied
// frame buffers their message callbacks capture after a successful export.
function disposeGifEncoder(encoder: GIF | null): void {
  if (!encoder) return
  const lifecycle = encoder as GIF & {
    activeWorkers?: Worker[]; freeWorkers?: Worker[]
    frames?: unknown[]; imageParts?: unknown[]
    removeAllListeners?: () => unknown
  }
  const workers = new Set([...(lifecycle.activeWorkers ?? []), ...(lifecycle.freeWorkers ?? [])])
  lifecycle.activeWorkers?.splice(0)
  lifecycle.freeWorkers?.splice(0)
  lifecycle.running = false
  for (const worker of workers) {
    worker.onmessage = null
    worker.onerror = null
    try { worker.terminate() } catch { /* Continue disposing the other worker. */ }
  }
  lifecycle.removeAllListeners?.()
  lifecycle.frames?.splice(0)
  lifecycle.imageParts?.splice(0)
}

const EDITOR_ELEMENTS = [
  '.react-flow__controls', '.react-flow__minimap', '.react-flow__background',
  '.react-flow__attribution', '.react-flow__handle', '.react-flow__resize-control',
  '.react-flow__selection', '.react-flow__nodesselection',
  '.react-flow__connectionline', '.react-flow__edge-interaction',
].join(',')
const exportFilter = (node: Node): boolean => !(node instanceof Element && node.matches(EDITOR_ELEMENTS))

// html-to-image deep-clones SVG descendants without copying their computed
// styles. Preserve the attached theme's actual drawing styles before capture.
const SVG_PRESENTATION_STYLES = [
  'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'vector-effect', 'paint-order',
  'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'visibility',
]
const HTML_PRESENTATION_STYLES = [
  'color', 'color-scheme', 'background-color', 'background-image',
  'background-size', 'background-position', 'background-repeat',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'box-shadow', 'text-shadow', 'filter', 'outline-color', 'outline-style', 'outline-width',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-transform',
  'text-decoration-color', 'text-decoration-line', 'opacity', 'visibility',
]
function freezeSnapshotPresentation(snapshot: HTMLDivElement, shells: HTMLElement[]) {
  // Freeze visual properties after removing selection decoration. Keep layout
  // widths/transforms responsive so whole-diagram geometry can expand later.
  for (const element of [...shells, snapshot, ...snapshot.querySelectorAll<HTMLElement | SVGElement>('*')]) {
    const style = window.getComputedStyle(element)
    const properties = element instanceof SVGElement ? SVG_PRESENTATION_STYLES : HTML_PRESENTATION_STYLES
    for (const property of [...properties, ...Array.from(style).filter(name => name.startsWith('--'))]) {
      const value = style.getPropertyValue(property)
      if (value) element.style.setProperty(property, value, 'important')
    }
  }
}

async function validateGeneratedImageAssets(sources: string[]): Promise<void> {
  const urls = new Set<string>()
  for (const source of sources) {
    try {
      const url = new URL(source, window.location.href)
      const capability = url.searchParams.get('key')
      // Only our exact same-origin read-capability route gets a new request.
      // Imported remote images, uploads and icons keep their existing behavior.
      if (url.origin === window.location.origin && !url.username && !url.password &&
          /^\/api\/images\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(url.pathname) &&
          [...url.searchParams].length === 1 && capability && /^[A-Za-z0-9_-]{43}$/.test(capability)) {
        // Encoded query characters and fragments identify the same WebP read.
        // Check its canonical route so these spellings cannot bypass freshness.
        url.search = `?key=${capability}`
        url.hash = ''
        urls.add(url.href)
      }
    } catch { /* Other image source formats do not expand this fetch scope. */ }
  }
  if (!urls.size) return
  const controller = new AbortController()
  const remaining = [...urls].values()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const unavailable = () => new Error('A generated image could not be verified. Check your connection and try exporting again.')
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('A generated image could not be checked in time. Check your connection and try exporting again.'))
      controller.abort()
    }, 8000)
  })
  const check = async () => {
    for (const url of remaining) {
      if (controller.signal.aborted) throw unavailable()
      let response: Response
      try {
        response = await fetch(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal })
      } catch { throw unavailable() }
      if (response.status === 404 || response.status === 410) throw new Error('A generated image was deleted or is no longer available. Remove or replace it before exporting.')
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/webp') throw unavailable()
    }
  }
  try { await Promise.race([Promise.all(Array.from({ length: Math.min(4, urls.size) }, check)), deadline]) }
  finally { clearTimeout(timeout); controller.abort() }
}

async function withExportSnapshot<T>(
  wrapper: HTMLDivElement,
  darkMode: boolean,
  maxRasterDimension: number,
  capture: (snapshot: HTMLDivElement, options: SnapshotCaptureOptions, renderer: ImageRenderer) => Promise<T>,
  exportOptions?: ImageExportOptions,
): Promise<T> {
  // Freeze content, viewport and theme before any verification or chunk load
  // can yield to editing, resizing, or a body-level light/dark mode change.
  const snapshot = wrapper.cloneNode(true) as HTMLDivElement
  const diagramNodes = exportOptions?.area === 'diagram'
    ? exportOptions.nodes.map(node => ({ ...node, position: { ...node.position }, style: node.style ? { ...node.style } : undefined }))
    : undefined
  let width = wrapper.clientWidth
  let height = wrapper.clientHeight
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error('The diagram viewport is not ready to export. Resize the window and try again.')
  }
  const host = document.createElement('div')
  host.dataset.flowchartExportSnapshot = 'true'
  host.setAttribute('aria-hidden', 'true')
  host.inert = true
  host.className = document.body.className
  host.style.colorScheme = darkMode ? 'dark' : 'light'
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, height: `${height}px`, pointerEvents: 'none' })
  // Retain ancestor classes/custom properties so .app theme selectors and
  // inherited fonts apply before html-to-image copies computed styles.
  const ancestors: HTMLElement[] = []
  for (let parent = wrapper.parentElement; parent && parent !== document.body; parent = parent.parentElement) ancestors.unshift(parent)
  let container: HTMLElement = host
  const shells: HTMLElement[] = []
  for (const ancestor of ancestors) {
    const shell = ancestor.cloneNode(false) as HTMLElement
    shell.removeAttribute('id')
    Object.assign(shell.style, { width: `${width}px`, height: `${height}px`, minWidth: '0', minHeight: '0', display: 'block', position: 'relative' })
    container.appendChild(shell)
    shells.push(shell)
    container = shell
  }
  Object.assign(snapshot.style, { width: `${width}px`, height: `${height}px`, flex: 'none' })
  // Remove SVG descendants explicitly: html-to-image deep-clones SVG roots
  // without applying its filter to every inner path/group.
  snapshot.querySelectorAll(EDITOR_ELEMENTS).forEach(element => element.remove())
  snapshot.querySelectorAll('.editable-edge-text.hint').forEach(element => {
    const label = element.closest('.editable-edge-label')
    element.remove()
    if (label && !label.textContent?.trim()) label.remove()
  })
  snapshot.querySelectorAll('.selected,.dragging,.connecting,.changed').forEach(element => element.classList.remove('selected', 'dragging', 'connecting', 'changed'))
  container.appendChild(snapshot)
  const imageAttributes = Array.from(snapshot.querySelectorAll('img,svg image'), element => ({
    element,
    attributes: ['src', 'srcset', 'sizes', 'href', 'xlink:href'].flatMap(name => {
      const value = element.getAttribute(name)
      return value === null ? [] : [{ name, value }]
    }),
  }))
  const imageSources = imageAttributes.flatMap(({ element }) => {
    const source = element.getAttribute('src') ?? element.getAttribute('href') ?? element.getAttribute('xlink:href')
    return source ? [source] : []
  })
  // Briefly attach the cleaned clone for initial computed styles. Loading
  // attributes stay absent until its exact frozen generated sources are checked.
  for (const { element, attributes } of imageAttributes) for (const { name } of attributes) element.removeAttribute(name)
  document.body.appendChild(host)
  try { freezeSnapshotPresentation(snapshot, [host, ...shells]) }
  finally { host.remove() }
  await validateGeneratedImageAssets(imageSources)
  for (const { element, attributes } of imageAttributes) for (const { name, value } of attributes) element.setAttribute(name, value)
  const renderer = await loadImageRenderer()
  document.body.appendChild(host)
  try {
    await document.fonts?.ready
    if (diagramNodes) {
      const viewport = snapshot.querySelector<HTMLElement>('.react-flow__viewport')
      if (!viewport) throw new Error('The diagram canvas is not ready to export. Wait for it to finish loading and try again.')
      // Measure curves and captions in diagram coordinates on this disposable
      // clone. Resetting its transform never pans or zooms the live canvas.
      viewport.style.transform = 'translate(0px, 0px) scale(1)'
      const origin = viewport.getBoundingClientRect()
      const extraBounds: ExportBounds[] = []
      for (const element of viewport.querySelectorAll<HTMLElement>('.react-flow__node,.react-flow__edgelabel-renderer > *')) {
        const rect = element.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) extraBounds.push({ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height })
      }
      for (const path of viewport.querySelectorAll<SVGGraphicsElement>('.react-flow__edge-path')) {
        try {
          const bounds = path.getBBox()
          extraBounds.push({ x: bounds.x - 8, y: bounds.y - 8, width: bounds.width + 16, height: bounds.height + 16 })
        } catch { /* Nodes still define a usable extent before a path has painted. */ }
      }
      const geometry = getDiagramExportGeometry(diagramNodes, maxRasterDimension, extraBounds)
      width = geometry.width; height = geometry.height
      viewport.style.transform = geometry.transform
      for (const element of [host, ...shells, snapshot]) {
        Object.assign(element.style, { width: `${width}px`, height: `${height}px` })
      }
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, maxRasterDimension / width, maxRasterDimension / height)
    const options = {
      backgroundColor: darkMode ? '#0f1211' : '#ffffff', filter: exportFilter,
      width, height, pixelRatio, includeQueryParams: true,
      fontEmbedCSS: await renderer.getFontEmbedCSS(snapshot, { includeQueryParams: true }),
    }
    return await capture(snapshot, options, renderer)
  } finally { host.remove() }
}

function downloadImage(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

export async function exportToPng(
  wrapper: HTMLDivElement,
  darkMode: boolean,
  exportOptions?: ImageExportOptions,
): Promise<void> {
  await withExportSnapshot(wrapper, darkMode, 4096, async (snapshot, options, renderer) => {
    downloadImage(await renderer.toPng(snapshot, options), 'flowchart.png')
  }, exportOptions)
}

export async function exportToSvg(
  wrapper: HTMLDivElement,
  darkMode: boolean,
  exportOptions?: ImageExportOptions,
): Promise<void> {
  await withExportSnapshot(wrapper, darkMode, 4096, async (snapshot, options, renderer) => {
    downloadImage(await renderer.toSvg(snapshot, options), 'flowchart.svg')
  }, exportOptions)
}

export async function exportToGif(
  wrapper: HTMLDivElement,
  darkMode: boolean,
  durationSeconds: number,
  onProgress?: (frame: number, total: number, metadata?: GifExportMetadata) => void,
  exportOptions?: ImageExportOptions,
): Promise<void> {
  const fps = 10
  const normalizedDurationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.min(durationSeconds, 10) : 1 / fps
  const totalFrames = Math.max(1, Math.round(normalizedDurationSeconds * fps))
  const frameDelay = 1000 / fps

  await withExportSnapshot(wrapper, darkMode, 1280, async (snapshot, captureOptions, renderer) => {
    // gif.js copies every RGBA frame before encoding. Preserve the requested
    // timing while reducing raster resolution for longer/larger captures.
    const maxFramePixels = Math.floor(GIF_FRAME_BYTE_BUDGET / (4 * totalFrames))
    const budgetRatio = Math.sqrt(maxFramePixels / (captureOptions.width * captureOptions.height))
    const pixelRatio = budgetRatio < captureOptions.pixelRatio
      ? budgetRatio * (1 - Number.EPSILON)
      : captureOptions.pixelRatio
    const options = { ...captureOptions, pixelRatio }
    const resolutionAdjusted = pixelRatio < captureOptions.pixelRatio
    const GifEncoder = await loadGifEncoder()
    // Animate the disposable snapshot only. The live diagram keeps its exact
    // selection, animation state and inline styles during capture and failure.
    const animatedPaths = snapshot.querySelectorAll<SVGPathElement>('.react-flow__edge.animated .react-flow__edge-path')
    animatedPaths.forEach(path => { path.style.animation = 'none' })
    let gif: GIF | null = null
    let metadata: GifExportMetadata | undefined
    try {
      for (let i = 0; i < totalFrames; i++) {
        // Calculate stroke-dashoffset for this frame
        // Animation: 0 -> -10 over 0.5s (500ms), linear infinite
        const timeMs = i * frameDelay
        const cycleProgress = (timeMs % 500) / 500
        const offset = -(cycleProgress * 10)

        animatedPaths.forEach((p) => {
          p.style.strokeDashoffset = `${offset}`
        })

        // Small delay to let the browser paint the style change
        await new Promise((resolve) => setTimeout(resolve, 20))

        const canvas = await renderer.toCanvas(snapshot, options)
        // Canvas dimensions truncate html-to-image's scaled sizes. Validate
        // the actual raster as well, before the encoder retains any pixels.
        if (!Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height)
          || canvas.width < 1 || canvas.height < 1
          || canvas.width > 1280 || canvas.height > 1280
          || canvas.width * canvas.height > maxFramePixels) {
          throw new Error('The GIF frame size could not be prepared. Try exporting a smaller area.')
        }
        if (metadata && (canvas.width !== metadata.pixelWidth || canvas.height !== metadata.pixelHeight)) {
          throw new Error('The GIF frame size changed during capture. Please try exporting again.')
        }

        if (i === 0) {
          metadata = { pixelWidth: canvas.width, pixelHeight: canvas.height, resolutionAdjusted }
          gif = new GifEncoder({
            workers: 2,
            quality: 10,
            width: canvas.width,
            height: canvas.height,
            workerScript: '/gif.worker.js',
            repeat: 0,
          })
        }

        gif!.addFrame(canvas, { delay: frameDelay, copy: true })
        onProgress?.(i + 1, totalFrames, metadata ? { ...metadata } : undefined)
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { reject(new Error('GIF encoding timed out. Try a shorter animation.')) }, 30000)
        gif!.on('finished', (blob: Blob) => {
          clearTimeout(timeout)
          try {
            const url = URL.createObjectURL(blob)
            try { downloadImage(url, 'flowchart.gif') }
            finally { setTimeout(() => { URL.revokeObjectURL(url) }, 1000) }
            resolve()
          } catch (error) { reject(error) }
        })
        gif!.on('error', error => { clearTimeout(timeout); reject(error) })
        try { gif!.render() } catch (error) { clearTimeout(timeout); reject(error) }
      })
    } finally { disposeGifEncoder(gif) }
  }, exportOptions)
}

/** Serialize a flow document. `version`/`mode` are additive keys; `nodes`/`edges` keep their legacy shape. */
export function serializeFlow(
  nodes: FlowNode[],
  edges: Edge[],
  mode: DiagramMode = 'flowchart',
): string {
  const portableNodes = nodes.map((node) => {
    if (node.data.icon || typeof node.data.imageUrl !== 'string') return node
    const icon = getIconId(node.data.imageUrl)
    return icon ? { ...node, data: { ...node.data, icon } } : node
  })
  return JSON.stringify({ version: 2, mode, nodes: portableNodes, edges }, null, 2)
}

export function exportToJson(
  nodes: FlowNode[],
  edges: Edge[],
  mode: DiagramMode = 'flowchart',
): void {
  const data = serializeFlow(nodes, edges, mode)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = 'flowchart.json'
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}
