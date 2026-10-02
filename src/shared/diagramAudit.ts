// Deterministic, local diagram feedback. No chart is saved, no model is called,
// and image URLs are inspected as text without contacting their hosts.
import {
  parseAndValidateChart,
  type ValidationIssue,
} from './flowSchema.js'
import { resolveIconRef } from './icons.js'
import type { ChartEdge, DraftNode } from './flowTypes.js'

export interface DiagramFinding {
  severity: 'error' | 'warning' | 'info'
  code: string
  path: string
  message: string
  suggestion: string
}

export interface DiagramAudit {
  valid: boolean
  summary: string
  findings: DiagramFinding[]
  metrics: { nodeCount: number; edgeCount: number; decisionCount: number; connectedComponents: number }
  normalized: { nodes: DraftNode[]; edges: ChartEdge[] } | null
}

const asFinding = (issue: ValidationIssue): DiagramFinding => ({
  severity: 'error', code: 'invalid_document', path: issue.path,
  message: issue.message, suggestion: 'Fix this field and audit the draft again before saving it.',
})

/** Accepts untrusted drafts and returns all blocking problems plus design tips. */
export function auditDiagram(raw: { nodes: unknown; edges?: unknown }): DiagramAudit {
  const chart = parseAndValidateChart(raw, {
    resolveIcon: (ref, options) => {
      const result = resolveIconRef(ref, options)
      return { id: result.icon?.id, suggestions: result.suggestions.map(({ id, name }) => ({ id, name })) }
    },
  })
  if (!chart.issues.length && !chart.nodes.length) chart.issues.push({ path: 'nodes', message: 'add at least one node' })
  const errors = Math.max(chart.issueCount ?? 0, chart.issues.length)
  if (errors) return {
    valid: false, summary: `Fix ${errors} validation problem${errors === 1 ? '' : 's'} before saving this diagram.`,
    findings: chart.issues.map(asFinding),
    metrics: { nodeCount: Array.isArray(raw.nodes) ? raw.nodes.length : 0, edgeCount: Array.isArray(raw.edges) ? raw.edges.length : 0, decisionCount: 0, connectedComponents: 0 },
    normalized: null,
  }
  const { nodes, edges } = chart
  const findings: DiagramFinding[] = []
  const add = (severity: DiagramFinding['severity'], code: string, path: string, message: string, suggestion: string) => {
    if (findings.length < 60) findings.push({ severity, code, path, message, suggestion })
  }

  const incoming = new Map(nodes.map((node) => [node.id, [] as ChartEdge[]]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as ChartEdge[]]))
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const item of edges) {
    incoming.get(item.target)?.push(item)
    outgoing.get(item.source)?.push(item)
    neighbors.get(item.source)?.add(item.target)
    neighbors.get(item.target)?.add(item.source)
  }
  const content = nodes.filter((node) => node.type !== 'note' && node.type !== 'container')
  const contentIds = new Set(content.map((node) => node.id))
  const seen = new Set<string>()
  let connectedComponents = 0
  for (const node of content) {
    if (seen.has(node.id)) continue
    connectedComponents++
    const queue = [node.id]
    seen.add(node.id)
    for (let i = 0; i < queue.length; i++) {
      for (const next of neighbors.get(queue[i]) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
  }
  if (connectedComponents > 1) add('warning', 'disconnected_components', 'edges', `The main diagram has ${connectedComponents} disconnected groups.`, 'Connect related groups, or make their separation intentional with labeled containers.')

  nodes.forEach((node, index) => {
    const path = `nodes[${index}]`
    const exits = outgoing.get(node.id) ?? []
    if (!node.label.trim()) add('warning', 'empty_label', `${path}.label`, 'This node has no visible label.', 'Give it a short action, question, or system name.')
    else if (node.label.length > 80) add('info', 'long_label', `${path}.label`, 'This label may be hard to scan on the canvas.', 'Keep one idea in the node; move supporting detail into a note.')
    if (node.type === 'decision') {
      if (exits.length < 2) add('warning', 'incomplete_decision', path, `Decision "${node.label}" has ${exits.length} outgoing branch${exits.length === 1 ? '' : 'es'}.`, 'Add at least two meaningful outcomes, such as Yes and No.')
      const labels = exits.map((item) => item.label?.trim().toLowerCase()).filter((label): label is string => !!label)
      if (exits.some((item) => !item.label?.trim())) add('warning', 'unlabeled_decision', path, `A branch from "${node.label}" has no label.`, 'Label every outgoing decision edge so readers can follow each outcome.')
      if (new Set(labels).size !== labels.length) add('warning', 'duplicate_outcomes', path, `Decision "${node.label}" repeats an outcome label.`, 'Use distinct labels for each branch, or merge equivalent outcomes.')
    }
    if (node.type === 'container' && !nodes.some((child) => child.parentNode === node.id)) add('info', 'empty_container', path, `Container "${node.label}" is empty.`, 'Place related nodes inside it using parentNode, or remove the unused boundary.')
    if (content.length > 1 && contentIds.has(node.id) && !(incoming.get(node.id)?.length || exits.length)) add('warning', 'isolated_node', path, `Node "${node.label}" has no connections.`, 'Connect it to the relevant flow, or use a note if it is context.')
    if (node.imageUrl?.startsWith('https://')) add('info', 'external_image', `${path}.imageUrl`, 'Viewing this diagram can contact an external image host.', 'Prefer a local icon id from search_icons when an illustration fits.')
  })
  edges.forEach((item, index) => {
    if (item.source === item.target) add('info', 'self_loop', `edges[${index}]`, 'This edge loops back to the same node.', 'Add a short label explaining the retry or repeated action.')
  })
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length
  return {
    valid: true,
    summary: warningCount ? `Valid diagram with ${warningCount} design suggestion${warningCount === 1 ? '' : 's'} to review.` : 'Valid diagram. No blocking problems or design warnings found.',
    findings,
    metrics: { nodeCount: nodes.length, edgeCount: edges.length, decisionCount: nodes.filter((node) => node.type === 'decision').length, connectedComponents },
    normalized: { nodes, edges },
  }
}
