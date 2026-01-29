import { memo, useState, useCallback } from 'react'
import { NodeProps } from 'reactflow'
import './NodeStyles.css'

function NoteNode({ data, id }: NodeProps) {
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
    <div className="custom-node note-node">
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
    </div>
  )
}

export default memo(NoteNode)
