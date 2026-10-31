import { memo, useState, useCallback, useEffect } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'

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

  return (
    <>
      <NodeResizer
        minWidth={60}
        minHeight={60}
        isVisible={selected}
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
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
            autoFocus
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
