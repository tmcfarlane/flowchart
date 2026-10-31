import { memo, useState, useCallback, useEffect, useRef } from 'react'
import { Handle, Position, NodeProps, useStoreApi, type NodeChange } from 'reactflow'
import { NodeResizer, type OnResizeStart, type ResizeParams, type ShouldResize } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'
import NodeLabelEditor from './NodeLabelEditor'

const MIN_SIZE = 60

function ImageNode({ data, id, selected }: NodeProps) {
  const imageUrl = data.imageUrl || ''
  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState<string>(data.label || '')

  // Sync local state when data.label changes externally (e.g., from Explorer)
  useEffect(() => {
    if (!isEditing) setLabel(data.label || '')
  }, [data.label, isEditing])

  const commit = useCallback(() => {
    setIsEditing(false)
    data.onLabelChange?.(id, label)
  }, [data, id, label])

  // Holding Cmd (Ctrl on Windows) while resizing keeps the node square. The
  // resizer's keepAspectRatio keeps the starting ratio and is fixed when the
  // drag begins, so instead veto its update and apply a square one, anchored at
  // the corner opposite the handle, through the same node-change pipeline.
  const store = useStoreApi()
  const resizeStart = useRef<(ResizeParams & { fromLeft: boolean; fromTop: boolean }) | null>(null)
  // Stable identities: the resizer rebinds its drag handlers when these change
  const onResizeStart = useCallback<OnResizeStart>((event, params) => {
    // The resize control's classes name its position, e.g. "top left"
    const control = (event.sourceEvent?.target as Element | null)?.closest('.react-flow__resize-control')
    resizeStart.current = { ...params, fromLeft: !!control?.classList.contains('left'), fromTop: !!control?.classList.contains('top') }
  }, [])
  const onResizeEnd = useCallback(() => { resizeStart.current = null }, [])
  const shouldResize = useCallback<ShouldResize>((event, next) => {
    const pointer = event.sourceEvent as MouseEvent | undefined
    const start = resizeStart.current
    if (!start || !(pointer?.metaKey || pointer?.ctrlKey)) return true
    const widthChanged = next.width !== start.width, heightChanged = next.height !== start.height
    // An edge handle drives one side; a corner follows whichever side is larger
    const size = Math.max(MIN_SIZE, widthChanged && !heightChanged ? next.width : heightChanged && !widthChanged ? next.height : Math.max(next.width, next.height))
    const changes: NodeChange[] = [
      { id, type: 'dimensions', updateStyle: true, resizing: true, dimensions: { width: size, height: size } },
    ]
    // Keep the edges opposite the grabbed handle fixed
    if (start.fromLeft || start.fromTop) {
      changes.push({ id, type: 'position', position: { x: start.fromLeft ? start.x + start.width - size : start.x, y: start.fromTop ? start.y + start.height - size : start.y } })
    }
    store.getState().triggerNodeChanges(changes)
    return false
  }, [id, store])

  return (
    <>
      <NodeResizer
        minWidth={MIN_SIZE}
        minHeight={MIN_SIZE}
        isVisible={selected}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
        shouldResize={shouldResize}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />

      <div className={`image-node ${selected ? 'selected' : ''}`} onDoubleClick={() => setIsEditing(true)}>
        {imageUrl ? (
          <div className="image-node-icon">
            <img
              src={imageUrl}
              alt={label || 'Image'}
              draggable={false}
            />
          </div>
        ) : (
          <div className="image-node-placeholder">No image</div>
        )}
        {isEditing ? (
          <NodeLabelEditor
            value={label}
            onChange={setLabel}
            onCommit={commit}
            className="node-input image-node-input"
            aria-label="Image label"
          />
        ) : (
          label && <span className="image-node-label">{label}</span>
        )}
      </div>
    </>
  )
}

export default memo(ImageNode)
