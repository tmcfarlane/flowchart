import { useState, useCallback, useEffect } from 'react'
import { Node, Edge } from 'reactflow'
import './AIChat.css'
import { BaseFlowNode, BaseFlowEdge, EdgeStyle } from '../App'
import { resolveAzureIcons } from '../utils/azureIconRegistry'
import { createThread, getMessages, addMessage as addThreadMessage } from '../utils/conversationStore'

const LOADING_MESSAGES = [
  'Thinking about your flowchart...',
  'Analyzing the structure...',
  'Generating ideas...',
  'Working on it...',
  'Processing your request...',
  'Designing the flow...',
]

// Pre-loaded starter prompts across categories
const ALL_STARTER_PROMPTS = [
  // Casual / Everyday
  { emoji: '\u{1F96A}', text: 'Make a PB&J sandwich' },
  { emoji: '\u{1F5FA}\uFE0F', text: 'Plan a weekend road trip' },
  { emoji: '\u{1F382}', text: 'Organize a birthday party' },
  { emoji: '\u{2615}', text: 'My morning routine' },
  { emoji: '\u{1F3E0}', text: 'Moving to a new apartment' },
  // Fitness / Health
  { emoji: '\u{1F4AA}', text: 'Plan my afternoon workout' },
  { emoji: '\u{1F957}', text: 'Weekly meal prep plan' },
  { emoji: '\u{1F3C3}', text: '30-day fitness challenge' },
  // Technical
  { emoji: '\u{1F680}', text: 'CI/CD deployment pipeline' },
  { emoji: '\u{1F510}', text: 'User authentication flow' },
  { emoji: '\u{1F41B}', text: 'Debug a production issue' },
  { emoji: '\u{26A1}', text: 'Microservices architecture' },
  { emoji: '\u{1F4E1}', text: 'API request lifecycle' },
  { emoji: '\u{1F500}', text: 'Git branching strategy' },
  { emoji: '\u{1F6E1}\uFE0F', text: 'Incident response runbook' },
  // Business
  { emoji: '\u{1F4CB}', text: 'Customer onboarding process' },
  { emoji: '\u{1F4E6}', text: 'Product launch checklist' },
  { emoji: '\u{1F4CA}', text: 'Quarterly planning cycle' },
  { emoji: '\u{1F465}', text: 'Hiring pipeline' },
  { emoji: '\u{1F3C3}\u200D\u2642\uFE0F', text: 'Sprint planning workflow' },
  { emoji: '\u{1F6D2}', text: 'E-commerce checkout flow' },
  { emoji: '\u{1F4A1}', text: 'Design thinking process' },
  { emoji: '\u{1F4C8}', text: 'Sales funnel optimization' },
  { emoji: '\u{1F91D}', text: 'Client proposal workflow' },
]

function pickRandomPrompts(count: number) {
  const shuffled = [...ALL_STARTER_PROMPTS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

interface FlowProposal {
  summary?: string
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}

interface AIChatProps {
  nodes: Node[]
  edges: Edge[]
  onProposalReady: (proposal: FlowProposal, threadId?: string) => void
  isOpen: boolean
  onClose: () => void
  variant?: 'welcome' | 'full'
  onDismiss?: () => void
}

function AIChat({ nodes, edges, onProposalReady, isOpen, onClose, variant = 'full', onDismiss }: AIChatProps) {
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starterPrompts] = useState(() => pickRandomPrompts(4))

  const [threadId, setThreadId] = useState<string | null>(null)
  const [currentLoadingMessage, setCurrentLoadingMessage] = useState('')
  const [loadingProgress, setLoadingProgress] = useState(0)

  useEffect(() => {
    if (!isLoading) {
      setCurrentLoadingMessage('')
      setLoadingProgress(0)
      return
    }

    // Calibrated for ~15-18 second API calls.
    // Uses an ease-out curve: fast initial progress, then gradual slowdown.
    const EXPECTED_DURATION_MS = 18_000
    const MAX_PROGRESS = 94
    const startTime = Date.now()

    setCurrentLoadingMessage(LOADING_MESSAGES[0])
    setLoadingProgress(2)

    // Rotate loading messages every 3.5s (slower to feel calmer over 18s)
    let messageIndex = 0
    const messageInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % LOADING_MESSAGES.length
      setCurrentLoadingMessage(LOADING_MESSAGES[messageIndex])
    }, 3500)

    // Update progress on an ease-out curve tied to elapsed time
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const t = Math.min(elapsed / EXPECTED_DURATION_MS, 1) // 0 → 1 over expected duration
      // Ease-out cubic: fast start, gradual slowdown approaching MAX_PROGRESS
      const eased = 1 - Math.pow(1 - t, 3)
      setLoadingProgress(Math.min(eased * MAX_PROGRESS, MAX_PROGRESS))
    }, 200)

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

  const sendMessage = useCallback(async (overrideText?: string) => {
    const userPrompt = (overrideText || inputValue).trim()
    if (!userPrompt || isLoading) return

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
          label: typeof e.label === 'string' ? e.label : undefined,
        })),
      }

      // Create or reuse a conversation thread
      let currentThreadId = threadId
      if (!currentThreadId) {
        currentThreadId = createThread()
        setThreadId(currentThreadId)
      }

      // Add user message to thread
      addThreadMessage(currentThreadId, { role: 'user', content: userPrompt })

      // Build full message history from thread
      const threadMessages = getMessages(currentThreadId)

      // Call our serverless function proxy at /api/chat
      // The API uses structured outputs to guarantee valid JSON matching our schema
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: threadMessages.map((m) => ({ role: m.role, content: m.content })),
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

      // Enrich proposal with Azure icons (local-only, no API calls)
      const enrichedProposal = resolveAzureIcons(proposal)

      // Save assistant summary to thread
      if (currentThreadId && proposal) {
        addThreadMessage(currentThreadId, {
          role: 'assistant',
          content: proposal.summary || 'Generated flowchart',
        })
      }

      // Notify parent with the enriched proposal
      onProposalReady(enrichedProposal, currentThreadId || undefined)
      
      // Close the bubble after successful proposal
      onClose()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('AI Chat error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [inputValue, isLoading, nodes, edges, getEdgeStyleFromEdge, onProposalReady, onClose, threadId])

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

  if (variant === 'welcome') {
    return (
      <div className="ai-welcome-prompt" role="dialog" aria-labelledby="ai-welcome-title">
        <div className="ai-bubble-header">
          <img src="/logo/logo_color.svg" alt="Zero Click Dev" className="ai-bubble-logo" />
          <span id="ai-welcome-title" className="ai-bubble-title">Zero Click Dev</span>
          <button className="ai-bubble-close" onClick={onClose} title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="ai-bubble-content">
          <p className="ai-welcome-heading">What's your flow?</p>

          {isLoading ? (
            <div className="loading-indicator">
              <div className="loading-message">{currentLoadingMessage}</div>
              <div className="loading-progress-bar">
                <div className="loading-progress-fill" style={{ width: `${loadingProgress}%` }}></div>
              </div>
            </div>
          ) : (
            <>
              <div className="ai-prompt-suggestions">
                {starterPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    className="ai-prompt-chip"
                    onClick={() => sendMessage(prompt.text)}
                  >
                    <span className="ai-prompt-emoji">{prompt.emoji}</span>
                    <span className="ai-prompt-text">{prompt.text}</span>
                  </button>
                ))}
              </div>

              <div className="ai-prompt-divider">
                <span>or describe your own</span>
              </div>

              <textarea
                className="ai-bubble-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe any process, workflow, or plan..."
                rows={2}
                autoFocus
              />
              <button
                className="ai-bubble-send"
                onClick={() => sendMessage()}
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

          {!isLoading && (
            <button className="ai-welcome-dismiss" onClick={onDismiss}>
              No, thank you
            </button>
          )}
        </div>
      </div>
    )
  }

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
          <img src="/logo/logo_color.svg" alt="Zero Click Dev" className="ai-bubble-logo" />
          <span id="ai-bubble-title" className="ai-bubble-title">Zero Click Dev</span>
          <button className="ai-bubble-close" onClick={onClose} title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="ai-bubble-content">
          <p className="ai-welcome-heading">What's the vibe today?</p>

          {isLoading ? (
            <div className="loading-indicator">
              <div className="loading-message">{currentLoadingMessage}</div>
              <div className="loading-progress-bar">
                <div className="loading-progress-fill" style={{ width: `${loadingProgress}%` }}></div>
              </div>
            </div>
          ) : (
            <>
              <div className="ai-prompt-suggestions">
                {starterPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    className="ai-prompt-chip"
                    onClick={() => sendMessage(prompt.text)}
                  >
                    <span className="ai-prompt-emoji">{prompt.emoji}</span>
                    <span className="ai-prompt-text">{prompt.text}</span>
                  </button>
                ))}
              </div>

              <div className="ai-prompt-divider">
                <span>or describe your own</span>
              </div>

              <textarea
                className="ai-bubble-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe any process, workflow, or plan..."
                rows={2}
                autoFocus
              />
              <button
                className="ai-bubble-send"
                onClick={() => sendMessage()}
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
