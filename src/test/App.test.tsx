import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../App'

describe('FlowChart Designer', () => {
  it('renders the app with toolbar', () => {
    render(<App />)
    expect(screen.getByLabelText('Selection Tool')).toBeInTheDocument()
  })

  it('has a toolbar with add node buttons', () => {
    render(<App />)
    expect(screen.getByLabelText('Add Step Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Decision Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Note')).toBeInTheDocument()
  })

  it('has clear and preview buttons', () => {
    render(<App />)
    expect(screen.getByLabelText('Clear All')).toBeInTheDocument()
    expect(screen.getByLabelText('Enter Preview Mode')).toBeInTheDocument()
  })

  it('renders the starter node', () => {
    render(<App />)
    expect(screen.getByText('Start')).toBeInTheDocument()
  })

  it('can add a new step node', () => {
    render(<App />)
    const addStepButton = screen.getByLabelText('Add Step Node')
    fireEvent.click(addStepButton)

    // After adding, we should have the original "Start" and a new "Step"
    const stepNodes = screen.getAllByText(/Step|Start/)
    expect(stepNodes.length).toBeGreaterThan(1)
  })

  it('can add a new decision node', () => {
    render(<App />)
    const addDecisionButton = screen.getByLabelText('Add Decision Node')
    fireEvent.click(addDecisionButton)

    expect(screen.getByText('Decision?')).toBeInTheDocument()
  })

  it('can add a new note node', () => {
    render(<App />)
    const addNoteButton = screen.getByLabelText('Add Note')
    fireEvent.click(addNoteButton)

    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('can enter preview mode', () => {
    render(<App />)
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(previewButton)

    expect(screen.getByText('Presentation Mode')).toBeInTheDocument()
    expect(screen.getByText(/Exit/i)).toBeInTheDocument()
  })

  it('shows navigation buttons in preview mode', () => {
    render(<App />)
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(previewButton)

    expect(screen.getByText(/Previous/i)).toBeInTheDocument()
    expect(screen.getByText(/Next/i)).toBeInTheDocument()
  })

  it('can exit preview mode', () => {
    render(<App />)

    // Enter preview mode
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(previewButton)
    expect(screen.getByText('Presentation Mode')).toBeInTheDocument()

    // Exit preview mode
    const exitButton = screen.getByText(/Exit/i)
    fireEvent.click(exitButton)
    expect(screen.queryByText('Presentation Mode')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Selection Tool')).toBeInTheDocument()
  })

  it('shows confirmation modal when clicking Clear All and can cancel', () => {
    render(<App />)

    // Verify the starter node exists
    expect(screen.getByText('Start')).toBeInTheDocument()

    // Click Clear All button
    const clearAllButton = screen.getByLabelText('Clear All')
    fireEvent.click(clearAllButton)

    // Modal should appear
    expect(screen.getByText('Clear the entire board?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()

    // Click Cancel
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)

    // Modal should close and starter node should still exist
    expect(screen.queryByText('Clear the entire board?')).not.toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument()
  })

  it('clears the board when confirming Clear All', () => {
    render(<App />)

    // Verify the starter node exists
    expect(screen.getByText('Start')).toBeInTheDocument()

    // Click Clear All button
    const clearAllButton = screen.getByLabelText('Clear All')
    fireEvent.click(clearAllButton)

    // Modal should appear
    expect(screen.getByText('Clear the entire board?')).toBeInTheDocument()

    // Click Clear board
    const confirmButton = screen.getByText('Clear board')
    fireEvent.click(confirmButton)

    // Modal should close and starter node should be removed
    expect(screen.queryByText('Clear the entire board?')).not.toBeInTheDocument()
    expect(screen.queryByText('Start')).not.toBeInTheDocument()
  })
})
