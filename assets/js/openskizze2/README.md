# OpenSKIZZE 2.0 — Interactive QD Explorer

A standalone, dependency-free interactive web app that demonstrates
**surrogate-assisted Quality-Diversity (MAP-Elites) generative design** for
climate-adaptive urban planning. It runs entirely in the browser: no build step,
no bundler, no server-side code.

The app is a single static page, [`openskizze-2.0.html`](../../../openskizze-2.0.html),
that loads Tailwind via the Play CDN and bootstraps the ES-module entry point
[`main.js`](main.js:1).

---

## Overview

OpenSKIZZE 2.0 turns a 10×10 parcel into a searchable design space. A
deterministic, seeded MAP-Elites search fills a 12×12 archive whose axes are two
QD **features** — **floor area** and **number of buildings** — while the
optimization objective is **porosity** (the share of the parcel left unbuilt).
The resulting elites are clustered into four human-readable design archetypes.

The genome is a **block/parcel morphology model**: nine rectangular blocks laid
into the free regions between a site's retained infrastructure, each carrying a
land use, a spatial pattern, a base height, a height profile and a footprint
density. A pure `rasterize` step derives the stable 100-cell interface every
renderer consumes, so the model gains real spatial structure while the rendering
contract stays simple.

The graphics are a **more realistic low-poly isometric** treatment: footprint
prisms with flat/pitched/stepped roofs, a directional lighting ramp, facade
banding, contact shadows, ambient occlusion, clustered tree canopies, gradient
water, a sky/ground/vignette environment and a cached static ground layer.

The user flow has three phases:

1. **Site selection** — pick a preset (Central Railyard Brownfield, North
   Cold-Air Gateway, South Heat-Island Core), each set in its own named city, and
   drag a 10×10 selection box on that city's macro map.
2. **Search** — a ~7 s simulated MAP-Elites run evaluates 1,600 candidates,
   filling the 12×12 archive with a live candidate preview and a flash-on-new-
   elite heatmap.
3. **Explore** — inspect the four archetypes (A–D) in a 2.5D isometric viewer
   with toggleable layers (airflow streamlines, cold-pool fog, KLAM legend) and a
   three-audience dashboard (Layman / Urban Planner / Planning Dept).

Everything is deterministic: all randomness flows through a seeded xorshift32
PRNG, so a given seed always produces the same archive and archetypes.

---

## How to run

ES modules (`<script type="module">`) are blocked by browsers on `file://`
origins, so the page **must be served over http(s)**. Any static server works.

### Option A — plain static server

```bash
# from the repository root
python -m http.server 8000
# then open:
#   http://localhost:8000/openskizze-2.0.html
```

### Option B — Jekyll (matches production)

```bash
bundle exec jekyll serve
# then open:
#   http://localhost:4000/openskizze-2.0.html
```

### Option C — GitHub Pages

The app is deployed verbatim (it has no YAML front matter, so Jekyll copies it
unchanged):

```text
https://alexander-hagg.github.io/openskizze-2.0.html
```

---

## Languages (EN/DE)

The app is fully bilingual (English / German) through a single dependency-free
module, [`i18n.js`](i18n.js:1):

- **`DICT`** holds every UI string keyed by a stable id, once per language
  (`DICT.en`, `DICT.de`). The two key sets are identical — there are no missing
  translations.
- **`t(key, params)`** looks up the current language with `{param}`
  interpolation, falling back to English and then to the key itself.
- **`loc(value)`** resolves a localised data field (`{en, de}`) to the current
  language (falling back to `en`), and passes a plain string through unchanged.
- **`applyI18n(root)`** fills `[data-i18n]` (`textContent`), `[data-i18n-html]`
  (`innerHTML`, for copy with inline markup), `[data-i18n-aria]` (`aria-label`)
  and `[data-i18n-title]` (`title`).
- **`getLang` / `setLang` / `toggleLang`** manage the active language and
  **`onChange`** subscribes to changes. The choice is persisted in
  `localStorage['openskizze.lang']`; the initial language is detected from
  `navigator.language` (German → `de`, otherwise `en`).

**All data is `{en, de}`.** Preset names, descriptions and rationales, city
names/taglines/terrain labels, archetype names and the KLAM class labels are all
localised objects, and every reader resolves them with `loc()`.

**All dynamically generated strings go through `t()`** — the consensus
requirement templates, `formatBrief`, compass zone names, the dashboard KPIs /
narrative / Planning-Department view, the isometric tooltip and wind cue, the
archive axis / coverage / Pareto labels, the city-map legend and cold-air arrow,
and the explainer copy (via `data-i18n-html`).

The header carries an **EN / DE toggle** (`#lang-toggle`). On a language change
`onChange` fires `rerenderForLanguage()` in [`ui.js`](ui.js:1), which re-applies
`applyI18n`, rebuilds the dynamic panels (presets, readout, ticker, layer and
audience toggles, archetype legend, dashboard) and redraws the text-bearing
canvases (city map, isometric wind cue, archive axes).

Proper nouns and acronyms — city names such as *Klimastadt*, *KLAM_21*,
*MAP-Elites*, *GRZ* / *GFZ*, *z0*, *V_flux* — are intentionally left
untranslated.

---

## Architecture

The code is split into small, single-responsibility ES modules with a strict
one-way dependency direction. Lower layers never import from higher layers.

```text
config.js
   │
   ├── prng.js ──┐
   └── klam.js ──┤
                 ▼
             design.js            (Block/Cell genome, rasterize, mutation, metrics)
                 │
                 ▼
           simulation.js          (candidate generation, MAP-Elites, archetypes)
                 │
                 ▼
              state.js            (store + pure reducer)
                 │
     ┌───────────┼───────────────┬───────────────┐
     ▼           ▼               ▼               ▼
 citymap.js   archiveview.js   iso.js        dashboard.js
     │           │               │               │
     └───────────┴───────┬───────┴───────────────┘
                         ▼
                       ui.js          (DOM wiring)
                         │
                         ▼
                      main.js         (bootstrap + single RAF loop)

palette.js   (leaf: cached per-KLAM colour ramps; imported by iso.js)
airflow.js   (imports config/prng/klam/iso; injected into iso.js + main.js)
consensus.js (pure aggregate: archive + archetype → per-cell consensus +
             program + zones + requirements + brief; imported by dashboard.js)
```

- [`palette.js`](palette.js:1) is a **leaf** module: it exports the per-KLAM
  three-tone ramps and a memoised `paletteFor(klam)` lookup, so the isometric
  renderer never mixes colours per building per frame.
- [`airflow.js`](airflow.js:1) sits above [`iso.js`](iso.js:1) (it reuses the
  shared `projectCellInto` ground/solution-grid projection and re-exports
  `COLD_AIR_LAYER_ELEVATION`) but is **injected** into the viewer rather than
  imported by it, keeping `iso.js` free of a hard airflow dependency.
- [`consensus.js`](consensus.js:1) is a **pure aggregate**: it depends only on
  [`config.js`](config.js:1) and [`klam.js`](klam.js:1) and turns an archive +
  archetype into a per-cell consensus, a per-class **program** (quantity) and
  **zone** (placement) aggregation, derived requirements and a brief. It is
  imported by [`dashboard.js`](dashboard.js:1) (see *Planning Department view*
  below).
- [`i18n.js`](i18n.js:1) is a **leaf** module: the EN/DE dictionary, the
  `t`/`loc` lookups, the language state with `localStorage` persistence and the
  `applyI18n` DOM filler. It is imported by [`consensus.js`](consensus.js:1),
  [`dashboard.js`](dashboard.js:1), [`ui.js`](ui.js:1) and
  [`main.js`](main.js:1) (see *Languages (EN/DE)* above).

### Single RAF loop

[`main.js`](main.js:264) owns the **only** `requestAnimationFrame` loop. Each
frame it:

1. computes a capped `dt` (`min(0.05, elapsed)`),
2. calls `update(dt)` — advances the time-based Phase-2 ticker or advects
   Phase-3 airflow particles,
3. calls `renderActive()` — renders whichever phase is active.

Rendering is throttled to ~20 fps via `DRAW_INTERVAL_MS = 50`
([`main.js`](main.js:34)). The Phase-2 search is **time-based**, not
frame-based: `update()` dispatches one `TICK` per candidate until the elapsed
time reaches `SIM.DURATION_MS`, so the search always completes in ~7 s
regardless of frame rate. The loop pauses when the document is hidden
(`visibilitychange` → `SET_PAUSED`) or `state.paused` is set.

---

## Domain model

### Site presets

The app ships three site presets ([`config.js`](config.js:89), `PRESETS`). Each
carries a `box` (the editable 10×10 region within the parcel grid), a land-use
`bias`, a one-line `description`, a planning `rationale` (surfaced in the
`#site-readout` panel), a fixed `structure` (see below) and a `city` context
(see *Cities* below).

| Preset | Position | Planning rationale |
|---|---|---|
| `railyard` — Central Railyard Brownfield | centre (`box {x:3,y:3}`) | **Cold-air transport corridor** (Kaltluftleitbahn): a large, largely sealed former freight yard in the low-lying belt between the cool north and the hot south, whose open rail corridor is a natural ventilation channel. |
| `northgate` — North Cold-Air Gateway | centre-north (`box {x:3,y:0}`) | **Cold-air production zone** (Kaltluftentstehungsgebiet): the northern edge where cold air forms over meadows and hills and enters the city; development must keep the gateway open. |
| `southcore` — South Heat-Island Core | centre-south (`box {x:3,y:6}`) | **Heat-accumulation zone** (urban heat island): the dense, sealed, heat-retaining city centre, where densification must be balanced with green/water and ventilation. |

The initial selection box matches the default preset (`railyard`), so the app
opens with the selection already centred on it and does not jump on the first
preset click ([`state.js`](state.js:52), `makeInitialState`). The `#site-readout`
panel shows the preset's name, its **city name and tagline**, the description,
the rationale and the live selection box.

### Cities

Each preset is set in a distinct imaginary city, described data-drivenly by
`preset.city` ([`config.js`](config.js:103)) and rendered generically by the
macro map ([`citymap.js`](citymap.js:1)). A city carries a `name`, a one-line
`tagline`, an ordered `terrain` list of flat zones (`hills`, `mountains`,
`meadow`, `river`, `lake`, `railyard`, `suburb`, `urban`, each with a grid rect
or polyline, a colour and an optional label) and a `coldAir` descriptor
`{ dir:{x,y}, label }` giving the downhill cold-air drainage vector
(x = east, y = south) and its compass shorthand.

| City | Preset | Setting | Cold-air path (`coldAir.dir`) |
|---|---|---|---|
| **Klimastadt** | `railyard` | Valley city: a cold-air reservoir and meadows in the north, a rail valley through the middle, the urban heat island to the south. | `N → S` (`{x:0,y:1}`) |
| **Alpenvorstadt** | `northgate` | Mountain-foot city: alpine slopes to the NW, foothill meadow, a river along the foot, the urban core to the SE. | `NW → SE` (`{x:1,y:1}`) |
| **Beckenstadt** | `southcore` | Basin city: a green rim with meadow and a cold-air lake to the north, the dense core south of the lake, suburbs to the east. | `NE → SW` (`{x:-1,y:1}`) |

Switching preset therefore changes the whole surrounding city — its terrain
zones, its legend and the direction of the animated cold-air vector arrow.

### Block/parcel morphology

The genome is nine **blocks** laid out into the free regions between a site's
retained infrastructure (see *Site-aware structure* below). Each block carries:

| Field | Meaning |
|---|---|
| `landUse` | Dominant KLAM class id. |
| `pattern` | One of `PATTERNS` — `perimeter`, `courtyard`, `row`, `towerPark`, `detached`, `green`, `water`. |
| `baseHeight` | Base building height in stories (discrete levels 1/2/4/6/8). |
| `heightProfile` | One of `PROFILES` — `flat`, `stepped`, `pitched`, `random`. |
| `density` | Footprint fraction 0.35–0.9. |
| `seed` | Per-block deterministic seed. |

[`rasterize`](design.js:675) is pure and deterministic: it fills the 100-cell
grid with grass, stamps the retained structure (green corridor, then roads, then
rails) as `KLAM_STREET`/green, then applies each block's pattern to its
free-region rectangle. The resulting `design.cells` is the stable interface
every renderer and metric consumes.

### Site-aware structure

The generic 3×3 `STREETS` grid has been **removed**. Every preset now carries a
`structure` ([`config.js`](config.js:45)) describing the existing infrastructure
that is **retained in every design**:

| Field | Meaning |
|---|---|
| `rails` | Existing rail tracks; retained and repurposed as roads. |
| `roads` | Existing roads retained in every design. |
| `greenCorridor` | Optional permeable cold-air corridor (grass/forest). |
| `existingBlocks` | Pre-existing blocks retained verbatim. |

A `StructureLine` is `{ axis:'h'|'v', x?, y?, from, to }`; `existingBlocks` are
`{ x, y, w, h, landUse }`. The per-preset structures are:

- **railyard** — two parallel E–W rail tracks (`y:4`, `y:5`) plus one N–S
  connector road (`x:2`).
- **northgate** — a N–S green corridor (`x:5`) plus two E–W cross paths
  (`y:3`, `y:7`); no rails.
- **southcore** — a retained 2×2 street grid (N–S `x:3`, `x:6`; E–W `y:3`,
  `y:6`) plus two pre-existing blocks.

[`computeFreeRects`](design.js:115) marks the structure occupied and decomposes
the remaining free cells into exactly nine rectangles, so the fixed 9-block
genome maps one-to-one onto the free regions. [`rasterize`](design.js:675)
derives the street network from the structure (rail tracks become roads), lays
the blocks into those free regions, and marks rail cells with the `rail:true`
cell flag (rendered as rail ties). The structure is **fixed**: `mutateDesign`
never mutates it, and the invariant repair never overwrites a structure cell
([`isStructureCell`](design.js:339)).

With the default seed the archive coverage per preset is **railyard 88/144**,
**northgate 77/144** and **southcore 84/144**.

### KLAM_21 land-use classes

Each parcel cell is assigned one of **seven** KLAM classes
([`klam.js`](klam.js:22)). A class defines its cold-air production coefficient
`pCold` (m³/h per m²), aerodynamic roughness length `z0` (m), sealed fraction,
and — for building classes — dwellings per floor and residents per dwelling.

| Class | `pCold` | `z0` | `sealed` | Dwellings/floor | Residents/dwelling | Height range (stories) |
|---|---:|---:|---:|---:|---:|---:|
| `KLAM_GRASS` | 12 | 0.03 | 0.0 | 0 | 0 | — |
| `KLAM_FOREST` | 8 | 1.0 | 0.0 | 0 | 0 | — |
| `KLAM_WATER` | 14 | 0.005 | 0.0 | 0 | 0 | — |
| `KLAM_RESIDENTIAL_LOW` | 4 | 0.4 | 0.6 | 4 | 2.2 | 1–2 |
| `KLAM_URBAN_HIGH` | 0.5 | 2.5 | 0.9 | 6 | 2.0 | 4–8 |
| `KLAM_COMMERCIAL` | 0 | 1.8 | 1.0 | 0 | 0 | 1 |
| `KLAM_STREET` | 0 | 0.05 | 0.9 | 0 | 0 | 0 |

`KLAM_GRASS`, `KLAM_FOREST` and `KLAM_WATER` are treated as **permeable**
(green/blue infrastructure). Height ranges live in `HEIGHT_RANGE`
([`klam.js`](klam.js:36)); non-building classes return `[0, 0]`. `KLAM_STREET`
is the seventh class added by the R1 upgrade: it is a non-building, low-roughness
surface that channels air through the parcel.

### Footprint-aware metrics

[`computeMetrics`](design.js:658) derives the metric bundle from the raster.
Unlike the pre-upgrade build, GRZ/GFZ/homes are **footprint-aware**:

```text
grz   = Σ footprint_i / count
gfz   = Σ (height_i * footprint_i) / count          # real floor-area ratio
homes = Σ (height_i * footprint_i * dwellingsPerFloor_i * residentsPerDwelling_i)
greenSpace = 100 * (grass + forest + water count) / count
```

`grz` is the mean building footprint fraction (0..1); `gfz` is the mean
floor-area ratio (stories × footprint). `SIM.GFZ_MAX = 6`, `SIM.STRUCT_MAX = 24`
and `V_FLUX_REF` (≈33.33 m³/s) are retained as **fixed fallback references** for
descriptor normalization; the search normally uses an adaptive scale instead
(see below).

### Directional cold-air flux with street canyons and sheltering

Cold air is modelled as flowing along the selected city's **`city.coldAir.dir`**
grid vector (x = east, y = south; `gy = 0` is North). For each cell the flux
walks **upstream along `-windDir`**, accumulating a sheltering penalty from the
cells the air passes over before reaching it
([`design.js`](design.js:884), `computeMetrics`):

```text
wind = normalizeDir(design.windDir)
for each cell (gx, gy):
    acc = 0
    walk upstream along -wind                 # up to MAX_STEPS = 4*N steps
        channel = (cell.street && street axis parallel to wind) ? 0.25 : 1.0
        acc    += z0(cell) * (cell.street ? 0.2 : footprint) * channel
    shelter = exp(-acc * SIM.SHELTER_K)       # SHELTER_K = 0.15
    vFlux  += pCold(cell) * CELL_AREA * shelter
vFlux /= 3600                                 # m³/h → m³/s
```

Streets contribute little roughness (`×0.2`) and, when a street runs **parallel
to the wind** (a N–S street for a N→S wind, or an E–W street for an E→W wind),
reduce the accumulated shelter (`channel = 0.25`), so they act as **street
canyons** that let cold air penetrate deeper into the parcel. The legacy N→S
behaviour is exactly the `windDir = (0,1)` special case.

The direction is carried by the design itself: [`createDesign`](design.js:333),
[`cloneDesign`](design.js:418) and
[`generateCandidates`](simulation.js:220) all pass the city's `coldAir.dir`
through, while [`mutateDesign`](design.js:846) neither reads nor changes it — so
every design keeps the city's fixed `Design.windDir`.

The reference flux `V_FLUX_REF` is the flux of an all-grass parcel
(`100 × 100 × 12 / 3600 ≈ 33.33 m³/s`, [`config.js`](config.js:80)).

### Descriptor axes, adaptive normalization and 12×12 binning

The two MAP-Elites behaviour axes are genuine QD **features** (not optimization
targets), returned by [`computeDescriptor`](design.js:1074):

- **floorArea** — the normalized floor-area ratio `gfz` (0..1)
- **structureCount** — the raw integer number of **contiguous building
  structures** (4-connected components of cells with `height > 0`, 0..N*N)

`structureCount` counts built *masses*, not built *cells*: a perimeter block
counts once, a row of detached structures counts many times, and adjacent
genome blocks (or a genome block touching a pre-existing block) merge into one
structure. It is computed by [`countStructures`](design.js:884) and is
deliberately distinct from the cell-based `buildingCount` used by the porosity
objective (see [Fitness](#fitness)).

**Adaptive descriptor scale (coverage fix).** The block genome only reaches
`gfz ≈ 1.47` and a handful of structures, far below the fixed ceilings
(`SIM.GFZ_MAX = 6`, `SIM.STRUCT_MAX = 24`). Normalising against those fixed
references compressed every candidate into a narrow corner of descriptor space.
[`generateCandidates`](simulation.js:237) therefore measures the whole
enumeration pool once, deterministically, and installs a **2nd–98th percentile
scale** for *each* axis of the candidate population via
[`setDescriptorScale`](design.js:1053) before any ticking:

```text
floorArea      = clamp01((gfz - floorLo) / (floorHi - floorLo))
structureCount = raw integer (not normalized in the descriptor)
# Lo/Hi are the 2nd/98th percentiles of the candidate pool
```

Both mappings stay **strictly monotonic** — higher `gfz` always yields higher
`floorArea`, and more structures always yields a higher bin — so the search
ordering is unchanged while candidates now spread across all bins.
[`getDescriptorScale`](design.js:1061) exposes the installed scale for tests.
When no scale is installed, `computeDescriptor` falls back to the fixed
`SIM.GFZ_MAX` reference and `binOfYStructures` to `SIM.STRUCT_MAX`.

Each axis is split into `BINS = 12` bins, giving a 12×12 = 144-cell archive.
Binning is centralized in [`design.js`](design.js:1) and used by **both**
[`simulation.js`](simulation.js:1) and [`state.js`](state.js:1):

```text
binOfX(floorArea)            = min(BINS-1, floor(clamp01(floorArea) * BINS))
binOfYStructures(structures) = min(BINS-1, floor(clamp01((structures - structLo) / (structHi - structLo)) * BINS))
# structLo/Hi are the 2nd/98th percentiles of the candidate pool;
# without a scale, structures / SIM.STRUCT_MAX is used instead.
# binOfY(buildingCount) is retained for the legacy cell-based axis.
```

A bin coordinate maps to a flat index via
`binIndex(bx, by) = by * BINS + bx` ([`design.js`](design.js:1)).

### Fitness

The scalar fitness in `[0, 1]` is the **porosity** objective — the fraction of
the parcel left unbuilt ([`design.js`](design.js:1097)):

```text
porosity = 1 - buildingCount / (N*N)   # buildingCount = built CELLS
fitness  = clamp01(porosity)
```

Porosity stays **cell-based** (`buildingCount`), independent of the
`structureCount` descriptor axis, so the objective keeps its meaning ("share of
the parcel left unbuilt") and selection pressure is preserved. The two
descriptor axes are QD features, not optimization targets, so fitness is
deliberately a pure function of porosity (no housing/permeability blend and no
uncertainty penalty, which would dilute the stated objective).

`sigma` is a surrogate-uncertainty proxy in `[0, 1]` that uses **block-level**
base-height variance, so coherent designs are not penalised
([`design.js`](design.js:722)):

```text
hStd          = stddev(block.baseHeight)
heightVarNorm = clamp01(hStd / 4)
sigma = clamp01(0.08 + 0.35*heightVarNorm + 0.25*grz + 0.20*(1 - greenNorm))
```

### Archetype derivation

After the search completes, the archive elites are clustered into **four**
archetypes with deterministic k-means (k-means++ init, `KMEANS_SEED = 15`,
`KMEANS_ITERS = 40`) over a **9-dimensional** normalised feature vector
([`simulation.js`](simulation.js:373)):

```text
[floorArea, buildingCountNorm, greenNorm, meanHeightNorm,
 waterFrac, forestFrac, sealedFrac, meanFootprint, streetFraction]
```

Dimension 1 stays **cell-based** (`buildingCount / N*N`) so the archetype
labelling (A = highest porosity) keeps its documented meaning; only the QD
archive axis uses `structureCount`.

Labels are assigned deterministically ([`simulation.js`](simulation.js:527)):

- **D** — cluster with the highest mean floor area
- **A** — among the rest, highest mean porosity (preferring green ≥ 0.4)
- **C** — among the rest, highest mean height
- **B** — the last remaining cluster

Each archetype also exposes a **medoid** (the member minimising summed squared
distance to its cluster-mates), used as the representative design.

| Id | Name | Colour |
|---|---|---|
| A | Green Cold-Air Finger | `#3fa34d` |
| B | Porous Courtyard Carpet | `#38bdf8` |
| C | Fine-Grain Low-Rise | `#a78bfa` |
| D | Maximum Housing Density | `#f97316` |

---

## Data model

Concise shapes (see the JSDoc in each module for the full definitions).

### `Block`

```js
{
  id: number,            // 0..8, stable index
  x: number, y: number,  // top-left grid cell
  w: number, h: number,  // size in cells
  landUse: string,       // dominant KLAM class id
  pattern: string,       // one of PATTERNS
  baseHeight: number,    // stories
  heightProfile: string, // one of PROFILES
  density: number,       // footprint fraction 0.35..0.9
  seed: number           // per-block deterministic seed
}
```

### `Cell`

```js
{
  klam: string,          // KLAM class id
  height: number,        // stories (0 for non-building)
  footprint: number,     // building footprint fraction 0..1 (0 if none)
  roofType: string,      // 'flat' | 'stepped' | 'pitched'
  buildingType: string,  // KLAM class id of the building, or 'none'
  street: boolean,       // true for street/plaza cells
  blockId: number,       // owning block id, or -1 for streets, -2 for existing blocks
  rail: boolean          // true for repurposed rail cells (street + rail detail)
}
```

### `Design`

```js
{
  id: number,
  seed: number,
  windDir: { x: number, y: number },  // normalized city cold-air direction (fixed)
  structure: Structure,  // fixed site infrastructure retained in every design
  blocks: Block[],       // 9 blocks
  streets: { cols: number[], rows: number[], width: number },  // derived from structure
  cells: Cell[],         // 100 cells, row-major: index = gy*N + gx (gy=0 is North)
  metrics: Metrics | null,
  descriptor: { floorArea: number, structureCount: number } | null,
  fitness: number | null,
  archetype: string | null
}
```

### `Metrics`

```js
{
  layman: {
    homes: number,            // residents (Σ height × footprint × dwellings/floor × residents/dwelling)
    freshAirInflow: number,   // % of V_FLUX_REF, 0..100
    greenSpace: number,       // % permeable cells
    summaryBadge: 'Cool & Green' | 'Balanced' | 'Dense & Warm' | 'High Capacity'
  },
  planner: {
    grz: number,              // mean footprint fraction 0..1
    gfz: number,              // mean floor-area ratio (stories × footprint)
    vFlux: number,            // m³/s
    z0Mean: number,           // mean roughness length (m)
    sigma: number,            // surrogate uncertainty 0..1
    buildingCount: number,    // integer count of built cells (0..N*N)
    structureCount: number,   // integer count of contiguous building structures (4-connected)
    porosity: number,         // 1 - buildingCount/(N*N), the QD objective
    classPct: Record<string, number>   // per-KLAM percentage (7 classes)
  }
}
```

### `Archive`

```js
{
  bins: (Design | null)[],   // 144 bins (12×12), null when empty
  coverage: number,          // fraction of non-empty bins 0..1
  best: Design | null,       // highest-fitness elite
  pareto: number[]           // ids of elites non-dominated on (floorArea, structureCount)
}
```

### `Archetype`

```js
{
  id: 'A' | 'B' | 'C' | 'D',
  name: string,
  color: string,
  badge: string,
  centroid: number[],        // 9-dim feature centroid
  medoidId: number | null,   // representative elite id
  memberIds: number[]        // elite ids in this cluster
}
```

### Application state

[`state.js`](state.js:52) holds the full `AppState` (phase, site, archive,
archetypes, selection, layers, audience, hover, pause, animation). It is managed
by a tiny Redux-style store — `createStore(reducer, initialState)` exposing
`{ getState, dispatch, subscribe }` ([`state.js`](state.js:274)). The reducer is
pure and immutable; unhandled actions return the previous state unchanged.

Handled actions: `SET_PRESET`, `SET_SELECTION_BOX`, `RUN_SEARCH`, `TICK`,
`SEARCH_COMPLETE`, `SELECT_DESIGN`, `SELECT_ARCHETYPE`, `TOGGLE_LAYER`,
`SWITCH_AUDIENCE`, `HOVER_CELL`, `RESTART`, `SET_PAUSED`.

---

## Planning Department view

OpenSKIZZE 2.0 briefs three audiences from the same archive. The dashboard
([`dashboard.js`](dashboard.js:1)) renders exactly one panel at a time, selected
by `state.audience`:

| Audience | `state.audience` | Panel | Content |
|---|---|---|---|
| Layman | `layman` | `#dashboard-layman` | Friendly KPI cards (homes, fresh-air gauge, green space, summary badge). |
| Urban Planner | `planner` | `#dashboard-planner` | GRZ/GFZ bars, V_flux reference table, roughness, σ, 7-class KLAM donut, narrative. |
| Planning Dept | `department` | `#dashboard-department` | Cluster consensus map (confident-only dominant + mixed shade), program bar, per-class heat toggle, grouped requirements and a copy/download brief. |

The three-way toggle lives in [`ui.js`](ui.js:1); the `SWITCH_AUDIENCE` reducer
rejects any audience other than those three
([`state.js`](state.js:253)). Unlike the Layman/Planner panels — which describe
a single *selected design* — the Planning Department view describes **the whole
selected archetype cluster**.

### Consensus engine ([`consensus.js`](consensus.js:1))

The engine separates **quantity** from **placement** and returns
`{ cells, program, zones, requirements, stats }`.

[`buildDesignIndex`](consensus.js:226) builds an id → design index from the
archive, accepting both the store's wrapper bins (`{ design, fitness, bx, by }`)
and raw designs; [`collectClusterDesigns`](consensus.js:245) resolves an
archetype's `memberIds` against that index in deterministic ascending-id order.

**Per-cell consensus.** [`computeConsensus`](consensus.js:587) aggregates the
cluster into **one record per cell** (`N * N = 100` cells):

| Field | Meaning |
|---|---|
| `classDist` | Mean frequency of each of the seven KLAM classes across the cluster (sums to 1). |
| `dominant` | KLAM class with the highest mean frequency. |
| `confidence` | `classDist[dominant]`, 0..1. |
| `entropy` | Shannon entropy of `classDist`, normalised by `log(7)` → 0..1 (0 = unanimous, 1 = maximum uncertainty). |
| `heightMean` / `heightStd` | Mean / population std-dev of building height (stories) over all designs. |
| `footprintMean` / `footprintStd` | Mean / population std-dev of footprint fraction over all designs. |
| `buildingFrac` | Fraction of designs in which the cell is a building (`height > 0`). |

**Program (quantity).** `program` is one entry per KLAM class
([`computeProgramAndZones`](consensus.js:374)):

| Field | Meaning |
|---|---|
| `klam` / `label` | Class id / human-readable label. |
| `meanShare` | Mean fraction of the 100 cells carrying the class across designs. |
| `stdShare` | Population std-dev of the per-design area share. |
| `expectedCells` | `meanShare * 100` (expected number of cells). |
| `presence` | Fraction of designs in which the class occurs at least once. |

This is the key robustness fix: a class that is abundant but placed differently
in every design keeps a stable `meanShare`/`expectedCells`, because the program
is computed from per-design **area counts**, not from any spatial agreement.

**Zones (placement).** `zones` aggregates each class's expected area over a
**3×3 compass partition** of the parcel ([`zoneOf`](consensus.js:205),
`ZONE_NAMES = ['NW','N','NE','W','C','E','SW','S','SE']`, row-major with the
north band first; [`zonePhrase`](consensus.js:215) gives the human phrase). Each
entry carries `zoneDist` (expected cells per zone, summing to `expectedCells`),
`dominantZone`, `concentration = max(zoneDist) / expectedCells` (≈0.11 when
dispersed across all nine zones → 1.0 when confined to one) and `zoneEntropy`
(normalized Shannon entropy of the zone shares, 0..1).

**Requirements.** [`computeRequirements`](consensus.js:472) derives three kinds,
ordered **quantity → placement → avoid**:

- **quantity** — always emitted when `meanShare >= QUANTITY_MIN = 0.03`. A firm
  area budget (`"provide approximately X% of the site (±Y%)"`), with
  `tolerance` = `round(stdShare * 100)` percentage points. This is the
  *presence* guarantee: the class must appear, wherever it goes.
- **placement** — conditional, emitted when
  `expectedCells >= PLACEMENT_AREA_MIN = 2`. If
  `concentration >= PLACEMENT_MIN = 0.45` the class is **concentrated**: the
  requirement names the `dominantZone` and a `tolerance` in zones (from the
  per-design centroid spread, `classToleranceZones`). Otherwise it is
  **flexible** (`flexible: true`, `"location unrestricted — distribute across
  the site"`). This is the *co-location* guarantee, and it is only claimed when
  the cluster actually agrees on a location.
- **avoid** — program-based: emitted when `meanShare < AVOID_MAX = 0.005` and
  the class has neither a quantity nor a placement requirement
  (`"not part of this design family"`).

**The scattered-water case.** A class that appears in every design (~10 cells)
but in a different place each time has `meanShare ≈ 0.10` and a low
`concentration` (≈0.16). The engine therefore emits a **quantity** requirement
(it is part of the program) and a **flexible** placement — never an `avoid` and
never a false "put it in the north-west". This is the regression the rework
fixes.

`stats` summarises the result: `designs`, `meanConfidence`, `meanEntropy` and a
per-class `coverage` (the fraction of cells each class dominates). The engine is
pure — no DOM, no state coupling, no `Math.random` — so it is fully testable
headless and deterministic. In the Node harness a cluster consensus of 15–30
designs computes in well under a few milliseconds (measured ≈0.3–2.8 ms).

### The brief export

[`formatBrief`](consensus.js:696) renders a consensus + archetype as a clean,
copy-pasteable plain-text competition brief: a header with the archetype id,
name and cluster size, the consensus confidence and mean uncertainty, then three
labelled sections — **PROGRAM (quantities)**, **PLACEMENT (where)** and
**AVOID** — each a numbered list of requirement sentences. In the department
panel the **📋 Copy brief** button copies this string to the clipboard (async
Clipboard API with a hidden-textarea `execCommand` fallback) and the **⬇ .txt**
button downloads it as `openskizze-brief-<id>.txt`.

### The department panel ([`dashboard.js`](dashboard.js:1))

The panel is built by [`departmentHTML`](dashboard.js:528) from the consensus:

- **Revised consensus map** ([`consensusMap`](dashboard.js:269)) — in the
  default *dominant* mode a cell shows its dominant class colour at
  `opacity = confidence` **only when `confidence >= CONFIDENCE_THRESHOLD = 0.6`**;
  below the threshold the cell is drawn as a neutral grey "mixed / flexible"
  hatch instead of pretending a class dominates. Confident cells with high
  normalized entropy keep a diagonal uncertainty hatch.
- **Per-class probability heat toggle** ([`classSelector`](dashboard.js:412)) —
  a "Dominant" button plus one heat button per class present in the program.
  Selecting a class re-renders the map in *heat* mode, tinting each cell with
  the class colour at `opacity = classDist[klam]`, so a scattered-but-abundant
  class is visibly spread across the site rather than washed out.
- **Program bar** ([`programBar`](dashboard.js:364)) — a stacked bar of each
  class's `meanShare`, plus one row per class showing the mean as a solid fill
  and the `stdShare` as a lighter ± band with the numeric `mean% ±std%`. This is
  the quantity fix made visible: a scattered class keeps a solid share even when
  its map location is flexible.
- **Requirements** ([`requirementList`](dashboard.js:491)) — grouped into
  PROGRAM (quantities), PLACEMENT (where) and AVOID. Quantity rows show
  mean ± std; concentrated placement rows get a solid accent with zone +
  tolerance; flexible placement rows get a dashed, muted accent and "location
  unrestricted"; avoid rows get a red accent.
- **Export** — the copy-brief and `.txt` download buttons.

### Caching

`createDashboard` caches the consensus **per archetype id** (`consensusCache`).
The cache is invalidated whenever the archive object identity changes — i.e. on
`SEARCH_COMPLETE`, `RESTART` or a new search — so switching back and forth
between archetypes within one search recomputes nothing. The department panel's
render signature additionally tracks the selected archetype and cluster size so
it only rebuilds when they change.

---

## Rendering

### Isometric viewer ([`iso.js`](iso.js:1))

- **Projection** — `isoProject(gx, gy, elevation, geom)` maps grid + elevation
  to screen; `computeGeom` fits the parcel to the canvas with headroom for the
  tallest building and is **cached** by canvas size + grid side + max height.
- **Footprint prisms** — `drawIsoPrism` insets each building by its footprint
  fraction and draws three flat-shaded faces (top lightest, left mid, right
  darkest) from the per-KLAM [`palette.js`](palette.js:1) ramp.
- **Roof types** — `flat` (parapet outline), `pitched` (gable with a raised
  ridge) and `stepped` (2–3 stacked, shrinking prisms).
- **Lighting ramp** — `LIGHT` defines the face tones and shared silhouette
  outline; facade floor bands and contact darkening add depth.
- **Environment** — a sky gradient, horizon glow, soft ground plane with a
  whole-parcel drop shadow, and a vignette. Gradients are built once per canvas
  size and reused.
- **Cached ground layer** — tiles, gradient water, ambient occlusion and the
  grid overlay are rendered once into an offscreen canvas keyed by design
  identity + size, then blitted each frame.
- **Ambient occlusion** — per-cell alpha from summed neighbour building heights,
  cached by design identity.
- **Trees / water** — forest cells draw 3–5 overlapping low-poly canopy blobs;
  water cells draw a gradient fill plus animated ripples (static under reduced
  motion).
- **Retained structure** — the static ground layer draws the retained roads and
  the repurposed rail cells; rail cells get subtle sleepers (ties) and twin
  rails, with the track direction inferred from rail neighbours.
- **Wind cue** — a small compass in the corner whose arrow follows the selected
  city's `coldAir.dir` (rotated into the iso view basis) and is labelled with its
  compass shorthand (e.g. `NW → SE`).
- **Orientation** — [`orientationForDir`](iso.js:129) picks a 0–3 quarter-turn
  grid rotation so the projected cold-air flow always has a positive screen-down
  component (it never renders as a purely horizontal flow); the depth-sort order
  rotates with it.

### Macro map ([`citymap.js`](citymap.js:1))

A deliberately **diagrammatic** municipal planning schematic (not an
illustration). `drawTerrain` renders the **selected city's** `city.terrain`
zones generically — each zone type (`hills`/`mountains`, `meadow`, `river`,
`lake`, `railyard`, `suburb`, `urban`) has its own flat-fill drawing routine,
zones are flat-filled with thin strokes and never overlap, and the legend lists
that city's labelled zones. Switching preset therefore swaps the whole
surrounding city.

The default **Klimastadt** stacks a cool northern cold-air reservoir and
meadows, a grey rail-valley band with simple parallel rail lines, and a dense,
strictly ordered warm-toned urban core to the south; **Alpenvorstadt** shows
alpine slopes, a foothill meadow and a river; **Beckenstadt** shows a green
basin rim around a meadow and a cold-air lake, with the dense core to the south.
City blocks sit on strict, non-overlapping grids inside their zone with
consistent margins, so street gaps stay visible and no two blocks intersect.

An animated cold-air vector arrow runs diagonally across the map along the
selected city's `coldAir.dir` and is labelled with its compass shorthand, with a
legend, a north arrow and a scale bar alongside. All decoration uses a seeded
PRNG.

The 10×10 site grid is **design-accurate**: it draws the actually selected
design's KLAM-tinted `design.cells` (or a deterministic preset-biased block
preview when nothing is selected), mirroring the isometric view, and overlays
the retained site structure (roads, rails, green corridor and pre-existing
blocks) distinctly. A draggable/resizable selection box sits on top.

### Archive heatmap ([`archiveview.js`](archiveview.js:1))

The 12×12 archive is drawn as a heatmap. Filled niches carry a **mini isometric
thumbnail** rendered once via `renderThumbnail` into an offscreen canvas cache
keyed by design id, then blitted; empty niches are slate. Newly filled niches
flash white/yellow. Phase 3 adds a stepped **Pareto frontier** polyline with
endpoint dots and a label, plus coloured **archetype badges** and a selected-
medoid outline. A cheap signature check skips redraws when nothing changed.

### Cold-air flow layer ([`airflow.js`](airflow.js:1))

The airflow is a **2 m-height, obstacle-aware flow layer** derived from the
actual design, not a per-cell roughness blur. It is modelled at
`COLD_AIR_LAYER_ELEVATION = 2/3` storeys ≈ **2.00 m** (exported from
[`iso.js`](iso.js:44) and re-exported by [`airflow.js`](airflow.js:52)), so at
that height **every building is an obstacle** (buildings are ≥1 storey ≈ 3 m)
while streets, courtyards, gardens, grass, forest and water are passable.

**Occupancy grid.** [`buildOccupancyGrid`](airflow.js:122) samples each 10 m cell
with `SUB = 4` sub-cell samples per edge, giving a `FN × FN = 40 × 40` fine grid
(1,600 samples). A sample is solid when its parent cell has `height > 0` and the
sample lies inside the cell's footprint sub-rectangle (the footprint fraction is
centred in the cell); streets and all non-building cells are free.

**Obstacle-aware field construction.** The velocity field is seeded with the
selected city's `coldAir.dir` (`setWindDir` / `getWindDir`) and then:

1. an **openness potential** (1 free, 0 obstacle) is diffused with
   `PERM_ITERS = 3` Jacobi iterations so the flow sees smooth corridors;
2. the base wind is **accelerated** where openness is high (streets get an extra
   `×1.25`) and **deflected up the openness gradient** (`DEFLECT = 2.2`) — i.e.
   away from buildings and toward open space — so the flow goes around obstacles
   and channels through streets;
3. obstacle samples are **pinned to zero** and the vector field is relaxed with
   `FIELD_ITERS = 2` obstacle-aware Jacobi smoothing passes (obstacle neighbours
   contribute the centre value, a Neumann-like condition, so the flow is not
   pulled into walls);
4. a coarse **upstream pooling** value accumulates blockage along `-coldAir.dir`
   (`POOL_STEPS = 4*N`), so tall/dense blocks stagnate the air in front of them.

**Collision-safe advection.** Particles spawn on the free upstream boundary
(weighted by the wind components) and are advected with bilinear sampling plus a
**collision step**: a move that would enter an obstacle sample is slid along the
wall (x-only or y-only) or the particle respawns, so **no particle ever
penetrates a building**. They preferentially travel along streets and are
rendered as fading **streamline ribbons** backed by a reusable per-particle trail
ring buffer. Sheltered/pooled cells are drawn as soft radial-gradient **fog
blobs** from a cached sprite, sharing one grey/blue visual language with the
`coldPool` iso layer. Under reduced motion the system draws static streamlines
(which stop at obstacles) instead of animating particles.

**Shared solution-grid projection.** Streamlines, particle trails and pooling fog
are all placed with the single shared projection
[`projectCell`](iso.js:175) / [`projectCellInto`](iso.js:160) from
[`iso.js`](iso.js:1) — the same transform the iso ground renderer uses for its
tiles. The airflow works in **cell-centre coordinates** (the centre of cell
`(gx,gy)` is `(gx+0.5, gy+0.5)`); its fine-grid particle coordinates are
converted with `x/SUB`, `y/SUB`. Because `projectCellInto` reuses
`isoProjectInto` (same `geom`, orientation and origin) and folds in the ground
renderer's `-0.5` corner shift and `+tileHeight/2` diamond-centre shift, the
streamlines align **exactly** with the solution grid in all four orientations
(verified max error 0 px), with the `COLD_AIR_LAYER_ELEVATION` offset applied
consistently.

---

## UI

- **Type scale** — a fixed 11 / 12 / 14 / 16 / 20 / 28 px scale exposed as
  `.fs-11` … `.fs-28` utility classes ([`openskizze-2.0.html`](../../../openskizze-2.0.html:26)).
- **Presentation mode** — the `🖥️ Presentation` toggle adds `body.presentation`,
  which collapses the explore sidebars to a full-bleed isometric view; the
  toggle re-measures **all** canvases via the orchestrator's `resizeAll`.
- **KLAM donut** — the Urban Planner panel renders a 7-class SVG donut plus a
  full legend (including zero-percent classes) from `metrics.planner.classPct`
  ([`dashboard.js`](dashboard.js:104)).
- **Layer toggles** — animated airflow streamlines, cold-air layer depth
  (pooling fog) and the KLAM_21 legend.
- **Audience switch** — Layman / Urban Planner / Planning Dept panels, toggled
  by `state.audience` (see *Planning Department view*).
- **Accessibility** — canvases are focusable (`tabindex="0"`) with
  `role`/`aria-label`s; the archive and city map support arrow-key navigation.

---

## Performance & determinism

### Caches

- `computeGeom` — geometry cached by canvas size + grid side + max height.
- `paletteFor` — per-KLAM colour ramps memoised.
- Isometric viewer — cached environment gradients, cached static ground layer
  (offscreen, keyed by design identity + size), cached ambient-occlusion buffer
  (keyed by design identity).
- Archive — thumbnails rendered once per design id into an offscreen cache
  (bounded, pruned to visible ids); heat colours memoised on a 64-level ramp.
- Airflow — the fine 2 m velocity field is **cached per design identity + wind
  direction** (`buildField` is a no-op when the same design and direction are
  re-supplied), so it is rebuilt only when the selected design or preset
  changes. The pooling fog blits a cached radial-gradient sprite; the particle
  hot path samples into a reused output object and reuses per-particle trail
  buffers (no per-frame allocation).
- Dashboard — the Planning Department consensus is **cached per archetype id**
  and invalidated when the archive object identity changes (`SEARCH_COMPLETE` /
  `RESTART` / a new search), so re-visiting an archetype is free.

### Throttles & caps

- Archive and preview redraws are limited to ~20 fps (`DRAW_INTERVAL_MS = 50`).
- The Phase-2 DOM ticker updates at ~10 fps (`ui.js`).
- Airflow particles are capped at **180** (desktop) / **90** (viewports
  < 1280 px) and re-applied on resize. The advection hot path performs **no
  per-frame allocation** (reused sample/projection objects and per-particle
  trail ring buffers).
- `update`/`render` are skipped when `document.hidden` or `state.paused`.
- `prefers-reduced-motion: reduce` disables particle motion (static streamlines)
  and phase transitions (`body.reduced-motion`).

### Frame budget

The isometric render is expected to stay within **≤ ~8 ms** per frame on a
mid-range device: the ground layer, geometry, palettes, AO and environment
gradients are all cached, and the per-frame work is limited to depth-sorted
prism drawing plus optional airflow passes.

### Measured airflow timings

In the Node verification harness the fine field builds in **≈1–3 ms** and
advection costs **≈0.03–0.05 ms per step** (180 particles). Because the field is
cached per design identity + wind direction, steady-state frames pay neither
cost — only the per-particle bilinear sample, collision step and ribbon draw.

### Determinism

The whole pipeline is deterministic: the same `SIM.SEED` produces identical
candidate genomes, an identical archive (coverage, best id, Pareto set) and
identical archetypes/medoids. The adaptive descriptor scale is likewise measured
deterministically from the candidate population *before* ticking, so the
normalisation is stable and reproducible. There is **no `Math.random`**
anywhere — all randomness flows through the seeded xorshift32 PRNG in
[`prng.js`](prng.js:1).

> **Reproducibility contract.** The seed is the reproducibility contract. The R1
> metric change — GFZ is now a real floor-area ratio (footprint × height) and
> `KLAM_STREET` was added — means the archive differs from the pre-upgrade
> build. The QD Y-axis change from cell-based `buildingCount` to
> `structureCount` likewise alters the archive (coverage, Pareto set and
> archetypes) for a fixed seed. Changing `SIM.SEED` produces a different but
> still fully reproducible archive.

---

## Extending it

### Add a KLAM class

1. Add an entry to `KLAM` in [`klam.js`](klam.js:22) with `pCold`, `z0`,
   `sealed`, `dwellingsPerFloor`, `residentsPerDwelling`, `label`, `color`.
2. If it is a building class, add a `HEIGHT_RANGE` entry
   ([`klam.js`](klam.js:36)).
3. Add a transition row to `TRANSITIONS` in [`klam.js`](klam.js:50) so block
   mutation can reach it.
4. Add a colour ramp to `PALETTE` in [`palette.js`](palette.js:21).

`KLAM_IDS` is derived from `Object.keys(KLAM)`, so metrics, the donut and the
legend pick up the new class automatically.

### Change the simulation constants

All tunables live in `SIM` in [`config.js`](config.js:23): `SEED`,
`TOTAL_CANDIDATES`, `DURATION_MS`, `MUTATION_RATE`, `BLOCK_MUTATION_RATE`,
`GLOBAL_MUTATION_RATE`, `KMEANS_SEED`, `KMEANS_ITERS`, `SHELTER_K`, `GFZ_MAX`,
`STRUCT_MAX`.
Changing `SEED` produces a different (but still reproducible) archive. Changing
`BINS` or `N` resizes the archive and parcel respectively — check the hard-coded
`144` in [`state.js`](state.js:58) if you change `BINS`.

### Add a layer

1. Add a boolean to `layers` in `makeInitialState()`
   ([`state.js`](state.js:62)).
2. Render it in the isometric viewer ([`iso.js`](iso.js:1)) gated on
   `state.layers.<name>`.
3. Add a toggle button in [`ui.js`](ui.js:1) that dispatches
   `{ type: 'TOGGLE_LAYER', layer: '<name>' }`.

### Swap the surrogate

The "surrogate" is the closed-form metric model in
[`design.js`](design.js:658) (`computeMetrics` / `computeDescriptor` /
`computeFitness`). To plug in a real model, replace these functions with calls
to your predictor while preserving their signatures and the `[0, 1]` descriptor
ranges. The rest of the pipeline (archive, archetypes, renderers) is agnostic to
how the numbers are produced.

---

## File inventory

| Module | Lines | Description |
|---|---:|---|
| [`config.js`](config.js:1) | 183 | Global constants (`N`, `BINS`, `SIM`, `V_FLUX_REF`), `DEFAULT_STRUCTURE`, patterns/profiles, site `PRESETS` (with `description`/`rationale`/`structure` plus a `city` context: name, tagline, `coldAir` direction and `terrain` zones), `ARCHETYPE_DEFS`. |
| [`prng.js`](prng.js:1) | 151 | Seeded xorshift32 PRNG plus `randInt`, `pick`, `shuffle`, `weightedPick`, `valueNoise2D`. |
| [`klam.js`](klam.js:1) | 89 | The seven KLAM_21 land-use classes, height ranges, transition kernel and accessors. |
| [`palette.js`](palette.js:1) | 49 | Cached per-KLAM three-tone isometric colour ramps (`paletteFor`). |
| [`i18n.js`](i18n.js:1) | 599 | Dependency-free EN/DE localisation core: `LANGS`, `DICT` (en/de), `t(key, params)` with `{param}` interpolation, `loc(value)` for `{en,de}` data, `getLang`/`setLang`/`toggleLang` + `onChange`, `localStorage['openskizze.lang']` persistence, and `applyI18n` for `data-i18n`/`data-i18n-html`/`data-i18n-aria`/`data-i18n-title`. |
| [`design.js`](design.js:1) | 1120 | Block/Cell genome, `computeFreeRects`/`streetsFromStructure`/`cloneStructure`, `createDesign`/`cloneDesign`/`mutateDesign` (fixed `windDir`), structure-aware `rasterize`, footprint-aware metrics with directional upstream shelter, `countStructures` (4-connected building components), descriptor/fitness, adaptive `setDescriptorScale`/`getDescriptorScale`, `binOfX`/`binOfY`/`binOfYStructures`. |
| [`simulation.js`](simulation.js:1) | 636 | `generateCandidates` (land-use maps × pattern schemes × height/density/profile sweep + adaptive scale; threads `city.coldAir.dir` into every design), `runMAPElites`, `deriveArchetypes` (k-means k=4, 9-dim features), `createArchive`. |
| [`consensus.js`](consensus.js:1) | 728 | Pure consensus + requirement-extraction engine: `buildDesignIndex`, `collectClusterDesigns`, `computeConsensus` (per-cell `classDist`/`dominant`/`confidence`/normalized `entropy`, height/footprint mean+std, `buildingFrac`; plus per-class program `meanShare`/`stdShare`/`expectedCells`/`presence` and 3×3 `zones` with `concentration`/`zoneEntropy`), `zoneOf`/`zonePhrase`, `computeRequirements` (quantity/placement/avoid), `describeRegion`, `formatBrief`. |
| [`state.js`](state.js:1) | 313 | Central store: `createStore`, pure `reducer`, `makeInitialState`, all actions. |
| [`citymap.js`](citymap.js:1) | 1071 | Diagrammatic macro city schematic: renders the selected preset's `city.terrain` zones generically, a per-city legend, non-overlapping block grids, a design-accurate 10×10 site grid with retained-structure overlay, a draggable/resizable selection box and a city-direction cold-air arrow. |
| [`iso.js`](iso.js:1) | 1467 | 2.5D isometric renderer: projection (`isoProject`/`isoProjectInto` plus the shared `projectCell`/`projectCellInto` ground/solution-grid transform), `orientationForDir` (so the cold-air flow reads downhill), geometry fitting, footprint prisms, roof types, cached ground layer with roads + rail ties, city-direction wind cue, layers, hover. |
| [`airflow.js`](airflow.js:1) | 899 | 2 m obstacle-aware cold-air flow layer: `buildOccupancyGrid` (40×40 sub-cell grid, `SUB=4`), distance-field-deflected velocity field (Jacobi openness diffusion, obstacle pinning, obstacle-aware smoothing, upstream pooling), collision-safe bilinear particle advection (no penetration, street channeling), cached pooling-fog sprite, per-design field cache, reduced-motion static streamlines. Re-exports `COLD_AIR_LAYER_ELEVATION`; projects via the shared `projectCellInto` in cell-centre coordinates. |
| [`archiveview.js`](archiveview.js:1) | 653 | 12×12 MAP-Elites heatmap with mini-thumbnails, flash-on-new-elite, Pareto frontier, archetype badges, keyboard nav. |
| [`dashboard.js`](dashboard.js:1) | 862 | Tri-audience dashboard (Layman and Urban Planner panels with a 7-class KLAM donut, plus the Planning Dept panel: confident-only consensus map with a neutral mixed shade, per-class probability heat toggle, program bar with mean ± std, requirements grouped into PROGRAM/PLACEMENT/AVOID, and copy/download brief; consensus cached per archetype id). |
| [`ui.js`](ui.js:1) | 542 | DOM wiring: presets, site readout (preset name + city name/tagline + rationale), CTAs, phase stepper, layer toggles, tooltips, audience switch, presentation mode, keyboard. |
| [`main.js`](main.js:1) | 336 | Bootstrap and the single RAF loop; time-based Phase-2 ticker; resolves the selected city's `coldAir.dir` for airflow + iso orientation and the preset for candidate generation; resize/visibility/reduced-motion handling. |

> The app comprises **16** ES modules; line counts are approximate and reflect
> the current implementation.
