import { seedReturningVisitor } from './helpers/returningVisitor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { serializeFlow } from '../utils/exportUtils'

// jsdom has no canvas or createImageBitmap, so stub the re-encoding step
vi.mock('../utils/imagePaste', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/imagePaste')>()),
  imageFileToDataUrl: async () => 'data:image/png;base64,AAAA',
}))

beforeEach(() => seedReturningVisitor())

const imageClipboard = () => ({ files: [new File(['x'], 'shot.png', { type: 'image/png' })] })

describe('Canvas paste', () => {
  it('adds a pasted clipboard image as an image node', async () => {
    render(<App />)
    fireEvent.paste(document.body, { clipboardData: imageClipboard() })
    await waitFor(() => expect(screen.getByAltText('Image')).toHaveAttribute('src', 'data:image/png;base64,AAAA'))
  })

  it('pastes copied nodes when the clipboard has no image', () => {
    const selected = [{ id: 'a', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Step' }, selected: true }]
    localStorage.setItem('flowchart-editor-draft-v3', serializeFlow(selected, [], 'flowchart'))
    render(<App />)
    fireEvent.click(screen.getByLabelText('Copy selected items'))
    fireEvent.paste(document.body, { clipboardData: { files: [] } })
    expect(screen.getAllByText('Step')).toHaveLength(2)
  })

  it('ignores canvas paste while a modal dialog is open', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Clear All'))
    fireEvent.paste(document.body, { clipboardData: imageClipboard() })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByAltText('Image')).not.toBeInTheDocument()
  })

  it('renames an image node on double-click and shows resize handles when selected', () => {
    const image = [{ id: 'img', type: 'image', position: { x: 0, y: 0 }, data: { label: 'Image', imageUrl: 'data:image/png;base64,AAAA' }, style: { width: 140, height: 140 }, selected: true }]
    localStorage.setItem('flowchart-editor-draft-v3', serializeFlow(image, [], 'flowchart'))
    const { container } = render(<App />)
    expect(container.querySelector('.react-flow__node-image .node-resize-handle')).toBeInTheDocument()
    fireEvent.doubleClick(screen.getByAltText('Image'))
    const input = screen.getByLabelText('Image label')
    fireEvent.change(input, { target: { value: 'Architecture sketch' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('Architecture sketch')).toBeInTheDocument()
    expect(screen.getByAltText('Architecture sketch')).toBeInTheDocument()
  })
})
