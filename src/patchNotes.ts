export type PatchNote = Readonly<{
  revision: number
  publishedOn: string
  title: string
  highlights: readonly string[]
}>

export const PATCH_NOTES: readonly [PatchNote, ...PatchNote[]] = [
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
