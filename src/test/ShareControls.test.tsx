import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShareStatus from '../components/ShareStatus'
import ShareMenu, { copyText } from '../components/ShareMenu'
import type { SharedFlowApi, SharedFlowState } from '../hooks/useSharedFlow'

const shared = (patch: Partial<SharedFlowState> = {}): SharedFlowApi => ({
  state: { id: 'Ab3dE5fG7h', title: 'Shared chart', version: 2, canEdit: false, status: 'synced', creating: false, ...patch },
  viewUrl: 'https://example.com/f/Ab3dE5fG7h',
  createShare: vi.fn(async () => true), rename: vi.fn(), loadLatest: vi.fn(async () => {}), keepMine: vi.fn(async () => {}), retryLoad: vi.fn(), detachToLocal: vi.fn(() => true),
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (document as { execCommand?: unknown }).execCommand })

describe('Shared chart controls', () => {
  it('keeps a loaded unavailable canvas usable for export instead of showing the initial missing-chart overlay', () => {
    const api = shared({ status: 'not-found', error: 'The shared link is unavailable. Export a copy to keep your work.' })
    api.viewUrl = undefined
    render(<ShareStatus shared={api} />)
    expect(screen.getByLabelText('Shared flowchart status')).toHaveTextContent('Link unavailable')
    expect(screen.getByRole('alert')).toHaveTextContent('Export a copy')
    expect(screen.queryByText('Start a new flowchart')).not.toBeInTheDocument()
    expect(screen.queryByText('Copy link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shared chart' })).toBeDisabled()
  })

  it('continues to show the missing-chart overlay when no version has ever loaded', () => {
    render(<ShareStatus shared={shared({ status: 'not-found', version: 0 })} />)
    expect(screen.getByText("This flowchart doesn't exist")).toBeInTheDocument()
    expect(screen.queryByLabelText('Shared flowchart status')).not.toBeInTheDocument()
  })

  it('offers Load latest but never Keep my version or rename on a read-only conflict', () => {
    const api = shared({ status: 'conflict', conflictVersion: 3 })
    render(<ShareStatus shared={api} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load latest' }))
    expect(api.loadLatest).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Keep my version' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Shared chart' }))
    expect(api.rename).not.toHaveBeenCalled()
  })

  it('does not hide a save failure behind a recent remote-update flash', () => {
    render(<ShareStatus shared={shared({ status: 'error', canEdit: true, error: 'Offline; not saved.', lastRemoteUpdate: { at: Date.now(), version: 2, via: 'mcp' } })} />)
    expect(screen.getByLabelText('Shared flowchart status')).toHaveTextContent('Not saved')
    expect(screen.queryByText('Updated by AI agent')).not.toBeInTheDocument()
  })

  it('keeps a focused title draft when a poll updates the shared title', () => {
    const api = shared({ canEdit: true })
    const view = render(<ShareStatus shared={api} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shared chart' }))
    fireEvent.change(screen.getByLabelText('Chart title'), { target: { value: 'My title draft' } })
    view.rerender(<ShareStatus shared={{ ...api, state: { ...api.state, title: 'Remote title', version: 3 } }} />)
    expect(screen.getByLabelText('Chart title')).toHaveValue('My title draft')
    expect(screen.getByLabelText('Chart title')).toHaveFocus()
    fireEvent.keyDown(screen.getByLabelText('Chart title'), { key: 'Enter' })
    expect(api.rename).toHaveBeenCalledWith('My title draft')
  })

  it('closes an active title editor when edit permission is revoked', () => {
    const api = shared({ canEdit: true })
    const view = render(<ShareStatus shared={api} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shared chart' }))
    fireEvent.change(screen.getByLabelText('Chart title'), { target: { value: 'An unsaved draft' } })
    view.rerender(<ShareStatus shared={{ ...api, state: { ...api.state, canEdit: false } }} />)
    expect(screen.queryByLabelText('Chart title')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shared chart' })).toBeDisabled()
    expect(api.rename).not.toHaveBeenCalled()
  })

  it('shows conflict-resolution feedback beside the preserved conflict actions', () => {
    render(<ShareStatus shared={shared({ status: 'conflict', canEdit: true, conflictVersion: 3, error: 'Your canvas changed while the latest version was loading.' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('canvas changed while')
    expect(screen.getByRole('button', { name: 'Load latest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep my version' })).toBeInTheDocument()
  })

  it('hides all private write controls on a read-only share dialog', () => {
    render(<ShareMenu isShared canEdit={false} viewUrl="https://example.com/f/Ab3dE5fG7h" editUrl="https://example.com/f/Ab3dE5fG7h#edit=private-fixture" creating={false} onCreate={async () => true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByLabelText('View link')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete shared chart…' })).not.toBeInTheDocument()
  })

  it('cleans the fallback clipboard element if copying a private link fails', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('Unavailable') }) } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => { throw new Error('Copy failed') } })
    expect(await copyText('private-link-fixture')).toBe(false)
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('retains explicit deletion confirmation and allows retry after a failed delete', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ShareMenu isShared canEdit viewUrl="https://example.com/f/Ab3dE5fG7h" editUrl="https://example.com/f/Ab3dE5fG7h#edit=private-fixture" creating={false} onCreate={async () => true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete shared chart…' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
