export type PatchNote = Readonly<{
  revision: number
  publishedOn: string
  title: string
  highlights: readonly string[]
}>

export const PATCH_NOTES: readonly [PatchNote, ...PatchNote[]] = [
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
