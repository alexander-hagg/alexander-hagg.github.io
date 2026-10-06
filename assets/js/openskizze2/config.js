/**
 * OpenSKIZZE 2.0 — global configuration constants.
 *
 * Pure ES module: no side effects, no DOM access.
 * All randomness in the app is seeded and deterministic; see {@link ./prng.js}.
 */

/** @typedef {import('./design.js').Design} Design */
/** @typedef {{ en: string, de: string }} Localized */

/** Parcel grid side length (10x10 cells). */
export const N = 10;

/** Area of a single cell in m² (10 m x 10 m). */
export const CELL_AREA = 100;

/** Total parcel area in m² (10,000 m²). */
export const PARCEL_AREA = N * N * CELL_AREA;

/** MAP-Elites archive side length (12x12 = 144 bins). */
export const BINS = 12;

/** Simulation-wide tunables. */
export const SIM = {
  SEED: 20260101,
  TOTAL_CANDIDATES: 12800,
  DURATION_MS: 7000,          // 6–8s window
  MUTATION_RATE: 0.16,        // per-cell probability
  BLOCK_MUTATION_RATE: 0.15,  // probability of a 2x2 block mutation
  GLOBAL_MUTATION_RATE: 0.10, // probability of a global (street/green-finger) mutation
  KMEANS_SEED: 15,
  KMEANS_ITERS: 40,
  SHELTER_K: 0.15,
  GFZ_MAX: 6,                 // real floor-area ratio ceiling
};

/**
 * @typedef {Object} StructureLine
 * @property {'h'|'v'} axis - 'h' = East–West line at row `y`; 'v' = North–South line at column `x`.
 * @property {number} [x] - Column (for `axis:'v'`).
 * @property {number} [y] - Row (for `axis:'h'`).
 * @property {number} from - Inclusive start cell along the line.
 * @property {number} to - Inclusive end cell along the line.
 */

/**
 * @typedef {Object} Structure
 * @property {StructureLine[]} rails - Existing rail tracks; retained and repurposed as roads.
 * @property {StructureLine[]} roads - Existing roads retained in every design.
 * @property {StructureLine|null} [greenCorridor] - Optional permeable cold-air corridor.
 * @property {Array<{x:number,y:number,w:number,h:number,landUse:string}>} [existingBlocks] - Pre-existing blocks retained verbatim.
 */

/**
 * Fallback structure for a site that defines none: a simple retained cross of
 * one N–S road and one E–W road. The generic 3×3 street grid has been removed;
 * every preset now carries its own `structure`.
 *
 * @type {Structure}
 */
export const DEFAULT_STRUCTURE = {
  rails: [],
  roads: [
    { axis: 'v', x: 3, from: 0, to: 9 },
    { axis: 'h', y: 3, from: 0, to: 9 },
  ],
  greenCorridor: null,
  existingBlocks: [],
};

/** Block morphology patterns (spatial arrangement of buildings/green). */
export const PATTERNS = ['perimeter', 'courtyard', 'row', 'towerPark', 'detached', 'green', 'water'];

/** Height profiles (how a block's base height varies across its cells). */
export const PROFILES = ['flat', 'stepped', 'pitched', 'random'];

/**
 * Reference cold-air flux for an all-grass parcel (m³/s).
 * 100 cells * 100 m² * pCold(grass)=12, converted from m³/h to m³/s.
 */
export const V_FLUX_REF = (100 * 100 * 12) / 3600; // 33.33 m³/s

/**
 * Site presets. `box` is the editable region within the parcel grid;
 * `bias` is a class-probability map used to seed base genomes.
 *
 * `name`, `description` and `rationale` are localised `{en,de}` values; the
 * site readout resolves them with `loc()` (see `i18n.js`). `description` is a
 * one-line summary and `rationale` explains the planning idea behind the preset.
 *
 * @type {Array<object>}
 */
export const PRESETS = [
  { id:'railyard',  name:{ en:'Central Railyard Brownfield', de:'Zentrales Bahnhofs-Brachgelände' }, box:{x:3,y:3,w:10,h:10},
    description:{ en:'Cold-air transport corridor in the transitional belt.', de:'Kaltluftleitbahn im Übergangsgürtel.' },
    rationale:{ en:'A large, underused, largely sealed former freight yard in the low-lying belt between the cool north and the hot south. The open rail corridor is a natural ventilation channel (Kaltluftleitbahn). The planning question: redevelop it for housing and mixed use without choking the cold-air drainage that flows through it.', de:'Eine große, untergenutzte, weitgehend versiegelte ehemalige Güterbahnhofsfläche im tiefliegenden Gürtel zwischen kühlem Norden und heißem Süden. Der offene Bahnkorridor ist eine natürliche Kaltluftleitbahn. Die Planungsfrage: für Wohnen und Mischnutzung entwickeln, ohne den Kaltluftabfluss zu ersticken, der hindurchströmt.' },
    bias:{ KLAM_COMMERCIAL:0.35, KLAM_GRASS:0.25, KLAM_RESIDENTIAL_LOW:0.25, KLAM_URBAN_HIGH:0.15 },
    // Two parallel E–W rail tracks become the primary E–W road/ventilation
    // corridor; one N–S connector road links the retained network.
    structure:{
      rails:[ { axis:'h', y:4, from:0, to:9 }, { axis:'h', y:5, from:0, to:9 } ],
      roads:[ { axis:'v', x:2, from:0, to:9 } ],
      greenCorridor:null,
      existingBlocks:[],
    },
    // City context: a north–south rail valley. Cold air drains N → S.
    city:{
      name:{ en:'Klimastadt', de:'Klimastadt' },
      tagline:{ en:'Valley city — cold air drains north to south along the rail valley', de:'Talstadt — Kaltluft fließt entlang des Bahntals von Nord nach Süd' },
      coldAir:{ dir:{ x:0, y:1 }, label:'N → S' },
      terrain:[
        { type:'hills',    x:0, y:0,  w:16, h:5,  color:'#2f6b4f', label:{ en:'Cold Air Reservoir', de:'Kaltluftreservoir' } },
        { type:'meadow',   x:0, y:5,  w:16, h:2,  color:'#6fae6f', label:{ en:'North Meadows', de:'Nordwiesen' } },
        { type:'railyard', x:0, y:7,  w:16, h:3,  color:'#6b7280', label:{ en:'Rail Valley', de:'Bahntal' } },
        { type:'suburb',   x:0, y:10, w:16, h:2,  color:'#c98a4b', label:{ en:'Transition Belt', de:'Übergangsgürtel' } },
        { type:'urban',    x:0, y:12, w:16, h:4,  color:'#b45309', label:{ en:'Urban Heat Island', de:'Städtische Wärmeinsel' } },
      ],
    } },
  { id:'northgate', name:{ en:'North Cold-Air Gateway', de:'Nördliches Kaltlufttor' }, box:{x:3,y:0,w:10,h:10},
    description:{ en:'Cold-air production and inflow zone.', de:'Kaltluftentstehungs- und Einströmzone.' },
    rationale:{ en:'The northern edge where cold air is generated over meadows and hills and enters the city (Kaltluftentstehungsgebiet). Development here must keep the gateway open so cold air can drain south. The planning question: add low-density housing while protecting the cold-air source.', de:'Der nördliche Rand, an dem Kaltluft über Wiesen und Hügeln entsteht und in die Stadt einströmt (Kaltluftentstehungsgebiet). Eine Bebauung hier muss das Tor offen halten, damit Kaltluft nach Süden abfließen kann. Die Planungsfrage: Wohnbebauung geringer Dichte ergänzen und zugleich die Kaltluftquelle schützen.' },
    bias:{ KLAM_GRASS:0.4, KLAM_FOREST:0.25, KLAM_WATER:0.1, KLAM_RESIDENTIAL_LOW:0.25 },
    // A N–S green corridor (the cold-air gateway) plus two cross paths; minimal
    // hard infrastructure so the gateway stays open.
    structure:{
      rails:[],
      roads:[ { axis:'h', y:3, from:0, to:9 }, { axis:'h', y:7, from:0, to:9 } ],
      greenCorridor:{ axis:'v', x:5, from:0, to:9 },
      existingBlocks:[],
    },
    // City context: alpine mountains to the NW, city to the SE. Cold air
    // descends the slope NW → SE toward the river at its foot.
    city:{
      name:{ en:'Alpenvorstadt', de:'Alpenvorstadt' },
      tagline:{ en:'Mountain-foot city — cold air flows NW to SE down the alpine slope', de:'Stadt am Gebirgsfuß — Kaltluft fließt vom Nordwesten nach Südosten den Alpenhang hinab' },
      coldAir:{ dir:{ x:1, y:1 }, label:'NW → SE' },
      terrain:[
        { type:'mountains', x:0, y:0, w:9, h:8, color:'#33556b', label:{ en:'Alpine Slopes', de:'Alpenhänge' } },
        { type:'meadow',    x:9, y:0, w:7, h:8, color:'#6fae6f', label:{ en:'Foothill Meadow', de:'Vorbergwiese' } },
        { type:'river',     points:[ { x:0, y:8 }, { x:16, y:8 } ], color:'#3d8fbb', label:{ en:'River', de:'Fluss' } },
        { type:'hills',     x:0, y:8, w:5, h:8, color:'#2f6b4f', label:{ en:'Lower Slope Woods', de:'Wald am Unterhang' } },
        { type:'suburb',    x:5, y:8, w:3, h:8, color:'#c98a4b', label:{ en:'Suburban Belt', de:'Vorstadtgürtel' } },
        { type:'urban',     x:8, y:8, w:8, h:8, color:'#b45309', label:{ en:'Urban Core (SE)', de:'Stadtkern (SO)' } },
      ],
    } },
  { id:'southcore', name:{ en:'South Heat-Island Core', de:'Südlicher Wärmeinselkern' }, box:{x:3,y:6,w:10,h:10},
    description:{ en:'Heat-accumulation zone (urban heat island).', de:'Wärmespeicherzone (städtische Wärmeinsel).' },
    rationale:{ en:'The dense, sealed, heat-retaining city centre. Adding housing in an already hot, sealed area worsens the urban heat island. The planning question: densify while introducing green/water and ventilation corridors to cool the core.', de:'Das dichte, versiegelte, wärmespeichernde Stadtzentrum. Wohnraum in einem bereits heißen, versiegelten Gebiet zu schaffen, verschärft die städtische Wärmeinsel. Die Planungsfrage: verdichten und zugleich Grün-/Wasserflächen und Lüftungskorridore einführen, um den Kern zu kühlen.' },
    bias:{ KLAM_URBAN_HIGH:0.4, KLAM_COMMERCIAL:0.3, KLAM_RESIDENTIAL_LOW:0.2, KLAM_GRASS:0.1 },
    // A retained 2×2 street grid (two N–S, two E–W streets) with two
    // pre-existing blocks kept verbatim.
    structure:{
      rails:[],
      roads:[
        { axis:'v', x:3, from:0, to:9 }, { axis:'v', x:6, from:0, to:9 },
        { axis:'h', y:3, from:0, to:9 }, { axis:'h', y:6, from:0, to:9 },
      ],
      greenCorridor:null,
      existingBlocks:[
        { x:0, y:0, w:3, h:3, landUse:'KLAM_COMMERCIAL' },
        { x:7, y:7, w:3, h:3, landUse:'KLAM_URBAN_HIGH' },
      ],
    },
    // City context: a basin ringed by green hills and a lake. Cold air sinks
    // from the NE rim SW into the dense central-south core.
    city:{
      name:{ en:'Beckenstadt', de:'Beckenstadt' },
      tagline:{ en:'Basin city — cold air sinks from the NE rim into the central-south core', de:'Beckenstadt — Kaltluft sinkt vom Nordostrand in den zentral-südlichen Kern' },
      coldAir:{ dir:{ x:-1, y:1 }, label:'NE → SW' },
      terrain:[
        { type:'hills',  x:0,  y:0, w:16, h:4,  color:'#2f6b4f', label:{ en:'Basin Rim', de:'Beckenrand' } },
        { type:'hills',  x:0,  y:4, w:3,  h:12, color:'#2f6b4f' },
        { type:'meadow', x:3,  y:4, w:5,  h:5,  color:'#6fae6f', label:{ en:'Basin Meadow', de:'Beckenwiese' } },
        { type:'lake',   x:8,  y:4, w:8,  h:5,  color:'#5bb8e8', label:{ en:'Cold-Air Lake', de:'Kaltluftsee' } },
        { type:'urban',  x:3,  y:9, w:10, h:7,  color:'#b45309', label:{ en:'Dense Core', de:'Dichter Kern' } },
        { type:'suburb', x:13, y:9, w:3,  h:7,  color:'#c98a4b', label:{ en:'Eastern Suburbs', de:'Östliche Vororte' } },
      ],
    } },
];

/**
 * The four design archetypes surfaced to the user. `name` is a localised
 * `{en,de}` value merged into each derived archetype by `deriveArchetypes`.
 *
 * @type {Array<{id:string, name:Localized, color:string, badge:string}>}
 */
export const ARCHETYPE_DEFS = [
  { id:'A', name:{ en:'Green Cold-Air Finger', de:'Grüner Kaltluftfinger' },   color:'#3fa34d', badge:'A' },
  { id:'B', name:{ en:'Porous Courtyard Carpet', de:'Poröser Hofteppich' },    color:'#38bdf8', badge:'B' },
  { id:'C', name:{ en:'Fine-Grain Low-Rise', de:'Feinkörnige Bebauung' },      color:'#a78bfa', badge:'C' },
  { id:'D', name:{ en:'Maximum Housing Density', de:'Maximale Wohndichte' },   color:'#f97316', badge:'D' },
];
