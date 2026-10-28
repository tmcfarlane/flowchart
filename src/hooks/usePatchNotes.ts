import { useState } from 'react'
import { PATCH_NOTES } from '../patchNotes'

const SEEN_REVISION_KEY = 'flowchart-patch-notes-seen-revision'
type PatchNotesVisibility = 'automatic' | 'manual' | 'closed'
type PatchNotesState = { seenRevision: number; visibility: PatchNotesVisibility }

function readSeenRevision(): number {
  try {
    const saved = localStorage.getItem(SEEN_REVISION_KEY)
    if (!saved || !/^\d+$/.test(saved)) return 0
    const revision = Number(saved)
    return Number.isSafeInteger(revision) ? revision : 0
  } catch {
    return 0
  }
}

export function usePatchNotes(canAutomaticallyOpen: boolean) {
  const [state, setState] = useState<PatchNotesState>(() => {
    const seenRevision = readSeenRevision()
    return { seenRevision, visibility: seenRevision < PATCH_NOTES[0].revision ? 'automatic' : 'closed' }
  })

  const dismiss = () => {
    const seenRevision = Math.max(state.seenRevision, readSeenRevision(), PATCH_NOTES[0].revision)
    try {
      localStorage.setItem(SEEN_REVISION_KEY, String(seenRevision))
    } catch {}
    setState({ seenRevision, visibility: 'closed' })
  }

  return {
    isOpen: state.visibility === 'manual' || (state.visibility === 'automatic' && canAutomaticallyOpen),
    open: () => setState(current => ({ ...current, visibility: 'manual' })),
    dismiss,
  }
}
