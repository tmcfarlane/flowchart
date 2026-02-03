import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'

function ImageNode({ data, selected }: NodeProps) {
  const imageUrl = data.imageUrl || ''
  const altText = data.label || 'Image'

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={80}
        isVisible={selected}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <div className={`image-node ${selected ? 'selected' : ''}`}>
        <Handle type="source" position={Position.Top} id="top" />
        <Handle type="source" position={Position.Right} id="right" />
        <Handle type="source" position={Position.Bottom} id="bottom" />
        <Handle type="source" position={Position.Left} id="left" />

        {imageUrl ? (
          <img
            src={imageUrl}
            alt={altText}
            className="image-node-content"
            draggable={false}
          />
        ) : (
          <div className="image-node-placeholder">No image</div>
        )}
      </div>
    </>
  )
}

export default memo(ImageNode)
