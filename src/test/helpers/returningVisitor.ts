import { PATCH_NOTES } from '../../patchNotes'

export function seedReturningVisitor() {
  localStorage.setItem('flowchart-patch-notes-seen-revision', String(PATCH_NOTES[0].revision))
}
