export type ReleaseScreenshot = Readonly<{
  src: `/releases/${string}/${string}.png`
  alt: string
  caption: string
  width: number
  height: number
}>

export const V3_SCREENSHOTS = [
  {
    src: '/releases/v3.0.0/draw-workspace-dark.png',
    alt: 'Dark Draw workspace with a community garden plan, labeled shapes, connectors, and two frames',
    caption: 'Plan a community garden with editable shapes, attached labels, and connectors.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/draw-workspace-light.png',
    alt: 'The community garden plan in the light Draw workspace with its appearance controls open',
    caption: 'Use the same drawing in light or dark mode.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/ai-draw-preview-dark.png',
    alt: 'Dark AI proposal preview of a product-launch workshop drawing with refinement and insertion controls',
    caption: 'Preview and refine a Draw proposal before insertion. This capture replays a recorded AI response.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/ai-selection-preview-dark.png',
    alt: 'AI selection editor comparing a green Pick a project card with a proposed blue Our project card',
    caption: 'Review selected-object changes before applying them. This capture uses a public AI response fixture.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/shape-text-dark.png',
    alt: 'The Pick a project label being edited inside its green rectangle in the dark Draw workspace',
    caption: 'Edit a shape label directly on the canvas while it stays attached.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/components-frames-light.png',
    alt: 'Light Draw workspace with two planning frames, selected shapes, and a saved component preview',
    caption: 'Organize drawings with frames and save reusable selections as components.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/mobile-draw-light.png',
    alt: 'Light Draw workspace on a phone with compact tools above three connected garden-planning cards',
    caption: 'Draw on a phone with compact tools and panels that open when needed.',
    width: 390,
    height: 844,
  },
  {
    src: '/releases/v3.0.0/architecture-light.png',
    alt: 'Light Architecture workspace showing a library platform with a Catalog API, database, events, and worker',
    caption: 'Map services, data stores, and labeled connections in Architecture mode.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/excalidraw-import-dark.png',
    alt: 'Imported Excalidraw library diagram with a rotated hatched API shape, bound arrow, image, and freehand line',
    caption: 'Import Excalidraw files as editable drawing objects.',
    width: 1440,
    height: 960,
  },
  {
    src: '/releases/v3.0.0/flowchart-light.png',
    alt: 'Light Flowchart workspace with a garden-planning process, readiness decision, and revision loop',
    caption: 'Build flowcharts with connected steps, decisions, and labeled branches.',
    width: 1440,
    height: 960,
  },
] as const satisfies readonly ReleaseScreenshot[]
