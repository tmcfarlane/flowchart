import { App } from '@modelcontextprotocol/ext-apps'
import { MAX_PREVIEW_ZOOM, renderDiagramPreview, type PreviewController } from './preview'

// Capabilities stay in this closure and direct UI requests. Never widget state,
// DOM attributes, logs, messages, tool calls, or model-visible context.
const app = new App({ name: 'Flowchart AI diagram card', version: '2.0.0' }, {}, { autoResize: true })
const title = document.querySelector<HTMLHeadingElement>('#title')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const diagram = document.querySelector<SVGSVGElement>('#diagram')!
const previewFrame = document.querySelector<HTMLDivElement>('.preview-frame')!
const previewNote = document.querySelector<HTMLParagraphElement>('#preview-note')!
const zoomIn = document.querySelector<HTMLButtonElement>('#zoom-in')!
const zoomOut = document.querySelector<HTMLButtonElement>('#zoom-out')!
const fit = document.querySelector<HTMLButtonElement>('#fit')!
const edit = document.querySelector<HTMLButtonElement>('#edit')!
const remove = document.querySelector<HTMLButtonElement>('#delete')!
const confirm = document.querySelector<HTMLDivElement>('#confirmation')!
const commit = document.querySelector<HTMLButtonElement>('#confirm-delete')!
const cancel = document.querySelector<HTMLButtonElement>('#cancel-delete')!
const origin = document.body.dataset.origin!
type Capability = { id: string; editUrl: string; editToken: string }
let capability: Capability | undefined
let preview: PreviewController | undefined
let previewScale = 1
const pendingDeletes = new Set<string>()
const deletedIds = new Set<string>()

function showDeleted() {
  preview = undefined
  zoom(0)
  diagram.replaceChildren()
  diagram.style.display = 'none'
  previewFrame.hidden = true
  previewNote.textContent = 'This chart has been deleted.'
  confirm.hidden = true
  status.textContent = 'Chart deleted from Flowchart AI. Its links no longer work. Copies already downloaded or included in chat remain.'
}

function zoom(factor: number) {
  const centerX = previewFrame.scrollLeft + previewFrame.clientWidth / 2
  const centerY = previewFrame.scrollTop + previewFrame.clientHeight / 2
  const scale = preview?.zoom(factor) ?? 1
  zoomIn.disabled = !preview || scale >= MAX_PREVIEW_ZOOM
  zoomOut.disabled = fit.disabled = !preview || scale <= 1
  if (factor === 0) previewFrame.scrollTop = previewFrame.scrollLeft = 0
  else {
    // Keep the same part of the diagram visible as its SVG grows. Otherwise
    // narrow, tall charts move outside the viewport when centered SVGs zoom.
    const ratio = scale / previewScale
    previewFrame.scrollLeft = Math.max(0, centerX * ratio - previewFrame.clientWidth / 2)
    previewFrame.scrollTop = Math.max(0, centerY * ratio - previewFrame.clientHeight / 2)
  }
  previewScale = scale
}
zoomIn.onclick = () => zoom(1.35)
zoomOut.onclick = () => zoom(1 / 1.35)
fit.onclick = () => zoom(0)

app.ontoolresult = (result) => {
  capability = undefined
  edit.disabled = remove.disabled = true
  commit.disabled = cancel.disabled = false
  confirm.hidden = true
  const publicData = result.structuredContent as { title?: unknown } | undefined
  title.textContent = typeof publicData?.title === 'string' ? publicData.title.slice(0, 200) : 'Flowchart'
  preview = renderDiagramPreview(diagram, previewNote, result._meta?.['flowchart/chart'])
  previewFrame.hidden = !preview
  zoom(0)
  const candidate = result._meta?.['flowchart/private'] as Partial<Capability> | undefined
  if (!candidate || typeof candidate.id !== 'string' || !/^[A-Za-z0-9]{10}$/.test(candidate.id) || typeof candidate.editToken !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(candidate.editToken)) {
    status.textContent = 'Private controls are unavailable in this host. Use the view link in the conversation. Never paste an edit link into chat.'
    return
  }
  // Exact origin, chart id, and encoded fragment; no redirects or fallback URLs.
  if (candidate.editUrl !== origin + '/f/' + candidate.id + '#edit=' + encodeURIComponent(candidate.editToken)) {
    status.textContent = 'Private controls are unavailable because the editor destination is invalid.'
    return
  }
  if (deletedIds.has(candidate.id)) { showDeleted(); return }
  capability = { id: candidate.id, editUrl: candidate.editUrl, editToken: candidate.editToken }
  if (pendingDeletes.has(candidate.id)) {
    commit.disabled = cancel.disabled = true
    status.textContent = 'Deleting chart…'
    return
  }
  edit.disabled = remove.disabled = false
  status.textContent = 'Anyone with the view link can read this chart. The private edit link allows editing and deletion. No account owns it. Retained indefinitely unless server retention is configured or you delete it. Save your edit link in the browser; it cannot be recovered from chat.'
}
edit.onclick = async () => {
  const selected = capability
  if (!selected) return
  edit.disabled = true
  try {
    const result = await app.openLink({ url: selected.editUrl })
    if (result.isError && capability === selected) status.textContent = 'The host could not open the editor. Try again in a host that supports opening links.'
  } catch {
    if (capability === selected) status.textContent = 'The host could not open the editor. Try again in a host that supports opening links.'
  } finally {
    if (capability === selected && !pendingDeletes.has(selected.id)) edit.disabled = false
  }
}
remove.onclick = () => { if (capability) confirm.hidden = false }
cancel.onclick = () => { confirm.hidden = true }
commit.onclick = async () => {
  const selected = capability
  if (!selected || pendingDeletes.has(selected.id)) return
  pendingDeletes.add(selected.id)
  commit.disabled = cancel.disabled = true
  edit.disabled = remove.disabled = true
  status.textContent = 'Deleting chart…'
  try {
    // Direct UI-to-REST request; never tools/call with a capability argument.
    const response = await fetch(origin + '/api/flows/' + selected.id, {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + selected.editToken }, credentials: 'omit',
    })
    if (!response.ok && response.status !== 404) throw new Error('Deletion failed')
    deletedIds.add(selected.id)
    if (deletedIds.size > 20) deletedIds.delete(deletedIds.values().next().value!)
    if (capability?.id !== selected.id) return
    capability = undefined
    showDeleted()
  } catch {
    if (capability?.id !== selected.id) return
    status.textContent = 'Could not delete the chart. Try again later or open the browser editor to delete it.'
    edit.disabled = remove.disabled = false
  } finally {
    pendingDeletes.delete(selected.id)
    if (capability?.id === selected.id) commit.disabled = cancel.disabled = false
  }
}
void app.connect().catch(() => {
  capability = undefined
  edit.disabled = remove.disabled = true
  confirm.hidden = true
  status.textContent = 'This host does not support private chart controls. Use the view link. Never paste edit links into chat.'
})
