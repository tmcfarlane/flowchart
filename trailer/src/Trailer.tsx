import React from 'react'
import { AbsoluteFill, Audio, Sequence, getStaticFiles, staticFile } from 'remotion'
import { SCENES } from './timeline'
import { C } from './theme'
import { loadTrailerFonts } from './fonts'
import { Hook } from './scenes/Hook'
import { LogoReveal } from './scenes/LogoReveal'
import { Generate } from './scenes/Generate'
import { McpScene } from './scenes/McpScene'
import { Montage } from './scenes/Montage'
import { Close } from './scenes/Close'

loadTrailerFonts()

export const AUDIO_FILE = 'audio/trailer-narrated.m4a'

export const Trailer: React.FC = () => {
  const hasAudio = getStaticFiles().some((f) => f.name === AUDIO_FILE)
  if (!hasAudio) throw new Error('The approved audio/trailer-narrated.m4a master is missing. Restore it from Git before rendering.')
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence name="Hook" from={SCENES.hook.from} durationInFrames={SCENES.hook.duration}>
        <Hook from={SCENES.hook.from} />
      </Sequence>
      <Sequence name="Logo" from={SCENES.logo.from} durationInFrames={SCENES.logo.duration}>
        <LogoReveal from={SCENES.logo.from} />
      </Sequence>
      <Sequence name="Generate" from={SCENES.generate.from} durationInFrames={SCENES.generate.duration}>
        <Generate from={SCENES.generate.from} />
      </Sequence>
      <Sequence name="MCP" from={SCENES.mcp.from} durationInFrames={SCENES.mcp.duration}>
        <McpScene from={SCENES.mcp.from} />
      </Sequence>
      <Sequence name="Montage" from={SCENES.montage.from} durationInFrames={SCENES.montage.duration}>
        <Montage from={SCENES.montage.from} />
      </Sequence>
      <Sequence name="Close" from={SCENES.close.from} durationInFrames={SCENES.close.duration}>
        <Close from={SCENES.close.from} />
      </Sequence>
      <Audio src={staticFile(AUDIO_FILE)} />
    </AbsoluteFill>
  )
}
