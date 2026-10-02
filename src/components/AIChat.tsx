import { useState, useCallback, useEffect, useRef } from 'react'
import type { Node, Edge } from 'reactflow'
import type { FlowProposal, DiagramMode } from '../App'
import { resolveAzureIcons } from '../utils/azureIconRegistry'
import { createThread, getMessages, addMessage, type ChatMessage } from '../utils/conversationStore'
import { MAX_DIAGRAM_IMPORT_BYTES, parseFlowJson } from '../utils/importFlow'
import { flowToChart, contentFingerprint } from '../utils/sharedFlow'
import { contextForAI, parseAIProposal, preserveCanvasImages, getPreservedImageNodeIds } from '../shared/aiProposal'
import './AIChat.css'

export type ProposalIntent = 'insert' | 'edit'

const STARTERS = [
  { emoji: '✦', text: 'A dream factory that turns ideas into constellations' },
  { emoji: '☁', text: 'A resilient cloud architecture for an AI assistant' },
  { emoji: '↗', text: 'Customer onboarding with a payment approval branch' },
  { emoji: '◈', text: 'A creative project from first spark to launch' },
]
const EDIT_STARTERS = ['Add a failure and recovery path', 'Make the labels clearer and shorter', 'Add a decision before the final step', 'Simplify this diagram without losing its meaning']

interface AIChatProps {
  nodes: Node[]
  edges: Edge[]
  onProposalReady: (proposal: FlowProposal, threadId?: string, intent?: ProposalIntent, baseFingerprint?: string) => void
  isOpen: boolean
  onClose: () => void
  variant?: 'welcome' | 'full'
  onDismiss?: () => void
  onImportJson?: (nodes: Node[], edges: Edge[], mode?: DiagramMode) => void
  onOpenTemplates?: () => void
  canEdit?: boolean
  diagramMode?: DiagramMode
}

function AIChat({ nodes, edges, onProposalReady, isOpen, onClose, variant = 'full', onDismiss, onImportJson, onOpenTemplates, canEdit = true, diagramMode = 'flowchart' }: AIChatProps) {
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [intent, setIntent] = useState<ProposalIntent>(() => nodes.length && canEdit ? 'edit' : 'insert')
  const [elapsed, setElapsed] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)
  const canRefine = canEdit && nodes.length > 0
  const effectiveIntent = intent === 'edit' && canRefine ? 'edit' : 'insert'

  useEffect(() => () => { abortRef.current?.abort() }, [])
  useEffect(() => {
    if (isOpen) {
      setIntent(nodes.length && canEdit ? 'edit' : 'insert')
      const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60)
      return () => window.clearTimeout(timer)
    }
    abortRef.current?.abort()
    requestRef.current += 1
    setIsLoading(false)
  }, [isOpen]) // Opening a chat selects the most useful default for that canvas.

  useEffect(() => {
    if (!isLoading) return
    const start = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [isLoading])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    requestRef.current += 1
    setIsLoading(false)
  }, [])
  const close = useCallback(() => { cancel(); onClose() }, [cancel, onClose])

  useEffect(() => {
    if (!isOpen) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [isOpen, close])

  const sendMessage = useCallback(async () => {
    const prompt = inputValue.trim()
    if (!prompt || isLoading) return
    const requestId = ++requestRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const original = flowToChart(nodes, edges)
    const baseline = contentFingerprint(original)
    const currentThreadId = threadId ?? createThread()
    setThreadId(currentThreadId)
    const history = getMessages(currentThreadId).filter((m) => m.role !== 'system')
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: prompt }].slice(-20),
          mode: effectiveIntent === 'edit' ? 'refine' : 'generate',
          diagramMode,
          flowContext: contextForAI(original),
          selectedNodeIds: effectiveIntent === 'edit' ? nodes.filter((node) => node.selected).map((node) => node.id) : [],
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'The assistant could not complete this request. Please try again.')
      let proposal = parseAIProposal(data.message || '', data.finishReason, effectiveIntent === 'edit', { preservedImageNodeIds: effectiveIntent === 'edit' ? getPreservedImageNodeIds(original.nodes) : [] })
      if (effectiveIntent === 'edit') proposal = preserveCanvasImages(proposal, original.nodes)
      if (controller.signal.aborted || requestId !== requestRef.current) return
      const enriched = resolveAzureIcons(proposal, { intent: effectiveIntent })
      addMessage(currentThreadId, { role: 'user', content: prompt })
      addMessage(currentThreadId, { role: 'assistant', content: proposal.summary })
      setMessages(getMessages(currentThreadId))
      setInputValue('')
      onProposalReady(enriched, currentThreadId, effectiveIntent, baseline)
      onClose()
    } catch (err) {
      if (controller.signal.aborted || requestId !== requestRef.current) return
      setError(err instanceof Error ? err.message : 'The request failed. Please try again.')
    } finally {
      if (requestId === requestRef.current) setIsLoading(false)
    }
  }, [inputValue, isLoading, nodes, edges, effectiveIntent, diagramMode, onProposalReady, onClose, threadId])

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !onImportJson) return
    if (file.size > MAX_DIAGRAM_IMPORT_BYTES) {
      setError('This diagram file is too large to import (maximum 10 MB).')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const flow = parseFlowJson(String(reader.result))
        onImportJson(flow.nodes, flow.edges, flow.mode)
        setError(null)
      } catch (err) { setError(err instanceof Error ? err.message : 'This file could not be imported.') }
    }
    reader.onerror = () => setError('This file could not be read.')
    reader.readAsText(file)
  }
  const useSuggestion = (prompt: string) => { setInputValue(prompt); inputRef.current?.focus() }
  if (!isOpen) return null
  const welcome = variant === 'welcome'
  const contents = (
    <section className={welcome ? 'ai-welcome-prompt' : 'ai-bubble-prompt'} role="dialog" aria-modal={!welcome} aria-labelledby={welcome ? 'ai-welcome-title' : 'ai-bubble-title'}>
      <div className="ai-bubble-header">
        <span className="ai-assistant-mark" aria-hidden="true">✦</span>
        <div className="ai-assistant-heading">
          <span id={welcome ? 'ai-welcome-title' : 'ai-bubble-title'} className="ai-bubble-title">{welcome ? 'Give your ideas a shape' : 'Diagram copilot'}</span>
          <span className="ai-bubble-subtitle">{welcome ? 'A little structure. A lot of possibility.' : `${nodes.length} nodes · ${edges.length} connections on your canvas`}</span>
        </div>
        {welcome && onImportJson && <button className="ai-bubble-import" onClick={() => fileRef.current?.click()} aria-label="Import from JSON" title="Import from JSON">↥</button>}
        <button className="ai-bubble-close" onClick={close} aria-label="Close" title="Close">×</button>
      </div>
      <div className="ai-bubble-content">
        {welcome ? (
          <>
            <div className="ai-welcome-orbit" aria-hidden="true"><i /><i /><i /><span>✦</span></div>
            <p className="ai-welcome-heading">From a spark to a whole system.</p>
            <p className="ai-context-hint">Describe a workflow, map an architecture, or build something wonderfully strange.</p>
          </>
        ) : (
          <div className="ai-intent-switch" aria-label="Assistant action">
            <button className={effectiveIntent === 'edit' ? 'active' : ''} onClick={() => setIntent('edit')} disabled={!canRefine || isLoading} aria-pressed={effectiveIntent === 'edit'}>Edit current diagram</button>
            <button className={effectiveIntent === 'insert' ? 'active' : ''} onClick={() => setIntent('insert')} disabled={isLoading} aria-pressed={effectiveIntent === 'insert'}>Create a new diagram</button>
          </div>
        )}
        {!welcome && <p className="ai-context-hint">{effectiveIntent === 'edit' ? 'Ask for a change. Review the full result before applying it. Unchanged parts stay in place.' : 'Create a diagram to insert alongside your existing work.'}{effectiveIntent === 'edit' && nodes.some((n) => n.selected) ? ` Focus: ${nodes.filter((n) => n.selected).length} selected nodes.` : ''}</p>}
        {messages.length > 0 && <div className="ai-conversation" aria-label="Conversation history">{messages.slice(-6).map((message, index) => <div key={index} className={`ai-conversation-message ${message.role}`}><span>{message.role === 'user' ? 'You' : 'Copilot'}</span><p>{message.content}</p></div>)}</div>}
        <div className="ai-prompt-suggestions">
          {(effectiveIntent === 'edit' && !welcome ? EDIT_STARTERS.map((text) => ({ emoji: '↳', text })) : STARTERS).map((prompt) => <button key={prompt.text} className="ai-prompt-chip" onClick={() => useSuggestion(prompt.text)} disabled={isLoading}><span className="ai-prompt-emoji" aria-hidden="true">{prompt.emoji}</span><span className="ai-prompt-text">{prompt.text}</span></button>)}
        </div>
        <label className="ai-input-label" htmlFor={welcome ? 'ai-welcome-input' : 'ai-chat-input'}>{effectiveIntent === 'edit' && !welcome ? 'What would you like to change?' : 'What would you like to map?'}</label>
        <textarea ref={inputRef} id={welcome ? 'ai-welcome-input' : 'ai-chat-input'} className="ai-bubble-input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMessage() } }} placeholder={effectiveIntent === 'edit' && !welcome ? 'Add a review step before publishing…' : 'An idea, a process, a world…'} maxLength={10000} rows={3} disabled={isLoading} />
        {isLoading ? <div className="ai-request-status" role="status"><span className="ai-thinking-spark" aria-hidden="true">✦</span><div><strong>{effectiveIntent === 'edit' ? 'Shaping your changes…' : 'Building your diagram…'}</strong><small>{elapsed > 20 ? 'Still working. Complex diagrams can take a little longer.' : 'Preparing a complete diagram for you to review.'}</small></div><button onClick={cancel}>Stop</button></div> : <button className="ai-bubble-send" onClick={() => void sendMessage()} disabled={!inputValue.trim()}>{effectiveIntent === 'edit' && !welcome ? 'Preview changes' : 'Generate Flowchart'}<span aria-hidden="true">↗</span></button>}
        {error && <div className="ai-bubble-error" role="alert">{error}</div>}
        {welcome && <div className="ai-welcome-links">{onOpenTemplates && <button onClick={onOpenTemplates}>Browse templates <span aria-hidden="true">→</span></button>}<a href="/mcp" target="_blank" rel="noopener noreferrer">Connect your AI agent</a><button onClick={onDismiss ?? close}>Start with a blank canvas</button></div>}
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleImport} hidden aria-label="Import JSON file" />
      </div>
    </section>
  )
  return welcome ? contents : <div className="ai-bubble-overlay" onClick={close}><div className="ai-dialog-position" onClick={(event) => event.stopPropagation()}>{contents}</div></div>
}

export default AIChat
