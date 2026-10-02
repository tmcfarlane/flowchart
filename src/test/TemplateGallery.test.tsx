import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TemplateGallery from '../components/TemplateGallery'

describe('Template gallery', () => {
  it('opens on search and combines category and keyword filters', () => {
    render(<TemplateGallery isOpen onClose={vi.fn()} onSelect={vi.fn()} />)
    const search = screen.getByRole('searchbox', { name: 'Search diagram templates' })
    expect(search).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Use The dream observatory template' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Architecture' }))
    expect(screen.queryByRole('button', { name: 'Use The dream observatory template' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use A grounded AI assistant template' })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'grounded' } })
    expect(screen.getByText('1 starting point')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use A small cloud with room to grow template' })).not.toBeInTheDocument()
  })

  it('recovers from an empty search and selects the actual editable template', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TemplateGallery isOpen onClose={onClose} onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-template-could-match-this' } })
    expect(screen.getByText('No match in this constellation.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all templates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use The dream observatory template' }))
    const template = onSelect.mock.calls[0][0]
    expect(template.id).toBe('dream-observatory')
    expect(template.nodes.length).toBeGreaterThan(0)
    expect(template.edges.length).toBeGreaterThan(0)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps keyboard focus inside the dialog and restores the opener when closed', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<TemplateGallery isOpen onClose={onClose} onSelect={vi.fn()} />)
    const close = screen.getByRole('button', { name: 'Close template gallery' })
    const lastTemplate = screen.getByRole('button', { name: 'Favorite Choose a tiny adventure template' })
    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(lastTemplate).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    view.rerender(<TemplateGallery isOpen={false} onClose={onClose} onSelect={vi.fn()} />)
    expect(opener).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    opener.remove()
  })
})
