import type { DiagramTemplate } from './diagramTemplates.js'

// Normalize both sides identically so ids, punctuation and casing do not
// create different matches in browser discovery and MCP discovery.
function tokens(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/** All query words may match across different template fields. Empty queries
 * (including punctuation-only queries) leave category filtering unchanged. */
export function matchesTemplateQuery(template: DiagramTemplate, query: string): boolean {
  const words = tokens(query)
  const text = tokens([template.id, template.title, template.description, template.category, ...template.nodes.map(node => node.label)].join(' ')).join(' ')
  return words.every(word => text.includes(word))
}
