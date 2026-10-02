import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import AIInsertPreviewDialog from '../components/AIInsertPreviewDialog'

const flow = vi.hoisted(() => ({ fitView: vi.fn(), initialized: true, props: {} as Record<string, unknown> }))
vi.mock('reactflow', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    default: (props: Record<string, unknown> & { children: ReactNode }) => { flow.props = props; return <div>{props.children}</div> },
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReactFlow: () => ({ fitView: flow.fitView }),
    useNodesInitialized: () => flow.initialized,
    Controls: () => <button>Fit diagram</button>,
    Background: () => null,
    MiniMap: () => null,
  }
})

const proposal = { summary: 'A quiet observatory', nodes: [{ id: 'moon', type: 'step', label: 'Collect moonlight', position: { x: 0, y: 0 } }], edges: [] }
const callbacks = () => ({ proposal, darkMode: true, onInsert: vi.fn(), onCancel: vi.fn(), onPreview: vi.fn(), onRefine: vi.fn<() => Promise<string | undefined>>().mockResolvedValue('Refined diagram') })

describe('AI proposal review', () => {
  let resize: ResizeObserverCallback | undefined
  let frame: FrameRequestCallback | undefined
  beforeEach(() => {
    flow.fitView.mockClear()
    flow.initialized = true
    resize = undefined
    frame = undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('allows tall diagrams to zoom out and refits after measured canvas dimensions change', () => {
    const view = render(<AIInsertPreviewDialog {...callbacks()} />)
    expect(flow.props.minZoom).toBe(0.05)
    act(() => frame?.(0))
    expect(flow.fitView).toHaveBeenCalledWith(expect.objectContaining({ minZoom: 0.05, duration: 0 }))
    act(() => resize?.([{ contentRect: { width: 390, height: 417 } } as ResizeObserverEntry], {} as ResizeObserver))
    act(() => frame?.(0))
    expect(flow.fitView).toHaveBeenCalledTimes(2)
    act(() => resize?.([{ contentRect: { width: 390, height: 661 } } as ResizeObserverEntry], {} as ResizeObserver))
    act(() => frame?.(0))
    expect(flow.fitView).toHaveBeenCalledTimes(3)
    frame = undefined
    act(() => resize?.([{ contentRect: { width: 390, height: 661 } } as ResizeObserverEntry], {} as ResizeObserver))
    expect(frame).toBeUndefined()
    view.unmount()
  })

  it('does not invent an assistant response when a stale refinement returns no result', async () => {
    const props = callbacks()
    props.onRefine.mockResolvedValue(undefined)
    render(<AIInsertPreviewDialog {...props} />)
    const input = screen.getByRole('textbox', { name: 'Refinement instruction' })
    fireEvent.change(input, { target: { value: 'Move moonlight above the dream' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(props.onRefine).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(props.onRefine).toHaveBeenCalledWith('Move moonlight above the dream'))
    expect(screen.queryByText('AI', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('Move moonlight above the dream', { selector: 'p' })).toBeInTheDocument()
  })

  it('keeps Apply disabled during refinement and lets users recover a failed instruction', async () => {
    const props = callbacks()
    props.onRefine.mockRejectedValue(new Error('The model is busy. Try again.'))
    const view = render(<AIInsertPreviewDialog {...props} />)
    const input = screen.getByRole('textbox', { name: 'Refinement instruction' })
    fireEvent.change(input, { target: { value: 'Add a launch branch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(input).toHaveValue('Add a launch branch'))
    expect(screen.getByText('The model is busy. Try again.')).toBeInTheDocument()
    view.rerender(<AIInsertPreviewDialog {...props} isRefining />)
    expect(screen.getByRole('button', { name: 'Insert into Canvas' })).toBeDisabled()
    expect(input).toBeDisabled()
  })

  it('traps focus and uses the latest cancel callback without stealing refinement focus', () => {
    const props = callbacks()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<AIInsertPreviewDialog {...props} />)
    expect(screen.getByRole('heading', { name: 'Preview AI Proposal' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Insert into Canvas' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toHaveFocus()
    const input = screen.getByRole('textbox', { name: 'Refinement instruction' })
    input.focus()
    const onCancel = vi.fn()
    view.rerender(<AIInsertPreviewDialog {...props} onCancel={onCancel} />)
    expect(input).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(props.onCancel).not.toHaveBeenCalled()
    view.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
