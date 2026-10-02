import type { Node as FlowNode } from 'reactflow'
import { isNodeType, LIMITS, NODE_TYPE_INFO } from '../shared/flowTypes'
import { getAbsolutePosition } from './nesting'

export interface ExportBounds { x: number; y: number; width: number; height: number }
export interface DiagramExportGeometry {
  width: number
  height: number
  transform: string
  bounds: ExportBounds
  zoom: number
}

/** Fit all visible diagram content into a bounded image, using absolute nested positions. */
export function getDiagramExportGeometry(
  nodes: FlowNode[],
  maxDimension: number,
  additionalBounds: ExportBounds[] = [],
): DiagramExportGeometry {
  const visible = nodes.filter(node => !node.hidden)
  if (!visible.length) throw new Error('Add nodes before exporting the entire diagram, or choose Current view.')
  const bounds = visible.map(node => {
    const fallback = NODE_TYPE_INFO[isNodeType(node.type) ? node.type : 'step'].defaultSize
    const width = node.width ?? (typeof node.style?.width === 'number' ? node.style.width : fallback.width)
    const height = node.height ?? (typeof node.style?.height === 'number' ? node.style.height : fallback.height)
    const position = getAbsolutePosition(node, nodes)
    if (![position.x, position.y, width, height].every(Number.isFinite)
      || width <= 0 || height <= 0 || width > LIMITS.maxNodeSize || height > LIMITS.maxNodeSize) {
      throw new Error('The diagram dimensions are not ready to export. Wait for the canvas to finish loading and try again.')
    }
    return { ...position, width, height }
  })
  const usableExtras = additionalBounds.filter(bound => [bound.x, bound.y, bound.width, bound.height].every(Number.isFinite)
    && bound.width >= 0 && bound.height >= 0)
  const all = [...bounds, ...usableExtras]
  const x = Math.min(...all.map(bound => bound.x))
  const y = Math.min(...all.map(bound => bound.y))
  const worldWidth = Math.max(...all.map(bound => bound.x + bound.width)) - x
  const worldHeight = Math.max(...all.map(bound => bound.y + bound.height)) - y
  const padding = 40
  if (!Number.isFinite(maxDimension) || maxDimension <= padding * 2 || maxDimension > 8192) throw new Error('Choose a supported export size.')
  const zoom = Math.min(1, (maxDimension - padding * 2) / worldWidth, (maxDimension - padding * 2) / worldHeight)
  const width = Math.min(maxDimension, Math.ceil(worldWidth * zoom + padding * 2))
  const height = Math.min(maxDimension, Math.ceil(worldHeight * zoom + padding * 2))
  return {
    width, height, zoom,
    bounds: { x, y, width: worldWidth, height: worldHeight },
    transform: `translate(${padding - x * zoom}px, ${padding - y * zoom}px) scale(${zoom})`,
  }
}
