import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShareMenu from '../components/ShareMenu'

const originalWidth = window.innerWidth
const originalHeight = window.innerHeight
const fixture = { isShared: true, canEdit: false, viewUrl: 'https://example.com/f/Ab3dE5fG7h', creating: false, onCreate: vi.fn(async () => true) }
function viewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}
afterEach(() => { viewport(originalWidth, originalHeight); vi.restoreAllMocks() })

describe('Share panel accessibility and viewport bounds', () => {
  it('escapes the toolbar clipping ancestor and fits a short mobile viewport', () => {
    viewport(390, 390)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 112, bottom: 149, right: 376, left: 332, width: 44, height: 37, x: 332, y: 112, toJSON() {} })
    render(<div className="app dark-mode"><div className="floating-toolbar"><div className="toolbar-row"><ShareMenu {...fixture} /></div></div></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog', { name: 'Share flowchart' })
    expect(dialog.parentElement).toHaveClass('app', 'dark-mode')
    expect(dialog.closest('.toolbar-row')).toBeNull()
    expect(dialog).toHaveStyle({ top: '12px', left: '12px', maxHeight: '366px' })
    expect(screen.getByLabelText('View link')).toHaveFocus()
    expect(screen.getByRole('link', { name: 'MCP setup guide' })).toBeInTheDocument()
    viewport(320, 260)
    fireEvent(window, new Event('resize'))
    expect(dialog).toHaveStyle({ top: '12px', left: '12px', maxHeight: '236px' })
  })

  it('keeps keyboard focus inside the dialog and returns it to Share on Escape or Close', () => {
    render(<ShareMenu {...fixture} />)
    const trigger = screen.getByRole('button', { name: 'Share' })
    fireEvent.click(trigger)
    const close = screen.getByRole('button', { name: 'Close share panel' })
    const footer = screen.getByRole('link', { name: 'MCP setup guide' })
    footer.focus()
    fireEvent.keyDown(footer, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(footer).toHaveFocus()
    fireEvent.keyDown(footer, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Close share panel' }))
    expect(trigger).toHaveFocus()
  })

  it('focuses creation consent without creating a chart, including when creation is busy', () => {
    const onCreate = vi.fn(async () => true)
    const view = render(<ShareMenu isShared={false} canEdit={false} creating={false} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('button', { name: 'Create share link' })).toHaveFocus()
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close share panel' }))
    view.rerender(<ShareMenu isShared={false} canEdit={false} creating onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('button', { name: 'Close share panel' })).toHaveFocus()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('requires fresh deletion confirmation after reopening and hides it on read-only views', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<ShareMenu {...fixture} canEdit editUrl="https://example.com/f/Ab3dE5fG7h#edit=controlled-fixture-not-auth" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByLabelText('Edit link')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete shared chart…' }))
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('button', { name: 'Delete shared chart…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument()
    view.rerender(<ShareMenu {...fixture} editUrl="https://example.com/f/Ab3dE5fG7h#edit=controlled-fixture-not-auth" />)
    expect(screen.queryByLabelText('Edit link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete shared chart…' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
