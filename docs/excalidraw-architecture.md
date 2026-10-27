# Drawing moved to Draw mode

**Architecture remains the existing React Flow architecture editor.**

The freeform editor now lives in a separate **Draw** mode, implemented by our own
SVG rendering, tools and history. The embedded Excalidraw editor was removed.

See [Draw mode](draw-mode.md) for the current implementation, storage compatibility
and mode behavior, and the [keyboard reference](excalidraw-hotkeys.md) for shortcuts.
