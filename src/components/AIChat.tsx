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
              <div className="ai-chat-apply-container">
                <button
                  className="ai-chat-apply-button"
                  onClick={() => applyFlowChanges(message.flowUpdate!)}
                  title="Apply these changes to your flowchart"
                >
                  Apply Changes
                </button>
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
