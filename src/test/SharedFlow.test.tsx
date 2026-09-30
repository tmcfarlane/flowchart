import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Edge } from 'reactflow'
import App from '../App'
import type { Chart, ChartEdge, ChartNode } from '../shared/flowTypes'
import { changedNodeIds, chartToFlow, contentFingerprint, flowToChart } from '../utils/sharedFlow'
import { getAzureIconId, getAzureIconUrl } from '../utils/azureIconIds'
import { parseSharedLocation } from '../utils/shareApi'

const ID = 'Ab3dE5fG7h'
const TOKEN = 'test-edit-token-1234567890'

const NODES: ChartNode[] = [
  { id: '1', type: 'step', label: 'Visitor signs up', position: { x: 0, y: 0 }, width: 180, height: 80 },
  { id: '2', type: 'decision', label: 'Email verified?', position: { x: 10, y: 150 }, width: 160, height: 160 },
  { id: '3', type: 'image', label: 'Cosmos DB', position: { x: 20, y: 380 }, width: 140, height: 140, icon: 'azure-cosmos-db' },
  { id: 'vpc', type: 'container', label: 'Prod VNet', position: { x: 400, y: 0 }, width: 420, height: 300, containerKind: 'vpc' },
  { id: 'api', type: 'service', label: 'Orders API', position: { x: 28, y: 56 }, parentNode: 'vpc', icon: 'app-services' },
  { id: 'up', type: 'image', label: 'Logo', position: { x: 0, y: 600 }, imageUrl: 'https://example.com/logo.png' },
]
const EDGES: ChartEdge[] = [
  { id: 'e1-2', source: '1', target: '2', style: 'animated', sourceHandle: 'bottom', targetHandle: 'top' },
  { id: 'e2-3', source: '2', target: '3', style: 'step', label: 'Yes', sourceHandle: 'right', targetHandle: 'top' },
  { id: 'e3-api', source: '3', target: 'api', style: 'default', protocol: 'SQL', commStyle: 'async' },
]

function makeChart(overrides: Partial<Chart> = {}): Chart {
  return {
    id: ID,
    version: 3,
    title: 'SaaS signup',
    nodes: NODES,
    edges: EDGES,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedVia: 'mcp',
    ...overrides,
  }
}

// Mirrors App's getEdgeStyleProps closely enough for the round trip.
const edgeProps = (style: string, options?: { protocol?: string; commStyle?: string }): Partial<Edge> => {
  const dashed = options?.commStyle ? options.commStyle === 'async' : style === 'animated'
  return {
    type: style === 'step' ? 'smoothstep' : 'default',
    animated: dashed,
    data: { protocol: options?.protocol, commStyle: options?.commStyle },
  }
}

describe('shared chart <-> React Flow conversion', () => {
  it('round-trips a chart without changes (so applying it never triggers a save)', () => {
    const flow = chartToFlow({ nodes: NODES, edges: EDGES }, { onLabelChange: () => {}, edgeProps })
    const back = flowToChart(flow.nodes, flow.edges)
    expect(contentFingerprint(back)).toBe(contentFingerprint({ nodes: NODES, edges: EDGES }))
    expect(changedNodeIds({ nodes: NODES, edges: EDGES }, back).size).toBe(0)
  })

  it('renders icons from ids and stores ids for icons picked in the editor', () => {
    const flow = chartToFlow({ nodes: NODES, edges: EDGES }, { onLabelChange: () => {}, edgeProps })
    const cosmos = flow.nodes.find((n) => n.id === '3')!
    expect(cosmos.data.imageUrl).toBe(getAzureIconUrl('azure-cosmos-db'))
    expect(getAzureIconId(cosmos.data.imageUrl)).toBe('azure-cosmos-db')

    // A node added with the image picker only has the asset URL.
    const picked = flowToChart(
      [{ id: 'p', type: 'image', position: { x: 0, y: 0 }, data: { label: 'KV', imageUrl: getAzureIconUrl('key-vaults') } }],
      [],
    )
    expect(picked.nodes[0]).toMatchObject({ icon: 'key-vaults' })
    expect(picked.nodes[0].imageUrl).toBeUndefined()
  })

  it('keeps nesting, container kinds and edge semantics', () => {
    const flow = chartToFlow({ nodes: NODES, edges: EDGES }, { onLabelChange: () => {}, edgeProps })
    const api = flow.nodes.find((n) => n.id === 'api')!
    expect(api).toMatchObject({ parentNode: 'vpc', extent: 'parent' })
    expect(flow.nodes.findIndex((n) => n.id === 'vpc')).toBeLessThan(flow.nodes.findIndex((n) => n.id === 'api'))
    expect(flow.nodes.find((n) => n.id === 'vpc')!.data.containerKind).toBe('vpc')
    expect(flow.edges.find((e) => e.id === 'e3-api')).toMatchObject({ animated: true, data: { protocol: 'SQL', commStyle: 'async' } })
  })

  it('parses shared links', () => {
    expect(parseSharedLocation({ pathname: `/f/${ID}`, hash: `#edit=${TOKEN}` })).toEqual({ id: ID, token: TOKEN })
    expect(parseSharedLocation({ pathname: `/f/${ID}/`, hash: '' })).toEqual({ id: ID, token: undefined })
    expect(parseSharedLocation({ pathname: '/', hash: '' })).toBeNull()
    expect(parseSharedLocation({ pathname: '/f/', hash: '' })).toBeNull()
    expect(parseSharedLocation({ pathname: '/f/a/b', hash: '' })).toBeNull()
    // Malformed ids are passed through so the server's 404 shows "not found".
    expect(parseSharedLocation({ pathname: '/f/short', hash: '' })).toEqual({ id: 'short', token: undefined })
  })
})

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('App on a shared link', () => {
  let routes: Handler
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.localStorage.clear()
    fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => Promise.resolve(routes(String(input), init)))
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  const calls = (method: string) =>
    fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method)

  it('loads the chart, remembers the edit token and hides it from the address bar', async () => {
    window.history.replaceState(null, '', `/f/${ID}#edit=${TOKEN}`)
    routes = (url) => (url.startsWith(`/api/flows/${ID}`) ? json(makeChart()) : json({}, 404))
    render(<App />)

    expect(await screen.findByText('Visitor signs up')).toBeInTheDocument()
    expect(screen.getByText('Email verified?')).toBeInTheDocument()
    expect(screen.getByText('Prod VNet')).toBeInTheDocument()
    expect(window.localStorage.getItem(`flowchart:edit-token:${ID}`)).toBe(TOKEN)
    expect(window.location.pathname).toBe(`/f/${ID}`)
    expect(window.location.hash).toBe('')

    const badge = screen.getByLabelText('Shared flowchart status')
    expect(badge).toHaveTextContent('Shared')
    expect(badge).toHaveTextContent('SaaS signup')
    expect(badge).toHaveTextContent('Saved')
    // No welcome prompt over a shared chart.
    expect(screen.queryByText("What's your flow?")).not.toBeInTheDocument()
    // Architecture content switches the palette.
    expect(screen.getByLabelText('Architecture Mode')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens without a token as view only', async () => {
    window.history.replaceState(null, '', `/f/${ID}`)
    routes = () => json(makeChart())
    render(<App />)
    expect(await screen.findByText('Visitor signs up')).toBeInTheDocument()
    expect(screen.getByLabelText('Shared flowchart status')).toHaveTextContent('View only')
  })

  it('shows a friendly message for unknown charts', async () => {
    window.history.replaceState(null, '', `/f/${ID}`)
    routes = () => json({ error: 'No flowchart', code: 'not_found' }, 404)
    render(<App />)
    expect(await screen.findByText("This flowchart doesn't exist")).toBeInTheDocument()
    expect(screen.getByText('Start a new flowchart')).toBeInTheDocument()
  })

  it('treats a truncated link as an unknown chart instead of opening a blank canvas', async () => {
    window.history.replaceState(null, '', '/f/Ab3dE5fG7')
    routes = () => json({ error: 'No flowchart', code: 'not_found' }, 404)
    render(<App />)
    expect(await screen.findByText("This flowchart doesn't exist")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/flows/Ab3dE5fG7', expect.anything())
  })

  it('saves edits made in the browser back with the token and base version', async () => {
    window.history.replaceState(null, '', `/f/${ID}#edit=${TOKEN}`)
    routes = (url, init) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        return json({ ...makeChart(), ...body, version: 4, updatedVia: 'api' })
      }
      return url.includes('since=') ? json({ id: ID, version: 3, changed: false }) : json(makeChart())
    }
    render(<App />)
    await screen.findByText('Visitor signs up')

    fireEvent.click(screen.getByLabelText('Toggle Explorer'))
    const input = screen.getAllByPlaceholderText('Node name').find((el) => (el as HTMLInputElement).value === 'Visitor signs up')!
    fireEvent.change(input, { target: { value: 'Visitor starts a trial' } })

    await waitFor(() => expect(calls('PUT')).toHaveLength(1), { timeout: 3000 })
    const [url, init] = calls('PUT')[0] as [string, RequestInit]
    expect(url).toBe(`/api/flows/${ID}`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    const body = JSON.parse(String(init.body))
    expect(body.baseVersion).toBe(3)
    expect(body.nodes.find((n: ChartNode) => n.id === '1').label).toBe('Visitor starts a trial')
    expect(body.nodes.find((n: ChartNode) => n.id === '3').icon).toBe('azure-cosmos-db')
    await waitFor(() => expect(screen.getByLabelText('Shared flowchart status')).toHaveTextContent('Saved'))
  })

  it('never overwrites a newer remote version: it asks instead', async () => {
    window.history.replaceState(null, '', `/f/${ID}#edit=${TOKEN}`)
    routes = (url, init) => {
      if (init.method === 'PUT') return json({ error: 'Version conflict', code: 'conflict', currentVersion: 5 }, 409)
      return url.includes('since=') ? json({ id: ID, version: 3, changed: false }) : json(makeChart())
    }
    render(<App />)
    await screen.findByText('Visitor signs up')
    fireEvent.click(screen.getByLabelText('Toggle Explorer'))
    const input = screen.getAllByPlaceholderText('Node name')[0]
    fireEvent.change(input, { target: { value: 'Local edit' } })

    expect(await screen.findByText(/changed elsewhere \(version 5\)/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('Load latest')).toBeInTheDocument()
    expect(screen.getByText('Keep my version')).toBeInTheDocument()
    // The local edit is still on the canvas.
    expect(screen.getAllByText('Local edit').length).toBeGreaterThan(0)
  })

  it('applies agent updates live while the tab is visible', async () => {
    window.history.replaceState(null, '', `/f/${ID}`)
    let remote = makeChart()
    routes = (url) => {
      if (url.includes('since=')) {
        const since = Number(new URL(url, 'http://x').searchParams.get('since'))
        return remote.version > since ? json({ ...remote, changed: true }) : json({ id: ID, version: remote.version, changed: false })
      }
      return json(remote)
    }
    render(<App />)
    await screen.findByText('Visitor signs up')

    remote = makeChart({
      version: 4,
      nodes: [...NODES, { id: '7', type: 'step', label: 'Send welcome email', position: { x: 0, y: 700 } }],
    })
    expect(await screen.findByText('Send welcome email', {}, { timeout: 6000 })).toBeInTheDocument()
    expect(screen.getByLabelText('Shared flowchart status')).toHaveTextContent('Updated by AI agent')
    expect(calls('GET').some(([url]) => String(url).includes('?since=3'))).toBe(true)
  }, 10_000)
})

describe('Share button', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('saves the current canvas and shows view and edit links', async () => {
    fetchMock = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(url) === '/api/flows' && init.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return json(
          {
            id: ID,
            version: 1,
            url: `http://localhost:3000/f/${ID}`,
            editUrl: `http://localhost:3000/f/${ID}#edit=${TOKEN}`,
            editToken: TOKEN,
            chart: { ...makeChart({ version: 1, title: body.title }), nodes: body.nodes, edges: body.edges },
          },
          201,
        )
      }
      return json({ id: ID, version: 1, changed: false })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<App />)
    fireEvent.click(screen.getByText('No, thank you'))
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    fireEvent.click(screen.getByLabelText('Share'))
    expect(screen.getByRole('dialog', { name: 'Share flowchart' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('Create share link'))
    })

    const [, init] = fetchMock.mock.calls.find(([url]) => String(url) === '/api/flows')! as [string, RequestInit]
    const sent = JSON.parse(String(init.body))
    expect(sent.title).toBe('Untitled flowchart')
    expect(sent.nodes).toHaveLength(1)
    expect(sent.nodes[0]).toMatchObject({ type: 'step', label: 'Step' })

    expect(await screen.findByLabelText('View link')).toHaveValue(`http://localhost:3000/f/${ID}`)
    expect(screen.getByLabelText('Edit link')).toHaveValue(`http://localhost:3000/f/${ID}#edit=${TOKEN}`)
    expect(screen.getByLabelText('MCP server')).toHaveValue('http://localhost:3000/api/mcp')
    expect(window.location.pathname).toBe(`/f/${ID}`)
    expect(window.localStorage.getItem(`flowchart:edit-token:${ID}`)).toBe(TOKEN)
    expect(screen.getByLabelText('Shared flowchart status')).toHaveTextContent('Untitled flowchart')
  })
})
