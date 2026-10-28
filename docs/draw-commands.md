# Draw editor commands

Draw keeps command panels, zen mode, and local view mode in the editor. They do not enter the saved scene. App owns the theme, document history, and clear confirmation.

| Action | Shortcut | Behavior |
| --- | --- | --- |
| Edit link | Ctrl or Cmd K | Adds or removes a link on one selected unlocked element. Open link requires a click. |
| Find in drawing | Ctrl or Cmd F | Searches element text, names, and IDs. The active result is selected and centered. Enter moves to the next result; Shift Enter moves back. |
| Command palette | Ctrl or Cmd /, or Ctrl or Cmd Shift P | Filters available commands by name or shortcut. Enter runs the first match. |
| Statistics | Alt or Option / | Shows live element count, saved file count, and scene JSON size in bytes. |
| Zen mode | Alt or Option Z | Hides editor chrome. The shortcut restores it. |
| View mode | Alt or Option R | Hides mutation controls and blocks Draw and App document writes. Pan, zoom, search, and explicit link opening remain available. |
| App theme | Alt or Option Shift D | Toggles App's theme. |
| Clear board | Ctrl Delete or Cmd Delete | Opens the same confirmation as the toolbar. macOS Cmd Delete arrives as Meta+Backspace. Confirm clears the graph and scene in one undoable App transaction. |

The help dialog remains on `?` and reads the same command catalog as the palette. Link input accepts `http`, `https`, and `mailto` URLs. Unsupported schemes show an error and leave the document unchanged. Open link uses a new tab with `noopener noreferrer`.

Run focused tests with `npx vitest run src/test/DrawCommands.test.tsx src/test/DrawHotkeys.test.tsx src/test/DrawCanvas.test.tsx`. Run the browser verifier with `npm run dev -- --host 127.0.0.1 --port 3031` and `python docs/screenshots/draw-commands/verify_draw_commands.py`. The verifier uses headless Linux Chromium at `/usr/bin/chromium` and saves five screenshots in its directory. Native macOS Option behavior was not available in this environment; the browser run exercised Chromium Alt events with the same physical key codes.
