import { memo, useState, useCallback, useEffect } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import './NodeStyles.css'

export type ArchKind =
  | 'service'
  | 'database'
  | 'queue'
  | 'cache'
  | 'apiGateway'
  | 'externalActor'

const KIND_CLASS: Record<ArchKind, string> = {
  service: 'service-node',
  database: 'database-node',
  queue: 'queue-node',
  cache: 'cache-node',
  apiGateway: 'api-gateway-node',
  externalActor: 'external-actor-node',
}

const MIN_SIZE: Record<ArchKind, { width: number; height: number }> = {
  service: { width: 140, height: 70 },
  database: { width: 130, height: 90 },
  queue: { width: 160, height: 60 },
  cache: { width: 130, height: 70 },
  apiGateway: { width: 140, height: 80 },
  externalActor: { width: 120, height: 80 },
}

const GLYPHS: Record<ArchKind, JSX.Element> = {
  service: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M2 6h12" />
      <circle cx="4.5" cy="4" r="0.5" fill="currentColor" />
    </svg>
  ),
  database: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
      <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" />
      <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
    </svg>
  ),
  queue: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M5 4v8M8.5 4v8" />
      <path d="M11 8h2" />
    </svg>
  ),
  cache: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" />
    </svg>
  ),
  apiGateway: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 1.5h7l3 6.5-3 6.5h-7l-3-6.5 3-6.5z" />
      <path d="M5.5 8h5M8.5 6l2 2-2 2" />
    </svg>
  ),
  externalActor: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="4.5" r="2.5" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  ),
}

function ArchNodeBase({ kind, data, id, selected }: NodeProps & { kind: ArchKind }) {
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

  const min = MIN_SIZE[kind]

  return (
    <>
      <NodeResizer
        minWidth={min.width}
        minHeight={min.height}
        isVisible={selected}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <div className={`arch-node ${KIND_CLASS[kind]} ${selected ? 'selected' : ''}`}>
        {kind === 'apiGateway' && (
          <>
            <div className="gateway-border" />
            <div className="gateway-shape" />
          </>
        )}

        <Handle type="target" position={Position.Top} id="top" />
        <Handle type="target" position={Position.Right} id="right" />
        <Handle type="target" position={Position.Bottom} id="bottom" />
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Top} id="top" />
        <Handle type="source" position={Position.Right} id="right" />
        <Handle type="source" position={Position.Bottom} id="bottom" />
        <Handle type="source" position={Position.Left} id="left" />

        <div className="arch-node-content">
          <span className="arch-node-glyph" aria-hidden="true">
            {data.imageUrl ? (
              <img src={data.imageUrl} alt="" draggable={false} />
            ) : (
              GLYPHS[kind]
            )}
          </span>
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
      </div>
    </>
  )
}

export const ServiceNode = memo((props: NodeProps) => <ArchNodeBase kind="service" {...props} />)
export const DatabaseNode = memo((props: NodeProps) => <ArchNodeBase kind="database" {...props} />)
export const QueueNode = memo((props: NodeProps) => <ArchNodeBase kind="queue" {...props} />)
export const CacheNode = memo((props: NodeProps) => <ArchNodeBase kind="cache" {...props} />)
export const ApiGatewayNode = memo((props: NodeProps) => <ArchNodeBase kind="apiGateway" {...props} />)
export const ExternalActorNode = memo((props: NodeProps) => <ArchNodeBase kind="externalActor" {...props} />)
