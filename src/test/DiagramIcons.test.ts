import { describe, expect, it } from 'vitest'
import { DIAGRAM_ICONS } from '../shared/diagramIcons'
import { chartToFlow, contentFingerprint, flowToChart } from '../utils/sharedFlow'
import { getIconId, getIconUrl } from '../utils/azureIconIds'

// A server-authored chart and an image-picker-authored chart must persist the
// same stable icon ids despite Vite hashing or inlining their local SVG URLs.
describe('original icon browser persistence', () => {
  it('renders and round-trips every original icon without replacing ids with URLs', () => {
    const chart = { nodes: DIAGRAM_ICONS.map((icon, index) => ({ id: `n${index}`, type: 'image' as const, label: icon.name, icon: icon.id, position: { x: index * 160, y: 0 } })), edges: [] }
    const flow = chartToFlow(chart, { onLabelChange: () => {}, edgeProps: () => ({}) })
    for (const item of flow.nodes) {
      expect(item.data.imageUrl).toBeTruthy()
      expect(getIconId(item.data.imageUrl)).toBe(item.data.icon)
    }
    expect(contentFingerprint(flowToChart(flow.nodes, flow.edges))).toBe(contentFingerprint(chart))
    const picked = flowToChart(flow.nodes.map((item) => ({ ...item, data: { label: item.data.label, imageUrl: item.data.imageUrl } })), [])
    expect(picked.nodes.map((item) => item.icon)).toEqual(DIAGRAM_ICONS.map((icon) => icon.id))
    expect(picked.nodes.every((item) => item.imageUrl === undefined)).toBe(true)
    expect(getIconUrl('../../icon-robot.svg')).toBeUndefined()
    expect(getIconId('https://example.com/icon-robot.svg')).toBeUndefined()
  })
})
