import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Share.css'
import { forgetEditToken, parseSharedLocation } from '../utils/shareApi'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    const focused = document.activeElement
    try {
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      area.remove()
      if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true })
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
          data-share-initial-focus
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
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const removeChart = async () => {
    if (!editUrl || deleting) return
    const link = new URL(editUrl)
    const shared = parseSharedLocation(link)
    if (!shared?.token) return
    setDeleting(true)
    setDeleteError('')
    try {
      const response = await fetch(`/api/flows/${shared.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${shared.token}` },
      })
      if (!response.ok && response.status !== 404) throw new Error('Could not delete chart. Try again later.')
      forgetEditToken(shared.id)
      window.location.assign('/')
    } catch {
      setDeleteError('Could not delete chart. Try again later.')
      setDeleting(false)
    }
  }
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const [position, setPosition] = useState({ top: 12, left: 12, maxHeight: 'calc(100dvh - 24px)' })
  const mcpUrl = `${window.location.origin}/api/mcp`

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!trigger) return
      const width = Math.min(440, Math.max(0, window.innerWidth - 24))
      const below = trigger.bottom + 10
      // A short viewport needs the full screen height for the scrollable panel.
      const top = window.innerHeight - below - 12 < 240 ? 12 : Math.max(12, below)
      setPosition({ top, left: Math.max(12, Math.min(trigger.right - width, window.innerWidth - width - 12)), maxHeight: `${Math.max(0, window.innerHeight - top - 12)}px` })
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const initial = panel?.querySelector<HTMLElement>('[data-share-initial-focus]:not(:disabled)') ?? panel?.querySelector<HTMLElement>('.share-panel-close')
    initial?.focus({ preventScroll: true })
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node
      if (!wrapperRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setOpen(false) }
      if (e.key === 'Tab') {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])
        const first = controls[0], last = controls[controls.length - 1]
        if (!first || !last) return
        if (e.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
      if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => { if (!open) setDeleteConfirm(false) }, [open])

  return (
    <div className="share-wrapper" ref={wrapperRef}>
      <button
        ref={triggerRef}
        className={`toolbar-button share-button ${open ? 'active' : ''} ${isShared ? 'is-shared' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={isShared ? 'Share links' : 'Share this flowchart'}
        aria-label="Share"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6.5 9.5l3-3" />
          <path d="M7.2 4.3l1.1-1.1a2.6 2.6 0 013.7 3.7l-1.1 1.1" />
          <path d="M8.8 11.7l-1.1 1.1a2.6 2.6 0 01-3.7-3.7l1.1-1.1" />
        </svg>
        <span className="share-button-label">Share</span>
      </button>

      {open && createPortal(
        <div ref={panelRef} id={panelId} className="share-panel" style={position} role="dialog" aria-modal="true" aria-label="Share flowchart">
          <div className="share-panel-header"><h2 className="share-panel-title">Share this flowchart</h2><button type="button" className="share-panel-close" aria-label="Close share panel" onClick={() => setOpen(false)}>×</button></div>
          {!isShared ? (
            <>
              <p className="share-panel-text">
                Save a link-shared chart. Anyone with its view link can read it. Anyone with its edit link can edit or delete it. No account owns it. It is retained indefinitely unless server retention is configured or you delete it. Do not include confidential information.
              </p>
              <button type="button" className="share-primary-button" data-share-initial-focus onClick={() => void onCreate()} disabled={creating}>
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
                  hint="Anyone with this link can edit or delete. Keep it private; never paste it into AI chat."
                />
              )}
              <p className="share-panel-text">{viewUrl ? 'Link-shared; no account ownership. Retained indefinitely unless server retention is configured or an edit-link holder deletes it.' : 'This shared link is unavailable. Export a copy to keep your current canvas.'}</p>
              {canEdit && editUrl && (
                <div>
                  {!deleteConfirm ? (
                    <button type="button" className="share-secondary-button" onClick={() => setDeleteConfirm(true)}>
                      Delete shared chart…
                    </button>
                  ) : (
                    <>
                      <p className="share-panel-text">
                        Delete permanently? All links stop working. Downloaded copies and chat content remain.
                      </p>
                      <button type="button" className="share-secondary-button" disabled={deleting} onClick={() => void removeChart()}>
                        {deleting ? 'Deleting…' : 'Delete permanently'}
                      </button>
                      <button type="button" className="share-secondary-button" disabled={deleting} onClick={() => setDeleteConfirm(false)}>
                        Cancel
                      </button>
                    </>
                  )}
                  {deleteError && <p role="alert" className="share-panel-error">{deleteError}</p>}
                </div>
              )}
              <div className="share-panel-divider" />
              <CopyField
                label="MCP server"
                chip="AI agents"
                value={mcpUrl}
                hint="Add this remote MCP server to Claude, Cursor, VS Code or OpenCode to create charts and revised copies from your agent."
              />
              <p className="share-panel-footer">
                <a href="/mcp" target="_blank" rel="noopener">
                  MCP setup guide
                </a>
              </p>
            </>
          )}
        </div>, document.querySelector('.app') ?? document.body
      )}
    </div>
  )
}

export default ShareMenu
