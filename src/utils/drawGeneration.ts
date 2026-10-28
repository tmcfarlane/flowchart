import { validateArchitectureScene, type ArchitectureScene } from '../shared/architectureScene'
import { DRAW_GENERATION_LIMITS, DrawProposalSchema, type DrawGenerationContext, type DrawProposal } from '../shared/drawGeneration'
import { createElement, rerouteBindings, type DrawElement } from './drawScene'
import { drawingTextSize } from './drawText'

const shapeTypes = new Set(['rectangle', 'ellipse', 'diamond'])
const contextTypes = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'line', 'arrow', 'freedraw', 'frame', 'image'])
const validId = /^[A-Za-z0-9_-]{1,100}$/

function wrapText(text: string, fontSize: number, maxWidth: number): string {
  return text.split('\n').flatMap(source => {
    const lines: string[] = []
    let line = ''
    for (const char of source) {
      if (line && drawingTextSize(line + char, { fontSize }).width > maxWidth) {
        lines.push(line.trimEnd())
        line = char.trimStart()
      } else line += char
    }
    lines.push(line)
    return lines
  }).join('\n')
}

function boundLabel(id: string, host: DrawElement, value: string, fontSize: number, strokeColor: string): DrawElement {
  const insetScale = host.type === 'diamond' ? 2 : host.type === 'ellipse' ? Math.SQRT2 : 1
  const maxWidth = host.type === 'rectangle' || host.type === 'ellipse' || host.type === 'diamond'
    ? Math.max(156, Math.min(host.width - 24, DRAW_GENERATION_LIMITS.maxSize / insetScale - 24)) : 320
  const text = wrapText(value, fontSize, maxWidth)
  const size = drawingTextSize(text, { fontSize })
  if (shapeTypes.has(host.type)) {
    host.width = Math.max(host.width, insetScale * (size.width + 24))
    host.height = Math.max(host.height, insetScale * (size.height + 20))
  }
  return createElement('text', { x: host.x, y: host.y }, undefined, {
    id, text, originalText: value, fontSize, fontFamily: 2, ...size,
    strokeColor, containerId: host.id, textAlign: 'center', verticalAlign: 'middle',
  })
}

export function drawProposalToScene(proposal: DrawProposal): ArchitectureScene {
  const parsed = DrawProposalSchema.parse(proposal)
  const occupied = new Set(parsed.elements.map(element => element.id))
  let labelIndex = 0
  const nextLabelId = () => {
    let id: string
    do { id = `ai-label-${labelIndex++}` } while (occupied.has(id))
    occupied.add(id)
    return id
  }
  const elements: DrawElement[] = []
  for (const item of parsed.elements) {
    if (item.type === 'text') {
      const size = drawingTextSize(item.text, { fontSize: item.fontSize })
      elements.push(createElement('text', { x: item.x, y: item.y }, undefined, {
        id: item.id, text: item.text, originalText: item.text, fontSize: item.fontSize,
        fontFamily: 2, strokeColor: item.strokeColor, ...size,
      }))
      continue
    }
    if (!('points' in item)) {
      const shape = createElement(item.type, { x: item.x, y: item.y }, { x: item.x + item.width, y: item.y + item.height }, {
        id: item.id, strokeColor: item.strokeColor, backgroundColor: item.backgroundColor,
      })
      elements.push(shape)
      if (item.label) elements.push(boundLabel(nextLabelId(), shape, item.label, 18, item.strokeColor))
      continue
    }
    const xs = item.points.map(point => point.x), ys = item.points.map(point => point.y)
    const x = Math.min(...xs), y = Math.min(...ys)
    const width = Math.max(...xs) - x, height = Math.max(...ys) - y
    const path = createElement(item.type, { x, y }, { x: x + width, y: y + height }, {
      id: item.id, points: item.points.map(point => [point.x - x, point.y - y]),
      strokeColor: item.strokeColor,
      ...(item.type === 'arrow' ? {
        startBinding: item.sourceId ? { elementId: item.sourceId, focus: 0, gap: 0 } : null,
        endBinding: item.targetId ? { elementId: item.targetId, focus: 0, gap: 0 } : null,
      } : {}),
    })
    elements.push(path)
    if (item.label) elements.push(boundLabel(nextLabelId(), path, item.label, 14, item.strokeColor))
  }
  return validateArchitectureScene(rerouteBindings({ version: 1, elements, files: {} }))
}

export function captureDrawGenerationContext(scene: ArchitectureScene): DrawGenerationContext {
  const elements: DrawGenerationContext['elements'] = []
  const ids = new Set<string>()
  for (const record of scene.elements) {
    if (elements.length === DRAW_GENERATION_LIMITS.elements) break
    const { id, type, x, y, width, height } = record
    if (record.isDeleted || record.hidden || record.isVisible === false || (typeof record.opacity === 'number' && record.opacity <= 0)) continue
    if (typeof id !== 'string' || !validId.test(id) || ids.has(id)) continue
    if (typeof type !== 'string' || !contextTypes.has(type)) continue
    if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) continue
    if (Math.abs(x as number) > DRAW_GENERATION_LIMITS.coordinate || Math.abs(y as number) > DRAW_GENERATION_LIMITS.coordinate) continue
    if ((width as number) < 0 || (height as number) < 0 || (width as number) > DRAW_GENERATION_LIMITS.maxSize || (height as number) > DRAW_GENERATION_LIMITS.maxSize) continue
    ids.add(id)
    elements.push({
      id, type: type as DrawGenerationContext['elements'][number]['type'],
      x: x as number, y: y as number, width: width as number, height: height as number,
      text: type === 'text' && typeof record.text === 'string'
        ? record.text.replace(/\b(?:https?:\/\/|data:|blob:|file:)\S+/gi, '[link omitted]').slice(0, DRAW_GENERATION_LIMITS.text)
        : null,
    })
  }
  return { elements, omittedElementCount: scene.elements.length - elements.length }
}
