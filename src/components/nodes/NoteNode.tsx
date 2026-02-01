import { memo, useState, useCallback } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'

function NoteNode({ data, id, selected }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState(data.label)

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true)
  }, [])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    if (data.onLabelChange) {
      data.onLabelChange(id, label)
    }
  }, [data, id, label])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        setIsEditing(false)
        if (data.onLabelChange) {
          data.onLabelChange(id, label)
        }
      }
    },
    [data, id, label]
  )

  return (
    <>
      <NodeResizer 
        minWidth={120} 
        minHeight={80} 
        isVisible={selected}
      />
      <div className={`custom-node note-node ${selected ? 'selected' : ''}`}>
        <Handle type="target" position={Position.Top} id="target-top" />
        <Handle type="target" position={Position.Right} id="target-right" />
        <Handle type="target" position={Position.Bottom} id="target-bottom" />
        <Handle type="target" position={Position.Left} id="target-left" />
        
        {isEditing ? (
          <textarea
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            className="node-textarea"
          />
        ) : (
          <div className="node-label" onDoubleClick={handleDoubleClick}>
            {label}
          </div>
        )}
        
        <Handle type="source" position={Position.Top} id="source-top" />
        <Handle type="source" position={Position.Right} id="source-right" />
        <Handle type="source" position={Position.Bottom} id="source-bottom" />
        <Handle type="source" position={Position.Left} id="source-left" />
      </div>
    </>
  )
}

export default memo(NoteNode)
