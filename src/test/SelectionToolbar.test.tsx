import { seedReturningVisitor } from './helpers/returningVisitor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { serializeFlow } from '../utils/exportUtils'

vi.mock('../components/DrawCanvas', async () => import('./mocks/DrawCanvas'))

beforeEach(() => seedReturningVisitor())

describe('Selection toolbar', () => {
  it('hides a graph selection carried into Draw, which has its own selection', () => {
    localStorage.setItem('flowchart-editor-draft-v3', serializeFlow([{ id: 'a', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Step' }, selected: true }], [], 'flowchart'))
    render(<App />)
    expect(screen.getByLabelText('Delete selected items')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Draw/ }))
    expect(screen.queryByLabelText('Delete selected items')).not.toBeInTheDocument()
  })
})
