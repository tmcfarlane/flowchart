import { toPng, toSvg, toCanvas } from 'html-to-image'
import GIF from 'gif.js'
import type { Node as FlowNode, Edge } from 'reactflow'

const exportFilter = (node: Node): boolean => {
  if (node instanceof HTMLElement) {
    const cl = node.classList
    if (
      cl?.contains('react-flow__controls') ||
      cl?.contains('react-flow__minimap') ||
      cl?.contains('react-flow__background') ||
      cl?.contains('react-flow__attribution')
    ) {
      return false
    }
  }
  return true
}

export async function exportToPng(
  wrapper: HTMLDivElement,
  darkMode: boolean,
): Promise<void> {
  const dataUrl = await toPng(wrapper, {
    backgroundColor: darkMode ? '#0f1211' : '#ffffff',
    filter: exportFilter,
  })
  const link = document.createElement('a')
  link.download = 'flowchart.png'
  link.href = dataUrl
  link.click()
}

export async function exportToSvg(
  wrapper: HTMLDivElement,
  darkMode: boolean,
): Promise<void> {
  const dataUrl = await toSvg(wrapper, {
    backgroundColor: darkMode ? '#0f1211' : '#ffffff',
    filter: exportFilter,
  })
  const link = document.createElement('a')
  link.download = 'flowchart.svg'
  link.href = dataUrl
  link.click()
}

export async function exportToGif(
  wrapper: HTMLDivElement,
  darkMode: boolean,
  durationSeconds: number,
  onProgress?: (frame: number, total: number) => void,
): Promise<void> {
  const fps = 10
  const totalFrames = Math.round(durationSeconds * fps)
  const frameDelay = 1000 / fps

  // The CSS animation (dashdraw) won't be captured by html-to-image since it
  // clones the DOM and the clone doesn't preserve animation state. We manually
  // set stroke-dashoffset on each frame to simulate the animation.
  // The animation cycles stroke-dashoffset from 0 to -10 over 0.5s.
  const animatedPaths = wrapper.querySelectorAll<SVGPathElement>(
    '.react-flow__edge.animated .react-flow__edge-path',
  )

  // Pause CSS animations on the paths so our manual offset is visible
  animatedPaths.forEach((p) => {
    p.style.animationPlayState = 'paused'
  })

  const captureOptions = {
    backgroundColor: darkMode ? '#0f1211' : '#ffffff',
    filter: exportFilter,
  }

  let gif: GIF | null = null

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

      const canvas = await toCanvas(wrapper, captureOptions)

      if (i === 0) {
        gif = new GIF({
          workers: 2,
          quality: 10,
          width: canvas.width,
          height: canvas.height,
          workerScript: '/gif.worker.js',
          repeat: 0,
        })
      }

      gif!.addFrame(canvas, { delay: frameDelay, copy: true })
      onProgress?.(i + 1, totalFrames)
    }
  } finally {
    // Restore CSS animations
    animatedPaths.forEach((p) => {
      p.style.animationPlayState = ''
      p.style.strokeDashoffset = ''
    })
  }

  return new Promise<void>((resolve, reject) => {
    gif!.on('finished', (blob: Blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = 'flowchart.gif'
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
      resolve()
    })
    gif!.on('error', reject)
    gif!.render()
  })
}

export function exportToJson(nodes: FlowNode[], edges: Edge[]): void {
  const data = JSON.stringify({ nodes, edges }, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = 'flowchart.json'
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

export function parseFlowJson(
  text: string,
): { nodes: FlowNode[]; edges: Edge[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file does not contain valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The file content is not a valid flowchart format.')
  }

  const obj = parsed as Record<string, unknown>

  if (!Array.isArray(obj.nodes)) {
    throw new Error('Missing or invalid "nodes" array in the JSON file.')
  }

  if (!Array.isArray(obj.edges)) {
    throw new Error('Missing or invalid "edges" array in the JSON file.')
  }

  for (let i = 0; i < obj.nodes.length; i++) {
    const node = obj.nodes[i]
    if (!node || typeof node !== 'object') {
      throw new Error(`Node at index ${i} is not a valid object.`)
    }
    if (!node.id || !node.position) {
      throw new Error(
        `Node at index ${i} is missing required fields (id, position).`,
      )
    }
  }

  return { nodes: obj.nodes as FlowNode[], edges: obj.edges as Edge[] }
}
