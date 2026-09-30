// Stable Azure icon ids derived from SVG file names. Tiny and data-free so the
// browser can use it without bundling the server-side icon index.
// Keep in sync with scripts/generate-azure-icon-index.mjs (a unit test checks it).

/** "10035-icon-service-App-Services.svg" -> "App-Services" */
export function iconNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.svg$/i, '')
    .replace(/^\d+-/, '')
    .replace(/^icon-service-/i, '')
    .replace(/\s+color icon$/i, '')
    .replace(/\s+icon$/i, '')
    .trim()
}

/** "Web-Application-Firewall-Policies(WAF)" -> "web-application-firewall-policies-waf" */
export function slugifyIconName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** "/assets/icons/.../10121-icon-service-Azure-Cosmos-DB.svg" -> "azure-cosmos-db" */
export function iconIdFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? path
  return slugifyIconName(iconNameFromFile(fileName))
}
