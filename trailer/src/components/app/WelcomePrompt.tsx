import React from 'react'
import { Img, staticFile } from 'remotion'
import { C, FONT } from '../../theme'

// Replica of the empty-canvas AI prompt (AIChat variant="welcome") in dark mode, values
// from src/components/AIChat.css.

const CHIPS = [
  { emoji: '🔐', text: 'User authentication flow' },
  { emoji: '📦', text: 'Product launch checklist' },
  { emoji: '🗺️', text: 'Plan a weekend road trip' },
  { emoji: '👥', text: 'Hiring pipeline' },
]

export type WelcomePromptProps = {
  typed: string
  caret: boolean
  pressed?: number // 0..1 button press
  loading?: { message: string; progress: number } | null
}

export const WelcomePrompt: React.FC<WelcomePromptProps> = ({ typed, caret, pressed = 0, loading }) => {
  const enabled = typed.trim().length > 0
  return (
    <div
      style={{
        width: 500,
        background: C.bg,
        border: `1px solid ${C.mintBorder}`,
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), 0 0 40px rgba(120, 252, 214, 0.15)',
        overflow: 'hidden',
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '16px 20px',
          background: 'linear-gradient(135deg, rgba(120, 252, 214, 0.15) 0%, rgba(0, 255, 182, 0.1) 100%)',
          borderBottom: `1px solid ${C.mintBorder}`,
        }}
      >
        <Img src={staticFile('brand/logo_color.svg')} style={{ width: 32, height: 32, marginRight: 10, flexShrink: 0 }} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            lineHeight: 1.2,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          <span style={{ background: C.mintTextGradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            FlowChart
          </span>
          <span style={{ fontSize: 11, fontWeight: 400, letterSpacing: 0.2, color: 'rgba(120, 252, 214, 0.7)' }}>
            by <span style={{ fontWeight: 500 }}>Zero Click Dev</span>
          </span>
        </div>
        <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mint, opacity: 0.7, marginRight: 4 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v8" />
            <path d="M4 6l4-4 4 4" />
            <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
          </svg>
        </div>
        <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mint, opacity: 0.9 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </div>
      </div>
      <div style={{ padding: 24, background: 'rgba(120, 252, 214, 0.02)' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(231, 236, 235, 0.7)' }}>{loading.message}</div>
            <div style={{ width: '100%', height: 3, background: 'rgba(39, 39, 42, 0.5)', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${loading.progress}%`,
                  height: '100%',
                  background: 'linear-gradient(to right, #10b981, #059669)',
                  borderRadius: 2,
                  boxShadow: '0 0 8px rgba(120, 252, 214, 0.3)',
                }}
              />
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: '0 0 20px 0', fontSize: 22, fontWeight: 700, lineHeight: 1.3, color: C.text, letterSpacing: -0.3 }}>
              What's your flow?
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {CHIPS.map((chip) => (
                <div
                  key={chip.text}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    background: 'rgba(120, 252, 214, 0.05)',
                    border: '1px solid rgba(120, 252, 214, 0.15)',
                    borderRadius: 10,
                    fontSize: 13,
                    lineHeight: 1.3,
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{chip.emoji}</span>
                  <span style={{ color: C.text, fontWeight: 500 }}>{chip.text}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, color: 'rgba(120, 252, 214, 0.4)', fontSize: 12, fontWeight: 500 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(120, 252, 214, 0.15)' }} />
              <span>or describe your own</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(120, 252, 214, 0.15)' }} />
            </div>
            <div
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                border: `2px solid ${C.mint}`,
                boxShadow: '0 0 0 3px rgba(120, 252, 214, 0.15)',
                borderRadius: 10,
                fontSize: 14,
                minHeight: 80,
                marginBottom: 16,
                background: 'rgba(120, 252, 214, 0.05)',
                color: typed ? C.text : 'rgba(120, 252, 214, 0.4)',
                lineHeight: 1.45,
              }}
            >
              {typed || (caret ? '' : 'Describe any process, workflow, or plan...')}
              {caret && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 1.5,
                    height: 17,
                    marginLeft: 1,
                    verticalAlign: 'text-bottom',
                    background: C.text,
                  }}
                />
              )}
              {!typed && caret && <span style={{ color: 'rgba(120, 252, 214, 0.4)' }}>Describe any process, workflow, or plan...</span>}
            </div>
            <div
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 20px',
                background: enabled ? 'linear-gradient(135deg, #78fcd6 0%, #00ffb6 100%)' : 'rgba(120, 252, 214, 0.1)',
                color: enabled ? C.bg : 'rgba(120, 252, 214, 0.3)',
                opacity: enabled ? 1 : 0.6,
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transform: `translateY(${-1 * pressed}px) scale(${1 - 0.02 * pressed})`,
                boxShadow: pressed > 0 ? `0 4px 12px rgba(120, 252, 214, ${0.4 * pressed})` : undefined,
              }}
            >
              Generate Flowchart
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ transform: 'rotate(180deg)' }}>
                <path d="M1 8l6-6v4h8v4H7v4L1 8z" />
              </svg>
            </div>
            <div style={{ width: '100%', padding: 10, marginTop: 8, textAlign: 'center', color: 'rgba(120, 252, 214, 0.6)', fontSize: 13, boxSizing: 'border-box' }}>
              No, thank you
            </div>
          </>
        )}
      </div>
    </div>
  )
}
