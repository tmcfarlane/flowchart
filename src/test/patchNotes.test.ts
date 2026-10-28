import { describe, expect, it } from 'vitest'
import { PATCH_NOTES } from '../patchNotes'

describe('published patch notes', () => {
  it('has unique, positive, descending safe revisions and complete release content', () => {
    let previous = Infinity
    expect(PATCH_NOTES.length).toBeGreaterThan(0)
    for (const note of PATCH_NOTES) {
      expect(Number.isSafeInteger(note.revision)).toBe(true)
      expect(note.revision).toBeGreaterThan(0)
      expect(note.revision).toBeLessThan(previous)
      previous = note.revision
      expect(note.publishedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(note.publishedOn).toISOString().slice(0, 10)).toBe(note.publishedOn)
      expect(note.title.trim()).not.toBe('')
      expect(note.highlights.length).toBeGreaterThan(0)
      for (const highlight of note.highlights) expect(highlight.trim()).not.toBe('')
    }
  })
})
