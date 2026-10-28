# Mobile layout verification

The minimum viewport is 390 CSS pixels, matching iPhone 12 width. The browser proof uses Chromium with `is_mobile`, `has_touch`, and a coarse pointer. Screenshots use a device scale of 1 so image pixels correspond to CSS pixels.

The repeatable verifier is `scripts/verify-mobile-layout.py`. It checks 390 × 844, 390 × 664, 844 × 390, 430 × 932, and 768 × 1024 with touch enabled. A 1440 × 960 desktop context checks the existing desktop layout. Each viewport runs in dark and light themes. Fresh notes and welcome use the application's default dark theme at both phone heights and in landscape.

Run the focused negative control against a server built from `52a3d51eb56697deb143f9c22989f6065cae436e`.

```sh
python3 scripts/verify-mobile-layout.py --baseline-only --baseline-url http://127.0.0.1:3097/
```

Stop the baseline server, then run the proof against the immutable reviewed build.

```sh
python3 scripts/verify-mobile-layout.py http://127.0.0.1:PORT/ \
  --source-revision FULL_40_CHARACTER_SHA \
  --baseline-report docs/screenshots/mobile/negative-control.json
```

`--baseline-url` can also run the negative control before the main proof. `--output PATH` keeps a rerun's evidence separate from the committed captures. A full run writes `report.json`; a failed viewport writes `failure.json` and exits with an error. The report records the source revision, browser versions, rendered rectangles, editable field font sizes, and the served same-origin entry asset hashes. Third-party analytics scripts are outside this fingerprint.

The base fails four meaningful conditions. Flowchart starts at x = -113.34, Undo at x = -39, and Share at x = -14. The displayed More menu's Laser pointer item fails a center hit test, and tapping those coordinates does not activate Laser. Frame is a primary tool at this source revision. A prior exploratory probe looked for Frame in More; this verifier uses the actual Laser item and separately proves primary Frame access after touch scrolling.

The verifier uses ordinary taps and CDP touch gestures. It measures complete rectangles and center and edge hit tests, checks palette scrolling with pinned tools, adds and undoes graph nodes, draws a rectangle, pans with Hand, and checks drawing history. It opens the actual menus, properties, Components, help, an unsent Draw AI editor, a routed AI proposal fixture, and an uploaded Excalidraw import fixture. It checks viewport bounds, 44 pixel targets, 16 pixel editable UI fonts, and separation between AI, Help, and navigation. AI responses are browser fixtures. Every other `/api/` request is aborted, including shared backend writes.

All twelve viewport and theme cases passed against `28f3966ad8cd47d04d91a3849308d52315dc125d`. The committed report combines retained cases and continuations, rather than one uninterrupted process. The local server restarted before the final continuation with the same clean source tree, URL, and Vite configuration. Eleven completed cases were retained with the same Chromium and Playwright versions. The final continuation ran desktop light and fresh notes and welcome at 390 × 844, 390 × 664, and 844 × 390. The entry asset hashes describe that final continuation.

The desktop Edit with AI action has a partial right-edge clip on the clean base. Each theme is compared with its own exact baseline rectangle and sampled hit area. That single unchanged control is excluded from the desktop bounds assertion. All other desktop controls and every touch control retain strict bounds and hit checks.

Native WebKit and physical Safari were unavailable. These captures do not establish physical iPhone keyboard, browser chrome, notch, or safe-area behavior.
