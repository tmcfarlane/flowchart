import type { ArchitectureScene } from './architectureScene.js'
import { drawingFromScene, type ExcalidrawDrawing } from './drawDocument.js'
import { DRAW_GENERATION_LIMITS, DrawProposalSchema, type DrawProposal } from './drawGeneration.js'
import { DRAW_FONT_MARKER, DRAW_LINE_HEIGHT, measureDrawText } from './drawFont.js'
import { getElementBounds, positionBoundText, rerouteBindings, type DrawElement, type Point } from '../utils/drawScene.js'
import { GeometryBudgetError, routeConnector } from './drawRouting.js'
import { inspectDrawGeometry, isShape, occupiedBounds, type DrawQualityIssue } from './drawQuality.js'

export { inspectDrawGeometry } from './drawQuality.js'
export type { DrawQualityIssue } from './drawQuality.js'
export type DrawCompilationResult = { ok: true; drawing: ExcalidrawDrawing } | { ok: false; issues: DrawQualityIssue[] }

function nativeElement(id: string, type: string, bounds: { x: number; y: number; width: number; height: number }, fields: Partial<DrawElement> = {}): DrawElement {
  let seed = 2166136261
  for (const character of id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  return {
    id, type, ...bounds, angle: 0, strokeColor: '#1e293b', backgroundColor: 'transparent',
    strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: seed >>> 1, version: 1,
    versionNonce: seed >>> 1, isDeleted: false, boundElements: null, updated: 0, link: null, locked: false,
    ...fields,
  }
}

function wrapText(value: string, fontSize: number, desiredWidth: number): string {
  const words = value.split(/\s+/)
  const width = Math.min(1800, Math.max(desiredWidth, ...words.map(word => measureDrawText(word, fontSize).width)))
  return value.split('\n').flatMap(paragraph => {
    const lines: string[] = []
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && measureDrawText(line + word, fontSize).width > width) {
        lines.push(line.trimEnd())
        line = word.trimStart()
      } else line += word
      if (measureDrawText(line, fontSize).width <= width) continue
      const token = line
      line = ''
      for (const character of Array.from(token)) {
        if (line && measureDrawText(line + character, fontSize).width > width && !/\p{Mark}/u.test(character)) { lines.push(line); line = character }
        else line += character
      }
    }
    lines.push(line)
    return lines
  }).join('\n')
}

function textElement(id: string, value: string, fontSize: number, width: number, fields: Partial<DrawElement>): DrawElement {
  const text = wrapText(value, fontSize, width), size = measureDrawText(text, fontSize)
  return nativeElement(id, 'text', { x: 0, y: 0, ...size }, {
    text, originalText: value, fontSize, fontFamily: 2, lineHeight: DRAW_LINE_HEIGHT,
    autoResize: true, textAlign: 'left', verticalAlign: 'top', containerId: null,
    customData: { flowchartFont: DRAW_FONT_MARKER }, ...fields,
  })
}

function setPath(element: DrawElement, points: Point[]): void {
  element.x = points[0].x
  element.y = points[0].y
  element.width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))
  element.height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))
  element.points = points.map(point => [point.x - element.x, point.y - element.y])
}

function fitFrames(elements: DrawElement[]): void {
  for (const frame of elements.filter(element => element.type === 'frame')) {
    let left = frame.x, top = frame.y, right = frame.x + frame.width, bottom = frame.y + frame.height
    for (const member of elements.filter(element => element.frameId === frame.id)) {
      const bounds = getElementBounds(member)
      left = Math.min(left, bounds.x - 40)
      top = Math.min(top, bounds.y - 40)
      right = Math.max(right, bounds.x + bounds.width + 40)
      bottom = Math.max(bottom, bounds.y + bounds.height + 40)
    }
    frame.x = left
    frame.y = top
    frame.width = Math.max(right - left, measureDrawText(String(frame.name), 13).width + 16)
    frame.height = bottom - top
  }
}

export function compileDrawProposal(plan: DrawProposal): DrawCompilationResult {
  const parsed = DrawProposalSchema.safeParse(plan)
  if (!parsed.success) return { ok: false, issues: [{ code: 'invalid-proposal', elementIds: [], detail: parsed.error.issues.slice(0, 3).map(issue => issue.message).join(' ').slice(0, 400) }] }
  const proposal = parsed.data
  const elements: DrawElement[] = [], ids = new Set(proposal.elements.map(element => element.id))
  const frames = new Map(proposal.elements.flatMap(element => element.type === 'frame' ? element.children.map(id => [id, element.id] as const) : []))
  let labelIndex = 0
  const labelId = () => {
    while (ids.has(`ai-label-${labelIndex}`)) labelIndex++
    const id = `ai-label-${labelIndex++}`
    ids.add(id)
    return id
  }
  for (const item of proposal.elements) {
    const frameId = frames.get(item.id) ?? null
    if (item.type === 'frame') {
      elements.push(nativeElement(item.id, 'frame', { x: item.x, y: item.y, width: item.width, height: item.height }, { name: item.name, fontFamily: 2, fontSize: 13, lineHeight: DRAW_LINE_HEIGHT, customData: { flowchartFont: DRAW_FONT_MARKER } }))
    } else if (item.type === 'text') {
      elements.push(textElement(item.id, item.text, item.fontSize, 620, { x: item.x, y: item.y, strokeColor: item.strokeColor, frameId }))
    } else if ('points' in item) {
      const path = nativeElement(item.id, item.type, { x: 0, y: 0, width: 0, height: 0 }, {
        strokeColor: item.strokeColor, frameId, startBinding: null, endBinding: null,
        ...(item.type === 'arrow' ? { startArrowhead: null, endArrowhead: 'arrow' } : {}),
        ...(item.type === 'freedraw' ? { pressures: [], simulatePressure: true } : {}),
      })
      setPath(path, item.points)
      elements.push(path)
      if (item.label) elements.push(textElement(labelId(), item.label, 14, 320, { containerId: item.id, strokeColor: item.strokeColor, frameId, textAlign: 'center', verticalAlign: 'middle' }))
    } else {
      const shape = nativeElement(item.id, item.type, { x: item.x, y: item.y, width: item.width, height: item.height }, { strokeColor: item.strokeColor, backgroundColor: item.backgroundColor, frameId })
      elements.push(shape)
      if (item.label) {
        const scale = item.type === 'ellipse' ? Math.SQRT2 : item.type === 'diamond' ? 2 : 1
        const label = textElement(labelId(), item.label, 18, Math.max(156, item.width / scale - 24), { containerId: item.id, strokeColor: item.strokeColor, frameId, textAlign: 'center', verticalAlign: 'middle' })
        shape.width = Math.max(shape.width, scale * (label.width + 24))
        shape.height = Math.max(shape.height, scale * (label.height + 24))
        elements.push(positionBoundText(label, shape))
      }
    }
  }
  const oversized = elements.filter(element => (isShape(element) || element.type === 'text') && (element.width > DRAW_GENERATION_LIMITS.maxSize || element.height > DRAW_GENERATION_LIMITS.maxSize))
  if (oversized.length) return { ok: false, issues: [{ code: 'geometry-budget', elementIds: oversized.slice(0, 10).map(element => element.id), detail: 'Fitted objects exceed the generated size limit.' }] }
  fitFrames(elements.filter(element => !['arrow', 'line'].includes(element.type) && !(element.type === 'text' && element.containerId && elements.some(host => host.id === element.containerId && ['arrow', 'line'].includes(host.type)))))
  const byId = new Map(elements.map(element => [element.id, element])), budget = { remaining: 3_000_000 }
  try {
    for (let pass = 0; pass < 2; pass++) {
      const completed = new Set<string>()
      for (const item of proposal.elements) {
        if (!('points' in item) || item.type === 'freedraw') continue
        const path = byId.get(item.id)!, source = item.sourceId ? byId.get(item.sourceId) : undefined, target = item.targetId ? byId.get(item.targetId) : undefined
        const caption = elements.find(element => element.containerId === item.id && element.type === 'text')
        const occupied = occupiedBounds(elements.filter(element => element.type !== 'text' || !element.containerId || !elements.some(host => host.id === element.containerId && ['arrow', 'line'].includes(host.type)) || completed.has(element.containerId)), path.id)
        const points = routeConnector(path, source, target, caption, occupied, budget)
        if (!points) return { ok: false, issues: [{ code: caption ? 'caption-blocked' : 'route-blocked', elementIds: [item.id], detail: 'No clear route with outward contour anchors and room for its native midpoint caption. Increase spacing to give the caption a clear shaft.' }] }
        setPath(path, points)
        for (const [key, host, point] of [['startBinding', source, points[0]], ['endBinding', target, points[points.length - 1]]] as const) {
          if (host) path[key] = { elementId: host.id, focus: 0, gap: 0, fixedPoint: [Math.max(0, Math.min(1, (point.x - host.x) / host.width)), Math.max(0, Math.min(1, (point.y - host.y) / host.height))] }
        }
        if (caption) Object.assign(caption, positionBoundText(caption, path))
        completed.add(path.id)
      }
      const before = elements.filter(element => element.type === 'frame').map(element => `${element.x}:${element.y}`).join('|')
      fitFrames(elements)
      const after = elements.filter(element => element.type === 'frame').map(element => `${element.x}:${element.y}`).join('|')
      if (before === after) break
    }
    const scene: ArchitectureScene = rerouteBindings({ version: 1, elements, files: {} })
    const issues = inspectDrawGeometry(scene, proposal)
    return issues.length ? { ok: false, issues } : { ok: true, drawing: drawingFromScene(scene) }
  } catch (error) {
    if (error instanceof GeometryBudgetError) return { ok: false, issues: [{ code: 'geometry-budget', elementIds: [], detail: error.message }] }
    throw error
  }
}
