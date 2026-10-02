import { DIAGRAM_TEMPLATES } from '../shared/diagramTemplates'

export const TEMPLATE_FAVORITES_KEY = 'flowchart.template-favorites.v1'
const knownIds = new Set(DIAGRAM_TEMPLATES.map(template => template.id))
const MAX_STORED_CHARACTERS = 4096

/** Preferences contain only known local template IDs, never diagram content. */
export function parseTemplateFavorites(raw: string | null): string[] {
  if (!raw || raw.length > MAX_STORED_CHARACTERS) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const record = value as { version?: unknown; ids?: unknown }
    if (record.version !== 1 || !Array.isArray(record.ids)) return []
    return [...new Set(record.ids.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))].slice(0, knownIds.size)
  } catch { return [] }
}

export function readTemplateFavorites(): string[] {
  return parseTemplateFavorites(localStorage.getItem(TEMPLATE_FAVORITES_KEY))
}

export function applyTemplateFavoriteChanges(ids: string[], changes: Record<string, boolean>): string[] {
  const selected = new Set(ids.filter(id => knownIds.has(id)))
  for (const [id, favorite] of Object.entries(changes)) {
    if (!knownIds.has(id)) continue
    if (favorite) selected.add(id)
    else selected.delete(id)
  }
  return DIAGRAM_TEMPLATES.filter(template => selected.has(template.id)).map(template => template.id)
}

export function setTemplateFavorite(id: string, favorite: boolean, fallback: string[], pendingChanges: Record<string, boolean> = {}): { ids: string[]; persisted: boolean } {
  // Read the latest preference immediately before changing one ID, so an
  // older open gallery does not overwrite unrelated favorites from another tab.
  let previous = fallback.filter(value => knownIds.has(value))
  let readable = true
  try {
    previous = parseTemplateFavorites(localStorage.getItem(TEMPLATE_FAVORITES_KEY))
  } catch { readable = false }
  const ids = applyTemplateFavoriteChanges(previous, { ...pendingChanges, [id]: favorite })
  // A blocked read must not overwrite preferences we could not inspect.
  if (!readable) return { ids, persisted: false }
  try {
    if (ids.length) localStorage.setItem(TEMPLATE_FAVORITES_KEY, JSON.stringify({ version: 1, ids }))
    else localStorage.removeItem(TEMPLATE_FAVORITES_KEY)
    if (JSON.stringify(parseTemplateFavorites(localStorage.getItem(TEMPLATE_FAVORITES_KEY))) !== JSON.stringify(ids)) return { ids, persisted: false }
    return { ids, persisted: true }
  } catch { return { ids, persisted: false } }
}
