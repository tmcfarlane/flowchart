import { memo, useState, useCallback, useEffect } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'

function DecisionNode({ data, id, selected }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState(data.label)

  // Sync local state when data.label changes externally (e.g., from Explorer)
  useEffect(() => {
    if (!isEditing) {
      setLabel(data.label)
    }
  }, [data.label, isEditing])

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
        minWidth={140}
        minHeight={140}
        isVisible={selected}
        keepAspectRatio={true}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <div className={`decision-node ${selected ? 'selected' : ''}`}>
        <div className="decision-border" />
        <div className="decision-diamond" />

        <Handle type="source" position={Position.Top} id="top" />
        <Handle type="source" position={Position.Right} id="right" />
        <Handle type="source" position={Position.Bottom} id="bottom" />
        <Handle type="source" position={Position.Left} id="left" />

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
      </div>
    </>
  )
}

export default memo(DecisionNode)
