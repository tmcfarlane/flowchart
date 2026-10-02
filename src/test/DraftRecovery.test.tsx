import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { LOCAL_DRAFT_KEY } from '../hooks/useLocalDraft'

const backup = {
  version: 1, savedAt: 1790917171000, diagramMode: 'architecture',
  flow: { nodes: [{ id: 'saved-service', type: 'service', label: 'Recovered gateway', position: { x: 120, y: 160 }, icon: 'icon-cloud' }], edges: [] },
}
beforeEach(() => { window.history.replaceState({}, '', '/'); localStorage.clear(); localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(backup)) })
afterEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('Reviewing a saved browser draft', () => {
  it('keeps the saved draft until review is applied and rehydrates editable node labels', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved draft' }))
    expect(document.querySelector('.react-flow-wrapper .react-flow__node')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Preview saved draft' })).toBeInTheDocument()
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore saved draft' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Preview saved draft' })).not.toBeInTheDocument())
    expect(screen.getByText('Recovered gateway')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Architecture Mode' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.doubleClick(screen.getByText('Recovered gateway'))
    // React Flow awaits browser measurements; JSDOM keeps its node wrapper hidden.
    const label = screen.getByRole('textbox', { hidden: true })
    fireEvent.change(label, { target: { value: 'Edited restored gateway' } })
    fireEvent.keyDown(label, { key: 'Enter' })
    expect(screen.getByText('Edited restored gateway')).toBeInTheDocument()
  })

  it('rejects a saved-draft apply after newer canvas changes, and Clear All purges the backup', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved draft' }))
    fireEvent.click(screen.getByLabelText('Add Note'))
    fireEvent.click(screen.getByRole('button', { name: 'Restore saved draft' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Your canvas changed')
    expect(screen.getByText('Note')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByLabelText('Clear All'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear board' }))
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview saved draft' })).not.toBeInTheDocument()
  })
})
