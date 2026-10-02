import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Node, Edge } from 'reactflow'
import { auditDiagram, type DiagramFinding } from '../shared/diagramAudit'
import { flowToChart } from '../utils/sharedFlow'
import './DiagramInsights.css'

export interface DiagramInsightsProps {
  nodes: Node[]
  edges: Edge[]
  onFocusNode: (id: string) => void
  onClose: () => void
}

type Filter = 'all' | DiagramFinding['severity']
const severityNames = { error: 'Needs attention', warning: 'Suggestion', info: 'Detail' } as const

function nodeForFinding(finding: DiagramFinding, nodes: Node[], edges: Edge[]): Node | undefined {
  const nodeIndex = /^nodes\[(\d+)\]/.exec(finding.path)
  if (nodeIndex) return nodes[Number(nodeIndex[1])]
  const edgeIndex = /^edges\[(\d+)\]/.exec(finding.path)
  const edge = edgeIndex ? edges[Number(edgeIndex[1])] : undefined
  return edge ? nodes.find((node) => node.id === edge.source) ?? nodes.find((node) => node.id === edge.target) : undefined
}

/** Mount when opened. Reads the current canvas; only explicit focus/close actions leave the dialog. */
export default function DiagramInsights({ nodes, edges, onFocusNode, onClose }: DiagramInsightsProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const [filter, setFilter] = useState<Filter>('all')
  const report = useMemo(() => auditDiagram(flowToChart(nodes, edges)), [nodes, edges])
  const counts = useMemo(() => ({
    error: report.findings.filter((finding) => finding.severity === 'error').length,
    warning: report.findings.filter((finding) => finding.severity === 'warning').length,
    info: report.findings.filter((finding) => finding.severity === 'info').length,
  }), [report])
  const findings = report.findings.filter((finding) => filter === 'all' || finding.severity === filter).slice(0, 60)
  const decisionCount = nodes.filter((node) => node.type === 'decision').length
  const healthy = report.valid && !counts.warning

  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      } else if (event.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
        if (!controls?.length) return
        const first = controls[0], last = controls[controls.length - 1]
        if (!dialogRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus() }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <div className="diagram-insights-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="diagram-insights" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <header className="diagram-insights-header">
          <div><span className="diagram-insights-eyebrow"><span aria-hidden="true">✦</span> A little clarity goes a long way</span><h2 id={titleId}>Look at the connections.</h2><p id={descriptionId}>A fresh perspective on your diagram’s structure and readability.</p></div>
          <button ref={closeRef} type="button" className="diagram-insights-close" aria-label="Close diagram insights" onClick={onClose}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
        </header>
        <dl className="diagram-insights-metrics" aria-label="Diagram metrics">
          <div><dt>Nodes</dt><dd>{nodes.length}</dd></div><div><dt>Connections</dt><dd>{edges.length}</dd></div><div><dt>Decisions</dt><dd>{decisionCount}</dd></div><div><dt>Connected groups</dt><dd>{report.valid ? report.metrics.connectedComponents : '—'}</dd></div>
        </dl>
        <div className={`diagram-insights-summary ${!report.valid ? 'has-errors' : healthy ? 'is-clear' : 'has-suggestions'}`} role="status" aria-live="polite">
          <span aria-hidden="true">{!report.valid ? '!' : healthy ? '✓' : '◇'}</span><div><strong>{!report.valid ? 'A few things need attention.' : counts.warning ? 'A few connections could be clearer.' : 'Your connections look clear.'}</strong><p>{report.summary}</p></div>
        </div>
        {report.findings.length > 0 && <div className="diagram-insights-filters" role="group" aria-label="Insight filters">
          <button type="button" aria-pressed={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All checks <span>{report.findings.length}</span></button>
          {(['error', 'warning', 'info'] as const).filter((severity) => counts[severity] > 0).map((severity) => <button key={severity} type="button" aria-pressed={filter === severity} className={filter === severity ? 'active' : ''} onClick={() => setFilter(severity)}>{severity === 'error' ? 'Needs attention' : severity === 'warning' ? 'Suggestions' : 'Details'} <span>{counts[severity]}</span></button>)}
        </div>}
        <div className="diagram-insights-scroll">
          {findings.length ? <ol className="diagram-insights-findings" aria-label="Diagram checks">{findings.map((finding, index) => {
            const node = nodeForFinding(finding, nodes, edges)
            const nodeLabel = typeof node?.data?.label === 'string' && node.data.label.trim() ? node.data.label.slice(0, 80) : node?.id
            return <li key={`${finding.code}:${finding.path}:${index}`} className={`diagram-insight severity-${finding.severity}`}><span className="diagram-insight-mark" aria-hidden="true">{finding.severity === 'error' ? '!' : finding.severity === 'warning' ? '◇' : 'i'}</span><div className="diagram-insight-copy"><span className="diagram-insight-severity">{severityNames[finding.severity]}</span><h3>{finding.message}</h3><p>{finding.suggestion}</p>{node && <button type="button" onClick={() => { onFocusNode(node.id); onClose() }} aria-label={`Find ${nodeLabel} on canvas`}>Find on canvas <span aria-hidden="true">↗</span></button>}</div></li>
          })}</ol> : <div className="diagram-insights-empty"><span aria-hidden="true">{report.findings.length ? '⌕' : '✦'}</span><h3>{report.findings.length ? 'Nothing in this view.' : 'Room for the next idea.'}</h3><p>{report.findings.length ? 'Choose another filter to see the remaining checks.' : 'Your diagram has no blocking issues or design warnings. Keep exploring.'}</p>{report.findings.length > 0 && <button type="button" onClick={() => setFilter('all')}>Show all checks</button>}</div>}
          {report.findings.length >= 60 && <p className="diagram-insights-cap">Up to 60 findings are shown at once. Checks cover the full current diagram.</p>}
        </div>
        <footer className="diagram-insights-footer"><p>Local checks update as you edit. Your diagram stays unchanged.</p><button type="button" onClick={onClose}>Back to canvas <span aria-hidden="true">↗</span></button></footer>
      </div>
    </div>
  )
}
