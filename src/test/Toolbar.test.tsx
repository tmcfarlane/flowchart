import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Toolbar from '../components/Toolbar'

function renderToolbar() {
  const onClearAll = vi.fn()
  const onToggleDarkMode = vi.fn()
  const wrapper = createRef<HTMLDivElement>()
  render(<>
    <div ref={wrapper} />
    <Toolbar onAddNode={vi.fn()} onAddContainer={vi.fn()} onAddImage={vi.fn()}
      onTogglePreview={vi.fn()} onToggleExplorer={vi.fn()} sidebarMode="none"
      onUndo={vi.fn()} onRedo={vi.fn()} canUndo canRedo onClearAll={onClearAll}
      toolMode="select" onSetToolMode={vi.fn()} darkMode={false} onToggleDarkMode={onToggleDarkMode}
      diagramMode="flowchart" onSetDiagramMode={vi.fn()} reactFlowWrapper={wrapper}
      nodes={[]} edges={[]} onImportJson={vi.fn()}
      share={{ isShared: false, canEdit: true, creating: false, onCreate: vi.fn() }} />
    <button>Outside toolbar</button>
  </>)
  return { more: screen.getByRole('button', { name: 'More actions' }), onClearAll, onToggleDarkMode }
}

describe('toolbar disclosures', () => {
  it('closes actions on Escape and restores focus to its trigger', () => {
    const { more } = renderToolbar()
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    fireEvent.change(screen.getByLabelText('GIF duration in seconds'), { target: { value: '4' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveFocus()
    expect(screen.queryByLabelText('GIF duration in seconds')).not.toBeInTheDocument()
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    expect(screen.getByLabelText('GIF duration in seconds')).toHaveValue(4)
  })

  it('dismisses actions outside and when Share opens', () => {
    const { more } = renderToolbar()
    fireEvent.click(more)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside toolbar' }))
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Share', exact: true }))
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog', { name: 'Share flowchart' })).toBeInTheDocument()
  })

  it('keeps the existing clear confirmation before changing the document', () => {
    const { more, onClearAll } = renderToolbar()
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Clear All', exact: true }))
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(onClearAll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear board', exact: true }))
    expect(onClearAll).toHaveBeenCalledOnce()
  })
})
