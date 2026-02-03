import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  getSmoothStepPath,
} from 'reactflow'

interface EditableEdgeData {
  onLabelChange?: (edgeId: string, label: string) => void
}

type EditableEdgeProps = EdgeProps<EditableEdgeData>

export function EditableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  label,
  data,
}: EditableEdgeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(typeof label === 'string' ? label : '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Get the edge path
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Update edit value when label changes externally
  useEffect(() => {
    setEditValue(typeof label === 'string' ? label : '')
  }, [label])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Start editing on double-click when selected
  const handleDoubleClick = useCallback(() => {
    if (selected) {
      setIsEditing(true)
    }
  }, [selected])

  // Save the label
  const saveLabel = useCallback(() => {
    if (data?.onLabelChange) {
      data.onLabelChange(id, editValue)
    }
    setIsEditing(false)
  }, [data, id, editValue])

  // Handle key press
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      saveLabel()
    } else if (e.key === 'Escape') {
      setEditValue(typeof label === 'string' ? label : '')
      setIsEditing(false)
    }
  }, [saveLabel, label])

  // Handle blur
  const handleBlur = useCallback(() => {
    // Small delay to allow click events to process
    setTimeout(() => {
      saveLabel()
    }, 100)
  }, [saveLabel])

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
      />
      {(isEditing || label || selected) && (
        <EdgeLabelRenderer>
          <div
            className={`editable-edge-label ${selected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            onDoubleClick={handleDoubleClick}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                className="editable-edge-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder="Label..."
              />
            ) : (
              <span className={`editable-edge-text ${!label && selected ? 'hint' : ''}`}>
                {label || (selected ? 'Double-click to edit' : '')}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export function EditableSmoothStepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  label,
  data,
}: EditableEdgeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(typeof label === 'string' ? label : '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Get the edge path
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Update edit value when label changes externally
  useEffect(() => {
    setEditValue(typeof label === 'string' ? label : '')
  }, [label])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Start editing on double-click when selected
  const handleDoubleClick = useCallback(() => {
    if (selected) {
      setIsEditing(true)
    }
  }, [selected])

  // Save the label
  const saveLabel = useCallback(() => {
    if (data?.onLabelChange) {
      data.onLabelChange(id, editValue)
    }
    setIsEditing(false)
  }, [data, id, editValue])

  // Handle key press
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      saveLabel()
    } else if (e.key === 'Escape') {
      setEditValue(typeof label === 'string' ? label : '')
      setIsEditing(false)
    }
  }, [saveLabel, label])

  // Handle blur
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      saveLabel()
    }, 100)
  }, [saveLabel])

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
      />
      {(isEditing || label || selected) && (
        <EdgeLabelRenderer>
          <div
            className={`editable-edge-label ${selected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            onDoubleClick={handleDoubleClick}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                className="editable-edge-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder="Label..."
              />
            ) : (
              <span className={`editable-edge-text ${!label && selected ? 'hint' : ''}`}>
                {label || (selected ? 'Double-click to edit' : '')}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
