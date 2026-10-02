import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CommandPalette from '../components/CommandPalette'
import type { Node } from 'reactflow'

const nodes: Node[] = [
  { id: 'gateway', type: 'apiGateway', position: { x: 0, y: 0 }, data: { label: 'Edge gateway' } },
  { id: 'redis', type: 'cache', position: { x: 200, y: 0 }, data: { label: 'Warm memory' } },
]
const props = () => ({ isOpen: true, nodes, onClose: vi.fn(), onFocusNode: vi.fn(), onOpenTemplates: vi.fn(), onOpenChat: vi.fn(), onOpenImageStudio: vi.fn(), onAutoLayout: vi.fn() })

describe('Command palette', () => {
  it('navigates workspace actions from the keyboard and closes before activating', () => {
    const callbacks = props()
    render(<CommandPalette {...callbacks} />)
    const search = screen.getByRole('combobox', { name: 'Find a node or action' })
    expect(search).toHaveFocus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Edit your diagram with AI/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(callbacks.onOpenChat).toHaveBeenCalledOnce()
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(callbacks.onClose.mock.invocationCallOrder[0]).toBeLessThan(callbacks.onOpenChat.mock.invocationCallOrder[0])
  })

  it('finds nodes by type or id and focuses the original canvas node', () => {
    const callbacks = props()
    render(<CommandPalette {...callbacks} />)
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'CACHE' } })
    expect(screen.getByRole('option', { name: /Warm memory/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(callbacks.onFocusNode).toHaveBeenCalledWith('redis')
    expect(callbacks.onClose).toHaveBeenCalledOnce()
  })

  it('routes horizontal layout and Premium studio actions to the right handlers', () => {
    const callbacks = props()
    render(<CommandPalette {...callbacks} />)
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'horizontal' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(callbacks.onAutoLayout).toHaveBeenCalledWith('LR')
    fireEvent.change(search, { target: { value: 'premium' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(callbacks.onOpenImageStudio).toHaveBeenCalledOnce()
  })

  it('keeps an empty query safe and restores focus when dismissed', () => {
    const callbacks = props()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<CommandPalette {...callbacks} />)
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'does-not-exist-98765' } })
    expect(screen.getByText('No matching thought yet.')).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(callbacks.onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close command palette' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    view.rerender(<CommandPalette {...callbacks} isOpen={false} />)
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('aligns a valid selection from the keyboard and closes before invoking the action', () => {
    const callbacks = { ...props(), nodes: nodes.map((node) => ({ ...node, selected: true })), onArrangeSelection: vi.fn() }
    render(<CommandPalette {...callbacks} />)
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'align selected nodes right' } })
    const option = screen.getByRole('option', { name: /Align selected nodes right/ })
    expect(option).toBeEnabled()
    expect(option).toHaveTextContent('right edges')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(callbacks.onArrangeSelection).toHaveBeenCalledOnce()
    expect(callbacks.onArrangeSelection).toHaveBeenCalledWith('align-right')
    expect(callbacks.onClose.mock.invocationCallOrder[0]).toBeLessThan(callbacks.onArrangeSelection.mock.invocationCallOrder[0])
  })

  it('keeps unavailable actions discoverable and prevents keyboard or pointer activation', () => {
    const callbacks = { ...props(), onArrangeSelection: vi.fn() }
    render(<CommandPalette {...callbacks} />)
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'align selected nodes left' } })
    const option = screen.getByRole('option', { name: /Align selected nodes left/ })
    expect(option).toBeDisabled()
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option).toHaveTextContent('Select at least two nodes')
    expect(search).toHaveAttribute('aria-activedescendant', option.id)
    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.click(option)
    expect(callbacks.onArrangeSelection).not.toHaveBeenCalled()
    expect(callbacks.onClose).not.toHaveBeenCalled()
  })

  it('explains distribution eligibility and accepts host geometry availability overrides', () => {
    const callbacks = { ...props(), nodes: nodes.map((node) => ({ ...node, selected: true })), onArrangeSelection: vi.fn() }
    const view = render(<CommandPalette {...callbacks} />)
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'distribute selected nodes horizontally' } })
    expect(screen.getByRole('option')).toBeDisabled()
    expect(screen.getByRole('option')).toHaveTextContent('at least three nodes')
    view.rerender(<CommandPalette {...callbacks} arrangementAvailability={{ align: { enabled: true }, horizontal: { enabled: true }, vertical: { enabled: false, reason: 'Move the end nodes farther apart vertically.' } }} />)
    expect(screen.getByRole('option')).toBeEnabled()
    expect(screen.getByRole('option')).toHaveTextContent('keep the two end nodes in place')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(callbacks.onArrangeSelection).toHaveBeenCalledWith('distribute-horizontal')
    fireEvent.change(search, { target: { value: 'distribute selected nodes vertically' } })
    expect(screen.getByRole('option')).toBeDisabled()
    expect(screen.getByRole('option')).toHaveTextContent('farther apart vertically')
  })

  it('does not offer selection commands until the host supplies an arrangement handler', () => {
    render(<CommandPalette {...props()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'align selected' } })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
