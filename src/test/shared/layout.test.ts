// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CONTAINER_PADDING,
  arrangeChart,
  assignHandles,
  fitContainers,
  inferDirection,
  layoutWorkUnits,
  nodeSize,
  placeNodes,
  planLayout,
} from '../../shared/layout'
import { edgeFromInput, nodeFromInput, validateChart, type EdgeInput, type NodeInput } from '../../shared/flowSchema'
import type { ChartEdge, ChartNode, DraftNode } from '../../shared/flowTypes'

function prepare(nodes: NodeInput[], edges: EdgeInput[]) {
  const result = validateChart(nodes.map(nodeFromInput), edges.map(edgeFromInput))
  expect(result.issues).toEqual([])
  return result
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function absoluteBoxes(nodes: ChartNode[]): Map<string, Box> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const boxes = new Map<string, Box>()
  for (const n of nodes) {
    let x = n.position.x
    let y = n.position.y
    let p = n.parentNode
    while (p) {
      const parent = byId.get(p)!
      x += parent.position.x
      y += parent.position.y
      p = parent.parentNode
    }
    const size = nodeSize(n)
    boxes.set(n.id, { x, y, w: size.width, h: size.height })
  }
  return boxes
}

function overlappingSiblings(nodes: ChartNode[]): string[] {
  const boxes = absoluteBoxes(nodes)
  const problems: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      if ((a.parentNode ?? null) !== (b.parentNode ?? null)) continue
      const A = boxes.get(a.id)!
      const B = boxes.get(b.id)!
      if (A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y) problems.push(`${a.id}/${b.id}`)
    }
  }
  return problems
}

const SIGNUP_NODES: NodeInput[] = [
  { id: 'visit', type: 'step', label: 'Visitor clicks sign up' },
  { id: 'form', type: 'step', label: 'Enter email and password' },
  { id: 'valid', type: 'decision', label: 'Email valid?' },
  { id: 'err', type: 'step', label: 'Show error' },
  { id: 'pay', type: 'step', label: 'Enter payment' },
  { id: 'paid', type: 'decision', label: 'Payment succeeded?' },
  { id: 'retry', type: 'step', label: 'Try another card' },
  { id: 'done', type: 'step', label: 'Onboarding' },
  { id: 'tip', type: 'note', label: 'Trial users skip payment' },
]
const SIGNUP_EDGES: EdgeInput[] = [
  { source: 'visit', target: 'form' },
  { source: 'form', target: 'valid' },
  { source: 'valid', target: 'err', label: 'No' },
  { source: 'err', target: 'form', label: 'Retry' },
  { source: 'valid', target: 'pay', label: 'Yes' },
  { source: 'pay', target: 'paid' },
  { source: 'paid', target: 'retry', label: 'No' },
  { source: 'retry', target: 'pay' },
  { source: 'paid', target: 'done', label: 'Yes' },
]

describe('full layout', () => {
  it('positions and sizes every node without overlaps, flowing top to bottom', async () => {
    const { nodes, edges } = prepare(SIGNUP_NODES, SIGNUP_EDGES)
    const result = await arrangeChart(nodes, edges)
    expect(result.layout).toBe('full')
    expect(result.nodes.every((n) => n.position && n.width && n.height)).toBe(true)
    expect(overlappingSiblings(result.nodes)).toEqual([])

    const y = (id: string) => result.nodes.find((n) => n.id === id)!.position.y
    // Retry loops must not flip the chart: the happy path runs downward.
    expect(y('visit')).toBeLessThan(y('form'))
    expect(y('form')).toBeLessThan(y('valid'))
    expect(y('valid')).toBeLessThan(y('pay'))
    expect(y('pay')).toBeLessThan(y('paid'))
    expect(y('paid')).toBeLessThan(y('done'))
  })

  it('assigns a handle to every edge and uses the diamond corners for branches', async () => {
    const { nodes, edges } = prepare(SIGNUP_NODES, SIGNUP_EDGES)
    const result = await arrangeChart(nodes, edges)
    expect(result.edges.every((e) => e.sourceHandle && e.targetHandle)).toBe(true)
    const branch = result.edges.filter((e) => e.source === 'paid').map((e) => e.sourceHandle)
    expect(branch.some((h) => h === 'left' || h === 'right')).toBe(true)
    expect(result.edges.find((e) => e.id === 'evisit-form')).toMatchObject({ sourceHandle: 'bottom', targetHandle: 'top' })
  })

  it('keeps explicit handles unless a relayout is requested', async () => {
    const { nodes, edges } = prepare(SIGNUP_NODES.slice(0, 2), [
      { source: 'visit', target: 'form', sourceHandle: 'right', targetHandle: 'left' },
    ])
    const kept = await arrangeChart(nodes, edges)
    expect(kept.edges[0]).toMatchObject({ sourceHandle: 'right', targetHandle: 'left' })
    const relaid = await arrangeChart(kept.nodes, kept.edges, { relayout: true })
    expect(relaid.edges[0]).toMatchObject({ sourceHandle: 'bottom', targetHandle: 'top' })
  })

  it('lays out left to right on request', async () => {
    const { nodes, edges } = prepare(SIGNUP_NODES.slice(0, 3), SIGNUP_EDGES.slice(0, 2))
    const result = await arrangeChart(nodes, edges, { direction: 'LR' })
    const x = (id: string) => result.nodes.find((n) => n.id === id)!.position.x
    expect(x('visit')).toBeLessThan(x('form'))
    expect(x('form')).toBeLessThan(x('valid'))
    expect(result.edges[0]).toMatchObject({ sourceHandle: 'right', targetHandle: 'left' })
    expect(inferDirection(result.nodes, result.edges)).toBe('LR')
  })

  it('sizes containers around their children, including nested containers', async () => {
    const { nodes, edges } = prepare(
      [
        { id: 'user', type: 'externalActor', label: 'Customer' },
        { id: 'region', type: 'container', label: 'East US', containerKind: 'region' },
        { id: 'aks', type: 'container', label: 'AKS', containerKind: 'cluster', parentNode: 'region' },
        { id: 'api', type: 'service', label: 'Orders API', parentNode: 'aks' },
        { id: 'worker', type: 'service', label: 'Worker', parentNode: 'aks' },
        { id: 'db', type: 'database', label: 'Cosmos DB', parentNode: 'region' },
        { id: 'empty', type: 'container', label: 'Later' },
      ],
      [
        { source: 'user', target: 'api' },
        { source: 'api', target: 'worker', commStyle: 'async' },
        { source: 'worker', target: 'db' },
      ],
    )
    const result = await arrangeChart(nodes, edges, { direction: 'LR' })
    expect(overlappingSiblings(result.nodes)).toEqual([])
    const byId = new Map(result.nodes.map((n) => [n.id, n]))
    for (const child of result.nodes.filter((n) => n.parentNode)) {
      const parent = byId.get(child.parentNode!)!
      const size = nodeSize(child)
      expect(child.position.x).toBeGreaterThanOrEqual(CONTAINER_PADDING.left - 1)
      expect(child.position.y).toBeGreaterThanOrEqual(CONTAINER_PADDING.top - 1)
      expect(child.position.x + size.width).toBeLessThanOrEqual(parent.width! + 1)
      expect(child.position.y + size.height).toBeLessThanOrEqual(parent.height! + 1)
    }
    expect(byId.get('empty')).toMatchObject({ width: 420, height: 300 })
    // Stored parents-first, as React Flow requires.
    const order = result.nodes.map((n) => n.id)
    expect(order.indexOf('region')).toBeLessThan(order.indexOf('aks'))
    expect(order.indexOf('aks')).toBeLessThan(order.indexOf('api'))
  })
})

describe('incremental placement', () => {
  it('keeps existing positions and places a new node below its predecessor without overlap', async () => {
    const { nodes, edges } = prepare(SIGNUP_NODES, SIGNUP_EDGES)
    const laidOut = await arrangeChart(nodes, edges)
    const before = new Map(laidOut.nodes.map((n) => [n.id, n.position]))

    const added: DraftNode[] = [...laidOut.nodes, { id: 'welcome', type: 'step', label: 'Send welcome email' }]
    const addedEdges: ChartEdge[] = [...laidOut.edges, { id: 'edone-welcome', source: 'done', target: 'welcome' }]
    const result = await arrangeChart(added, addedEdges)
    expect(result.layout).toBe('incremental')
    for (const node of result.nodes) {
      if (node.id !== 'welcome') expect(node.position).toEqual(before.get(node.id))
    }
    const done = result.nodes.find((n) => n.id === 'done')!
    const welcome = result.nodes.find((n) => n.id === 'welcome')!
    expect(welcome.position.y).toBeGreaterThan(done.position.y + nodeSize(done).height)
    expect(overlappingSiblings(result.nodes)).toEqual([])
    expect(result.edges.find((e) => e.id === 'edone-welcome')).toMatchObject({ sourceHandle: 'bottom', targetHandle: 'top' })
  })

  it('inserts a step between two others without crossing existing edges', () => {
    // page -> [escalate] -> resolve, while queue -> resolve comes in from the right.
    const nodes: DraftNode[] = [
      { id: 'page', type: 'step', label: 'Page on-call', position: { x: 0, y: 300 }, width: 180, height: 80 },
      { id: 'queue', type: 'step', label: 'Support queue', position: { x: 300, y: 300 }, width: 180, height: 80 },
      { id: 'resolve', type: 'step', label: 'Resolve', position: { x: 150, y: 440 }, width: 180, height: 80 },
      { id: 'escalate', type: 'step', label: 'Escalate to tier 2' },
    ]
    const edges = [
      { source: 'queue', target: 'resolve' },
      { source: 'page', target: 'escalate' },
      { source: 'escalate', target: 'resolve' },
    ]
    const placed = placeNodes(nodes, edges)
    const escalate = placed.find((n) => n.id === 'escalate')!
    expect(overlappingSiblings(placed as ChartNode[])).toEqual([])
    // Beside the successor on the predecessor's side, not below it (which would flow backwards).
    expect(escalate.position!.x + 90).toBeLessThan(150 + 90)
    expect(escalate.position!.y).toBeLessThanOrEqual(440)
  })

  it('re-derives guessed handles on edges to nodes the server placed', async () => {
    const nodes: DraftNode[] = [
      { id: 'a', type: 'step', label: 'A', position: { x: 0, y: 0 }, width: 180, height: 80 },
      { id: 'b', type: 'step', label: 'B', position: { x: 0, y: 140 }, width: 180, height: 80 },
      { id: 'new', type: 'step', label: 'New' },
    ]
    const result = await arrangeChart(nodes, [
      { id: 'kept', source: 'a', target: 'b', sourceHandle: 'left', targetHandle: 'left' },
      { id: 'guessed', source: 'b', target: 'new', sourceHandle: 'top', targetHandle: 'bottom' },
    ])
    expect(result.edges.find((e) => e.id === 'kept')).toMatchObject({ sourceHandle: 'left', targetHandle: 'left' })
    expect(result.edges.find((e) => e.id === 'guessed')).toMatchObject({ sourceHandle: 'bottom', targetHandle: 'top' })
  })

  it('finds a free spot next to siblings that already occupy the natural position', () => {
    const nodes: DraftNode[] = [
      { id: 'a', type: 'step', label: 'A', position: { x: 0, y: 0 }, width: 180, height: 80 },
      { id: 'b', type: 'step', label: 'B', position: { x: 0, y: 140 }, width: 180, height: 80 },
      { id: 'c', type: 'step', label: 'C' },
    ]
    const placed = placeNodes(nodes, [{ source: 'a', target: 'c' }])
    const c = placed.find((n) => n.id === 'c')!
    expect(c.position).toBeDefined()
    expect(overlappingSiblings(placed as ChartNode[])).toEqual([])
  })

  it('places a node added to a container inside it and grows the container', async () => {
    const nodes: DraftNode[] = [
      { id: 'vpc', type: 'container', label: 'VPC', position: { x: 0, y: 0 }, width: 260, height: 180, containerKind: 'vpc' },
      { id: 'api', type: 'service', label: 'API', position: { x: 28, y: 56 }, parentNode: 'vpc', width: 180, height: 90 },
      { id: 'cache', type: 'cache', label: 'Redis', parentNode: 'vpc' },
    ]
    const result = await arrangeChart(nodes, [{ id: 'e', source: 'api', target: 'cache' }])
    const vpc = result.nodes.find((n) => n.id === 'vpc')!
    const cache = result.nodes.find((n) => n.id === 'cache')!
    expect(cache.position.y).toBeGreaterThanOrEqual(56 + 90)
    expect(vpc.height!).toBeGreaterThanOrEqual(cache.position.y + nodeSize(cache).height + CONTAINER_PADDING.bottom)
  })
})

describe('containers and handles', () => {
  it('moves a container instead of its children when a child sits in the header', () => {
    const nodes: ChartNode[] = [
      { id: 'box', type: 'container', label: 'Box', position: { x: 100, y: 100 }, width: 300, height: 200 },
      { id: 'kid', type: 'step', label: 'Kid', position: { x: 10, y: 10 }, parentNode: 'box', width: 180, height: 80 },
    ]
    const fitted = fitContainers(nodes)
    const box = fitted.find((n) => n.id === 'box')!
    const kid = fitted.find((n) => n.id === 'kid')!
    // The child keeps its on-screen position; the container moved up and left.
    expect(box.position.x + kid.position.x).toBe(110)
    expect(box.position.y + kid.position.y).toBe(110)
    expect(kid.position).toEqual({ x: CONTAINER_PADDING.left, y: CONTAINER_PADDING.top })
  })

  it('routes loops back around the side', () => {
    const nodes: ChartNode[] = [
      { id: 'a', type: 'step', label: 'A', position: { x: 0, y: 0 }, width: 180, height: 80 },
      { id: 'b', type: 'step', label: 'B', position: { x: 0, y: 200 }, width: 180, height: 80 },
    ]
    const [loop] = assignHandles(nodes, [{ id: 'l', source: 'b', target: 'a' }])
    expect(loop).toMatchObject({ sourceHandle: 'right', targetHandle: 'right' })
  })
})

describe('layout cost', () => {
  it('plans the same kind of layout arrangeChart runs', async () => {
    const at = { x: 0, y: 0 }
    expect(planLayout([{}, {}])).toEqual({ layout: 'full', missing: 2 })
    expect(planLayout([{ position: at }, {}])).toEqual({ layout: 'incremental', missing: 1 })
    expect(planLayout([{ position: at }], { relayout: true })).toEqual({ layout: 'full', missing: 0 })
    expect(planLayout([{ position: at }])).toEqual({ layout: 'none', missing: 0 })
    expect(planLayout([])).toEqual({ layout: 'none', missing: 0 })

    const { nodes, edges } = prepare(
      [
        { id: 'a', type: 'step', label: 'A', position: at },
        { id: 'b', type: 'step', label: 'B' },
      ],
      [{ source: 'a', target: 'b' }],
    )
    expect((await arrangeChart(nodes, edges)).layout).toBe(planLayout(nodes).layout)
  })

  it('weights big automatic layouts roughly by their CPU cost', () => {
    const full = (n: number, e: number) => layoutWorkUnits({ layout: 'full', missing: n }, n, e)
    expect(full(15, 15)).toBe(1)
    expect(full(100, 130)).toBe(5)
    expect(full(200, 400)).toBe(29)
    expect(full(500, 1000)).toBe(178)
    expect(layoutWorkUnits({ layout: 'incremental', missing: 2 }, 30, 30)).toBe(1)
    expect(layoutWorkUnits({ layout: 'incremental', missing: 499 }, 500, 1000)).toBe(50)
    expect(layoutWorkUnits({ layout: 'none', missing: 0 }, 500, 1000)).toBe(1)
  })
})
