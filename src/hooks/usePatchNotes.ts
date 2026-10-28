import { useState } from 'react'
import { PATCH_NOTES } from '../patchNotes'

const SEEN_REVISION_KEY = 'flowchart-patch-notes-seen-revision'
type PatchNotesVisibility = 'automatic' | 'manual' | 'closed'

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
  const [visibility, setVisibility] = useState<PatchNotesVisibility>(() =>
    readSeenRevision() < PATCH_NOTES[0].revision ? 'automatic' : 'closed',
  )

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_REVISION_KEY, String(PATCH_NOTES[0].revision))
    } catch {}
    setVisibility('closed')
  }

  return {
    isOpen: visibility === 'manual' || (visibility === 'automatic' && canAutomaticallyOpen),
    open: () => setVisibility('manual'),
    dismiss,
  }
}
