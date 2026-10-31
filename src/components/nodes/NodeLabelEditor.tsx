import { useLayoutEffect, useRef } from 'react'

interface NodeLabelEditorProps {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  className?: string
  'aria-label'?: string
}

/**
 * Inline label editor shared by all node types. Enter commits; Shift+Enter
 * inserts a line break. The textarea grows with its content.
 */
export default function NodeLabelEditor({ value, onChange, onCommit, className = 'node-input', 'aria-label': ariaLabel }: NodeLabelEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        // React Flow's document key listener treats a held Shift as its
        // selection key and cancels the keydown, which would swallow the newline
        e.stopPropagation()
        // isComposing: Enter confirms an IME candidate rather than submitting
        if (!e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onCommit()
        }
      }}
      autoFocus
      className={`node-label-editor nodrag ${className}`}
      aria-label={ariaLabel}
    />
  )
}
