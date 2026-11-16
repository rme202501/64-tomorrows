# Tech stack: what each view is built with

Presentation reference. Covers the three front-ends in `site/` and the Python pipeline.
Companion to `docs/qa_prep.md` (which covers the *data* questions).

## The one-line answer

No build step, no framework, no bundler. Hand-written ES modules and vanilla DOM, with
libraries loaded from CDNs. Deploys as static files to GitHub Pages
(`.github/workflows/pages.yml`).

| Where | Libraries loaded |
| --- | --- |
| `site/index.html` (classic site) | D3 v7.9.0, topojson-client 3.1.0 |
| `site/dashboards/` | D3, topojson-client, plus `shared.js` (IIFE exposing a global `W`) |
| `site/story/` | D3, topojson-client, **GSAP 3.12.5 + ScrollTrigger**, **Three.js 0.160** (via `<script type="importmap">`), Google Fonts |
| `pipeline/` | numpy, xarray, zarr, obstore, dask, netCDF4, scipy, matplotlib |

That table is the complete external dependency list. There is nothing else.

**Not used:** scrollama, Observable Plot, Chart.js, Leaflet / Mapbox, React / Vue / Svelte,
webpack / Vite / Rollup, jQuery, lodash, Crossfilter, Three.js `OrbitControls`.
The scroll logic is our own (`IntersectionObserver` on the classic site, GSAP ScrollTrigger
on the story page). The linked-dashboard filtering is a hand-rolled shared state object.

**Why no React?** The page is one long scroll with per-view imperative animation; the DOM is
driven directly from scroll progress at 60fps. That is exactly the case where a virtual DOM
buys nothing.

## Shared plumbing

This answers a lot of questions on its own.

### Data format
`site/js/data.js`, `site/story/js/data.js`, `site/dashboards/shared.js`

Forecast fields are **not JSON**. Each field is a raw `Int16` little-endian blob
(`site/data/fields/*.bin`) of shape `(lead, lat, lon)`, with `scale` / `offset` in
`manifest.json`. The browser fetches the `ArrayBuffer`, wraps it in an `Int16Array`, and
expands it to a `Float32Array` once, with `-32768` as the NaN sentinel. Individual time
frames are handed out as **`subarray()` views** - zero-copy.

That is how 7 days of ~34 fields fits in about 20 MB and why the time slider is instant.

### Maps
`site/js/map.js` - used by 8 classic views and both dashboards. A **hybrid canvas + SVG** map.

* `d3.geoConicConformal()` fitted to the New England box with `.fitWidth()`
* The raster (temperature, cloud, suitability) is drawn as **projected grid-cell polygons on a
  2D canvas**, scaled by `devicePixelRatio`. Cell corner positions are projected once and cached.
* Coastlines and state borders are **SVG `<path>`** from `d3.geoPath` over
  `topojson.feature` / `topojson.mesh`.
* Hit-testing uses `projection.invert()`. Town labels de-collide with `getBoundingClientRect()`.
* The legend is an SVG `<linearGradient>` ramp (`legendRamp`).

**Why the split?** Thousands of grid cells per frame would kill SVG. A few dozen outlines in
SVG stay crisp and get CSS theming for free.

### Charts
`site/js/chart.js` - the D3 margin convention wrapped up. `frame()` builds the svg/g,
`responsive()` re-renders on a `ResizeObserver`, and `timeAxis` / `yAxis` / `crosshair` /
`segmented()` / `townSelect()` are shared.

### Lazy loading
`site/js/main.js` - an `IntersectionObserver` (`rootMargin: "400px"`) triggers a **dynamic
`import()`** of each view module. Nothing off-screen is parsed or fetched.

## Classic site: the four scrollytelling acts

Engine is `site/js/scrolly.js`: an `IntersectionObserver` with
`rootMargin: "-45% 0px -45% 0px"`, so the step nearest the viewport centre is active. The
chart is held in place by CSS `position: sticky`. `fillValues()` writes computed numbers into
`<span data-val="...">` placeholders, so **the numbers in the prose come from the data, not
hard-coded text**.

| Act | Module | Technique |
| --- | --- | --- |
| Hook | `scrollyHook.js` | Two stacked `d3.area` bands (p10-p90, p25-p75) + `d3.line` median, `curveMonotoneX`. The weather-app card beside it is plain HTML/CSS. |
| Rising | `scrollyGrowth.js` | Multi-series `d3.line`, `scaleTime` / `scaleLinear`, `d3.extent` |
| Message | `scrollyCaveat.js` | `d3.scaleBand` strip, 12 towns x days, `d3.utcDay` / `utcFormat`, `d3.mean` |
| Solution | `scrollyHorizon.js` | Horizontal bars, `scaleBand` + `scaleLinear`, `d3.mean` |

## Classic site: the "More views" section

The ones with interesting one-off techniques:

* **`windFlow.js`** - particle streamlines on a canvas overlay, animated by `d3.timer`.
  Particles are advected through the u10/v10 fields with bilinear interpolation; trails come
  from alpha-fading the canvas rather than clearing it. Orange marks where forecasts disagree
  (`d3.interpolateLab`).
* **`stormCone.js`** - `d3.contours` finds low-pressure minima, linked step to step into
  tracks; `d3.geoCircle` builds the hurricane-style cone; `d3.curveCatmullRom` smooths the
  track; `d3.geoDistance` for radii.
* **`horizonMap.js`** - `d3.contours` draws trust-horizon iso-lines over the canvas raster.
* **`roulette.js`** - each spin samples a percentile and reads the field through
  `valueAtPercentile()` (linear interpolation between the five stored quantiles, extrapolated
  past p10/p90 with the end slopes); `d3.bin` builds the tally histogram. The page states the
  simplification: one percentile is applied everywhere on the map.
* **`routePlanner.js`** - `d3.geoInterpolate` + `d3.geoDistance` sample points along the drawn
  route, `d3.pairs` walks segments, a `scaleBand` matrix holds departure x time, `d3.maxIndex`
  picks the best departure.
* **`timeMachine.js`** - `scaleBand` bars for 10 older forecast runs from `time_machine.json`;
  clicking one renders a difference map with a diverging `interpolateLab` ramp.
* **`cloudMap.js` / `fogMap.js`** - `d3.interval` playback over the canvas raster. fogMap adds
  a second canvas whose opacity is driven by the spread.
* **`freezeTimeline.js`** - `d3.area` with `curveStepAfter`, SVG `<pattern>` hatching for
  ice-on-ground spans.
* **`feelsMap.js`, `tempSpread.js`, `rangeGrowth.js`** - straightforward map and area/line work
  on the shared helpers.

## The two dashboards

`site/dashboards/` - loaded as **classic scripts, not modules**. `shared.js` is an IIFE
exposing a `W` namespace: manifest/field loading, the `TOWNS` table, `createMap`, `tooltip`,
and theme handling (CSS custom properties plus a `MutationObserver` on `data-theme`).

**`uncertainty.js`** - three linked panels sharing one state object (no Crossfilter):

* fog map (canvas raster, fog opacity from `t2m_spread`)
* growth line chart with a **`d3.drag`-able threshold line** and **`d3.brushX`** to average the
  map over a time window
* trust-horizon bar chart
* `d3.contours` draws the "past its horizon" hatched region; `d3.interval` drives play;
  clicking the map adds a place (max 4, colour-slotted)

**`planner.js`** - activity scoring is pure JS rules (feels-like, rain chance, wind -> 0/1/2).
`d3.brushX` time window, `d3.area` / `line` with `curveMonotoneX` and `curveStepAfter`,
`d3.maxIndex` for the best window, SVG `<pattern>` for ice spans.

## The story page

`site/story/` - the cinematic rework at `/story/`.

### Engine
`js/main.js` uses **GSAP ScrollTrigger**, one trigger per chapter. Each chapter `<section>` is
sized `length x 100lvh`; `onUpdate` hands the chapter module a **progress value 0 to 1**, and
layers cross-fade over about 0.45vh at each end. Chapters are lazily dynamic-imported modules
with a documented contract: `mount / update(p) / enter(dir) / leave(dir)`.
`prefers-reduced-motion` and a mobile breakpoint live in the shared `ctx`.

### The 3D world
`js/world/` - Three.js, the biggest single piece.

* `campus.js` procedurally builds Harvard Yard from `BoxGeometry` / `ExtrudeGeometry` /
  `Shape` + `Path` / `Cone` / `Cylinder`, merged with `mergeGeometries` into a few draw calls,
  carrying custom `color` and `aWin` vertex attributes. Trees and lamps are `InstancedMesh`.
* `shaders.js` patches `MeshLambertMaterial` through **`onBeforeCompile`** with injected GLSL
  (procedurally lit windows, floodlit trims), plus standalone `ShaderMaterial`s for sky, water,
  rain and the fracture effect.
* Postprocessing: `EffectComposer` -> `RenderPass` + `UnrealBloomPass` + `ShaderPass` +
  `OutputPass`. ACES filmic tone mapping, PCF soft shadows, `FogExp2`, `Reflector` for the
  Charles.
* **`astro.js` is real astronomy written from scratch** (solar and lunar declination, right
  ascension, sidereal time), so the sun and moon are where they will actually be at the
  forecast hour.

### Chapter by chapter

| Chapter | Built with |
| --- | --- |
| `hero` | DOM text animation + Three.js camera path; weather from the median member |
| `phone` | **Pure DOM/CSS 3D** - scroll drives `translate3d` + `rotateX/Y/Z` + `scale` on a phone mock. `phone/kit.js` uses `d3.scaleLinear` / `interpolateLab` for sky gradients and feels-like. |
| `grid64` | **64 DOM tiles, not canvas** - `translate3d` + `backgroundColor`, values and colours eased frame to frame with an exponential smoother, re-sorted by rank each frame in a rAF loop. DOM keeps the numbers crisp and selectable. |
| `spread` | D3 SVG fan chart (`spread/chart.js`: two `d3.area` + `d3.line`) plus a hand-built 64-tick SVG strip via `createElementNS` |
| `wind` | Three **2D-canvas** vignettes (`spread/windscene.js`) - autumn tree, grass, banner, procedural leaves, seeded RNG, driven by p10/p50/p90 wind |
| `lying` | Typography only - CSS transforms and filters, 18 seeded ghost copies, a rAF glitch-jitter loop |
| `pdfs` | **Canvas 2D ridgeline of kernel density estimates** - Gaussian KDE with **Silverman's rule** bandwidth (`pdfs/common.js`), `ResizeObserver` + DPR fitting |
| `plinko` | **Canvas 2D Galton board** - up to 1500 balls, each a draw from that day's distribution, hopping peg to peg into a live histogram; rAF loop, interactive controls |
| `northeast` | **A second Three.js scene** (`northeast/map.js`). The forecast grid is uploaded as a half-float **`DataArrayTexture`**; a `PlaneGeometry` is displaced in the vertex shader for relief; custom GLSL terrain and cloud shaders use **fBm noise** for the fog. Land and shelf masks are rasterised from topojson with `d3.geoPath` into canvases -> `CanvasTexture`. State borders are fat lines (`LineSegments2` + `LineMaterial`). The colour ramp is baked into a 1x512 `CanvasTexture`. City pins are DOM, positioned by projecting through the camera. |
| `care` | Inline SVG illustration + CSS word animation |
| `jacket` | SVG Yard scene built as a string (`decide/yard.js`), a **beeswarm** of the 64 members, GSAP tweens, a range input bound to scroll progress |
| `party` | SVG party scene (`decide/partyScene.js`) + a dice roll that samples one of the 64 members, classified dry / drizzle / rain / storm; GSAP timeline |
| `finale` | Word-by-word text reveal + the world's `FractureShader` driven by member spread |

## The data pipeline

* **`fetch_wn3_stats.py`** - `obstore` + `zarr` + `xarray` against
  `gs://weathernext3_statistics_spatial`. Each stored chunk is a whole-globe field for one lead
  hour (about 20 MB), so it uses a `ThreadPoolExecutor`, **crops to the New England box in
  memory and discards the rest**, caching cropped chunks so a run resumes after a failure.
  About 63 GB streamed, about 80 MB kept.
* **`build_web_data.py`** - numpy/xarray -> the Int16 `.bin` files + `manifest.json`. Derived
  fields: feels-like (NWS wind chill and heat index), spread = p90 - p10, and `p_rain` /
  `p_freeze` from a **piecewise-linear CDF through the five quantiles**.
* **`build_story_data.py`** - the one to be ready to defend. The statistics bucket ships only
  the mean and p10-p90, **not** the 64 members, so the story page reconstructs them: each
  lead's quantile curve is interpolated **in normal-score (z) space** and evaluated at
  percentiles `(k + 0.5) / 64`, which reproduces the stored quantiles exactly. Which member
  gets which rank is then decided by ranking **64 AR(1) random paths** with a 30-hour time
  constant, so each member follows a continuous track and members trade places smoothly
  instead of flickering.
* Figures: matplotlib (`forecast_uncertainty_grid.py`,
  `docs/prototype/make_draft_figures.py`).

## Likely questions

**Do you use scrollama?**
No. The classic site uses an `IntersectionObserver` directly (`site/js/scrolly.js`, about 40
lines); the story page uses GSAP ScrollTrigger. Scrollama is a thin wrapper over the same
`IntersectionObserver` API, and we needed continuous progress within a chapter, not just
discrete step-enter events, which is what ScrollTrigger gives us.

**Are those really 64 forecasts?**
On the classic site and dashboards you only ever see quantiles, which are real. On the story
page the 64 members are **reconstructed** from the quantiles. The finale credits say so
("Members reconstructed from stored quantiles (p10-p90)"), and `docs/qa_prep.md` explains why
the raw member bucket is not used (requester-pays, about 64x larger).

**Why canvas here and SVG there?**
Thousands of grid cells, particles or balls per frame go to canvas. Tens of outlines, axes and
labels go to SVG, so they stay crisp and get CSS and theme styling.

**How does the scrolling work?**
Classic site: `IntersectionObserver` + CSS `sticky`. Story page: GSAP ScrollTrigger giving each
chapter a 0-to-1 progress number that drives everything. Neither page hijacks the scroll.

**Does it need a server?**
No. It is static files on GitHub Pages. Locally, `python3 -m http.server --directory site 8731`
is enough (a server is needed only because ES modules and `fetch` do not work from `file://`).
