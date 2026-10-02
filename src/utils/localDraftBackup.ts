import { parseLocalDraft, type LocalDraft } from '../hooks/useLocalDraft'
import { parseDiagramJson } from './importFlow'

export interface DraftBackup {
  draft: LocalDraft | null
  portable: boolean
  content: string
  filename: string
}

/** Valid drafts download as an importable diagram; unverified data stays exact for salvage. */
export function prepareDraftBackup(raw: string): DraftBackup {
  const draft = parseLocalDraft(raw)
  if (draft) {
    const content = JSON.stringify({ version: 2, mode: draft.diagramMode, nodes: draft.flow.nodes, edges: draft.flow.edges }, null, 2)
    try {
      parseDiagramJson(content, { requireEdgeIds: true })
      return { draft, portable: true, content, filename: 'flowchart-saved-draft.json' }
    } catch { /* Retain data that current import rules cannot safely restore. */ }
  }
  return { draft, portable: false, content: raw, filename: 'flowchart-browser-draft-unverified-backup.txt' }
}
