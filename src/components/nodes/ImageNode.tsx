import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import './NodeStyles.css'

function ImageNode({ data, selected }: NodeProps) {
  const imageUrl = data.imageUrl || ''
  const label = data.label || ''

  return (
    <>
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />

      <div className={`image-node ${selected ? 'selected' : ''}`}>
        {imageUrl ? (
          <>
            <div className="image-node-icon">
              <img
                src={imageUrl}
                alt={label || 'Image'}
                draggable={false}
              />
            </div>
            {label && <span className="image-node-label">{label}</span>}
          </>
        ) : (
          <div className="image-node-placeholder">No image</div>
        )}
      </div>
    </>
  )
}

export default memo(ImageNode)
