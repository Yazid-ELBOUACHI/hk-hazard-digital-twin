# Lessons

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
