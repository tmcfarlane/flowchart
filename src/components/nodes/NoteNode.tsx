import { memo, useState, useCallback, useEffect } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'
import NodeLabelEditor from './NodeLabelEditor'

function NoteNode({ data, id, selected }: NodeProps) {
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


  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={100}
        isVisible={selected}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <div className={`note-node ${selected ? 'selected' : ''}`}>
        <Handle type="target" position={Position.Top} id="top" />
        <Handle type="target" position={Position.Right} id="right" />
        <Handle type="target" position={Position.Bottom} id="bottom" />
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Top} id="top" />
        <Handle type="source" position={Position.Right} id="right" />
        <Handle type="source" position={Position.Bottom} id="bottom" />
        <Handle type="source" position={Position.Left} id="left" />

        {isEditing ? (
          <NodeLabelEditor
            value={label}
            onChange={setLabel}
            onCommit={handleBlur}
            className="node-textarea"
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

export default memo(NoteNode)
