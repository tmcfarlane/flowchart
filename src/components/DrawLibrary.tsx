import { useEffect, useId, useRef, useState } from 'react'
import type { ArchitectureScene } from '../shared/architectureScene'
import { serializedByteLength, validateArchitectureScene } from '../shared/architectureScene'
import { expandSelection, getSceneBounds, newDrawId } from '../utils/drawScene'
import DrawSceneSvg from './DrawSceneSvg'
import './DrawLibrary.css'

export interface DrawLibraryProps {
  scene: ArchitectureScene
  selectedIds: ReadonlySet<string>
  onInsert: (component: ArchitectureScene) => void | boolean
}

export interface DrawingComponent {
  id: string
  name: string
  scene: ArchitectureScene
}

const STORAGE_KEY = 'flowchart-draw-components-v1'
const MAX_COMPONENTS = 24
const MAX_LIBRARY_BYTES = 2 * 1024 * 1024
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Keep a reusable selection intact, detaching links that leave the component. */
export function buildDrawingComponent(scene: ArchitectureScene, selectedIds: ReadonlySet<string>): ArchitectureScene {
  const selected = new Set(expandSelection(scene, selectedIds))
  const live = scene.elements.filter(element => !element.isDeleted)
  // A connector between two selected shapes belongs to the component, even if
  // the user selected the shapes individually rather than drawing a marquee.
  for (const element of live) {
    if (element.type === 'arrow' && record(element.startBinding) && record(element.endBinding) && selected.has(String(element.startBinding.elementId)) && selected.has(String(element.endBinding.elementId))) selected.add(String(element.id))
  }
  for (const id of expandSelection(scene, selected)) selected.add(id)
  const originals = live.filter(element => selected.has(String(element.id)))
  if (!originals.length) throw new Error('Select objects on the canvas before saving a component.')
  const ids = new Set(originals.map(element => String(element.id)))
  const graphIds = new Set(originals.flatMap(element => {
    const metadata = record(element.customData) && record(element.customData.flowchart) ? element.customData.flowchart : undefined
    return metadata?.kind === 'node' && typeof metadata.id === 'string' ? [metadata.id] : []
  }))
  const elements = originals.map(original => {
    const element = clone(original)
    for (const field of ['frameId', 'containerId']) if (typeof element[field] === 'string' && !ids.has(element[field] as string)) element[field] = null
    for (const field of ['startBinding', 'endBinding']) if (record(element[field]) && !ids.has(String(element[field].elementId))) element[field] = null
    if (Array.isArray(element.boundElements)) element.boundElements = element.boundElements.filter(bound => record(bound) && ids.has(String(bound.id)))
    if (Array.isArray(element.boundElementIds)) element.boundElementIds = element.boundElementIds.filter(id => typeof id === 'string' && ids.has(id))
    if (record(element.customData) && record(element.customData.flowchart)) {
      const metadata = element.customData.flowchart
      const snapshot = record(metadata.snapshot) ? metadata.snapshot : undefined
      if ((metadata.kind === 'edge' && (!snapshot || !graphIds.has(String(snapshot.source)) || !graphIds.has(String(snapshot.target)))) || (metadata.kind === 'icon' && !graphIds.has(String(metadata.id)))) {
        // A free connector/icon cannot retain an active reference to a graph
        // outside this component, but its visible geometry stays untouched.
        const { flowchart: _removed, ...remaining } = element.customData
        element.customData = remaining
      } else if (snapshot && typeof snapshot.parentNode === 'string' && !graphIds.has(snapshot.parentNode)) {
        delete snapshot.parentNode
      }
    }
    return element
  })
  const assets = new Set(elements.flatMap(element => element.type === 'image' && typeof element.fileId === 'string' ? [element.fileId] : []))
  const files = Object.fromEntries(Object.entries(scene.files).filter(([id]) => assets.has(id)).map(([id, file]) => [id, clone(file)]))
  return validateArchitectureScene({ version: 1, elements, files, ...(scene.appState ? { appState: clone(scene.appState) } : {}) })
}

interface LibraryState { items: DrawingComponent[]; error?: string; blocked?: boolean }
function readLibrary(): LibraryState {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (!value) return { items: [] }
    const parsed: unknown = JSON.parse(value)
    if (!record(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items) || parsed.items.length > MAX_COMPONENTS) throw new Error('Unsupported library format')
    const ids = new Set<string>()
    const items = parsed.items.map(value => {
      if (!record(value) || typeof value.id !== 'string' || !value.id || ids.has(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60) throw new Error('Invalid component')
      ids.add(value.id)
      return { id: value.id, name: value.name, scene: validateArchitectureScene(value.scene) }
    })
    if (serializedByteLength(parsed) > MAX_LIBRARY_BYTES) throw new Error('Library is too large')
    return { items }
  } catch {
    return { items: [], error: 'Your saved components could not be read. Reset the library to save new components.', blocked: true }
  }
}

/** First-party, browser-local reusable multi-object drawing components. */
export default function DrawLibrary({ scene, selectedIds, onInsert }: DrawLibraryProps) {
  const [library, setLibrary] = useState<LibraryState>(readLibrary)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panelId = `draw-library-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const button = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const count = scene.elements.filter(element => !element.isDeleted && selectedIds.has(String(element.id))).length

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY) setLibrary(readLibrary()) }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => {
    if (!open) return
    nameInput.current?.focus()
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const persist = (items: DrawingComponent[]) => {
    const data = { version: 1, items }
    if (items.length > MAX_COMPONENTS) throw new Error(`Keep up to ${MAX_COMPONENTS} components. Delete an unused one before saving another.`)
    if (serializedByteLength(data) > MAX_LIBRARY_BYTES) throw new Error('These components are too large for the library. Use fewer objects or smaller images.')
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }
    catch { throw new Error('Browser storage is full. Your existing components are unchanged. Remove an unused component or use smaller images.') }
    setLibrary({ items })
  }
  const save = () => {
    setError(null); setNotice(null)
    try {
      if (library.blocked) throw new Error(library.error)
      const label = name.trim()
      if (!label) throw new Error('Give this component a name.')
      if (library.items.some(item => item.name.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error('A component with this name already exists. Choose a different name.')
      const component = buildDrawingComponent(scene, selectedIds)
      persist([...library.items, { id: newDrawId('component'), name: label, scene: component }])
      setName(''); setNotice(`Saved “${label}”.`)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this component.') }
  }
  const remove = (item: DrawingComponent) => {
    setError(null); setNotice(null)
    try { persist(library.items.filter(component => component.id !== item.id)); setNotice(`Deleted “${item.name}”.`) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not delete this component.') }
  }

  return <div ref={wrapper} className="draw-library" onKeyDown={event => {
    if (!open) return
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus() }
  }}>
    <button ref={button} type="button" className="draw-library-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(value => !value); setError(null); setNotice(null) }}>
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/></svg>
      Components
    </button>
    {open && <aside id={panelId} className="draw-library-panel" role="dialog" aria-modal="false" aria-labelledby={`${panelId}-title`}>
      <div className="draw-library-heading"><div><strong id={`${panelId}-title`}>Your components</strong><span>Reusable objects, saved in this browser</span></div><button type="button" aria-label="Close components" onClick={() => { setOpen(false); button.current?.focus() }}>×</button></div>
      <form className="draw-library-save" onSubmit={event => { event.preventDefault(); save() }}>
        <label htmlFor={`${panelId}-name`}>Component name</label>
        <input ref={nameInput} id={`${panelId}-name`} value={name} maxLength={60} placeholder="e.g. API with cache" onChange={event => setName(event.target.value)} disabled={library.blocked} />
        <button type="submit" disabled={!count || !name.trim() || library.blocked}>Save selection <span>{count ? `${count} ${count === 1 ? 'object' : 'objects'}` : 'Select objects first'}</span></button>
      </form>
      {(error || library.error) && <p className="draw-library-error" role="alert">{error || library.error}</p>}
      {library.blocked && <button className="draw-library-reset" type="button" onClick={() => { try { persist([]); setError(null); setNotice('Component library reset.') } catch (error) { setError(error instanceof Error ? error.message : 'Could not reset the library.') } }}>Reset components</button>}
      {notice && <p className="draw-library-notice" role="status">{notice}</p>}
      <div className="draw-library-items">
        {!library.items.length && !library.blocked && <div className="draw-library-empty"><strong>Build once. Use it again.</strong><p>Select a few objects, name the component, and save it here.</p></div>}
        {library.items.map(item => {
          const bounds = getSceneBounds(item.scene.elements), padding = Math.max(12, Math.min(bounds.width, bounds.height) * 0.08)
          return <div key={item.id} className="draw-library-item">
            <button type="button" className="draw-library-insert" aria-label={`Insert ${item.name}`} onClick={() => {
              setError(null); setNotice(null)
              try { if (onInsert(clone(validateArchitectureScene(item.scene))) !== false) setNotice(`Added “${item.name}”.`) }
              catch (error) { setError(error instanceof Error ? error.message : 'Could not insert this component.') }
            }}>
              <svg aria-hidden="true" viewBox={`${bounds.x - padding} ${bounds.y - padding} ${Math.max(1, bounds.width + padding * 2)} ${Math.max(1, bounds.height + padding * 2)}`}><DrawSceneSvg elements={item.scene.elements} files={item.scene.files} darkMode={false} backgroundColor="#f6faf8" /></svg>
              <span className="draw-library-item-name">{item.name}</span><span className="draw-library-item-count">{item.scene.elements.length} objects · Insert ↗</span>
            </button>
            <button type="button" className="draw-library-delete" aria-label={`Delete component ${item.name}`} onClick={() => remove(item)} title={`Delete ${item.name}`}>×</button>
          </div>
        })}
      </div>
    </aside>}
  </div>
}
