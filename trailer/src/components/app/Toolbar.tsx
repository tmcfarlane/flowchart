import React from 'react'
import { C, FONT } from '../../theme'

// Replica of src/components/Toolbar.tsx in dark mode (flowchart mode), same SVG icons
// and the values from Toolbar.css / Share.css.

const btn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 8,
  color: 'rgba(231, 236, 235, 0.7)',
  flexShrink: 0,
}

const Sep = () => <div style={{ width: 1, height: 24, background: 'rgba(255, 255, 255, 0.12)', margin: '0 6px', flexShrink: 0 }} />

const Btn: React.FC<{ children: React.ReactNode; color?: string; active?: boolean; style?: React.CSSProperties }> = ({
  children,
  color,
  active,
  style,
}) => (
  <div
    style={{
      ...btn,
      color: active ? C.mint : color ?? btn.color,
      background: active ? 'rgba(120, 252, 214, 0.15)' : 'transparent',
      ...style,
    }}
  >
    {children}
  </div>
)

export type ToolbarProps = {
  shared?: boolean
  /** Highlight a button (e.g. the one the cursor is on): 'share' | 'export' | 'dark' */
  hover?: string
}

export const Toolbar: React.FC<ToolbarProps> = ({ shared = false, hover }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '8px 12px',
      background: C.toolbar,
      borderRadius: 50,
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(120, 252, 214, 0.08)',
      border: `1px solid ${C.mintBorderSoft}`,
      fontFamily: FONT.sans,
      whiteSpace: 'nowrap',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255, 255, 255, 0.07)', borderRadius: 8, padding: 2 }}>
        <Btn active style={{ width: 'auto', gap: 6, padding: '0 10px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)' }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
            <rect x="4" y="1.5" width="8" height="4" rx="1" />
            <path d="M8 5.5v2" />
            <path d="M8 7.5L11.5 11L8 14.5L4.5 11L8 7.5z" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>Flowchart</span>
        </Btn>
        <Btn style={{ width: 'auto', gap: 6, padding: '0 10px' }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="5.25" y="9" width="5.5" height="5.5" rx="1" />
            <path d="M4.5 7v1.5M11.5 7v1.5" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>Architecture</span>
        </Btn>
      </div>
      <Sep />
      <div style={{ display: 'flex', gap: 2 }}>
        <Btn active>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 1l10 8-4 1-2 4-1-5-3-8z" />
          </svg>
        </Btn>
        <Btn>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.4 3.2c.5 0 1 .4 1 1v6.4h.8V3.8c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v6.8h.8V4.6c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v6.3h.8V6.8c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v6.5c0 2.2-1.5 3.7-3.8 3.7H9.1c-2.1 0-3.5-1.4-3.8-3.6L4.7 9.9c-.2-1 .5-1.9 1.5-2.1.1 0 .2 0 .2 0z" />
          </svg>
        </Btn>
        <Btn>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10h10" />
            <path d="M11 6l4 4-4 4" />
          </svg>
        </Btn>
      </div>
      <Sep />
      <div style={{ display: 'flex', gap: 2 }}>
        <Btn color={C.mint}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </Btn>
        <Btn color={C.mint}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2L14 8L8 14L2 8Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </Btn>
        <Btn color={C.mint}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 2h10v9l-3 3H3V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M10 11v3l3-3h-3z" fill="currentColor" />
          </svg>
        </Btn>
        <Btn color={C.mint}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
            <path d="M2 11.5l3-3 2 2 3.5-3.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </Btn>
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        <Btn>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 8l4-4v2.5c4 0 6 2 6 5.5-1-2-3-3-6-3V11L4 8z" />
          </svg>
        </Btn>
        <Btn color="rgba(231, 236, 235, 0.25)">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12 8l-4-4v2.5c-4 0-6 2-6 5.5 1-2 3-3 6-3V11l4-3z" />
          </svg>
        </Btn>
        <Btn>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3h12v1H2V3zm1 2h10l-.5 9H3.5L3 5zm3 2v5h1V7H6zm3 0v5h1V7H9z" />
          </svg>
        </Btn>
      </div>
      <Sep />
      <div style={{ display: 'flex', gap: 2 }}>
        <Btn style={hover === 'dark' ? { background: 'rgba(120, 252, 214, 0.1)', color: C.text } : undefined}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="5" fill="currentColor" stroke="currentColor" strokeWidth="1" />
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="1" x2="12" y2="4" />
              <line x1="12" y1="20" x2="12" y2="23" />
              <line x1="1" y1="12" x2="4" y2="12" />
              <line x1="20" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" />
              <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
              <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" />
              <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" />
            </g>
          </svg>
        </Btn>
        <Btn>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3h12v2H2V3zm0 4h12v2H2V7zm0 4h12v2H2v-2z" />
          </svg>
        </Btn>
        <Btn style={hover === 'export' ? { background: 'rgba(120, 252, 214, 0.1)', color: C.text } : undefined}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 10V2" />
            <path d="M4 6l4 4 4-4" />
            <path d="M2 10v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
          </svg>
        </Btn>
        <Btn color={C.mint}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 4l8 4-8 4V4z" />
          </svg>
        </Btn>
      </div>
      <Sep />
      <div
        style={{
          ...btn,
          width: 'auto',
          gap: 6,
          padding: '0 12px',
          color: hover === 'share' ? C.mintBright : C.mint,
          background: hover === 'share' ? 'rgba(120, 252, 214, 0.2)' : 'rgba(120, 252, 214, 0.12)',
          boxShadow: 'inset 0 0 0 1px rgba(120, 252, 214, 0.22)',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 9.5l3-3" />
          <path d="M7.2 4.3l1.1-1.1a2.6 2.6 0 013.7 3.7l-1.1 1.1" />
          <path d="M8.8 11.7l-1.1 1.1a2.6 2.6 0 01-3.7-3.7l1.1-1.1" />
        </svg>
        <span>Share</span>
        {shared && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.mintBright, boxShadow: '0 0 8px rgba(0, 255, 182, 0.7)' }} />
        )}
      </div>
      <Sep />
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 10px',
          fontSize: 12,
          fontWeight: 500,
          color: 'rgba(231, 236, 235, 0.5)',
          borderRadius: 8,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.7 }}>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <span>Open-Source</span>
      </div>
    </div>
  </div>
)
