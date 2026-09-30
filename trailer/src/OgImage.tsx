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

// 1200x630 Open Graph cards for the website: the brand (or the MCP line) beside a close crop
// of the real app at the moment the agent's edit lands (the "Send welcome email" node).
export type OgImageProps = { variant: 'home' | 'mcp' }

const W = 1200
const H = 630

const glowText = (size: number) =>
  `0 0 ${size * 0.34}px rgba(120, 252, 214, 0.28), 0 0 ${size * 0.1}px rgba(120, 252, 214, 0.22)`

const McpChip: React.FC<{ size: number }> = ({ size }) => (
  <span
    style={{
      fontFamily: FONT.sans,
      fontSize: size,
      fontWeight: 700,
      letterSpacing: '0.06em',
      color: C.mint,
      padding: `${size * 0.16}px ${size * 0.5}px`,
      borderRadius: 6,
      background: 'rgba(120, 252, 214, 0.14)',
    }}
  >
    MCP
  </span>
)

const AppCrop: React.FC = () => {
  const cap = captures.landscape
  const capture = { w: cap.viewport.width, h: cap.viewport.height }
  const paneW = 600
  const paneH = 360
  return (
    <div style={{ position: 'absolute', left: 648, top: (H - paneH - 34) / 2 }}>
      <BrowserWindow
        width={paneW}
        contentHeight={paneH}
        barHeight={34}
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
          camera={{ zoom: 4.1, fx: 1074, fy: 530 }}
          source={{ kind: 'image', src: 'captures/landscape/agent-update.png' }}
        />
      </BrowserWindow>
    </div>
  )
}

export const OgImage: React.FC<OgImageProps> = ({ variant }) => (
  <AbsoluteFill style={{ background: C.bg, fontFamily: FONT.sans, color: C.text }}>
    <DotGrid id="og-grid" viewport={{ x: W / 2, y: H / 2, zoom: 1.4 }} width={W} height={H} opacity={0.45} />
    <AppCrop />
    {variant === 'home' ? (
      <div style={{ position: 'absolute', left: 72, top: 0, bottom: 0, width: 560, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Logo size={84} glow={0.55} />
        <div style={{ marginTop: 30, fontSize: 52, fontWeight: 800, letterSpacing: '0.15em', lineHeight: 1, whiteSpace: 'nowrap', textShadow: glowText(52) }}>
          {COPY.name}
        </div>
        <div style={{ marginTop: 22, fontSize: 28, fontWeight: 500, letterSpacing: '-0.01em', color: C.textMuted }}>
          Describe your idea. <span style={{ color: C.text }}>Get a flowchart.</span>
        </div>
        <div style={{ marginTop: 44, display: 'flex' }}>
          <div
            style={{
              padding: '9px 20px',
              borderRadius: 999,
              background: 'linear-gradient(135deg, rgba(15, 18, 17, 0.95) 0%, rgba(30, 33, 32, 0.95) 100%)',
              border: '1px solid rgba(120, 252, 214, 0.4)',
              boxShadow: '0 0 24px rgba(120, 252, 214, 0.16)',
              fontSize: 24,
              fontWeight: 650,
              letterSpacing: '-0.005em',
            }}
          >
            <span style={{ background: C.mintTextGradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Now with MCP
            </span>
          </div>
        </div>
        <div style={{ marginTop: 16, fontSize: 22, fontWeight: 500, color: C.textMuted }}>Your AI agent draws. You iterate.</div>
      </div>
    ) : (
      <div style={{ position: 'absolute', left: 72, top: 0, bottom: 0, width: 560, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo size={48} glow={0.45} />
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.16em', whiteSpace: 'nowrap', textShadow: glowText(22) }}>{COPY.name}</span>
        </div>
        <div style={{ marginTop: 40, fontSize: 60, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.04 }}>
          <div>Your agent draws.</div>
          <div style={{ color: C.mint }}>You iterate.</div>
        </div>
        <div style={{ marginTop: 26, fontSize: 25, fontWeight: 500, lineHeight: 1.35, color: C.textMuted }}>
          Flowchart AI is now a remote MCP server.
          <br />
          <span style={{ color: C.text }}>Free, no account, open source.</span>
        </div>
        <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
          <McpChip size={15} />
          <span style={{ fontFamily: FONT.mono, fontSize: 18, color: 'rgba(231, 236, 235, 0.78)', whiteSpace: 'nowrap' }}>{COPY.mcpEndpoint}</span>
        </div>
      </div>
    )}
  </AbsoluteFill>
)
