import { useEffect, useRef, useState } from 'react'
import './Share.css'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function CopyField({ label, chip, value, hint }: { label: string; chip?: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="share-field">
      <div className="share-field-label">
        {label}
        {chip && <span className="share-chip">{chip}</span>}
      </div>
      <div className="share-field-row">
        <input
          className="share-field-input"
          value={value}
          readOnly
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className={`share-copy-button ${copied ? 'copied' : ''}`}
          onClick={async () => setCopied(await copyText(value))}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="share-field-hint">{hint}</p>
    </div>
  )
}

export interface ShareMenuProps {
  isShared: boolean
  canEdit: boolean
  viewUrl?: string
  editUrl?: string
  creating: boolean
  createError?: string
  onCreate: () => Promise<boolean>
}

function ShareMenu({ isShared, canEdit, viewUrl, editUrl, creating, createError, onCreate }: ShareMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mcpUrl = `${window.location.origin}/api/mcp`

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="share-wrapper" ref={wrapperRef}>
      <button
        className={`toolbar-button share-button ${open ? 'active' : ''} ${isShared ? 'is-shared' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={isShared ? 'Share links' : 'Share this flowchart'}
        aria-label="Share"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6.5 9.5l3-3" />
          <path d="M7.2 4.3l1.1-1.1a2.6 2.6 0 013.7 3.7l-1.1 1.1" />
          <path d="M8.8 11.7l-1.1 1.1a2.6 2.6 0 01-3.7-3.7l1.1-1.1" />
        </svg>
        <span className="share-button-label">Share</span>
      </button>

      {open && (
        <div className="share-panel" role="dialog" aria-label="Share flowchart">
          <h2 className="share-panel-title">Share this flowchart</h2>
          {!isShared ? (
            <>
              <p className="share-panel-text">
                Get a link to this chart. Changes save automatically, and anyone you give the edit link to (a teammate or an AI
                agent) can edit it with you in real time.
              </p>
              <button type="button" className="share-primary-button" onClick={() => void onCreate()} disabled={creating}>
                {creating ? 'Creating link…' : 'Create share link'}
              </button>
              {createError && <p className="share-panel-error">{createError}</p>}
            </>
          ) : (
            <>
              {viewUrl && (
                <CopyField label="View link" value={viewUrl} hint="Anyone with this link can view the chart." />
              )}
              {canEdit && editUrl && (
                <CopyField
                  label="Edit link"
                  chip="Can edit"
                  value={editUrl}
                  hint="Anyone with this link can edit, including AI agents. Share it carefully."
                />
              )}
              <div className="share-panel-divider" />
              <CopyField
                label="MCP server"
                chip="AI agents"
                value={mcpUrl}
                hint="Add this remote MCP server to Claude, Cursor, VS Code or OpenCode to create and edit charts from your agent."
              />
              <p className="share-panel-footer">
                <a href="/mcp" target="_blank" rel="noopener">
                  MCP setup guide
                </a>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ShareMenu
