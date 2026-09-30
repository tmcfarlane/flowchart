import React from 'react'
import { AbsoluteFill } from 'remotion'
import { COPY } from './timeline'
import { C, FONT } from './theme'
import captures from './data/captures.json'
import { loadTrailerFonts } from './fonts'
import { Logo } from './components/Logo'
import { BrowserWindow } from './components/BrowserWindow'
import { CaptureView } from './components/CaptureView'
import { DotGrid } from './components/flow/FlowCanvas'

loadTrailerFonts()

// Poster frame: the brand lockup beside the real app at the moment an agent's edit lands.
export const Poster: React.FC = () => {
  const cap = captures.landscape
  const capture = { w: cap.viewport.width, h: cap.viewport.height }
  const paneW = 1010
  const paneH = (paneW * capture.h) / capture.w
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT.sans }}>
      <DotGrid id="poster-grid" viewport={{ x: 960, y: 540, zoom: 1.5 }} width={1920} height={1080} opacity={0.5} />
      <div style={{ position: 'absolute', left: 120, top: 250, width: 640 }}>
        <Logo size={120} glow={0.6} />
        <div
          style={{
            marginTop: 40,
            fontSize: 74,
            fontWeight: 800,
            letterSpacing: '0.16em',
            lineHeight: 1,
            color: C.text,
            textShadow: '0 0 22px rgba(120, 252, 214, 0.3), 0 0 6px rgba(120, 252, 214, 0.25)',
            whiteSpace: 'nowrap',
          }}
        >
          {COPY.name}
        </div>
        <div style={{ marginTop: 26, fontSize: 32, fontWeight: 500, color: C.textMuted, letterSpacing: '-0.01em' }}>
          Describe your idea. <span style={{ color: C.text }}>Get a flowchart.</span>
        </div>
        <div
          style={{
            marginTop: 44,
            display: 'inline-flex',
            padding: '13px 28px',
            borderRadius: 999,
            background: 'linear-gradient(135deg, rgba(15, 18, 17, 0.95) 0%, rgba(30, 33, 32, 0.95) 100%)',
            border: '1px solid rgba(120, 252, 214, 0.36)',
            boxShadow: '0 8px 26px rgba(0, 0, 0, 0.4), 0 0 30px rgba(120, 252, 214, 0.2)',
            fontSize: 28,
            fontWeight: 600,
          }}
        >
          <span style={{ background: C.mintTextGradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{COPY.url}</span>
        </div>
        <div style={{ marginTop: 28, fontSize: 22, fontWeight: 500, color: C.textMuted }}>{COPY.credit}</div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', color: C.mint, padding: '3px 9px', borderRadius: 5, background: 'rgba(120, 252, 214, 0.14)' }}>MCP</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 19, color: 'rgba(231, 236, 235, 0.72)' }}>{COPY.mcpEndpoint}</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 830, top: (1080 - paneH - 40) / 2 }}>
        <BrowserWindow
          width={paneW}
          contentHeight={paneH}
          barHeight={40}
          url={
            <span>
              <span style={{ color: 'rgba(231, 236, 235, 0.92)' }}>flowchart.zeroclickdev.ai</span>
              {`/f/${cap.id}`}
            </span>
          }
        >
          <CaptureView
            width={paneW}
            height={paneH}
            capture={capture}
            camera={{ zoom: 1, fx: capture.w / 2, fy: capture.h / 2 }}
            source={{ kind: 'image', src: 'captures/landscape/agent-update.png' }}
          />
        </BrowserWindow>
      </div>
    </AbsoluteFill>
  )
}
