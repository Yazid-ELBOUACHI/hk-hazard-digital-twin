# Lessons

- **Mistake:** The map rendered at pixel ratio 1 while the attached 3D canvas tracked a different drawing-buffer size on a fractionally scaled display. Geographic projections agreed numerically, but the rendered debris appeared away from the site.
  **Rule:** With MapLibre 4 and deck.gl 9.4 interleaving, compare the actual canvas dimensions with luma's `getDrawingBufferSize()` AND its default framebuffer wrapper. MapLibre can resize the canvas first, causing luma to skip updating the wrapper; a stale wrapper height produces a nonzero GL viewport Y offset. Mirror both dimensions before each shared render pass. Verify rendered geometry after resizing, not just `project()` coordinates.

- **Mistake:** Scene geometry and DEM heights were sampled before the camera arrived and stayed cached after zooming. Empty roads, floating debris and missing context followed.
  **Rule:** Frame the complete source and runout before initializing the scene, refresh elevations after movement or DEM tile updates, and identify missing geometry explicitly. Stable outcomes need a visible site and explanation as well. Replay must reuse seeded placements and derive contacts from model time.

- **Mistake:** A MapLibre 4 camera animation applied a cloned transform whose elevation was still zero; a correct longitude/latitude then appeared above the screen in a pitched close-up.
  **Rule:** During terrain playback, use the supported `transformCameraUpdate` hook to resolve camera target elevation from the DEM, preserve any existing hook, and restore it on disposal. Check the actual site remains inside the visible area after camera commands.

- **Mistake:** (preemptive, from initial brief) Risk of presenting synthetic values as real HK government data, and of coupling frontend to mock JSON.
  **Rule:** Every generated value carries `isSynthetic: true` provenance and visible SYNTHETIC banners/badges; components only consume `core/interfaces.ts` via `core/registry.ts` — never import `src/mock/*` directly.

- **Mistake:** Assumed Carto's free dark raster basemap was key-free; tiles rendered with "API KEY REQUIRED" watermarks.
  **Rule:** Verify tile-service terms/keys with a live render before committing to a basemap; fallback that works key-free: Esri World Imagery + AWS terrarium DEM.

- **Mistake:** Gaussian scatter around hill anchors put synthetic slopes and assets in Victoria Harbour and open sea; one anchor (Sai Kung) was itself over water.
  **Rule:** Any synthetic geographic sampling must be rejection-sampled against an explicit land footprint (`HILL_CLUSTERS[].footprint`), and polylines must be walked inside it. Verify on the real basemap before shipping.

- **Mistake:** First UI pass showed everything at once (15 flat KPIs, 11 sliders, 11 layer chips, 40-value slope overview) with no "look here first" cue.
  **Rule:** Order every page by decision value — headline → why → detail behind a `Collapsible`. Give each page one ranked entry point (Needs attention, presets, suggested steps). Interactive elements must look interactive (legend rows, layer panel, camera buttons) and every mode switch needs a visible hint.

- **Mistake:** `populationNearby` summed the service catchments of linked assets (hospitals 10–40k), so "people near at-risk slopes" reached millions; the linear risk sum also put the median slope in "elevated" on any wet day.
  **Rule:** Sanity-check every headline number against a real-world ceiling (HK ≈ 7.5 M people; most registered slopes are low/moderate). Keep direct exposure (residents within reach) separate from indirect exposure (service catchments), and calibrate the score distribution, not just the ordering.

- **Mistake:** Sampling 5,000 slopes independently inside small massif footprints produced piles of overlapping polygons; the first fix (shrinking areas to 200–6,000 m²) made them unreadably small.
  **Rule:** Place features with a spatial-hash packer (`SlopePacker`: centre distance ≥ r1 + r2 + gap) and size the area range from footprint capacity (m² per slope), not aesthetics alone. Weight clusters by usable land area. Give sub-pixel features a low-zoom point representation so density still reads from far out.

- **Mistake:** Slope polygons placed at random points inside the land footprint with random orientation sat on ridges, reservoirs and flat ground and did not read as slope faces.
  **Rule:** Synthetic features that represent terrain phenomena must be sampled from the terrain: bake a DEM slope/aspect grid (`scripts/build-terrain.mjs`), sample steep cells, orient polygons along the contour with the DEM aspect, and take elevation and angle from the DEM. Real relief in, synthetic hazard out.

- **Rule (user instruction, 2026-09-06):** the in-app *Data Sources* section (Reports → Data Sources) must stay in sync with reality.
  It is generated from `src/core/dataSources.ts` — a registry of every dataset with what it is, what the twin does with it,
  connection type (live-api / live-proxy / baked / tiles / synthetic), real vs synthetic, publisher cadence and freshness —
  plus the runtime status loaders report through `reportSource()`. **Whenever a data source is added, replaced, re-baked or its
  connection/freshness changes, update the registry (and `reportSource` calls) in the same commit.** Provenance never lives only in a component.

- **Mistake:** Assumed CSDI's HKO station layer mapped station IDs to names correctly; its ID column is shifted by one row
  (name ↔ coordinate is consistent, ID is not), and HKO's live feed reuses GEO gauge IDs (N12, K02, H17…).
  **Rule:** Never trust a cross-agency ID column without a round-trip check; resolve stations by name against the live feed and
  fall back to the GEO gauge of the same ID (`bakeHko()` in `scripts/build-live-data.mjs`).

- **Mistake:** `SLOPE_NO IN (…)` batches of 80 slope numbers (~2 KB URLs) intermittently returned HTTP 404 from the CSDI portal,
  which silently dropped the LPM slopes from the inventory.
  **Rule:** Keep CSDI query URLs around 1 KB (batches of 40), retry transient non-OK responses with backoff, and never let an
  auxiliary fetch failure demote the whole real inventory to synthetic — degrade one dataset and report it in the Data Sources status.

- **Mistake:** First live-rainfall design assumed a server proxy was mandatory because CSDI's per-station HKO files lack CORS;
  HKO's own Open Data API (`hourlyRainfall.php`) is CORS-open.
  **Rule:** Check CORS on the *publisher's* API before building a proxy; keep the proxy only for what genuinely needs server
  state (here: the rolling 24-h accumulation HKO does not publish).

- **Mistake:** The 10-minute risk refresh re-evaluated ~37k features with string-hashed noise and re-uploaded ~2 MB of GeoJSON
  twice, blocking the main thread for ~2.5 s at a time — wheel zooms landed seconds late and the app read as "super slow".
  **Rule:** Measure before guessing (`PerformanceObserver` long tasks + wheel-to-frame latency in the running tab, tab focused —
  rAF and long-task data are meaningless in a hidden tab). Any pass over the whole inventory must be chunked with `yieldToMain()`,
  never run twice concurrently, and must not touch the map through `setData`: static geometry once, dynamic values through
  feature-state diffs. Hot loops get precomputed numeric seeds, not template strings. Keep `performance.measure("twin:…")`
  marks on every phase so the next regression is visible in one call.

- **Mistake:** Nesting a `["zoom"]` interpolate inside a data expression (`["*", state, ["interpolate", ["zoom"] …]]`) — MapLibre
  rejects it and the whole layer mount throws inside the `load` handler, leaving the map "loading" forever with no visible error.
  **Rule:** Zoom expressions only at the top level; put feature-state factors inside each stop's output. Check the console after any
  paint-expression change.

- **Rule (user, 2026-09-06):** UI follows Apple's current design language (iOS 26 Liquid Glass) — `src/styles.ios.css` is the skin,
  loaded last. Every element sits on one grid: 12 px outer margin, 12 px inner inset inside the map (`--gutter`, `--inset`, `--hud`),
  panels sized to content and never touching the map edge, HUD pills and legend sharing one bottom line, header content, caption and
  page columns starting on the same 24 px line. Verify alignment numerically with `getBoundingClientRect` on the real DOM, not by eye
  on a scaled screenshot — HUD widgets are positioned from the map edge, panels from the page edge, and the two drift apart otherwise.
  Map credits stay off the map (caption line under the toolbar) — they are a licence requirement, so move them, never remove them.

- **Mistake:** Spent a long time "debugging" slopes that would not draw, when the automation tab was simply in a hidden Chrome window:
  `document.hidden` was true, `requestAnimationFrame` never fired, and MapLibre never finished loading its style (it schedules style
  loading on a frame). Nothing in the code was wrong.
  **Rule:** Before debugging any "map does not render / stuck loading" report, check `document.visibilityState` in that tab and whether
  rAF fires; ask the user which tab/window and zoom they are looking at. `window.__twinMap` is exposed in the app for exactly this
  kind of live inspection (`isStyleLoaded()`, `getSource("slopes")`, `queryRenderedFeatures`).

- **Mistake:** Two agents edited `MapView.tsx` / `store.ts` in the same working tree at the same time (one added `map3d`, `mapSelection`,
  an async `applyRiskState`), so the state of the files on disk drifted from what the other one thought it had written.
  **Rule:** Check `ls -lt src/**` mtimes against your own edit times before assuming a file's content; re-read the region you are about to
  patch; keep patches anchored on exact text so a foreign edit fails loudly instead of silently landing in the wrong place.

- **Mistake:** A 2,900-row facilities literal made `tsc` fail with "union type too complex", and a 1 MB per-slope neighbours literal would
  parse slowly in V8.
  **Rule:** Emit large baked tables as `JSON.parse("…")` with a declared type; keep boot chunks lean (3 nearest blocks, 4-decimal coords,
  names ≤ 40 chars) and gzip everything the server ships (`compression` middleware).

- **Rule (user, 2026-09-06):** at territory zoom the 3D map must not read as a field of circles. Slopes are shown as a risk
  *surface* — the worst band per ~280 m cell as two overlapping octagons draped on the terrain (`riskBlobFC` / `applyBlobState`
  in MapView, feature-state coloured, hidden with the legend filter), cross-fading into the real polygons at zoom 11.5–12.5;
  facility markers only from zoom 12, building blocks from 13 (separate sources with `minzoom`, so they are not even uploaded
  below that). 3D defaults on (`map3d: true`), pixel ratio pinned to 1 on integrated GPUs, and the glass blur is dropped while
  the map is moving (`.main.map-moving`). Measured: 55 fps with terrain, wheel-to-frame ≈ 30 ms.


- **Rule (user instruction, 2026-09-08):** the in-app *What's new* page (Reports → What's new, flagged in the top banner) must be
  updated after every new feature. It is generated from `src/core/changelog.ts` — releases newest first, each item with kind
  (feature / real data / model / interface / fix), what changed, where to find it, and the `calc` / `source` ids of the
  registry rows behind it. **Every feature, data source, model or calculation change adds an entry in the same commit**;
  bump the release `id` so the banner lights up again for returning viewers.
