import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import AIChat from '../components/AIChat'
import type { DiagramMode } from '../shared/flowTypes'
import { compileDrawProposal } from '../shared/drawCompiler'
import { DrawProposalSchema } from '../shared/drawGeneration'
import type { AIGenerationProposal } from '../shared/aiGeneration'

// jsdom has no canvas or createImageBitmap, so stub the re-encoding step
vi.mock('../utils/imagePaste', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/imagePaste')>()),
  imageFileToDataUrl: async () => 'data:image/jpeg;base64,AAAA',
}))

const drawing = {
  outputMode: 'draw', summary: 'Workshop plan',
  elements: [{ id: 'desk', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, label: 'Desk', strokeColor: '#000000', backgroundColor: '#ffffff' }],
}
const flowchart = {
  outputMode: 'flowchart', summary: 'Simple process',
  nodes: [{ id: 'start', type: 'step', label: 'Start', position: { x: 0, y: 0 } }], edges: [],
}

function jsonResponse(proposal: object) {
  const parsed = DrawProposalSchema.safeParse(proposal)
  const compiled = parsed.success ? compileDrawProposal(parsed.data) : null
  if (compiled && !compiled.ok) throw new Error(JSON.stringify(compiled.issues))
  return { ok: true, json: async () => ({ message: JSON.stringify(proposal), ...(compiled?.ok ? { drawing: compiled.drawing } : {}), finishReason: 'stop' }) } as Response
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

function ControlledChat(props: Omit<ComponentProps<typeof AIChat>, 'generationPrompt' | 'onGenerationPromptChange'>) {
  const [prompt, setPrompt] = useState('')
  return <AIChat key={props.variant} {...props} generationPrompt={prompt} onGenerationPromptChange={setPrompt} />
}

function ChatHarness({ onReady, revision = 0, onClose = vi.fn(), getContext = () => undefined }: {
  onReady: (proposal: AIGenerationProposal) => void
  revision?: number
  onClose?: () => void
  getContext?: () => { drawContext: { elements: []; omittedElementCount: number } } | undefined
}) {
  const [mode, setMode] = useState<DiagramMode>('flowchart')
  const [prompt, setPrompt] = useState('')
  return <AIChat nodes={[]} edges={[]} isOpen onClose={onClose} variant="full"
    generationMode={mode} onGenerationModeChange={setMode}
    generationPrompt={prompt} onGenerationPromptChange={setPrompt} getGenerationContext={getContext}
    generationRevision={revision} onProposalReady={onReady} />
}

afterEach(() => vi.unstubAllGlobals())

describe('AIChat generation modes', () => {
  it('shows a controlled selector in both prompt variants', () => {
    const onModeChange = vi.fn()
    const common = {
      nodes: [], edges: [], isOpen: true, onClose: vi.fn(),
      generationMode: 'draw' as DiagramMode, onGenerationModeChange: onModeChange,
      getGenerationContext: () => undefined, onProposalReady: vi.fn(),
    }
    const view = render(<ControlledChat {...common} variant="welcome" />)
    expect(screen.getByLabelText('Generate for')).toHaveValue('draw')
    expect(screen.getByRole('button', { name: /Generate drawing/i })).toBeInTheDocument()
    expect(screen.getByLabelText('AI Draw tools')).toHaveTextContent('Rectangle, Ellipse, Diamond, Text, Line, Arrow, Pen, Frame')
    expect(screen.getByRole('button', { name: /Make two named mobile screen frames/i })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Describe shapes, labels, and lines to draw...'), { target: { value: 'Keep this sketch' } })
    view.rerender(<ControlledChat {...common} variant="full" />)
    expect(screen.getByLabelText('Generate for')).toHaveValue('draw')
    expect(screen.getByText('What should we draw?')).toBeInTheDocument()
    expect(screen.getByLabelText('AI Draw tools')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Describe shapes, labels, and lines to draw...')).toHaveValue('Keep this sketch')
    fireEvent.change(screen.getByLabelText('Generate for'), { target: { value: 'architecture' } })
    expect(onModeChange).toHaveBeenCalledWith('architecture')
  })

  it('shows tool help only for Draw and submits a Draw starter on click', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(drawing))
    vi.stubGlobal('fetch', fetchMock)
    const onReady = vi.fn()
    const view = render(<ControlledChat nodes={[]} edges={[]} isOpen onClose={vi.fn()} variant="welcome"
      generationMode="flowchart" onGenerationModeChange={vi.fn()} getGenerationContext={() => undefined} onProposalReady={onReady} />)
    expect(screen.queryByLabelText('AI Draw tools')).not.toBeInTheDocument()
    view.rerender(<ControlledChat nodes={[]} edges={[]} isOpen onClose={vi.fn()} variant="welcome"
      generationMode="draw" onGenerationModeChange={vi.fn()} getGenerationContext={() => undefined} onProposalReady={onReady} />)
    const prompt = 'Make two named mobile screen frames with buttons, labels and navigation arrows'
    fireEvent.click(screen.getByRole('button', { name: new RegExp(prompt) }))
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'draw', proposal: drawing, drawing: expect.objectContaining({ type: 'excalidraw', version: 2 }) }), expect.any(String)))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual([{ role: 'user', content: prompt }])
  })

  it('sends the selected Draw target with fresh context and delivers native proposal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(drawing))
    vi.stubGlobal('fetch', fetchMock)
    const onReady = vi.fn()
    const getContext = vi.fn(() => ({ drawContext: { elements: [], omittedElementCount: 0 } }))
    render(<ChatHarness onReady={onReady} getContext={getContext} />)
    fireEvent.change(screen.getByLabelText('Generate for'), { target: { value: 'draw' } })
    fireEvent.change(screen.getByPlaceholderText('Describe shapes, labels, and lines to draw...'), { target: { value: 'Sketch a workshop' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate drawing/i }))
    expect(screen.getByLabelText('Generate for')).toBeDisabled()
    expect(screen.getByText('Generating drawing...')).toBeInTheDocument()
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'draw', proposal: drawing, drawing: expect.objectContaining({ type: 'excalidraw', version: 2 }) }), expect.any(String)))
    expect(screen.getByPlaceholderText('Describe shapes, labels, and lines to draw...')).toHaveValue('')
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request).toMatchObject({ mode: 'generate', diagramMode: 'draw', drawContext: { omittedElementCount: 0 }, messages: [{ role: 'user', content: 'Sketch a workshop' }] })
    expect(request.flowContext).toBeUndefined()
    expect(getContext).toHaveBeenCalledTimes(1)
  })

  it('omits context when App cannot supply a safe one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(drawing))
    vi.stubGlobal('fetch', fetchMock)
    const onReady = vi.fn()
    const getContext = vi.fn(() => undefined)
    render(<ControlledChat
      nodes={[
        { id: 'embedded', type: 'image', position: { x: 0, y: 0 }, data: { label: 'Embedded', imageUrl: 'data:image/png;base64,SECRET' } },
        { id: 'external', type: 'image', position: { x: 10, y: 10 }, data: { label: 'External', imageUrl: 'https://example.test/image.png' } },
      ]}
      edges={[]} isOpen onClose={vi.fn()} diagramMode="flowchart"
      generationMode="draw" onGenerationModeChange={vi.fn()}
      getGenerationContext={getContext} onProposalReady={onReady}
    />)
    fireEvent.change(screen.getByPlaceholderText('Describe shapes, labels, and lines to draw...'), { target: { value: 'Sketch a floor plan' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate drawing/i }))
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'draw', proposal: drawing, drawing: expect.objectContaining({ type: 'excalidraw', version: 2 }) }), expect.any(String)))
    const requestBody = fetchMock.mock.calls[0][1].body as string
    const request = JSON.parse(requestBody)
    expect(request.diagramMode).toBe('draw')
    expect(request.flowContext).toBeUndefined()
    expect(request.drawContext).toBeUndefined()
    expect(requestBody).not.toContain('data:image')
    expect(requestBody).not.toContain('https://example.test/image.png')
    expect(getContext).toHaveBeenCalledTimes(1)
  })

  it('generates a graph from a Draw board using the chosen output mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(flowchart))
    vi.stubGlobal('fetch', fetchMock)
    const onReady = vi.fn()
    render(<ControlledChat nodes={[]} edges={[]} isOpen onClose={vi.fn()} diagramMode="draw"
      generationMode="flowchart" onGenerationModeChange={vi.fn()}
      getGenerationContext={() => ({ drawContext: { elements: [], omittedElementCount: 0 } })}
      onProposalReady={onReady} />)
    fireEvent.change(screen.getByPlaceholderText('Describe any process, workflow, or plan...'), { target: { value: 'Plan a handoff' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate Flowchart/i }))
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(flowchart, expect.any(String)))
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request.diagramMode).toBe('flowchart')
    expect(request.drawContext).toEqual({ elements: [], omittedElementCount: 0 })
    expect(request.flowContext).toBeUndefined()
  })

  it('keeps the typed prompt after an error and ignores a response from a former target', async () => {
    const stale = deferredResponse()
    const fetchMock = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(jsonResponse(drawing))
    vi.stubGlobal('fetch', fetchMock)
    const onReady = vi.fn()
    render(<ChatHarness onReady={onReady} />)
    fireEvent.change(screen.getByPlaceholderText('Describe any process, workflow, or plan...'), { target: { value: 'Plan launch' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate flowchart/i }))
    fireEvent.change(screen.getByLabelText('Generate for'), { target: { value: 'draw' } })
    stale.resolve(jsonResponse(flowchart))
    await waitFor(() => expect(screen.getByRole('button', { name: /Generate drawing/i })).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Describe shapes, labels, and lines to draw...')).toHaveValue('Plan launch')
    expect(onReady).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Generate drawing/i }))
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'draw', proposal: drawing, drawing: expect.objectContaining({ type: 'excalidraw', version: 2 }) }), expect.any(String)))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages).toEqual([{ role: 'user', content: 'Plan launch' }])
  })

  it('ignores a pending response after the document revision changes', async () => {
    const pending = deferredResponse()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
    const onReady = vi.fn()
    const view = render(<ChatHarness onReady={onReady} revision={0} />)
    fireEvent.change(screen.getByPlaceholderText('Describe any process, workflow, or plan...'), { target: { value: 'Map it' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate flowchart/i }))
    view.rerender(<ChatHarness onReady={onReady} revision={1} />)
    pending.resolve(jsonResponse(flowchart))
    await waitFor(() => expect(screen.getByRole('button', { name: /Generate flowchart/i })).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Describe any process, workflow, or plan...')).toHaveValue('Map it')
    expect(onReady).not.toHaveBeenCalled()
  })

  it('shows a request error without clearing the prompt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Service unavailable' }) }))
    const onReady = vi.fn()
    render(<ChatHarness onReady={onReady} />)
    fireEvent.change(screen.getByPlaceholderText('Describe any process, workflow, or plan...'), { target: { value: 'Map the handoff' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate flowchart/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable')
    expect(screen.getByPlaceholderText('Describe any process, workflow, or plan...')).toHaveValue('Map the handoff')
    expect(onReady).not.toHaveBeenCalled()
  })

  it('sends a pasted image with the prompt and enables generation without text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(flowchart))
    vi.stubGlobal('fetch', fetchMock)
    const onReady = vi.fn()
    render(<ChatHarness onReady={onReady} />)
    const input = screen.getByPlaceholderText('Describe any process, workflow, or plan...')
    const file = new File(['x'], 'sketch.png', { type: 'image/png' })
    fireEvent.paste(input, { clipboardData: { files: [file] } })
    expect(await screen.findByAltText('Pasted image')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Generate flowchart/i }))
    await waitFor(() => expect(onReady).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.image).toBe('data:image/jpeg;base64,AAAA')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Create a diagram from this image.' })
  })
})
