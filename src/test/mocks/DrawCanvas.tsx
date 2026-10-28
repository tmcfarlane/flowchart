import { useEffect, useRef } from 'react'
import type { ComponentProps } from 'react'
import type DrawCanvas from '../../components/DrawCanvas'
import type { ArchitectureScene } from '../../shared/architectureScene'

type Props = ComponentProps<typeof DrawCanvas>
const emptyScene = (): ArchitectureScene => ({ version: 1, elements: [], files: {} })

/** App-level tests isolate the controlled Draw boundary. The real SVG tools,
 * pointer gestures and history are exercised by DrawCanvas.test.tsx. */
export default function DrawCanvasAdapter(props: Props) {
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    if (!props.onReady) return
    props.onReady({
      getScene: () => latest.current.scene ?? emptyScene(),
      getSelectedIds: () => [],
      applySelectionEdit: () => false,
      viewportToScenePoint: point => point,
      fitScene: () => {},
      exportImage: async () => {},
      replaceScene: scene => latest.current.onChange(scene, latest.current.nodes, latest.current.edges),
    })
    return () => props.onReady?.(null)
  }, [props.onReady])

  const select = (id: string) => props.onChange(
    props.scene ?? emptyScene(),
    props.nodes.map(node => ({ ...node, selected: node.id === id })),
    props.edges.map(edge => ({ ...edge, selected: false })),
  )

  return <section aria-label="Draw canvas" data-testid="draw-canvas-adapter" data-presentation={props.viewMode || undefined}>
    {props.nodes.map(node => <div key={node.id} data-testid={`draw-node-${node.id}`} data-node-type={node.type} data-container-kind={node.data.containerKind} data-parent-node={node.parentNode}>
      <button aria-label={`Select drawing node ${node.id}`} onClick={() => select(node.id)}>{node.data.label}</button>
      <input aria-label={`Drawing label ${node.id}`} value={node.data.label} onChange={event => props.onChange(props.scene ?? emptyScene(), props.nodes.map(current => current.id === node.id ? { ...current, data: { ...current.data, label: event.target.value } } : current), props.edges)} />
    </div>)}
    {props.edges.map(edge => <input key={edge.id} aria-label={`Restored edge label ${edge.id}`} value={String(edge.label ?? '')} onChange={event => edge.data?.onLabelChange?.(edge.id, event.target.value)} />)}
    {props.scene?.elements.filter(element => !element.isDeleted && element.type === 'text').map(element => <span key={String(element.id)}>{String(element.text ?? '')}</span>)}
    <button onClick={() => props.onChange({ ...(props.scene ?? emptyScene()), elements: [...(props.scene?.elements ?? []), { id: 'test-annotation', type: 'text', x: -120, y: 80, width: 180, height: 24, angle: 0.2, text: 'Drawing annotation', fontSize: 20, strokeColor: '#087f5b' }] }, props.nodes, props.edges)}>Add drawing annotation</button>
  </section>
}
