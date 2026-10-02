import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImagePicker from '../components/ImagePicker'
import { getIconUrl } from '../utils/azureIconIds'
import type { UploadedImage } from '../utils/imageUpload'

const upload = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('../utils/imageUpload', async (original) => ({ ...await original<typeof import('../utils/imageUpload')>(), prepareImageUpload: upload.prepare }))
const file = new File(['image bytes'], 'same-photo.png', { type: 'image/png' })
function deferred() {
  let resolve!: (image: UploadedImage) => void
  const promise = new Promise<UploadedImage>((done) => { resolve = done })
  return { promise, resolve }
}
function open() {
  const props = { isOpen: true, onClose: vi.fn(), onSelectImage: vi.fn() }
  const view = render(<ImagePicker {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Upload', exact: true }))
  return { ...view, props }
}
function choose() { fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } }) }
beforeEach(() => upload.prepare.mockReset())
afterEach(() => vi.restoreAllMocks())

describe('Image picker asynchronous uploads', () => {
  it('keeps the newer upload when an older read completes late', async () => {
    const older = deferred(), newer = deferred()
    upload.prepare.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const { props } = open()
    choose()
    const oldSignal = upload.prepare.mock.calls[0][1] as AbortSignal
    expect(screen.getByRole('status')).toHaveTextContent('Opening your image')
    choose()
    expect(oldSignal.aborted).toBe(true)
    await act(async () => newer.resolve({ imageUrl: 'data:image/png;base64,bmV3', label: 'Newer artwork' }))
    await act(async () => older.resolve({ imageUrl: 'data:image/png;base64,b2xk', label: 'Older artwork' }))
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Newer artwork')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Flowchart' }))
    expect(props.onSelectImage).toHaveBeenCalledWith('data:image/png;base64,bmV3', 'Newer artwork')
  })

  it('preserves a library selection after abandoning a pending upload', async () => {
    const pending = deferred()
    upload.prepare.mockReturnValue(pending.promise)
    const { props } = open()
    choose()
    const signal = upload.prepare.mock.calls[0][1] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Icon library' }))
    expect(signal.aborted).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search icon library' }), { target: { value: 'moon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Moon', exact: true }))
    await act(async () => pending.resolve({ imageUrl: 'data:image/png;base64,b2xk', label: 'Abandoned upload' }))
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Moon')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Flowchart' }))
    expect(props.onSelectImage).toHaveBeenCalledWith(getIconUrl('icon-moon'), 'Moon')
  })

  it('cancels pending uploads on Close and unmount without reopening a preview', async () => {
    const pending = deferred()
    upload.prepare.mockReturnValue(pending.promise)
    const view = open()
    choose()
    const signal = upload.prepare.mock.calls[0][1] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    expect(signal.aborted).toBe(true)
    view.rerender(<ImagePicker {...view.props} isOpen={false} />)
    await act(async () => pending.resolve({ imageUrl: 'data:image/png;base64,b2xk', label: 'Late upload' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(view.props.onSelectImage).not.toHaveBeenCalled()
    view.rerender(<ImagePicker {...view.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Upload', exact: true }))
    choose()
    const nextSignal = upload.prepare.mock.calls[1][1] as AbortSignal
    view.unmount()
    expect(nextSignal.aborted).toBe(true)
  })

  it('shows a read error and allows retrying the same file without enabling an invalid preview', async () => {
    upload.prepare.mockRejectedValueOnce(new Error('This file could not be read. Choose it again.'))
      .mockResolvedValueOnce({ imageUrl: 'data:image/png;base64,bmV3', label: 'Retried photo', notice: 'This image is too large for sharing and automatic draft recovery. Export JSON to keep a copy.' })
    open()
    await act(async () => choose())
    expect(screen.getByRole('alert')).toHaveTextContent('could not be read')
    expect(screen.queryByRole('button', { name: 'Add to Flowchart' })).not.toBeInTheDocument()
    await act(async () => choose())
    expect(upload.prepare).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Retried photo')
    expect(screen.getByRole('note')).toHaveTextContent('too large for sharing')
    expect(screen.getByRole('button', { name: 'Add to Flowchart' })).not.toBeDisabled()
  })
})
