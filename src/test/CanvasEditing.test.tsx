import { seedReturningVisitor } from './helpers/returningVisitor'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { serializeFlow } from '../utils/exportUtils'

beforeEach(() => seedReturningVisitor())

const seed = (label = 'Step') => localStorage.setItem('flowchart-editor-draft-v3', serializeFlow([{ id: 'a', type: 'step', position: { x: 0, y: 0 }, data: { label } }], [], 'flowchart'))
const startEditing = (label: string) => {
  fireEvent.doubleClick(screen.getByText(label))
  return screen.getByDisplayValue(label) as HTMLTextAreaElement
}

describe('Card label editing', () => {
  it('commits on Enter', () => {
    seed()
    render(<App />)
    const editor = startEditing('Step')
    fireEvent.change(editor, { target: { value: 'Renamed' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(screen.queryByDisplayValue('Renamed')).not.toBeInTheDocument()
    expect(screen.getByText('Renamed')).toBeInTheDocument()
  })

  it('keeps editing on Shift+Enter and while an IME is composing, and shows line breaks', () => {
    seed()
    render(<App />)
    const editor = startEditing('Step')
    // Shift+Enter is left to the textarea's default newline insertion
    expect(fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })).toBe(true)
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(editor).toBeInTheDocument()
    fireEvent.change(editor, { target: { value: 'First line\nSecond line' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(screen.getByText((_, element) => element?.classList.contains('node-label') === true && element.textContent === 'First line\nSecond line')).toBeInTheDocument()
  })
})

describe('Canvas zoom', () => {
  const zoomOf = (container: HTMLElement) => Number(/scale\(([\d.]+)\)/.exec((container.querySelector('.react-flow__viewport') as HTMLElement).style.transform)?.[1])

  it.each([['Cmd', { metaKey: true }], ['Ctrl', { ctrlKey: true }]])('%s + scroll zooms the graph canvas', async (_, modifier) => {
    seed()
    const { container } = render(<App />)
    const pane = container.querySelector('.react-flow__pane')!
    const before = zoomOf(container)
    fireEvent.wheel(pane, { deltaY: -200, ...modifier })
    await waitFor(() => expect(zoomOf(container)).toBeGreaterThan(before))
    const zoomedIn = zoomOf(container)
    fireEvent.wheel(pane, { deltaY: 400, ...modifier })
    await waitFor(() => expect(zoomOf(container)).toBeLessThan(zoomedIn))
  })

  it('does not zoom on a plain scroll', async () => {
    seed()
    const { container } = render(<App />)
    fireEvent.wheel(container.querySelector('.react-flow__pane')!, { deltaY: -200 })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(zoomOf(container)).toBe(1)
  })
})
