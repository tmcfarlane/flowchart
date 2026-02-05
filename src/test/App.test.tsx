import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

describe('AI Flowchart Assistant', () => {
  let fetchMock: any

  beforeEach(() => {
    // Mock global fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the AI floating pill button', () => {
    render(<App />)
    expect(screen.getByLabelText('Open AI Assistant')).toBeInTheDocument()
  })

  it('opens the AI bubble when clicking the floating pill', () => {
    render(<App />)
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)

    expect(screen.getByText('AI Flowchart Assistant')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Create a login flow/i)).toBeInTheDocument()
  })

  it('closes the AI bubble when clicking close button', () => {
    render(<App />)
    
    // Open bubble
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)
    expect(screen.getByText('AI Flowchart Assistant')).toBeInTheDocument()

    // Close bubble
    const closeButton = screen.getByLabelText('Close')
    fireEvent.click(closeButton)
    expect(screen.queryByText('AI Flowchart Assistant')).not.toBeInTheDocument()
  })

  it('shows preview dialog when AI returns a valid proposal', async () => {
    // Mock successful API response with flowchart JSON
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: `Here's a simple login flow:

\`\`\`json
{
  "summary": "Basic login flow with authentication",
  "nodes": [
    { "id": "1", "type": "step", "label": "Login Page", "position": { "x": 0, "y": 0 } },
    { "id": "2", "type": "decision", "label": "Valid?", "position": { "x": 0, "y": 100 } },
    { "id": "3", "type": "step", "label": "Dashboard", "position": { "x": 100, "y": 200 } }
  ],
  "edges": [
    { "id": "e1-2", "source": "1", "target": "2", "style": "animated" },
    { "id": "e2-3", "source": "2", "target": "3", "style": "default" }
  ]
}
\`\`\``,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Open AI bubble
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)

    // Type a prompt
    const input = screen.getByPlaceholderText(/Create a login flow/i)
    fireEvent.change(input, { target: { value: 'Create a login flow' } })

    // Click generate
    const generateButton = screen.getByText('Generate Flowchart')
    fireEvent.click(generateButton)

    // Wait for preview dialog to appear
    await waitFor(() => {
      expect(screen.getByText('Preview AI Proposal')).toBeInTheDocument()
    })

    // Check that the proposal summary is shown
    expect(screen.getByText('Basic login flow with authentication')).toBeInTheDocument()

    // Check that Insert and Cancel buttons are present
    expect(screen.getByText('Insert into Canvas')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('inserts nodes when clicking Insert button', async () => {
    // Mock successful API response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: `\`\`\`json
{
  "summary": "Test flow",
  "nodes": [
    { "id": "1", "type": "step", "label": "Test Node", "position": { "x": 0, "y": 0 } }
  ],
  "edges": []
}
\`\`\``,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Count initial nodes (should have "Start" node)
    expect(screen.getByText('Start')).toBeInTheDocument()

    // Open AI bubble and generate
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)
    const input = screen.getByPlaceholderText(/Create a login flow/i)
    fireEvent.change(input, { target: { value: 'Add a test node' } })
    const generateButton = screen.getByText('Generate Flowchart')
    fireEvent.click(generateButton)

    // Wait for preview dialog
    await waitFor(() => {
      expect(screen.getByText('Preview AI Proposal')).toBeInTheDocument()
    })

    // Click Insert
    const insertButton = screen.getByText('Insert into Canvas')
    fireEvent.click(insertButton)

    // Preview dialog should close
    await waitFor(() => {
      expect(screen.queryByText('Preview AI Proposal')).not.toBeInTheDocument()
    })

    // New node should be added to canvas
    expect(screen.getByText('Test Node')).toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument() // Original node still there
  })

  it('does not insert nodes when clicking Cancel button', async () => {
    // Mock successful API response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: `\`\`\`json
{
  "summary": "Test flow",
  "nodes": [
    { "id": "1", "type": "step", "label": "Should Not Appear", "position": { "x": 0, "y": 0 } }
  ],
  "edges": []
}
\`\`\``,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Open AI bubble and generate
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)
    const input = screen.getByPlaceholderText(/Create a login flow/i)
    fireEvent.change(input, { target: { value: 'Add a test node' } })
    const generateButton = screen.getByText('Generate Flowchart')
    fireEvent.click(generateButton)

    // Wait for preview dialog
    await waitFor(() => {
      expect(screen.getByText('Preview AI Proposal')).toBeInTheDocument()
    })

    // Click Cancel
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)

    // Preview dialog should close
    await waitFor(() => {
      expect(screen.queryByText('Preview AI Proposal')).not.toBeInTheDocument()
    })

    // New node should NOT be added
    expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument()
    expect(screen.getByText('Start')).toBeInTheDocument() // Original node still there
  })

  it('shows error message when AI response is invalid', async () => {
    // Mock API response without JSON
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Sorry, I cannot help with that.',
        role: 'assistant',
      }),
    })

    render(<App />)

    // Open AI bubble and generate
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)
    const input = screen.getByPlaceholderText(/Create a login flow/i)
    fireEvent.change(input, { target: { value: 'Invalid request' } })
    const generateButton = screen.getByText('Generate Flowchart')
    fireEvent.click(generateButton)

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText(/could not parse ai response/i)).toBeInTheDocument()
    })

    // Preview dialog should NOT appear
    expect(screen.queryByText('Preview AI Proposal')).not.toBeInTheDocument()
  })

  it('sends flow context to API', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: `\`\`\`json
{
  "summary": "Test",
  "nodes": [{ "id": "1", "type": "step", "label": "Test", "position": { "x": 0, "y": 0 } }],
  "edges": []
}
\`\`\``,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Open AI bubble and generate
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)
    const input = screen.getByPlaceholderText(/Create a login flow/i)
    fireEvent.change(input, { target: { value: 'Add something' } })
    const generateButton = screen.getByText('Generate Flowchart')
    fireEvent.click(generateButton)

    // Wait for API call
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('flowContext'),
        })
      )
    })

    // Verify flowContext includes the starter node
    const callArgs = fetchMock.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.flowContext).toBeDefined()
    expect(body.flowContext.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Start' })
      ])
    )
  })
})
