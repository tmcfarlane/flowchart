# Image export

The export menu defaults to **Entire diagram**, including nested containers and nodes outside the current view. Choose **Current view** to preserve the visible crop. PNG raster output is bounded to 4,096 pixels per axis. Entire diagram SVG uses the fitted bounds; Current view SVG retains the viewport dimensions. GIF uses at most 1,280 pixels per axis and captures ten frames per second for up to ten seconds.

GIF capture also limits copied RGBA frame buffers to 64 MiB. Longer or larger animations reduce their raster resolution while keeping the requested duration and frame rate. Every frame uses the same dimensions. The export status shows the actual pixel dimensions and explains when resolution has been reduced; shorter exports often retain their original resolution. This trades some text and image detail for lower memory pressure. Browser rendering, workers, and the encoded output use additional memory, so this frame budget is not a total browser memory limit or a guarantee for every device.

JSON serialization and parsing are synchronous. The image renderer loads when an image export starts, and the GIF encoder loads only for a GIF export. A failed dependency download produces an actionable error without changing the live diagram. Export uses a disposable diagram snapshot; the live selection, pan, zoom, and animation styles remain intact.

The graph, current viewport dimensions, ancestor theme, fonts, colors, and SVG drawing styles are frozen when export starts. Resizing the window or switching theme during image checks or a dependency download cannot change that capture. Selection decorations are removed before styles are frozen. A brief inert style-capture mount has image loading attributes removed; it is detached before network checks.

Generated images served through this website’s read-capability route are checked before capture. Deleted or unavailable generated assets stop export. Export never prints those private URLs in an error.

GIF cleanup explicitly terminates both active and idle workers, detaches worker callbacks, and clears encoder listeners and copied frame buffers after success or failure. This is necessary for the installed `gif.js` 0.2.0: its `abort()` method terminates active workers but leaves its finished worker pool alive. Recheck this adapter and the installed-library lifecycle tests when changing that dependency.

`GifLifecycle.test.ts` exercises the installed browser encoder with controlled local workers. It covers a successful encode, partial worker creation, task dispatch failure, the encoding deadline, and download failure. Native browser export evidence separately checks rendered diagrams and live-canvas preservation.

The optional GIF progress callback keeps its existing `(frame, total)` arguments and adds metadata as a third argument: `{ pixelWidth, pixelHeight, resolutionAdjusted }`. Metadata is reported after a frame is captured and validated. Callbacks that accept only two arguments remain compatible. A raster outside the frame budget or a later frame whose dimensions change stops export and disposes the partial encoder.
