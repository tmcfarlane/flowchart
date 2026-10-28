import { useState, useCallback, useEffect, useRef } from 'react'
import { Node, Edge } from 'reactflow'
import './AIChat.css'
import { type DiagramMode, type EdgeStyle, DIAGRAM_MODES } from '../shared/flowTypes'
import { parseGenerationProposal, normalizeGenerationProposal, type AIGenerationContext, type AIGenerationProposal } from '../shared/aiGeneration'
import { resolveAzureIcons } from '../utils/azureIconRegistry'
import { createThread, getMessages, addMessage as addThreadMessage } from '../utils/conversationStore'
import { parseFlowJson } from '../utils/exportUtils'
import type { ArchitectureScene } from '../shared/architectureScene'

const FLOW_STARTER_PROMPTS = [
  { emoji: '\u{1F96A}', text: 'Make a PB&J sandwich' },
  { emoji: '\u{1F5FA}\uFE0F', text: 'Plan a weekend road trip' },
  { emoji: '\u{1F382}', text: 'Organize a birthday party' },
  { emoji: '\u{2615}', text: 'My morning routine' },
  { emoji: '\u{1F3E0}', text: 'Moving to a new apartment' },
  { emoji: '\u{1F4AA}', text: 'Plan my afternoon workout' },
  { emoji: '\u{1F957}', text: 'Weekly meal prep plan' },
  { emoji: '\u{1F3C3}', text: '30-day fitness challenge' },
  { emoji: '\u{1F680}', text: 'CI/CD deployment pipeline' },
  { emoji: '\u{1F510}', text: 'User authentication flow' },
  { emoji: '\u{1F41B}', text: 'Debug a production issue' },
  { emoji: '\u{26A1}', text: 'Microservices architecture' },
  { emoji: '\u{1F4E1}', text: 'API request lifecycle' },
  { emoji: '\u{1F500}', text: 'Git branching strategy' },
  { emoji: '\u{1F6E1}\uFE0F', text: 'Incident response runbook' },
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

const MODE_COPY: Record<DiagramMode, {
  heading: string
  placeholder: string
  button: string
  loading: string
  starters: { emoji: string; text: string }[]
}> = {
  flowchart: {
    heading: "What's your flow?",
    placeholder: 'Describe any process, workflow, or plan...',
    button: 'Generate Flowchart',
    loading: 'Generating flowchart...',
    starters: FLOW_STARTER_PROMPTS,
  },
  architecture: {
    heading: 'What should we architect?',
    placeholder: 'Describe your services, data stores, and connections...',
    button: 'Generate architecture diagram',
    loading: 'Generating architecture diagram...',
    starters: [
      { emoji: '☁️', text: 'Design a cloud app with API, database, and cache' },
      { emoji: '🔐', text: 'Map an authentication system' },
      { emoji: '📦', text: 'Show an order processing architecture' },
      { emoji: '📡', text: 'Design a real-time messaging system' },
    ],
  },
  draw: {
    heading: 'What should we draw?',
    placeholder: 'Describe shapes, labels, and lines to draw...',
    button: 'Generate drawing',
    loading: 'Generating drawing...',
    starters: [
      { emoji: '🖊️', text: 'Sketch a workshop whiteboard' },
      { emoji: '💡', text: 'Draw a mind map for a product launch' },
      { emoji: '📱', text: 'Make a labeled mobile app wireframe' },
      { emoji: '🗺️', text: 'Draw a simple event floor plan' },
    ],
  },
}

const MODE_LABELS: Record<DiagramMode, string> = {
  flowchart: 'Flowchart', architecture: 'Architecture', draw: 'Draw',
}

function pickRandomPrompts(count: number) {
  return [...FLOW_STARTER_PROMPTS].sort(() => Math.random() - 0.5).slice(0, count)
}

interface AIChatProps {
  nodes: Node[]
  edges: Edge[]
  onProposalReady: (proposal: AIGenerationProposal, threadId?: string) => void
  isOpen: boolean
  onClose: () => void
  variant?: 'welcome' | 'full'
  onDismiss?: () => void
  diagramMode?: DiagramMode
  generationMode: DiagramMode
  onGenerationModeChange: (mode: DiagramMode) => void
  getGenerationContext: () => AIGenerationContext | undefined
  generationRevision?: number
  onImportJson?: (nodes: Node[], edges: Edge[], mode?: DiagramMode, architectureScene?: ArchitectureScene) => void
  onImportFile?: (file: File) => void
  selectedCount?: number
  onEditSelection?: () => void
}

function AIChat({ nodes, edges, onProposalReady, isOpen, onClose, variant = 'full', onDismiss, onImportJson, onImportFile, diagramMode = 'flowchart', generationMode, onGenerationModeChange, getGenerationContext, generationRevision = 0, selectedCount = 0, onEditSelection }: AIChatProps) {
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const welcomeFileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [flowStarterPrompts] = useState(() => pickRandomPrompts(4))

  const [loadingProgress, setLoadingProgress] = useState(0)
  const requestRef = useRef<{ controller: AbortController } | null>(null)
  const targetRef = useRef(generationMode)
  const openRef = useRef(isOpen)
  const revisionRef = useRef(generationRevision)
  const threadRef = useRef<{ mode: DiagramMode; id: string } | null>(null)
  targetRef.current = generationMode
  openRef.current = isOpen
  revisionRef.current = generationRevision
  const copy = MODE_COPY[generationMode]
  const starterPrompts = generationMode === 'flowchart' ? flowStarterPrompts : copy.starters

  const cancelRequest = useCallback(() => {
    requestRef.current?.controller.abort()
    requestRef.current = null
    setIsLoading(false)
  }, [])

  useEffect(() => {
    cancelRequest()
    threadRef.current = null
  }, [generationMode, generationRevision, cancelRequest])

  useEffect(() => {
    if (!isOpen) cancelRequest()
  }, [isOpen, cancelRequest])

  useEffect(() => () => {
    requestRef.current?.controller.abort()
    requestRef.current = null
  }, [])

  useEffect(() => {
    if (!isLoading) {
      setLoadingProgress(0)
      return
    }
    const startTime = Date.now()
    setLoadingProgress(2)
    const interval = setInterval(() => {
      const t = Math.min((Date.now() - startTime) / 18_000, 1)
      setLoadingProgress(Math.min((1 - Math.pow(1 - t, 3)) * 94, 94))
    }, 200)
    return () => clearInterval(interval)
  }, [isLoading])

  const getEdgeStyleFromEdge = useCallback((edge: Edge): EdgeStyle => {
    if (edge.animated) return 'animated'
    if (edge.type === 'step') return 'step'
    return 'default'
  }, [])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const userPrompt = (overrideText ?? inputValue).trim()
    if (!userPrompt || requestRef.current || !isOpen) return

    const outputMode = generationMode
    const revision = generationRevision
    const request = { controller: new AbortController() }
    requestRef.current = request
    setIsLoading(true)
    setError(null)

    try {
      const context = getGenerationContext()
      const fallbackFlowContext = !context && diagramMode !== 'draw' ? {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.data.label,
          position: n.position,
          width: typeof n.style?.width === 'number' ? n.style.width : undefined,
          height: typeof n.style?.height === 'number' ? n.style.height : undefined,
          imageUrl: typeof n.data.imageUrl === 'string' && !n.data.imageUrl.startsWith('data:') ? n.data.imageUrl : undefined,
          parentNode: n.parentNode,
          containerKind: n.data.containerKind,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          style: getEdgeStyleFromEdge(e),
          sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
          targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : undefined,
          label: typeof e.label === 'string' ? e.label : undefined,
          protocol: e.data?.protocol,
          commStyle: e.data?.commStyle,
        })),
        } : undefined
      const existingThread = threadRef.current?.mode === outputMode ? threadRef.current.id : null
      const messages = existingThread ? getMessages(existingThread) : []
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: request.controller.signal,
        body: JSON.stringify({
          mode: 'generate',
          diagramMode: outputMode,
          messages: [...messages.map((message) => ({ role: message.role, content: message.content })), { role: 'user', content: userPrompt }],
          ...(context ?? (fallbackFlowContext ? { flowContext: fallbackFlowContext } : {})),
        }),
      })
      if (requestRef.current !== request || targetRef.current !== outputMode || revisionRef.current !== revision || !openRef.current) return
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `API request failed with status ${response.status}`)
      }

      const data = await response.json()
      if (requestRef.current !== request || targetRef.current !== outputMode || revisionRef.current !== revision || !openRef.current) return
      let proposal: AIGenerationProposal
      try {
        proposal = parseGenerationProposal(data.message, outputMode, data.finishReason)
        if (proposal.outputMode !== 'draw') {
          proposal = normalizeGenerationProposal({ ...proposal, nodes: resolveAzureIcons(proposal).nodes }, outputMode)
        }
      } catch (parseError) {
        if (data.finishReason === 'length') throw parseError
        throw new Error('Could not parse AI response. Please try again or rephrase your request.')
      }
      if (requestRef.current !== request || targetRef.current !== outputMode || revisionRef.current !== revision || !openRef.current) return

      const currentThreadId = existingThread ?? createThread()
      threadRef.current = { mode: outputMode, id: currentThreadId }
      addThreadMessage(currentThreadId, { role: 'user', content: userPrompt })
      addThreadMessage(currentThreadId, { role: 'assistant', content: proposal.summary || MODE_COPY[outputMode].button })
      setInputValue('')
      onProposalReady(proposal, currentThreadId)
      onClose()
    } catch (err) {
      if (requestRef.current === request && !request.controller.signal.aborted && targetRef.current === outputMode && revisionRef.current === revision && openRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred')
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null
        setIsLoading(false)
      }
    }
  }, [inputValue, isOpen, nodes, edges, getEdgeStyleFromEdge, onProposalReady, onClose, diagramMode, generationMode, generationRevision, getGenerationContext])

  const handleClose = useCallback(() => {
    cancelRequest()
    onClose()
  }, [cancelRequest, onClose])

  const modeSelector = (
    <label className="ai-generation-mode">
      <span>Generate for</span>
      <select
        value={generationMode}
        onChange={(event) => {
          cancelRequest()
          threadRef.current = null
          onGenerationModeChange(event.target.value as DiagramMode)
        }}
        disabled={isLoading}
      >
        {DIAGRAM_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}
      </select>
    </label>
  )

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
        handleClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, handleClose])

  const handleWelcomeImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (onImportFile) {
      onImportFile(file)
      e.target.value = ''
      return
    }
    if (!onImportJson) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const result = parseFlowJson(event.target?.result as string)
        onImportJson(result.nodes, result.edges, result.mode, result.architectureScene)
        setImportError(null)
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Failed to import file.')
      }
    }
    reader.onerror = () => {
      setImportError('Could not read the selected file.')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  if (!isOpen) return null

  if (variant === 'welcome') {
    return (
      <div className="ai-welcome-prompt" role="dialog" aria-labelledby="ai-welcome-title">
        <div className="ai-bubble-header">
          <img src="/logo/logo_color.svg" alt="Zero Click Dev" className="ai-bubble-logo" />
          <span id="ai-welcome-title" className="ai-bubble-title">
            FlowChart
            <span className="ai-bubble-subtitle">by <a href="https://zeroclickdev.ai" target="_blank" rel="noopener noreferrer" className="ai-bubble-subtitle-link">Zero Click Dev</a></span>
          </span>
          <button
            className="ai-bubble-import"
            onClick={() => welcomeFileInputRef.current?.click()}
            title="Import from JSON"
            aria-label="Import from JSON"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8" />
              <path d="M4 6l4-4 4 4" />
              <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
            </svg>
          </button>
          <input
            ref={welcomeFileInputRef}
            type="file"
            accept=".json,.excalidraw,application/json"
            onChange={handleWelcomeImport}
            style={{ display: 'none' }}
            aria-label="Import JSON or Excalidraw file"
          />
          <button className="ai-bubble-close" onClick={handleClose} title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="ai-bubble-content">
          {!isLoading && (
            <p className="ai-welcome-news">
              <span className="ai-welcome-news-tag">New</span>
              <a href="/mcp" target="_blank" rel="noopener" className="ai-welcome-news-link">
                Connect your AI agent (MCP)
              </a>
              <a href="/mcp#trailer" target="_blank" rel="noopener" className="ai-welcome-news-link ai-welcome-news-trailer">
                <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor" aria-hidden="true">
                  <path d="M0 0.8v8.4a.6.6 0 00.9.5l7.4-4.2a.6.6 0 000-1L.9.3A.6.6 0 000 .8z" />
                </svg>
                Watch the trailer
              </a>
            </p>
          )}
          {!isLoading && <p className="ai-welcome-heading">{copy.heading}</p>}

          {modeSelector}
          {isLoading ? (
            <div className="loading-indicator">
              <div className="loading-message">{copy.loading}</div>
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
                placeholder={copy.placeholder}
                rows={2}
                autoFocus
              />
              <button
                className="ai-bubble-send"
                onClick={() => sendMessage()}
                disabled={!inputValue.trim()}
              >
                {copy.button}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 8l6-6v4h8v4H7v4L1 8z" />
                </svg>
              </button>
            </>
          )}

          {error && (
            <div className="ai-bubble-error" role="alert">
              {error}
            </div>
          )}

          {!isLoading && (
            <>
              {onImportFile && <button className="ai-welcome-import-drawing" onClick={() => welcomeFileInputRef.current?.click()}>Import Excalidraw <span aria-hidden="true">↗</span></button>}
              <button className="ai-welcome-dismiss" onClick={() => { cancelRequest(); onDismiss?.() }}>
                No, thank you
              </button>
            </>
          )}
        </div>
        {importError && (
          <div
            className="confirm-overlay"
            onClick={() => setImportError(null)}
            role="dialog"
            aria-modal="true"
          >
            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <h2 className="confirm-title">Invalid JSON Format</h2>
              <p className="confirm-body">{importError}</p>
              <div className="confirm-actions">
                <button className="confirm-button confirm-cancel" onClick={() => setImportError(null)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="ai-bubble-overlay"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-bubble-title"
    >
      <div className="ai-bubble-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="ai-bubble-header">
          <img src="/logo/logo_color.svg" alt="Zero Click Dev" className="ai-bubble-logo" />
          <span id="ai-bubble-title" className="ai-bubble-title">
            FlowChart
            <span className="ai-bubble-subtitle">by <a href="https://zeroclickdev.ai" target="_blank" rel="noopener noreferrer" className="ai-bubble-subtitle-link">Zero Click Dev</a></span>
          </span>
          <button className="ai-bubble-close" onClick={handleClose} title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="ai-bubble-content">
          {!isLoading && <p className="ai-welcome-heading">{copy.heading}</p>}
          {!isLoading && onEditSelection && <button className="ai-selection-action" onClick={onEditSelection} disabled={selectedCount === 0}>
            <span>✦ Edit selected nodes</span><span>{selectedCount} node{selectedCount === 1 ? '' : 's'}</span>
          </button>}

          {modeSelector}
          {isLoading ? (
            <div className="loading-indicator">
              <div className="loading-message">{copy.loading}</div>
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
                placeholder={copy.placeholder}
                rows={2}
                autoFocus
              />
              <button
                className="ai-bubble-send"
                onClick={() => sendMessage()}
                disabled={!inputValue.trim()}
              >
                {copy.button}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 8l6-6v4h8v4H7v4L1 8z" />
                </svg>
              </button>
            </>
          )}

          {error && (
            <div className="ai-bubble-error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AIChat
