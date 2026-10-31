import { seedReturningVisitor } from './helpers/returningVisitor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'

vi.mock('../components/DrawCanvas', async () => import('./mocks/DrawCanvas'))

beforeEach(() => seedReturningVisitor())

describe('Mode transitions', () => {
  it('animates only after a mode switch, not on first load', async () => {
    const { container } = render(<App />)
    const app = container.querySelector('.app')!
    expect(app).not.toHaveClass('mode-transition')
    fireEvent.click(screen.getByRole('button', { name: /Architecture/ }))
    expect(app).toHaveClass('mode-transition')
    await waitFor(() => expect(app).not.toHaveClass('mode-transition'), { timeout: 1000 })
  })
})
