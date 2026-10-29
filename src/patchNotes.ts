import { V3_SCREENSHOTS, type ReleaseScreenshot } from './releaseScreenshots'

export type PatchNote = Readonly<{
  revision: number
  publishedOn: string
  title: string
  highlights: readonly string[]
  media?: readonly ReleaseScreenshot[]
}>

export const PATCH_NOTES: readonly [PatchNote, ...PatchNote[]] = [
  {
    revision: 4,
    publishedOn: '2026-10-29',
    title: 'Flowchart v3.0.0',
    highlights: [
      'Work in Flowchart, Architecture, or Draw mode with tools suited to each board.',
      'Generate mode-aware AI proposals, preview and refine them before insertion, or review scoped edits to selected objects.',
      'Draw with native shapes, arrows, freehand strokes, images, and text, including labels attached to shapes and connectors.',
      'Organize drawings with frames and save reusable selections as components.',
      'Import Excalidraw files as editable objects and export boards as JSON, PNG, SVG, or Excalidraw files.',
      'Use compact mobile controls, on-demand panels, and previews that fit smaller screens.',
      'Share boards by link and connect AI tools through the MCP endpoint.',
      'Explore the MIT-licensed source, contribute, or run your own instance.',
    ],
    media: V3_SCREENSHOTS,
  },
  {
    revision: 3,
    publishedOn: '2026-10-29',
    title: 'Edit text right on your drawings',
    highlights: [
      'Double-click a shape or its outline to add a centered label that stays attached.',
      'Reopen existing text without creating another text box.',
      'Add labels to arrows and lines without selection controls blocking the click.',
    ],
  },
  {
    revision: 2,
    publishedOn: '2026-10-28',
    title: 'More room to draw on your phone',
    highlights: [
      'Switch between Flowchart, Architecture, and Draw with visible mode buttons on smaller screens.',
      'Use larger touch controls and menus that stay within the screen.',
      'Open Draw properties or Components when you need them, leaving more room for your canvas.',
      'Fit drawings to phone screens and review AI proposals in panels that scroll.',
    ],
  },
  {
    revision: 1,
    publishedOn: '2026-10-28',
    title: 'Draw with more clarity',
    highlights: [
      'Text wraps naturally, keeping words together and labels easy to read.',
      'Clean connectors and clearer arrows keep your drawings readable in dark mode.',
      'Organize your drawing with editable frames.',
      'Download the current board as an editable Excalidraw file.',
    ],
  },
]
