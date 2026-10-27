import { useEffect, useRef } from 'react'
import type { ComponentProps } from 'react'
import type ArchitectureCanvas from '../../components/ArchitectureCanvas'
import type { ArchitectureScene } from '../../shared/architectureScene'

type Props = ComponentProps<typeof ArchitectureCanvas>
const emptyScene = (): ArchitectureScene => ({ version: 1, elements: [], files: {} })

/** App integration adapter: native rendering/hotkeys are verified in a browser.
 * This exposes the graph and scene callback contract without loading the
 * browser-only Excalidraw renderer inside JSDOM. */
export default function ArchitectureCanvasAdapter(props: Props) {
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    if (!props.onReady) return
    props.onReady({
      getScene: () => latest.current.scene ?? emptyScene(),
      viewportToScenePoint: point => point,
      fitScene: () => {},
      exportImage: async () => {},
      replaceScene: scene => latest.current.onChange(scene, latest.current.nodes, latest.current.edges),
    })
    return () => props.onReady?.(null)
  }, [props.onReady])

  const select = (id: string) => props.onChange(props.scene ?? emptyScene(), props.nodes.map(node => ({ ...node, selected: node.id === id })), props.edges.map(edge => ({ ...edge, selected: false })))

  return <section aria-label="Architecture drawing canvas" data-testid="architecture-canvas-adapter" data-presentation={props.viewMode || undefined}>
    {props.nodes.map(node => <div key={node.id} data-testid={`architecture-node-${node.id}`} data-node-type={node.type} data-container-kind={node.data.containerKind} data-parent-node={node.parentNode}>
      <button aria-label={`Select native node ${node.id}`} onClick={() => select(node.id)}>{node.data.label}</button>
      <input aria-label={`Native label ${node.id}`} value={node.data.label} onChange={event => props.onChange(props.scene ?? emptyScene(), props.nodes.map(current => current.id === node.id ? { ...current, data: { ...current.data, label: event.target.value } } : current), props.edges)} />
    </div>)}
    {props.edges.map(edge => <input key={edge.id} aria-label={`Restored edge label ${edge.id}`} value={String(edge.label ?? '')} onChange={event => edge.data?.onLabelChange?.(edge.id, event.target.value)} />)}
    {props.scene?.elements.filter(element => !element.isDeleted && element.type === 'text').map(element => <span key={String(element.id)}>{String(element.text ?? '')}</span>)}
    <button onClick={() => props.onChange({ ...(props.scene ?? emptyScene()), elements: [...(props.scene?.elements ?? []), { id: 'test-annotation', type: 'text', x: -120, y: 80, width: 180, height: 24, angle: 0.2, text: 'Native annotation', fontSize: 20, strokeColor: '#087f5b' }] }, props.nodes, props.edges)}>Add native annotation</button>
  </section>
}
