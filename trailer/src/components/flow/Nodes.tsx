import React from 'react'
import { Img, staticFile } from 'remotion'
import { C, FONT } from '../../theme'

// Dark-mode node visuals, reproduced from src/components/nodes/NodeStyles.css.

export type NodeType = 'step' | 'decision' | 'note' | 'image'
export type HandleSide = 'top' | 'right' | 'bottom' | 'left'

export type ChartNode = {
  id: string
  type: NodeType
  label: string
  icon?: string
  position: { x: number; y: number }
  width: number
  height: number
}

export type ChartEdge = {
  id: string
  source: string
  target: string
  label?: string
  style?: string
  sourceHandle?: HandleSide
  targetHandle?: HandleSide
}

export type Chart = { nodes: ChartNode[]; edges: ChartEdge[] }

const label: React.CSSProperties = {
  fontFamily: FONT.sans,
  fontSize: 14,
  fontWeight: 500,
  color: C.text,
  maxWidth: 200,
  overflowWrap: 'break-word',
  textAlign: 'center',
  lineHeight: 1.2,
}

const box: React.CSSProperties = {
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
}

export const StepNode: React.FC<{ label: string }> = ({ label: text }) => (
  <div
    style={{
      ...box,
      padding: '16px 20px',
      borderRadius: 8,
      background: C.stepBg,
      border: `2px solid ${C.mint}`,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 20px rgba(120, 252, 214, 0.1)',
    }}
  >
    <div style={label}>{text}</div>
  </div>
)

const diamond = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'

export const DecisionNode: React.FC<{ label: string }> = ({ label: text }) => (
  <div style={box}>
    <div style={{ position: 'absolute', inset: 0, background: C.decision, clipPath: diamond }} />
    <div style={{ position: 'absolute', inset: 3, background: C.decisionBg, clipPath: diamond }} />
    <div style={{ ...label, maxWidth: '60%', position: 'relative' }}>{text}</div>
  </div>
)

export const NoteNode: React.FC<{ label: string }> = ({ label: text }) => (
  <div
    style={{
      ...box,
      padding: '16px 20px',
      borderRadius: 8,
      background: C.noteBg,
      border: `2px dashed ${C.note}`,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 212, 59, 0.1)',
    }}
  >
    <div style={label}>{text}</div>
  </div>
)

export const ImageNode: React.FC<{ label: string; icon?: string }> = ({ label: text, icon }) => (
  <div
    style={{
      ...box,
      flexDirection: 'column',
      gap: 8,
      padding: '12px 10px',
      background: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: 12,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        padding: 6,
        boxSizing: 'border-box',
        background: 'rgba(240, 243, 242, 0.88)',
      }}
    >
      {icon && <Img src={staticFile(`icons/${icon}.svg`)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
    </div>
    <span
      style={{
        fontFamily: FONT.sans,
        fontSize: 11,
        fontWeight: 500,
        color: 'rgba(231, 236, 235, 0.7)',
        textAlign: 'center',
        lineHeight: 1.3,
        maxWidth: '100%',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}
    >
      {text}
    </span>
  </div>
)

export const NodeView: React.FC<{ node: ChartNode }> = ({ node }) => {
  switch (node.type) {
    case 'decision':
      return <DecisionNode label={node.label} />
    case 'note':
      return <NoteNode label={node.label} />
    case 'image':
      return <ImageNode label={node.label} icon={node.icon} />
    default:
      return <StepNode label={node.label} />
  }
}
