import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../utils/azureIconIds', () => ({
  getAzureIconUrl: (id: string) => id === 'azure-app-services' ? '/assets/app-services.svg' : undefined,
}))
import DrawSceneSvg from '../components/DrawSceneSvg'

const graphShape = (snapshot: Record<string, unknown>) => ({
  id: 'fc-node-api', type: 'rectangle', x: 10, y: 20, width: 180, height: 90, angle: Math.PI / 4,
  customData: { flowchart: { kind: 'node', id: 'api', snapshot: { id: 'api', type: 'service', label: 'Orders API', ...snapshot } } },
})
const image = (container: HTMLElement) => container.querySelector<SVGImageElement>('image[data-semantic-icon]')
const renderScene = (elements: Array<Record<string, unknown>>) => render(<svg><DrawSceneSvg elements={elements} files={{}} /></svg>)

describe('custom Draw semantic icons', () => {
  it('shows a stable Azure icon on the original projected shape without adding scene objects', () => {
    const element = graphShape({ icon: 'azure-app-services', imageUrl: 'https://example.com/fallback.png' })
    const before = JSON.stringify(element)
    const { container } = renderScene([element])
    expect(image(container)).toHaveAttribute('href', '/assets/app-services.svg')
    expect(container.querySelectorAll('[data-element-id]')).toHaveLength(1)
    expect(image(container)?.closest('[transform]')).toHaveAttribute('transform', 'rotate(45 100 65) translate(10 20)')
    expect(image(container)).toHaveAttribute('pointer-events', 'none')
    expect(JSON.stringify(element)).toBe(before)
  })

  it('retains embedded image sources and falls back from an unknown icon identifier', () => {
    const embedded = 'data:image/png;base64,aGVsbG8='
    const { container } = renderScene([graphShape({ icon: 'unknown-icon', imageUrl: embedded })])
    expect(image(container)).toHaveAttribute('href', embedded)
    expect(image(container)).toHaveAttribute('width', '28')
    expect(image(container)).toHaveAttribute('height', '28')
  })

  it('keeps HTTPS and local graph image sources for export embedding', () => {
    for (const imageUrl of ['https://example.com/icon.svg', '/assets/team-icon.svg']) {
      const view = renderScene([graphShape({ imageUrl })])
      expect(image(view.container)).toHaveAttribute('href', imageUrl)
      view.unmount()
    }
  })

  it('does not render unsafe or unrelated metadata as an image source', () => {
    for (const imageUrl of ['javascript:alert(1)', '//example.com/icon.svg', 'http://example.com/icon.svg', 'https://user:password@example.com/icon.svg', '/\\example.com/icon.svg']) {
      const view = renderScene([graphShape({ imageUrl })])
      expect(image(view.container)).toBeNull()
      view.unmount()
    }
    const { container } = renderScene([{ ...graphShape({ imageUrl: '/assets/icon.svg' }), customData: { icon: '/assets/icon.svg' } }])
    expect(image(container)).toBeNull()
  })

  it('keeps semantic icons inside small shapes and ignores deleted objects', () => {
    const element = { ...graphShape({ icon: 'azure-app-services' }), width: 24, height: 24, type: 'ellipse' }
    const { container } = renderScene([element, { ...graphShape({ icon: 'azure-app-services' }), id: 'deleted', isDeleted: true }])
    const graphic = image(container)!
    expect(container.querySelectorAll('[data-element-id]')).toHaveLength(1)
    expect(Number(graphic.getAttribute('x')) + Number(graphic.getAttribute('width'))).toBeLessThanOrEqual(24)
    expect(Number(graphic.getAttribute('y')) + Number(graphic.getAttribute('height'))).toBeLessThanOrEqual(24)
  })
})

describe('custom Draw surface contrast and connector labels', () => {
  it('adapts our default teal on dark paper while preserving it on imported white paper', () => {
    const element = { id: 'teal', type: 'rectangle', x: 0, y: 0, width: 100, height: 60, angle: 0, strokeColor: '#0f766e' }
    const dark = render(<svg><DrawSceneSvg elements={[element]} files={{}} darkMode backgroundColor="#0f1211" /></svg>)
    expect(dark.container.querySelector('[data-element-id="teal"] path')).toHaveAttribute('stroke', '#78fcd6')
    dark.unmount()
    const paper = render(<svg><DrawSceneSvg elements={[element]} files={{}} darkMode backgroundColor="#ffffff" /></svg>)
    expect(paper.container.querySelector('[data-element-id="teal"] path')).toHaveAttribute('stroke', '#0f766e')
    expect(element.strokeColor).toBe('#0f766e')
  })

  it('pads arrow and line label backgrounds using the actual canvas paint without adding records', () => {
    const arrow = { id: 'arrow', type: 'arrow', x: 0, y: 0, width: 200, height: 0, angle: 0, points: [[0, 0], [200, 0]] }
    const line = { ...arrow, id: 'line', type: 'line', y: 100 }
    const label = (id: string, containerId: string) => ({ id, type: 'text', x: 50, y: 0, width: 80, height: 24, angle: 0, fontSize: 18, text: 'HTTPS', containerId })
    const elements = [arrow, line, label('arrow-label', 'arrow'), label('line-label', 'line')]
    const before = JSON.stringify(elements)
    const { container } = render(<svg><DrawSceneSvg elements={elements} files={{}} darkMode backgroundColor="#173c32" /></svg>)
    const backdrops = container.querySelectorAll('[data-draw-label-backdrop]')
    expect(backdrops).toHaveLength(2)
    for (const backdrop of backdrops) {
      expect(backdrop).toHaveAttribute('fill', '#173c32')
      expect(Number(backdrop.getAttribute('width'))).toBeGreaterThan(80)
      expect(backdrop).toHaveAttribute('pointer-events', 'none')
    }
    expect(container.querySelectorAll('[data-element-id]')).toHaveLength(4)
    expect(JSON.stringify(elements)).toBe(before)
  })

  it('keeps node-bound and standalone text transparent and honors white canvas paint in dark app chrome', () => {
    const shape = { id: 'node', type: 'rectangle', x: 0, y: 0, width: 200, height: 80, angle: 0, backgroundColor: '#ffeeaa' }
    const arrow = { id: 'edge', type: 'arrow', x: 0, y: 100, width: 200, height: 0, angle: 0, points: [[0, 0], [200, 0]] }
    const text = { type: 'text', x: 50, y: 20, width: 100, height: 24, angle: 0, text: 'Label', strokeColor: '#0f766e' }
    const elements = [shape, arrow, { ...text, id: 'node-label', containerId: 'node' }, { ...text, id: 'standalone' }, { ...text, id: 'edge-label', containerId: 'edge' }]
    const { container } = render(<svg><DrawSceneSvg elements={elements} files={{}} darkMode backgroundColor="#ffffff" /></svg>)
    expect(container.querySelector('[data-element-id="node-label"] [data-draw-label-backdrop]')).toBeNull()
    expect(container.querySelector('[data-element-id="standalone"] [data-draw-label-backdrop]')).toBeNull()
    expect(container.querySelector('[data-element-id="edge-label"] [data-draw-label-backdrop]')).toHaveAttribute('fill', '#ffffff')
    expect(container.querySelector('[data-element-id="edge-label"] text')).toHaveAttribute('fill', '#0f766e')
  })
})

describe('imported Draw text uses its visible background', () => {
  const shape = (id: string, backgroundColor: string, extra: Record<string, unknown> = {}) => ({ id, type: 'rectangle', x: 0, y: 0, width: 200, height: 100, angle: 0, backgroundColor, fillStyle: 'solid', ...extra })
  const text = (id: string, strokeColor: string, extra: Record<string, unknown> = {}) => ({ id, type: 'text', text: 'Readable label', x: 40, y: 38, width: 120, height: 24, angle: 0, fontSize: 18, strokeColor, ...extra })
  const draw = (elements: Array<Record<string, unknown>>, backgroundColor = '#0f1211') => render(<svg><DrawSceneSvg elements={elements} files={{}} darkMode backgroundColor={backgroundColor} /></svg>)
  const paint = (container: HTMLElement, id: string) => container.querySelector(`[data-element-id="${id}"] text`)?.getAttribute('fill')

  it('retains dark text on imported pastel node fills instead of whitening it for dark chrome', () => {
    for (const backgroundColor of ['#d0ebff', '#d3f9d8', '#ffe3e3', 'rgb(255, 243, 191)']) {
      const elements = [shape('node', backgroundColor), text('label', '#1e1e1e', { containerId: 'node' })]
      const original = JSON.stringify(elements)
      const view = draw(elements)
      expect(paint(view.container, 'label')).toBe('#1e1e1e')
      expect(JSON.stringify(elements)).toBe(original)
      view.unmount()
    }
  })

  it('finds light fills beneath unbound labels, including rotated shapes', () => {
    const elements = [shape('node', '#d0ebff', { angle: Math.PI / 4 }), text('unbound', '#1e1e1e'), text('outside', '#495057', { x: 350 })]
    const view = draw(elements)
    expect(paint(view.container, 'unbound')).toBe('#1e1e1e')
    expect(paint(view.container, 'outside')).toBe('#dcece6')
  })

  it('uses light ink on a dark node fill even on white paper and preserves already readable white', () => {
    const elements = [shape('node', 'rgb(18, 36, 28)'), text('dark-authored', '#1e1e1e', { containerId: 'node' }), text('white-authored', '#ffffff', { containerId: 'node', y: 65 })]
    const view = draw(elements, '#ffffff')
    expect(paint(view.container, 'dark-authored')).toBe('#dcece6')
    expect(paint(view.container, 'white-authored')).toBe('#ffffff')
    const translucent = draw([shape('node', '#12241c', { opacity: 15 }), text('label', '#1e1e1e', { containerId: 'node' })], '#ffffff')
    expect(paint(translucent.container, 'label')).toBe('#1e1e1e')
  })

  it('makes gray, brown and near-black canvas captions readable without changing high-contrast authored colors', () => {
    const edge = { id: 'edge', type: 'arrow', x: 0, y: 0, width: 200, height: 0, angle: 0, points: [[0, 0], [200, 0]] }
    const elements = [edge, text('gray', '#495057'), text('brown', '#7f5539', { y: 80 }), text('nearblack', '#343a40', { y: 120 }), text('connector', 'rgb(70, 70, 70)', { containerId: 'edge' }), text('yellow', '#ffd43b', { y: 160 })]
    const original = JSON.stringify(elements)
    const view = draw(elements)
    for (const id of ['gray', 'brown', 'nearblack', 'connector']) expect(paint(view.container, id)).toBe('#dcece6')
    expect(paint(view.container, 'yellow')).toBe('#ffd43b')
    expect(JSON.stringify(elements)).toBe(original)
  })

  it('respects preceding fill order and ignores a filled object clipped outside its frame', () => {
    const stacked = draw([shape('dark', '#12241c'), shape('light', '#d0ebff'), text('top', '#1e1e1e')])
    expect(paint(stacked.container, 'top')).toBe('#1e1e1e')
    const later = draw([shape('dark', '#12241c'), text('earlier', '#1e1e1e'), shape('light-after-text', '#d0ebff')])
    expect(paint(later.container, 'earlier')).toBe('#dcece6')
    const frame = { id: 'frame', type: 'frame', x: 0, y: 0, width: 100, height: 100, angle: 0 }
    const clipped = draw([frame, shape('clipped', '#d0ebff', { x: 200, frameId: 'frame' }), text('caption', '#495057', { x: 240 })])
    expect(paint(clipped.container, 'caption')).toBe('#dcece6')
  })

  it('treats hatching as transparent paper and reaches readable contrast on middle-gray paper', () => {
    const hatch = draw([shape('hatched', '#d0ebff', { fillStyle: 'hachure' }), text('label', '#1e1e1e', { containerId: 'hatched' })])
    expect(paint(hatch.container, 'label')).toBe('#dcece6')
    const gray = draw([text('label', '#777777')], '#777777')
    expect(paint(gray.container, 'label')).toBe('#000000')
  })
})

describe('bound Draw labels respect actual stacked fills', () => {
  const box = (id: string, backgroundColor: string) => ({ id, type: 'rectangle', x: 0, y: 0, width: 200, height: 100, angle: 0, backgroundColor, fillStyle: 'solid' })
  const label = { id: 'label', type: 'text', text: 'Bound label', x: 40, y: 38, width: 120, height: 24, angle: 0, strokeColor: '#1e1e1e', containerId: 'host' }
  const draw = (elements: Array<Record<string, unknown>>) => render(<svg><DrawSceneSvg elements={elements} files={{}} darkMode backgroundColor="#0f1211" /></svg>)
  const paint = (container: HTMLElement) => container.querySelector('[data-element-id="label"] text')?.getAttribute('fill')

  it('keeps dark bound text readable on a transparent host over a pale ordinary container', () => {
    const elements = [box('backing', '#d0ebff'), box('host', 'transparent'), label]
    const before = JSON.stringify(elements)
    const view = draw(elements)
    expect(paint(view.container)).toBe('#1e1e1e')
    expect(JSON.stringify(elements)).toBe(before)
  })

  it('uses a sibling fill layered between the host and label in either lightness direction', () => {
    const lightOverDark = draw([box('host', '#12241c'), box('overlay', '#d0ebff'), label])
    expect(paint(lightOverDark.container)).toBe('#1e1e1e')
    const darkOverLight = draw([box('host', '#d0ebff'), box('overlay', '#12241c'), { ...label, strokeColor: '#ffffff' }])
    expect(paint(darkOverLight.container)).toBe('#ffffff')
  })
})
