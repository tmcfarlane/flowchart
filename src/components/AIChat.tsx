import { useState, useCallback, useRef, useEffect } from 'react'
import { Node, Edge, MarkerType } from 'reactflow'
import './AIChat.css'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  flowUpdate?: {
    explanation: string
    nodes: Array<{
      id: string
      type: string
      label: string
      position: { x: number; y: number }
    }>
    edges: Array<{
      id: string
      source: string
      target: string
    }>
  }
}

interface AIChatProps {
  nodes: Node[]
  edges: Edge[]
  onUpdateFlow: (nodes: Node[], edges: Edge[]) => void
  onClose: () => void
}

function AIChat({ nodes, edges, onUpdateFlow, onClose }: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! I can help you create and modify your flowchart. Try asking me to add nodes, create connections, or modify your flow.',
    },
  ])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Parse flow update from assistant message if present
  const parseFlowUpdate = (content: string) => {
    try {
      // Look for JSON code block in the message
      const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/)
      if (!jsonMatch) return null

      const jsonStr = jsonMatch[1]
      const parsed = JSON.parse(jsonStr)

      // Validate the structure
      if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.edges && Array.isArray(parsed.edges)) {
        return {
          explanation: parsed.explanation || 'Flow updated',
          nodes: parsed.nodes,
          edges: parsed.edges,
        }
      }
    } catch (e) {
      console.error('Failed to parse flow update:', e)
    }
    return null
  }

  // Apply flow changes to the canvas
  const applyFlowChanges = useCallback((flowUpdate: NonNullable<Message['flowUpdate']>) => {
    // Convert the AI's flow format to React Flow format
    const newNodes: Node[] = flowUpdate.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: { 
        label: node.label,
        onLabelChange: (_nodeId: string, _label: string) => {
          // This will be handled by the parent component
        }
      },
    }))

    const newEdges: Edge[] = flowUpdate.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'default',
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
    }))

    onUpdateFlow(newNodes, newEdges)
  }, [onUpdateFlow])

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: inputValue }
    
    // Detect if user is asking for modifications
    const modificationKeywords = ['add', 'create', 'modify', 'change', 'update', 'delete', 'remove', 'connect', 'link']
    const isRequestingModification = modificationKeywords.some(keyword => 
      inputValue.toLowerCase().includes(keyword)
    )
    
    setMessages((prev) => [...prev, userMessage])
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
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        })),
      }

      // Call our serverless function proxy at /api/chat
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            ...messages.slice(-5), // Include last 5 messages for context
            userMessage,
          ],
          flowContext,
          requestStructuredUpdate: isRequestingModification,
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
      
      // Check if the response contains a flow update
      const flowUpdate = parseFlowUpdate(content)
      
      // Extract just the explanation part (text before the JSON block)
      let displayContent = content
      if (flowUpdate) {
        displayContent = content.replace(/```json\s*\n[\s\S]*?\n```/, '').trim()
      }
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: displayContent,
        flowUpdate: flowUpdate || undefined,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(`Failed to get AI response: ${errorMessage}`)
      console.error('AI Chat error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [inputValue, isLoading, nodes, edges, messages])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="ai-chat-sidebar">
      <div className="ai-chat-header">
        <h3>AI Assistant</h3>
        <button className="ai-chat-close" onClick={onClose} title="Close AI Chat">
          ×
        </button>
      </div>

      <div className="ai-chat-messages">
        {messages.map((message, index) => (
          <div key={index}>
            <div
              className={`ai-chat-message ${message.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className="message-content">{message.content}</div>
            </div>
            {message.flowUpdate && (
              <div className="ai-chat-proposed-flow">
                <div className="proposed-flow-header">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '6px' }}>
                    <circle cx="3" cy="8" r="1.5" fill="#10b981"/>
                    <circle cx="8" cy="4" r="1.5" fill="#10b981"/>
                    <circle cx="8" cy="12" r="1.5" fill="#10b981"/>
                    <circle cx="13" cy="8" r="1.5" fill="#10b981"/>
                    <path d="M3 8h4M8 5v2M8 10v2M9 8h3" stroke="#10b981" strokeWidth="1.5"/>
                  </svg>
                  <span className="proposed-flow-title">Proposed Flow</span>
                </div>
                <div className="proposed-flow-summary">
                  <div className="proposed-flow-count">
                    {message.flowUpdate.nodes.length} node{message.flowUpdate.nodes.length !== 1 ? 's' : ''}, {message.flowUpdate.edges.length} edge{message.flowUpdate.edges.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="proposed-flow-actions">
                  <button
                    className="proposed-flow-button insert"
                    onClick={() => applyFlowChanges(message.flowUpdate!)}
                    title="Apply these changes to your flowchart"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    Insert
                  </button>
                  <button
                    className="proposed-flow-button cancel"
                    onClick={() => {
                      // Just dismiss - the message stays but user can scroll past
                    }}
                    title="Dismiss this proposal"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    Cancel
                  </button>
                  <button
                    className="proposed-flow-button regenerate"
                    onClick={() => {
                      // Re-run the last user message to get a new proposal
                      // For now, just show a message that this will be implemented
                      alert('Regenerate will re-run your last request')
                    }}
                    title="Request a new proposal"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13 8A5 5 0 1 1 8 3V1l3 3-3 3V5a3 3 0 1 0 3 3h2z"/>
                    </svg>
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="ai-chat-message assistant">
            <div className="message-content loading">
              <span className="loading-dot">.</span>
              <span className="loading-dot">.</span>
              <span className="loading-dot">.</span>
            </div>
          </div>
        )}
        {error && (
          <div className="ai-chat-error">
            <strong>Error:</strong> {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-chat-input-container">
        <textarea
          className="ai-chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me to help with your flowchart..."
          rows={3}
          disabled={isLoading}
        />
        <button
          className="ai-chat-send"
          onClick={sendMessage}
          disabled={!inputValue.trim() || isLoading}
          title="Send message (Enter)"
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}

export default AIChat
