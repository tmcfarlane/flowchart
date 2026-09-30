import { memo, useState, useCallback, useEffect } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'

type ContainerKind = 'vpc' | 'cluster' | 'region' | 'zone' | 'trustBoundary' | 'group'

const KIND_LABEL: Record<ContainerKind, string> = {
  vpc: 'VPC',
  cluster: 'Cluster',
  region: 'Region',
  zone: 'Zone',
  trustBoundary: 'Trust boundary',
  group: 'Group',
}

function ContainerNode({ data, id, selected }: NodeProps) {
  const kind: ContainerKind =
    data.containerKind && data.containerKind in KIND_LABEL ? data.containerKind : 'group'

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
        minWidth={220}
        minHeight={140}
        isVisible={selected}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <div className={`container-node container-${kind} ${selected ? 'selected' : ''}`}>
        <Handle type="target" position={Position.Top} id="top" />
        <Handle type="target" position={Position.Right} id="right" />
        <Handle type="target" position={Position.Bottom} id="bottom" />
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Top} id="top" />
        <Handle type="source" position={Position.Right} id="right" />
        <Handle type="source" position={Position.Bottom} id="bottom" />
        <Handle type="source" position={Position.Left} id="left" />

        <div className="container-node-header">
          <span className="container-kind-badge">{KIND_LABEL[kind]}</span>
          {isEditing ? (
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              autoFocus
              className="node-input container-label-input"
            />
          ) : (
            <span className="container-node-label" onDoubleClick={handleDoubleClick}>
              {label}
            </span>
          )}
        </div>
      </div>
    </>
  )
}

export default memo(ContainerNode)
