import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../App'

describe('FlowChart Designer', () => {
  it('renders the app with toolbar', () => {
    render(<App />)
    expect(screen.getByText('FlowChart Designer')).toBeInTheDocument()
  })

  it('has a toolbar with add node buttons', () => {
    render(<App />)
    expect(screen.getByLabelText('Add Step Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Decision Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Note')).toBeInTheDocument()
  })

  it('has clear and preview buttons', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview/i })).toBeInTheDocument()
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
    
    // Look for the note node in the flow (not the button)
    const noteNodes = screen.getAllByText('Note')
    expect(noteNodes.length).toBeGreaterThan(1) // Button + added node
  })

  it('can enter preview mode', () => {
    render(<App />)
    const previewButton = screen.getByText(/Preview/i)
    fireEvent.click(previewButton)
    
    expect(screen.getByText('Presentation Mode')).toBeInTheDocument()
    expect(screen.getByText(/Exit/i)).toBeInTheDocument()
  })

  it('shows navigation buttons in preview mode', () => {
    render(<App />)
    const previewButton = screen.getByText(/Preview/i)
    fireEvent.click(previewButton)
    
    expect(screen.getByText(/Previous/i)).toBeInTheDocument()
    expect(screen.getByText(/Next/i)).toBeInTheDocument()
  })

  it('can exit preview mode', () => {
    render(<App />)
    
    // Enter preview mode
    const previewButton = screen.getByText(/Preview/i)
    fireEvent.click(previewButton)
    expect(screen.getByText('Presentation Mode')).toBeInTheDocument()
    
    // Exit preview mode
    const exitButton = screen.getByText(/Exit/i)
    fireEvent.click(exitButton)
    expect(screen.queryByText('Presentation Mode')).not.toBeInTheDocument()
    expect(screen.getByText('FlowChart Designer')).toBeInTheDocument()
  })
})
