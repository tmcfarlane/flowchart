import { useEffect, useState } from 'react'
import type { SharedFlowApi } from '../hooks/useSharedFlow'
import { copyText } from './ShareMenu'
import './Share.css'

const FLASH_MS = 4000

function statusText(api: SharedFlowApi, flashing: boolean): { text: string; flash?: boolean; warning?: boolean } {
  const { state } = api
  if (state.status === 'synced' && flashing && state.lastRemoteUpdate) {
    return {
      text: state.lastRemoteUpdate.via === 'mcp' ? 'Updated by AI agent' : 'Updated elsewhere',
      flash: true,
    }
  }
  switch (state.status) {
    case 'loading':
      return { text: 'Opening…' }
    case 'saving':
      return { text: 'Saving…' }
    case 'error':
      return { text: state.canEdit ? 'Not saved' : 'View only', warning: state.canEdit }
    case 'conflict':
      return { text: 'Changed elsewhere', warning: true }
    case 'not-found':
      return { text: 'Link unavailable', warning: true }
    default:
      return { text: state.canEdit ? 'Saved' : 'Read-only link' }
  }
}

function TitleEditor({ title, canEdit, onRename }: { title: string; canEdit: boolean; onRename: (t: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  if (editing) {
    const commit = () => {
      setEditing(false)
      if (draft.trim() && draft.trim() !== title) onRename(draft.trim())
    }
    return (
      <input
        className="share-badge-title-input"
        value={draft}
        maxLength={200}
        autoFocus
        aria-label="Chart title"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className="share-badge-title"
      disabled={!canEdit}
      title={canEdit ? 'Rename chart' : title}
      onClick={() => {
        setDraft(title)
        setEditing(true)
      }}
    >
      {title || 'Untitled flowchart'}
    </button>
  )
}

export default function ShareStatus({ shared, onMakeLocalCopy, copyError }: { shared: SharedFlowApi; onMakeLocalCopy?: () => void; copyError?: string | null }) {
  const { state } = shared
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const remoteAt = state.lastRemoteUpdate?.at
  useEffect(() => {
    if (!remoteAt) return
    setNow(Date.now())
    const timer = window.setTimeout(() => setNow(Date.now()), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [remoteAt])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!state.id) return null

  if (state.status === 'not-found' && state.version === 0) {
    return (
      <div className="share-overlay">
        <div className="share-overlay-card" role="alert">
          <h2>This flowchart doesn't exist</h2>
          <p>The link may be incomplete, or the chart was never saved.</p>
          <button type="button" className="share-primary-button" onClick={() => window.location.assign('/')}>
            Start a new flowchart
          </button>
        </div>
      </div>
    )
  }

  if (state.status === 'load-error') {
    return (
      <div className="share-overlay">
        <div className="share-overlay-card" role="alert">
          <h2>Couldn't open this flowchart</h2>
          <p>{state.error ?? 'Something went wrong while loading it.'}</p>
          <button type="button" className="share-primary-button" onClick={shared.retryLoad}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const flashing = !!remoteAt && now - remoteAt < FLASH_MS
  const status = statusText(shared, flashing)

  return (
    <>
      {state.status === 'loading' && (
        <div className="share-overlay">
          <div className="share-overlay-card" role="status">
            <div className="share-spinner" aria-hidden="true" />
            <h2>Opening shared flowchart…</h2>
          </div>
        </div>
      )}

      <div
        className={`share-badge status-${state.status} ${state.canEdit ? '' : 'is-readonly'}`}
        role="status"
        aria-live="polite"
        aria-label="Shared flowchart status"
      >
        <span className="share-badge-dot" aria-hidden="true" />
        <span className="share-badge-kind">{state.canEdit ? 'Shared' : 'View only'}</span>
        <span className="share-badge-sep" aria-hidden="true" />
        <TitleEditor key={`${state.id}:${state.canEdit}`} title={state.title} canEdit={state.canEdit} onRename={shared.rename} />
        <span
          className={`share-badge-status ${status.flash ? 'flash' : ''} ${status.warning ? 'is-warning' : ''}`}
          title={state.error ?? `Version ${state.version}`}
        >
          {status.text}
        </span>
        {shared.viewUrl && (
          <button
            type="button"
            className="share-badge-copy"
            onClick={async () => setCopied(await copyText(shared.viewUrl!))}
            title="Copy the view-only link"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {copied ? (
                <path d="M3 8.5l3.2 3L13 4.5" />
              ) : (
                <>
                  <path d="M6.5 9.5l3-3" />
                  <path d="M7.2 4.3l1.1-1.1a2.6 2.6 0 013.7 3.7l-1.1 1.1" />
                  <path d="M8.8 11.7l-1.1 1.1a2.6 2.6 0 01-3.7-3.7l1.1-1.1" />
                </>
              )}
            </svg>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        )}
        {!state.canEdit && state.version > 0 && onMakeLocalCopy && <div className="share-local-copy"><p>Edits here are temporary and aren’t saved to the original.</p><button type="button" className="share-primary-button" onClick={onMakeLocalCopy}>Make editable copy</button></div>}
        {copyError && <p className="share-local-copy-error" role="alert">{copyError}</p>}
      </div>

      {state.status === 'conflict' && (
        <div className="share-notice" role="alert">
          <span className="share-notice-text">
            This chart was changed elsewhere{state.conflictVersion ? ` (version ${state.conflictVersion})` : ''} while you had
            unsaved edits. Nothing has been overwritten.
            {state.error && <span> {state.error}</span>}
          </span>
          <span className="share-notice-actions">
            <button type="button" className="share-primary-button" onClick={() => void shared.loadLatest()}>
              Load latest
            </button>
            {state.canEdit && (
              <button type="button" className="share-secondary-button" onClick={() => void shared.keepMine()}>
                Keep my version
              </button>
            )}
          </span>
        </div>
      )}

      {(state.status === 'error' || state.status === 'not-found') && state.error && (
        <div className="share-notice" role="alert">
          <span className="share-notice-text">{state.error}</span>
        </div>
      )}
    </>
  )
}
