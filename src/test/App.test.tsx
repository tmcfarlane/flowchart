import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'
import { resolveAzureIcons } from '../utils/azureIconRegistry'

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

  it('shows the welcome AI prompt on an empty canvas', () => {
    render(<App />)
    expect(screen.getByText("What's your flow?")).toBeInTheDocument()
  })

  it('can add a new step node', () => {
    render(<App />)
    const addStepButton = screen.getByLabelText('Add Step Node')
    fireEvent.click(addStepButton)

    expect(screen.getByText('Step')).toBeInTheDocument()
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
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(previewButton)

    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText('✕')).toBeInTheDocument()
  })

  it('shows navigation buttons in preview mode', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(previewButton)

    expect(screen.getByText('←')).toBeInTheDocument()
    expect(screen.getByText('→')).toBeInTheDocument()
  })

  it('can exit preview mode', () => {
    render(<App />)

    // Enter preview mode
    const previewButton = screen.getByLabelText('Enter Preview Mode')
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    fireEvent.click(previewButton)
    expect(screen.getByText('1 / 1')).toBeInTheDocument()

    // Exit preview mode
    const exitButton = screen.getByText('✕')
    fireEvent.click(exitButton)
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Selection Tool')).toBeInTheDocument()
  })

  it('shows confirmation modal when clicking Clear All and can cancel', () => {
    render(<App />)

    fireEvent.click(screen.getByLabelText('Add Step Node'))
    expect(screen.getByText('Step')).toBeInTheDocument()

    // Click Clear All button
    const clearAllButton = screen.getByLabelText('Clear All')
    fireEvent.click(clearAllButton)

    // Modal should appear
    expect(screen.getByText('Clear the entire board?')).toBeInTheDocument()
    expect(screen.getByText('You can undo this change.')).toBeInTheDocument()

    // Click Cancel
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)

    // Modal should close and node should still exist
    expect(screen.queryByText('Clear the entire board?')).not.toBeInTheDocument()
    expect(screen.getByText('Step')).toBeInTheDocument()
  })

  it('clears the board when confirming Clear All', () => {
    render(<App />)

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
  })

  it('restores the complete graph after undoing Clear All', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    fireEvent.click(screen.getByLabelText('Clear All'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear board', exact: true }))
    expect(screen.queryByText('Step')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Undo'))
    expect(screen.getByText('Step')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Redo'))
    expect(screen.queryByText('Step')).not.toBeInTheDocument()
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

  it('shows welcome prompt first, then the AI floating pill after dismiss', () => {
    render(<App />)
    expect(screen.getByText("What's your flow?")).toBeInTheDocument()
    expect(screen.queryByLabelText('Open AI Assistant')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('No, thank you'))
    expect(screen.getByLabelText('Open AI Assistant')).toBeInTheDocument()
  })

  it('opens the AI bubble when clicking the floating pill', () => {
    render(<App />)
    fireEvent.click(screen.getByText('No, thank you'))
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)

    expect(screen.getByText("What's your flow?")).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Describe any process, workflow, or plan/i)).toBeInTheDocument()
  })

  it('closes the AI bubble when clicking close button', () => {
    render(<App />)
    
    // Open bubble
    fireEvent.click(screen.getByText('No, thank you'))
    const aiButton = screen.getByLabelText('Open AI Assistant')
    fireEvent.click(aiButton)
    expect(screen.getByText("What's your flow?")).toBeInTheDocument()

    // Close bubble
    const closeButton = screen.getByLabelText('Close')
    fireEvent.click(closeButton)
    expect(screen.queryByText("What's your flow?")).not.toBeInTheDocument()
  })

  it('shows preview dialog when AI returns a valid proposal', async () => {
    // Mock successful API response with flowchart JSON
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: `{
  "outputMode": "flowchart",
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
}`,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Type a prompt
    const input = screen.getByPlaceholderText(/Describe any process, workflow, or plan/i)
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: `{
  "outputMode": "flowchart",
  "summary": "Test flow",
  "nodes": [
    { "id": "1", "type": "step", "label": "Test Node", "position": { "x": 0, "y": 0 } }
  ],
  "edges": []
}`,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/Describe any process, workflow, or plan/i)
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: `{
  "outputMode": "flowchart",
  "summary": "Test flow",
  "nodes": [
    { "id": "1", "type": "step", "label": "Should Not Appear", "position": { "x": 0, "y": 0 } }
  ],
  "edges": []
}`,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/Describe any process, workflow, or plan/i)
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Sorry, I cannot help with that.',
        role: 'assistant',
      }),
    })

    render(<App />)

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/Describe any process, workflow, or plan/i)
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
        message: `{
  "outputMode": "flowchart",
  "summary": "Test",
  "nodes": [{ "id": "1", "type": "step", "label": "Test", "position": { "x": 0, "y": 0 } }],
  "edges": []
}`,
        role: 'assistant',
      }),
    })

    render(<App />)

    // Generate via welcome prompt
    const input = screen.getByPlaceholderText(/Describe any process, workflow, or plan/i)
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
    const callArgs = fetchMock.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.flowContext).toBeDefined()
    expect(body.flowContext.nodes).toEqual([])
    expect(body.flowContext.edges).toEqual([])
  })

  it('sends architecture metadata for refinement and displays rate-limit feedback', async () => {
    const proposal = {
      outputMode: 'architecture',
      summary: 'Order system',
      nodes: [
        { id: 'api', type: 'service', label: 'Order API', position: { x: 0, y: 0 } },
        { id: 'db', type: 'database', label: 'Orders', position: { x: 0, y: 150 } },
      ],
      edges: [{ id: 'write', source: 'api', target: 'db', label: 'Save', protocol: 'SQL', commStyle: 'async' }],
    }
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ message: JSON.stringify(proposal), role: 'assistant' }) })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'AI has reached its daily usage limit. Please try again tomorrow.' }) })
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.change(screen.getByPlaceholderText(/Describe your services/i), { target: { value: 'Draw an order system' } })
    fireEvent.click(screen.getByText('Generate architecture diagram'))
    await screen.findByText('Preview AI Proposal')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).diagramMode).toBe('architecture')
    fireEvent.change(screen.getByPlaceholderText(/Describe how to refine/i), { target: { value: 'Add a retry' } })
    fireEvent.click(screen.getByText('Regenerate'))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI has reached its daily usage limit')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const refinement = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(refinement).toMatchObject({ mode: 'refine', diagramMode: 'architecture', flowContext: { edges: [expect.objectContaining({ protocol: 'SQL', commStyle: 'async' })] } })
    expect(screen.getByText('Insert into Canvas')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Insert into Canvas'))
    expect(screen.getByText('Order API')).toBeInTheDocument()
    expect(screen.getByText('Orders')).toBeInTheDocument()
  })

})


describe('Architecture AI icons', () => {
  it('adds local icons without replacing semantic types or container boundaries', () => {
    const proposal = resolveAzureIcons({
      summary: 'Azure services',
      nodes: [
        { id: 'boundary', type: 'container', label: 'Azure Cosmos DB', containerKind: 'vpc', position: { x: 0, y: 0 } },
        { id: 'db', type: 'database', label: 'Azure Cosmos DB', parentNode: 'boundary', position: { x: 40, y: 50 } },
      ],
      edges: [],
    })
    expect(proposal.nodes[0]).toMatchObject({ type: 'container', containerKind: 'vpc' })
    expect(proposal.nodes[1]).toMatchObject({ type: 'database', parentNode: 'boundary', imageUrl: expect.any(String) })
    expect(proposal.nodes[1].width).toBeUndefined()
  })
})
