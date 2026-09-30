import React from 'react'
import { AbsoluteFill, interpolate, spring } from 'remotion'
import { CLOSE, COPY } from '../timeline'
import { C, EASE, FONT } from '../theme'
import { GEAR_TURN } from '../layout'
import { Logo } from '../components/Logo'
import { DotGrid } from '../components/flow/FlowCanvas'
import { clamp01, ease, useAbsFrame, useLayout } from '../components/util'
import { Wordmark } from './LogoReveal'

export const Close: React.FC<{ from: number }> = ({ from }) => {
  const frame = useAbsFrame(from)
  const { W, H, portrait } = useLayout()
  const fps = 60
  const g = portrait
    ? { logo: 210, logoCy: 610, word: 72, wordCy: 800, tag: 34, tagCy: 884, urlCy: 1010, url: 34, creditCy: 1118, credit: 27, mcpCy: 1196, mono: 22 }
    : { logo: 150, logoCy: 292, word: 88, wordCy: 452, tag: 34, tagCy: 536, urlCy: 648, url: 32, creditCy: 746, credit: 25, mcpCy: 812, mono: 22 }

  const draw = ease(frame, CLOSE.hit - 2, CLOSE.hit + 34, EASE.out)
  const fill = ease(frame, CLOSE.hit + 10, CLOSE.hit + 34, EASE.standard)
  const turn = interpolate(ease(frame, CLOSE.hit + 8, CLOSE.hit + 70, EASE.out), [0, 1], [GEAR_TURN, 0])
  const pointer = spring({ frame: frame - CLOSE.hit - 22, fps, config: { damping: 12, stiffness: 170, mass: 0.7 } })
  const logoIn = spring({ frame: frame - CLOSE.hit, fps, config: { damping: 20, stiffness: 120 } })
  const tagK = ease(frame, CLOSE.taglineIn, CLOSE.taglineIn + 30)
  const urlK = spring({ frame: frame - CLOSE.urlIn, fps, config: { damping: 18, stiffness: 150 } })
  const creditK = ease(frame, CLOSE.creditIn, CLOSE.creditIn + 28)
  const mcpK = ease(frame, CLOSE.mcpIn, CLOSE.mcpIn + 28)
  const drift = interpolate(frame, [CLOSE.hit, CLOSE.hit + 600], [1, 1.025], { extrapolateRight: 'clamp' })
  const sceneIn = ease(frame, from, from + 10, EASE.standard)
  const urlGlow = 0.5 + 0.5 * Math.sin(((frame - CLOSE.urlIn) / 120) * Math.PI * 2) * clamp01((frame - CLOSE.urlIn - 40) / 60)

  const center: React.CSSProperties = { position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center' }
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: sceneIn }}>
      <DotGrid id="close-grid" viewport={{ x: W / 2, y: H / 2, zoom: 1.5 }} width={W} height={H} opacity={0.5} />
      <AbsoluteFill style={{ transform: `scale(${drift})` }}>
        <div style={{ ...center, top: g.logoCy - (g.logo * 446) / 441 / 2, opacity: clamp01(logoIn * 1.5), transform: `scale(${0.9 + 0.1 * logoIn})` }}>
          <Logo size={g.logo} draw={draw} fill={fill} rotate={turn} pointer={clamp01(pointer * 1.3)} pointerScale={0.6 + 0.4 * pointer} glow={0.6} strokeWidth={5} />
        </div>
        <div style={{ ...center, top: g.wordCy - g.word / 2 }}>
          <Wordmark frame={frame} start={CLOSE.hit + 14} size={g.word} />
        </div>
        <div
          style={{
            ...center,
            top: g.tagCy - g.tag * 0.6,
            fontFamily: FONT.sans,
            fontSize: g.tag,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: C.textMuted,
            opacity: tagK,
            transform: `translateY(${(1 - tagK) * 14}px)`,
          }}
        >
          <span>
            Describe your idea. <span style={{ color: C.text }}>Get a flowchart.</span>
          </span>
        </div>
        <div style={{ ...center, top: g.urlCy - g.url * 1.05, opacity: clamp01(urlK * 1.4), transform: `translateY(${(1 - urlK) * 18}px) scale(${0.96 + 0.04 * urlK})` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: g.url * 0.4,
              padding: `${g.url * 0.42}px ${g.url * 0.9}px`,
              borderRadius: 999,
              background: 'linear-gradient(135deg, rgba(15, 18, 17, 0.95) 0%, rgba(30, 33, 32, 0.95) 100%)',
              border: `1px solid rgba(120, 252, 214, ${0.3 + 0.15 * urlGlow})`,
              boxShadow: `0 8px 26px rgba(0, 0, 0, 0.4), 0 0 ${24 + 14 * urlGlow}px rgba(120, 252, 214, ${0.16 + 0.1 * urlGlow})`,
              fontFamily: FONT.sans,
              fontSize: g.url,
              fontWeight: 600,
              letterSpacing: '-0.005em',
            }}
          >
            <span style={{ background: C.mintTextGradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              {COPY.url}
            </span>
          </div>
        </div>
        <div
          style={{
            ...center,
            top: g.creditCy - g.credit * 0.6,
            fontFamily: FONT.sans,
            fontSize: g.credit,
            fontWeight: 500,
            color: C.textMuted,
            opacity: creditK,
            transform: `translateY(${(1 - creditK) * 10}px)`,
          }}
        >
          {COPY.credit}
        </div>
        <div style={{ ...center, top: g.mcpCy - g.mono * 0.8, opacity: mcpK, transform: `translateY(${(1 - mcpK) * 10}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: g.mono * 0.6 }}>
            <span
              style={{
                fontFamily: FONT.sans,
                fontSize: g.mono * 0.72,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: C.mint,
                padding: `${g.mono * 0.12}px ${g.mono * 0.4}px`,
                borderRadius: 5,
                background: 'rgba(120, 252, 214, 0.14)',
              }}
            >
              MCP
            </span>
            <span style={{ fontFamily: FONT.mono, fontSize: g.mono, color: 'rgba(231, 236, 235, 0.72)' }}>{COPY.mcpEndpoint}</span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
