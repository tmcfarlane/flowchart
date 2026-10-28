import { describe, expect, it } from 'vitest'
import { validateArchitectureScene } from '../shared/architectureScene'
import { getWorldPoints, moveElements, type DrawElement } from '../utils/drawScene'
import { mermaidToScene, recognizeStroke, safeEmbedUrl } from '../utils/drawExtraTools'

describe('extra drawing tools', () => {
  it('recognizes a drawn line, rectangle, ellipse, and diamond while retaining irregular strokes', () => {
    const loop = (points: Array<[number, number]>) => points.map(([x, y]) => ({ x, y }))
    expect(recognizeStroke(loop([[0, 0], [25, 1], [50, 0], [75, 0], [100, 0]]))).toBe('line')
    expect(recognizeStroke(loop([[0, 0], [50, 0], [100, 0], [100, 40], [100, 80], [50, 80], [0, 80], [0, 40], [0, 0]]))).toBe('rectangle')
    expect(recognizeStroke(loop([[50, 0], [85, 12], [100, 40], [85, 68], [50, 80], [15, 68], [0, 40], [15, 12], [50, 0]]))).toBe('ellipse')
    expect(recognizeStroke(loop([[50, 0], [75, 20], [100, 40], [75, 60], [50, 80], [25, 60], [0, 40], [25, 20], [50, 0]]))).toBe('diamond')
    expect(recognizeStroke(loop([[0, 0], [60, 20], [20, 60], [90, 90], [30, 5]]))).toBeNull()
  })

  it('accepts only HTTPS embeds without credentials or control characters', () => {
    expect(safeEmbedUrl(' https://example.com/path?q=1 ')).toBe('https://example.com/path?q=1')
    for (const url of ['javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'http://example.com', 'https://user:pass@example.com', 'https://example.com\n<script>']) expect(() => safeEmbedUrl(url)).toThrow()
  })

  it('converts a flowchart into editable bound shapes and labels that move together', () => {
    const scene = validateArchitectureScene(mermaidToScene('flowchart LR\nA[Start] -->|go| B{Choose}\nB --> C(Done)'))
    const elements = scene.elements as DrawElement[]
    const start = elements.find(item => item.type === 'rectangle')!
    const arrow = elements.find(item => item.type === 'arrow' && item.startBinding?.elementId === start.id)!
    const label = elements.find(item => item.type === 'text' && item.containerId === arrow.id)!
    expect(start.boundElements).toContainEqual({ id: arrow.id, type: 'arrow' })
    expect(arrow.boundElements).toContainEqual({ id: label.id, type: 'text' })
    const before = getWorldPoints(arrow)[0]
    const moved = moveElements(scene, [start.id], { x: 40, y: 20 })
    const movedArrow = moved.elements.find(item => item.id === arrow.id) as DrawElement
    const movedLabel = moved.elements.find(item => item.id === label.id) as DrawElement
    expect(getWorldPoints(movedArrow)[0]).not.toEqual(before)
    expect(movedLabel.x).not.toBe(label.x)
    expect(validateArchitectureScene(moved)).toBe(moved)
  })

  it('leaves visible connector ends around short and long LR labels', () => {
    for (const text of ['go', 'Continue through the review']) {
      const scene = mermaidToScene(`flowchart LR\nA[Start] -->|${text}| B[End]`)
      const elements = scene.elements as DrawElement[]
      const arrow = elements.find(element => element.type === 'arrow')!
      const label = elements.find(element => element.type === 'text' && element.containerId === arrow.id)!
      const [start, end] = getWorldPoints(arrow)
      const backdropLeft = Number(label.x) - 5, backdropRight = Number(label.x) + Number(label.width) + 5
      expect(backdropLeft - start.x).toBeGreaterThanOrEqual(30)
      expect(end.x - backdropRight).toBeGreaterThanOrEqual(30)
      expect(Number(label.width)).toBeGreaterThanOrEqual(text.length * 14)
    }
  })

  it('rejects unsupported Mermaid lines before returning a scene', () => {
    expect(mermaidToScene('graph TB\nA-->B').elements.length).toBeGreaterThan(0)
    for (const source of ['graph RL\nA-->B', 'flowchart TB\nA-->B-->C', 'flowchart TB\nclick A "javascript:alert(1)"', 'flowchart TB\nA[<b>x</b>]', 'flowchart TB\nA-->B; B-->C', 'flowchart TB\n%%{init: {}}%%']) expect(() => mermaidToScene(source)).toThrow()
  })

  it('keeps LR layout with whitespace and the graph header alias', () => {
    for (const header of ['flowchart LR   ', 'graph LR  ']) {
      const scene = mermaidToScene(`${header}\nA --> B`)
      const shapes = (scene.elements as DrawElement[]).filter(element => element.type === 'rectangle')
      expect(shapes).toHaveLength(2)
      expect(shapes[1].x).toBeGreaterThan(shapes[0].x)
      expect(shapes[1].y).toBe(shapes[0].y)
    }
  })
})
