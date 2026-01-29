import { useState, useCallback, useRef, useEffect } from 'react'
import { Node, Edge } from 'reactflow'
import './AIChat.css'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AIChatProps {
  nodes: Node[]
  edges: Edge[]
  onUpdateFlow: (nodes: Node[], edges: Edge[]) => void
  onClose: () => void
}

function AIChat({ nodes, edges, onClose }: AIChatProps) {
  // Note: onUpdateFlow is available for future AI-driven modifications
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

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return

    // Check for Azure OpenAI configuration
    const deploymentName = import.meta.env.VITE_AZURE_DEPLOYMENT_NAME
    const resourceName = import.meta.env.VITE_AZURE_RESOURCE_NAME
    const apiKey = import.meta.env.VITE_AZURE_API_KEY

    if (!deploymentName || !resourceName || !apiKey) {
      setError(
        'Azure OpenAI configuration missing. Please set VITE_AZURE_DEPLOYMENT_NAME, VITE_AZURE_RESOURCE_NAME, and VITE_AZURE_API_KEY in your .env file.'
      )
      return
    }

    const userMessage: Message = { role: 'user', content: inputValue }
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

      const systemMessage = `You are a flowchart assistant. The user has the following flowchart:
${JSON.stringify(flowContext, null, 2)}

Help them modify or understand their flowchart. If they ask you to make changes, explain what you would do clearly. You cannot directly modify the flowchart, but you can provide clear instructions.`

      // Call Azure OpenAI API
      const endpoint = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemMessage },
            ...messages.slice(-5), // Include last 5 messages for context
            userMessage,
          ],
          max_tokens: 800,
          temperature: 0.7,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          errorData.error?.message || `API request failed with status ${response.status}`
        )
      }

      const data = await response.json()
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.choices[0]?.message?.content || 'No response received.',
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
          <div
            key={index}
            className={`ai-chat-message ${message.role === 'user' ? 'user' : 'assistant'}`}
          >
            <div className="message-content">{message.content}</div>
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
