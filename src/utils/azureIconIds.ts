// Maps stable Azure icon ids (used in shared chart documents) to the Vite asset
// URLs the browser renders, and back. Asset URLs are hashed or inlined in
// production builds, so documents store ids rather than URLs.

import { iconIdFromPath } from '../shared/iconIds'
import { svgModules } from './azureIconRegistry'

const idToUrl = new Map<string, string>()
const urlToId = new Map<string, string>()

// Sorted so duplicate icons (same service in several folders) resolve to the
// same file the server's generated index picked.
for (const path of Object.keys(svgModules).sort()) {
  const id = iconIdFromPath(path)
  const url = svgModules[path]
  if (!id || !url) continue
  if (!idToUrl.has(id)) idToUrl.set(id, url)
  if (!urlToId.has(url)) urlToId.set(url, id)
}

export function getAzureIconUrl(id: string): string | undefined {
  return idToUrl.get(id)
}

export function getAzureIconId(url: string): string | undefined {
  return urlToId.get(url)
}
