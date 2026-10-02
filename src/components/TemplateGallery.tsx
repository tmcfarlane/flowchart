import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { DIAGRAM_TEMPLATES, searchDiagramTemplates, type DiagramTemplate, type DiagramTemplateCategory } from '../shared/diagramTemplates'
import { applyTemplateFavoriteChanges, parseTemplateFavorites, readTemplateFavorites, setTemplateFavorite, TEMPLATE_FAVORITES_KEY } from '../utils/templateFavorites'
import './TemplateGallery.css'

interface TemplateGalleryProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (template: DiagramTemplate) => void
}

const categoryNames: Record<string, string> = {
  process: 'Processes',
  business: 'Business',
  cloud: 'Architecture',
  creative: 'Creative',
}
const categories = Array.from(new Set(DIAGRAM_TEMPLATES.map((template) => template.category)))

/** Small graph previews stay local; opening the gallery makes no network request. */
function previewLayout(template: DiagramTemplate) {
  const nodes = template.nodes.filter((node) => node.type !== 'container')
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Set<string>()
  const outgoing = new Map<string, string[]>()
  for (const edge of template.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) continue
    incoming.add(edge.target)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }
  const ranks = new Map<string, number>()
  const queue = nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id)
  for (const id of queue) ranks.set(id, 0)
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    for (const next of outgoing.get(id) ?? []) {
      if (ranks.has(next)) continue
      ranks.set(next, (ranks.get(id) ?? 0) + 1)
      queue.push(next)
    }
  }
  // A component made entirely of feedback loops still needs a starting point.
  for (const node of nodes) {
    if (ranks.has(node.id)) continue
    ranks.set(node.id, 0)
    const remaining = [node.id]
    for (let index = 0; index < remaining.length; index++) {
      for (const next of outgoing.get(remaining[index]) ?? []) {
        if (ranks.has(next)) continue
        ranks.set(next, (ranks.get(remaining[index]) ?? 0) + 1)
        remaining.push(next)
      }
    }
  }
  const levels = new Map<number, string[]>()
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0
    levels.set(rank, [...(levels.get(rank) ?? []), node.id])
  }
  const maxRank = Math.max(0, ...ranks.values())
  const position = new Map<string, { x: number; y: number }>()
  for (const [rank, ids] of levels) {
    ids.forEach((id, index) => {
      const along = maxRank ? rank / maxRank : 0.5
      const across = (index + 1) / (ids.length + 1)
      position.set(id, template.direction === 'LR'
        ? { x: 38 + along * 204, y: 14 + across * 112 }
        : { x: 10 + across * 260, y: 27 + along * 86 })
    })
  }
  const maxAcross = Math.max(1, ...Array.from(levels.values(), (ids) => ids.length))
  const scale = template.direction === 'LR'
    ? Math.min(1, 204 / Math.max(1, maxRank) / 70, 112 / maxAcross / 36)
    : Math.min(1, 86 / Math.max(1, maxRank) / 36, 260 / maxAcross / 70)
  return { nodes, position, scale }
}

const TemplatePreview = memo(function TemplatePreview({ template }: { template: DiagramTemplate }) {
  const markerId = useId()
  const { nodes, position, scale } = useMemo(() => previewLayout(template), [template])
  return (
    <svg className="template-preview-svg" viewBox="0 0 280 140" fill="none" aria-hidden="true">
      <defs>
        <marker id={markerId} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0 0L5 2.5L0 5" fill="currentColor" />
        </marker>
      </defs>
      <g className="template-preview-edges">
        {template.edges.map((edge, index) => {
          const source = position.get(edge.source)
          const target = position.get(edge.target)
          if (!source || !target) return null
          const horizontal = template.direction === 'LR'
          const sx = source.x + (horizontal ? 26 * scale : 0)
          const sy = source.y + (horizontal ? 0 : 11 * scale)
          const tx = target.x - (horizontal ? 28 * scale : 0)
          const ty = target.y - (horizontal ? 0 : 13 * scale)
          const mid = horizontal ? (sx + tx) / 2 : (sy + ty) / 2
          const path = horizontal
            ? `M${sx} ${sy}C${mid} ${sy} ${mid} ${ty} ${tx} ${ty}`
            : `M${sx} ${sy}C${sx} ${mid} ${tx} ${mid} ${tx} ${ty}`
          return <path key={edge.id ?? index} d={path} markerEnd={`url(#${markerId})`} />
        })}
      </g>
      {nodes.map((node) => {
        const point = position.get(node.id)
        if (!point) return null
        const isRound = node.type === 'externalActor' || node.type === 'image'
        return (
          <g key={node.id} className={`template-preview-node node-${node.type}`} transform={`translate(${point.x} ${point.y}) scale(${scale})`}>
            {node.type === 'decision' ? (
              <path d="M0 -17L30 0L0 17L-30 0Z" />
            ) : isRound ? (
              <rect x="-25" y="-12" width="50" height="24" rx="12" />
            ) : (
              <rect x="-27" y="-12" width="54" height="24" rx={node.type === 'database' ? 9 : 5} />
            )}
            <text textAnchor="middle" dominantBaseline="middle">{node.label.length > 11 ? `${node.label.slice(0, 10)}…` : node.label}</text>
          </g>
        )
      })}
    </svg>
  )
})

function GalleryContents({ onClose, onSelect }: Omit<TemplateGalleryProps, 'isOpen'>) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | 'favorites' | DiagramTemplateCategory>('all')
  const [favoritePreferences, setFavoritePreferences] = useState(() => {
    try { return { ids: readTemplateFavorites(), pending: {} as Record<string, boolean>, notice: null as string | null } }
    catch { return { ids: [] as string[], pending: {} as Record<string, boolean>, notice: 'Saved favorites could not be read. Allow browser storage and reopen this gallery to try again.' } }
  })
  const { ids: favorites, pending: pendingFavorites, notice: favoriteNotice } = favoritePreferences
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const templates = useMemo(() => {
    const matches = searchDiagramTemplates(query, category === 'all' || category === 'favorites' ? undefined : category)
    return category === 'favorites' ? matches.filter(template => favorites.includes(template.id)) : matches
  }, [query, category, favorites])

  const toggleFavorite = (template: DiagramTemplate) => {
    const adding = !favorites.includes(template.id)
    const result = setTemplateFavorite(template.id, adding, favorites, pendingFavorites)
    // Removing a filtered card also removes its focused control.
    if (!adding && category === 'favorites') searchRef.current?.focus()
    setFavoritePreferences({ ids: result.ids, pending: result.persisted ? {} : { ...pendingFavorites, [template.id]: adding }, notice: result.persisted
      ? `${template.title} ${adding ? 'added to' : 'removed from'} favorites.`
      : 'Favorites could not be saved. They will reset when you close this gallery.' })
  }

  useEffect(() => {
    const syncFavorites = (event: StorageEvent) => {
      if (event.key !== TEMPLATE_FAVORITES_KEY && event.key !== null) return
      try { if (event.storageArea && event.storageArea !== localStorage) return }
      catch { return }
      const ids = applyTemplateFavoriteChanges(event.key === null ? [] : parseTemplateFavorites(event.newValue), pendingFavorites)
      const focusedCard = document.activeElement?.closest<HTMLElement>('[data-template-id]')
      if (category === 'favorites' && focusedCard && !ids.includes(focusedCard.dataset.templateId ?? '')) searchRef.current?.focus()
      setFavoritePreferences(previous => ({ ...previous, ids, notice: Object.keys(previous.pending).length ? previous.notice : null }))
    }
    window.addEventListener('storage', syncFavorites)
    return () => window.removeEventListener('storage', syncFavorites)
  }, [category, pendingFavorites])

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <div className="template-gallery-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="template-gallery" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
        <header className="template-gallery-header">
          <div>
            <span className="template-gallery-eyebrow"><span aria-hidden="true">✦</span> A head start for your next idea</span>
            <h2 id={titleId}>Find your starting point.</h2>
            <p id={descriptionId}>Pick a living blueprint. Make it yours on the canvas.</p>
          </div>
          <button className="template-gallery-close" type="button" onClick={onClose} aria-label="Close template gallery">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>
        <div className="template-gallery-discovery">
          <label className="template-gallery-search">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <input ref={searchRef} type="search" aria-label="Search diagram templates" placeholder="Search ideas, processes, architectures…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="template-gallery-filters" role="group" aria-label="Template categories">
            <button type="button" className={category === 'all' ? 'active' : ''} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All ideas</button>
            <button type="button" className={category === 'favorites' ? 'active' : ''} aria-pressed={category === 'favorites'} onClick={() => setCategory('favorites')}>Favorites ({favorites.length})</button>
            {categories.map((value) => (
              <button key={value} type="button" className={category === value ? 'active' : ''} aria-pressed={category === value} onClick={() => setCategory(value)}>{categoryNames[value] ?? value}</button>
            ))}
          </div>
        </div>
        <div className="template-gallery-results" role="status" aria-live="polite">
          <span>{templates.length} {templates.length === 1 ? 'starting point' : 'starting points'}</span>
          <span className="template-gallery-local">Ready to customize</span>
        </div>
        {favoriteNotice && <p className="template-gallery-favorite-notice" role="status">{favoriteNotice}</p>}
        <div className="template-gallery-scroll">
          {templates.length ? (
            <div className="template-gallery-grid">
              {templates.map((template, index) => (
                <article key={template.id} data-template-id={template.id} className={`template-card template-category-${template.category}`}>
                  <button type="button" className="template-card-select" onClick={() => { onSelect(template); onClose() }} aria-label={`Use ${template.title} template`}>
                    <div className="template-card-art"><span className="template-card-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><TemplatePreview template={template} /></div>
                    <div className="template-card-copy">
                      <span className="template-card-category">{categoryNames[template.category] ?? template.category}</span>
                      <h3>{template.title}</h3>
                      <p>{template.description}</p>
                      <span className="template-card-footer"><span>{template.nodes.filter((node) => node.type !== 'container').length} nodes · {template.direction === 'LR' ? 'Horizontal' : 'Vertical'}</span><span className="template-card-action">Use template <span aria-hidden="true">↗</span></span></span>
                    </div>
                  </button>
                  <button type="button" className={`template-favorite${favorites.includes(template.id) ? ' active' : ''}`} aria-label={`Favorite ${template.title} template`} aria-pressed={favorites.includes(template.id)} title={favorites.includes(template.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(template)}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill={favorites.includes(template.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z" /></svg>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="template-gallery-empty">
              <span aria-hidden="true">⌕</span>
              <h3>{category === 'favorites' && !favorites.length ? 'Keep your best starting points close.' : 'No match in this constellation.'}</h3>
              <p>{category === 'favorites' && !favorites.length ? 'Use the star on a template to find it here next time.' : 'Try a broader idea, or explore every starting point.'}</p>
              <button type="button" onClick={() => { setQuery(''); setCategory('all'); searchRef.current?.focus() }}>Show all templates</button>
            </div>
          )}
        </div>
        <footer className="template-gallery-footer"><span>{category === 'favorites' ? 'Favorites stay in this browser.' : 'Every template is fully editable.'}</span><span>Choose a direction. Follow your imagination.</span></footer>
      </div>
    </div>
  )
}

export default function TemplateGallery({ isOpen, onClose, onSelect }: TemplateGalleryProps) {
  return isOpen ? <GalleryContents onClose={onClose} onSelect={onSelect} /> : null
}
