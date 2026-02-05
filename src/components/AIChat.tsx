import { useState, useCallback, useEffect } from 'react'
import { Node, Edge } from 'reactflow'
import './AIChat.css'
import { BaseFlowNode, BaseFlowEdge, EdgeStyle } from '../App'

const LOADING_MESSAGES = [
  'Thinking about your flowchart...',
  'Analyzing the structure...',
  'Generating ideas...',
  'Working on it...',
  'Processing your request...',
  'Designing the flow...',
]

interface FlowProposal {
  summary?: string
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}

interface AIChatProps {
  nodes: Node[]
  edges: Edge[]
  onProposalReady: (proposal: FlowProposal) => void
  isOpen: boolean
  onClose: () => void
}

function AIChat({ nodes, edges, onProposalReady, isOpen, onClose }: AIChatProps) {
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [currentLoadingMessage, setCurrentLoadingMessage] = useState('')
  const [loadingProgress, setLoadingProgress] = useState(0)

  useEffect(() => {
    if (!isLoading) {
      setCurrentLoadingMessage('')
      setLoadingProgress(0)
      return
    }

    setCurrentLoadingMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)])
    setLoadingProgress(10)

    const messageInterval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * LOADING_MESSAGES.length)
      setCurrentLoadingMessage(LOADING_MESSAGES[randomIndex])
    }, 2000)

    const progressInterval = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 90) return prev
        return prev + Math.random() * 15
      })
    }, 500)

    return () => {
      clearInterval(messageInterval)
      clearInterval(progressInterval)
    }
  }, [isLoading])

  // Parse flow proposal from assistant message
  // With structured outputs, the API returns raw JSON directly (no code block wrapper)
  const parseFlowProposal = (content: string, finishReason?: string): FlowProposal | null => {
    // Check for truncation due to token limit
    if (finishReason === 'length') {
      console.error('Response was truncated due to token limit')
      return null
    }

    let parsed: unknown = null

    // Try direct JSON parse first (structured outputs return raw JSON)
    try {
      parsed = JSON.parse(content)
    } catch {
      // Fall back to code block extraction for backward compatibility
      try {
        let jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/)
        if (!jsonMatch) {
          jsonMatch = content.match(/```\s*\n([\s\S]*?)\n```/)
        }
        
        if (jsonMatch) {
          const jsonStr = jsonMatch[1].trim()
          parsed = JSON.parse(jsonStr)
        }
      } catch (e) {
        console.error('Failed to parse JSON from code block:', e)
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      console.error('Could not parse response as JSON:', content)
      return null
    }

    const proposal = parsed as Record<string, unknown>

    // Validate the structure - nodes and edges are required
    if (!proposal.nodes || !Array.isArray(proposal.nodes)) {
      console.error('Invalid proposal: missing or invalid nodes array', proposal)
      return null
    }
    
    if (!proposal.edges || !Array.isArray(proposal.edges)) {
      console.error('Invalid proposal: missing or invalid edges array', proposal)
      return null
    }

    // Validate each node has required fields
    for (const node of proposal.nodes) {
      if (!node.id || !node.type || !node.label || !node.position) {
        console.error('Invalid node structure:', node)
        return null
      }
    }

    return {
      summary: (proposal.summary as string) || (proposal.explanation as string) || 'Flowchart proposal',
      nodes: proposal.nodes as BaseFlowNode[],
      edges: proposal.edges as BaseFlowEdge[],
    }
  }

  const getEdgeStyleFromEdge = useCallback((edge: Edge): EdgeStyle => {
    if (edge.animated) return 'animated'
    if (edge.type === 'step') return 'step'
    return 'default'
  }, [])

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return

    const userPrompt = inputValue.trim()
    setInputValue('')
    setIsLoading(true)
    setError(null)

    try {
      // Build context about the current flowchart
      const flowContext = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.data.label,
          position: n.position,
          width: typeof n.style?.width === 'number' ? n.style.width : undefined,
          height: typeof n.style?.height === 'number' ? n.style.height : undefined,
          imageUrl: typeof n.data.imageUrl === 'string' ? n.data.imageUrl : undefined,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          style: getEdgeStyleFromEdge(e),
          sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
          targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : undefined,
        })),
      }

      // Call our serverless function proxy at /api/chat
      // The API uses structured outputs to guarantee valid JSON matching our schema
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: userPrompt }],
          flowContext,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          errorData.error || `API request failed with status ${response.status}`
        )
      }

      const data = await response.json()
      const content = data.message || 'No response received.'
      const finishReason = data.finishReason as string | undefined

      console.log('AI Response:', content, 'Finish reason:', finishReason)

      // Parse the flow proposal (with structured outputs, this should always succeed)
      const proposal = parseFlowProposal(content, finishReason)

      if (!proposal) {
        // Handle specific error cases
        if (finishReason === 'length') {
          throw new Error('The AI response was cut off due to length limits. Try a simpler request.')
        }
        throw new Error('Could not parse AI response. Please try again or rephrase your request.')
      }

      // Notify parent with the proposal
      onProposalReady(proposal)
      
      // Close the bubble after successful proposal
      onClose()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('AI Chat error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [inputValue, isLoading, nodes, edges, getEdgeStyleFromEdge, onProposalReady, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Handle ESC key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="ai-bubble-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-bubble-title"
    >
      <div className="ai-bubble-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="ai-bubble-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '8px' }}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" opacity="0.3"/>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 7h2v6h-2zM11 15h2v2h-2z" fill="currentColor"/>
          </svg>
          <span id="ai-bubble-title" className="ai-bubble-title">AI Flowchart Assistant</span>
          <button className="ai-bubble-close" onClick={onClose} title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="ai-bubble-content">
          <p className="ai-bubble-message">
            👋 Hi! I can help you create flowcharts. Tell me what you'd like to add to your canvas.
          </p>

          {isLoading ? (
            <div className="loading-indicator">
              <div className="loading-message">{currentLoadingMessage}</div>
              <div className="loading-progress-bar">
                <div className="loading-progress-fill" style={{ width: `${loadingProgress}%` }}></div>
              </div>
            </div>
          ) : (
            <>
              <textarea
                className="ai-bubble-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="E.g., 'Create a login flow' or 'Add error handling steps'..."
                rows={3}
                autoFocus
              />
              <button
                className="ai-bubble-send"
                onClick={sendMessage}
                disabled={!inputValue.trim()}
              >
                Generate Flowchart
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 8l6-6v4h8v4H7v4L1 8z" />
                </svg>
              </button>
            </>
          )}

          {error && (
            <div className="ai-bubble-error">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AIChat
