import React from 'react'
import { Composition, Still } from 'remotion'
import { FPS, TOTAL_FRAMES } from './timeline'
import { Trailer } from './Trailer'
import { Poster } from './Poster'
import { OgImage } from './OgImage'

export const Root: React.FC = () => (
  <>
    <Composition id="Trailer" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="TrailerVertical" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1080} height={1920} />
    <Still id="Poster" component={Poster} width={1920} height={1080} />
    <Still id="OgImage" component={OgImage} defaultProps={{ variant: 'home' as const }} width={1200} height={630} />
    <Still id="OgImageMcp" component={OgImage} defaultProps={{ variant: 'mcp' as const }} width={1200} height={630} />
  </>
)
