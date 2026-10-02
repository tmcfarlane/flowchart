import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

const identitySession = { ok: true, json: async () => ({ available: false, authenticated: false, planUsageAvailable: false }) }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/openai/session') return identitySession
    throw new Error(`Unexpected test request: ${url}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('FlowChart Designer', () => {
  it('renders the app with toolbar', async () => {
    await act(async () => { render(<App />) })
    expect(screen.getByLabelText('Selection Tool')).toBeInTheDocument()
  })

  it('has a toolbar with add node buttons', async () => {
    await act(async () => { render(<App />) })
    expect(screen.getByLabelText('Add Step Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Decision Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Note')).toBeInTheDocument()
  })

  it('has clear and preview buttons', async () => {
    await act(async () => { render(<App />) })
    expect(screen.getByLabelText('Clear All')).toBeInTheDocument()
    expect(screen.getByLabelText('Enter Preview Mode')).toBeInTheDocument()
  })

  it('shows the welcome AI prompt on an empty canvas', async () => {
    await act(async () => { render(<App />) })
    expect(screen.getByText("From a spark to a whole system.")).toBeInTheDocument()
  })

  it('can add a new step node', async () => {
    await act(async () => { render(<App />) })
    const addStepButton = screen.getByLabelText('Add Step Node')
    fireEvent.click(addStepButton)

    expect(screen.getByText('Step')).toBeInTheDocument()
  })

  it('can add a new decision node', async () => {
    await act(async () => { render(<App />) })
    const addDecisionButton = screen.getByLabelText('Add Decision Node')
    fireEvent.click(addDecisionButton)

    expect(screen.getByText('Decision?')).toBeInTheDocument()
  })

  it('can add a new note node', async () => {
    await act(async () => { render(<App />) })
    const addNoteButton = screen.getByLabelText('Add Note')
    fireEvent.click(addNoteButton)

    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('can enter preview mode', async () => {
    await act(async () => { render(<App />) })
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(previewButton)

    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText('✕')).toBeInTheDocument()
  })

  it('shows navigation buttons in preview mode', async () => {
    await act(async () => { render(<App />) })
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(previewButton)

    expect(screen.getByText('←')).toBeInTheDocument()
    expect(screen.getByText('→')).toBeInTheDocument()
  })

  it('can exit preview mode', async () => {
    await act(async () => { render(<App />) })

    // Enter preview mode
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    fireEvent.click(previewButton)
    expect(screen.getByText('1 / 1')).toBeInTheDocument()

    // Exit preview mode
    const exitButton = screen.getByText('✕')
    await act(async () => { fireEvent.click(exitButton) })
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Selection Tool')).toBeInTheDocument()
  })

  it('shows confirmation modal when clicking Clear All and can cancel', async () => {
    await act(async () => { render(<App />) })

    fireEvent.click(screen.getByLabelText('Add Step Node'))
    expect(screen.getByText('Step')).toBeInTheDocument()

    // Click Clear All button
    const clearAllButton = screen.getByLabelText('Clear All')
    fireEvent.click(clearAllButton)

    // Modal should appear
    expect(screen.getByText('Clear the entire board?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()

    // Click Cancel
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)

    // Modal should close and node should still exist
    expect(screen.queryByText('Clear the entire board?')).not.toBeInTheDocument()
    expect(screen.getByText('Step')).toBeInTheDocument()
  })

  it('clears the board when confirming Clear All', async () => {
    await act(async () => { render(<App />) })

    fireEvent.click(screen.getByLabelText('Add Step Node'))
    expect(screen.getByText('Step')).toBeInTheDocument()

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
    expect(screen.queryByText('Step')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Undo')).toBeDisabled()
    expect(screen.getByLabelText('Redo')).toBeDisabled()
  })
})

describe('AI Flowchart Assistant', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let chatMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    chatMock = vi.fn()
    fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/auth/openai/session') return Promise.resolve(identitySession)
      if (url === '/api/chat') return chatMock(url, options)
      throw new Error(`Unexpected test request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows welcome prompt first, then the AI floating pill after dismiss', async () => {
    await act(async () => { render(<App />) })
    expect(screen.getByText("From a spark to a whole system.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Open AI Assistant')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Start with a blank canvas'))
    expect(screen.getByLabelText('Open AI Assistant')).toBeInTheDocument()
  })

  it('opens the AI bubble when clicking the floating pill', async () => {
    await act(async () => { render(<App />) })
    fireEvent.click(screen.getByText('Start with a blank canvas'))
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)

    expect(screen.getByText("Diagram copilot")).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/An idea, a process, a world/i)).toBeInTheDocument()
  })

  it('closes the AI bubble when clicking close button', async () => {
    await act(async () => { render(<App />) })
    
    // Open bubble
    fireEvent.click(screen.getByText('Start with a blank canvas'))
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)
    expect(screen.getByText("Diagram copilot")).toBeInTheDocument()

    // Close bubble
    const closeButton = screen.getByLabelText('Close')
    fireEvent.click(closeButton)
    expect(screen.queryByText("Diagram copilot")).not.toBeInTheDocument()
  })

  it('shows preview dialog when AI returns a valid proposal', async () => {
    // Mock successful API response with flowchart JSON
    chatMock.mockResolvedValueOnce({
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

    await act(async () => { render(<App />) })

    // Type a prompt
    const input = screen.getByPlaceholderText(/An idea, a process, a world/i)
    fireEvent.change(input, { target: { value: 'Create a login flow' } })

    // Click generate
    const generateButton = screen.getByText('Generate Flowchart')
    fireEvent.click(generateButton)

    // Wait for preview dialog to appear
    await waitFor(() => {
      expect(screen.getByText('Preview AI Proposal')).toBeInTheDocument()
    })

    // Check that the proposal summary is shown
    expect(screen.getAllByText('Basic login flow with authentication').length).toBeGreaterThan(0)

    // Check that Insert and Cancel buttons are present
    expect(screen.getByText('Insert into Canvas')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('inserts nodes when clicking Insert button', async () => {
    // Mock successful API response
    chatMock.mockResolvedValueOnce({
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

    await act(async () => { render(<App />) })

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/An idea, a process, a world/i)
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
  })

  it('does not insert nodes when clicking Cancel button', async () => {
    // Mock successful API response
    chatMock.mockResolvedValueOnce({
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

    await act(async () => { render(<App />) })

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/An idea, a process, a world/i)
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
  })

  it('shows error message when AI response is invalid', async () => {
    // Mock API response without JSON
    chatMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Sorry, I cannot help with that.',
        role: 'assistant',
      }),
    })

    await act(async () => { render(<App />) })

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/An idea, a process, a world/i)
    fireEvent.change(input, { target: { value: 'Invalid request' } })
    const generateButton = screen.getByText('Generate Flowchart')
    fireEvent.click(generateButton)

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText(/unreadable diagram/i)).toBeInTheDocument()
    })

    // Preview dialog should NOT appear
    expect(screen.queryByText('Preview AI Proposal')).not.toBeInTheDocument()
  })

  it('sends flow context to API', async () => {
    chatMock.mockResolvedValueOnce({
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

    await act(async () => { render(<App />) })

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/An idea, a process, a world/i)
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

    // Verify flowContext exists (empty canvas)
    const callArgs = fetchMock.mock.calls.find(([url]) => url === '/api/chat')
    expect(callArgs).toBeDefined()
    const body = JSON.parse(callArgs![1]!.body as string)
    expect(body.flowContext).toBeDefined()
    expect(body.flowContext.nodes).toEqual([])
    expect(body.flowContext.edges).toEqual([])
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/openai/session')).toHaveLength(1)
  })
})
