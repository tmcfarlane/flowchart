import { memo, useState, useCallback } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import './NodeStyles.css'

function StepNode({ data, id }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState(data.label)

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true)
  }, [])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    // Update node data through React Flow's state management
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
    <div className="custom-node step-node">
      <Handle type="target" position={Position.Top} />
      {isEditing ? (
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
          className="node-input"
        />
      ) : (
        <div className="node-label" onDoubleClick={handleDoubleClick}>
          {label}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export default memo(StepNode)
