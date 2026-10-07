/**
 * OpenSKIZZE 2.0 — block/parcel morphology genome, rasterizer, mutation,
 * footprint-aware metrics, descriptors and fitness.
 *
 * The genome is a set of 9 rectangular **blocks** separated by a street grid.
 * A pure, deterministic `rasterize` step derives the stable 100-cell
 * `design.cells` interface consumed by every renderer, so renderers keep
 * working unchanged while the underlying model gains spatial structure.
 *
 * Pure ES module: no side effects, no DOM access, no `Math.random`.
 * All randomness is supplied by a caller-provided seeded PRNG.
 */

import { N, CELL_AREA, BINS, SIM, V_FLUX_REF, DEFAULT_STRUCTURE, PATTERNS, PROFILES } from './config.js';
import { KLAM, KLAM_IDS, heightRangeFor, isBuilding, TRANSITIONS } from './klam.js';
import { weightedPick, randInt, pick, valueNoise2D } from './prng.js';

/**
 * A block (parcel cluster) in the morphology genome.
 * @typedef {Object} Block
 * @property {number} id - 0..8, stable index.
 * @property {number} x - Left column (grid units).
 * @property {number} y - Top row (grid units, 0 = North).
 * @property {number} w - Width in cells.
 * @property {number} h - Height in cells.
 * @property {string} landUse - Dominant KLAM class id.
 * @property {string} pattern - One of `PATTERNS`.
 * @property {number} baseHeight - Base building height in stories.
 * @property {string} heightProfile - One of `PROFILES`.
 * @property {number} density - Footprint fraction 0.35..0.9.
 * @property {number} seed - Per-block deterministic seed.
 */

/**
 * A single parcel cell (the stable renderer interface).
 * @typedef {Object} Cell
 * @property {string} klam - KLAM class id.
 * @property {number} height - Building height in stories (0 for non-building).
 * @property {number} footprint - Building footprint fraction 0..1 (0 if none).
 * @property {string} roofType - 'flat' | 'stepped' | 'pitched'.
 * @property {string} buildingType - KLAM class id of the building, or 'none'.
 * @property {boolean} street - True for street/plaza cells.
 * @property {number} blockId - Owning block id, or -1 for streets.
 * @property {boolean} rail - True for repurposed rail cells (street + rail detail).
 */

/**
 * A candidate design (genome + cached evaluation).
 * @typedef {Object} Design
 * @property {number} id
 * @property {number} seed
 * @property {{x:number,y:number}} windDir - Normalized cold-air wind direction (grid units, x=east, y=south).
 * @property {import('./config.js').Structure} structure - Fixed site infrastructure retained in every design.
 * @property {Block[]} blocks - 9 blocks.
 * @property {{cols:number[], rows:number[], width:number}} streets - Derived from `structure`.
 * @property {Cell[]} cells - 100 cells, row-major, index = gy*N + gx (gy=0 is North).
 * @property {Metrics|null} metrics
 * @property {{floorArea:number, structureCount:number}|null} descriptor
 * @property {number|null} fitness
 * @property {string|null} archetype
 */

/**
 * Layman + planner metric bundle.
 * @typedef {Object} Metrics
 * @property {{homes:number, freshAirInflow:number, greenSpace:number, summaryBadge:string}} layman
 * @property {{grz:number, gfz:number, vFlux:number, z0Mean:number, sigma:number, buildingCount:number, structureCount:number, porosity:number, classPct:Record<string,number>}} planner
 */

/** Classes considered permeable (green/blue infrastructure). */
const PERMEABLE = new Set(['KLAM_GRASS', 'KLAM_FOREST', 'KLAM_WATER']);

/** Default cold-air wind direction (grid units, x=east, y=south): N → S. */
export const DEFAULT_WIND_DIR = { x: 0, y: 1 };

/**
 * Normalize a grid direction vector to unit length. Falls back to
 * {@link DEFAULT_WIND_DIR} for missing or degenerate input.
 *
 * @param {{x:number,y:number}} [dir]
 * @returns {{x:number,y:number}}
 */
export function normalizeDir(dir) {
  const x = dir && Number.isFinite(dir.x) ? dir.x : 0;
  const y = dir && Number.isFinite(dir.y) ? dir.y : 1;
  const len = Math.hypot(x, y);
  if (!(len > 0)) return { ...DEFAULT_WIND_DIR };
  return { x: x / len, y: y / len };
}

/** Default balanced class bias used when no blocks are supplied. */
const DEFAULT_BIAS = {
  KLAM_GRASS: 0.4,
  KLAM_RESIDENTIAL_LOW: 0.35,
  KLAM_URBAN_HIGH: 0.25,
};

/** Discrete base-height levels used by generation and mutation. */
const HEIGHT_LEVELS = [1, 2, 4, 6, 8];

/** Discrete density levels used by generation and mutation. */
const DENSITY_LEVELS = [0.4, 0.6, 0.8];

/**
 * Mark a structure line's cells as occupied in a boolean 10×10 grid.
 * @param {boolean[]} occ
 * @param {import('./config.js').StructureLine} line
 */
function markLineOccupied(occ, line) {
  if (!line) return;
  const from = Math.max(0, Math.min(N - 1, line.from));
  const to = Math.max(0, Math.min(N - 1, line.to));
  for (let t = from; t <= to; t++) {
    const x = line.axis === 'v' ? line.x : t;
    const y = line.axis === 'h' ? line.y : t;
    if (x >= 0 && x < N && y >= 0 && y < N) occ[y * N + x] = true;
  }
}

/**
 * Compute the free block rectangles between a site's retained infrastructure.
 *
 * The structure's rails, roads, green corridor and existing blocks are marked
 * occupied; the remaining free cells are decomposed greedily (row-major) into
 * disjoint rectangles. The list is then deterministically forced to exactly
 * nine rectangles (splitting the largest when short, keeping the largest when
 * long) so the fixed 9-block genome maps one-to-one onto free regions.
 *
 * Pure and deterministic.
 *
 * @param {import('./config.js').Structure} structure
 * @returns {{x:number,y:number,w:number,h:number}[]} Exactly nine rectangles.
 */
export function computeFreeRects(structure) {
  const st = structure || DEFAULT_STRUCTURE;
  const occ = new Array(N * N).fill(false);
  for (const line of st.rails || []) markLineOccupied(occ, line);
  for (const line of st.roads || []) markLineOccupied(occ, line);
  if (st.greenCorridor) markLineOccupied(occ, st.greenCorridor);
  for (const eb of st.existingBlocks || []) {
    for (let y = eb.y; y < eb.y + eb.h; y++) {
      for (let x = eb.x; x < eb.x + eb.w; x++) {
        if (x >= 0 && x < N && y >= 0 && y < N) occ[y * N + x] = true;
      }
    }
  }

  const visited = new Array(N * N).fill(false);
  const rects = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (occ[i] || visited[i]) continue;
      let w = 0;
      while (x + w < N && !occ[y * N + x + w] && !visited[y * N + x + w]) w++;
      let h = 1;
      grow: while (y + h < N) {
        for (let k = 0; k < w; k++) {
          if (occ[(y + h) * N + x + k] || visited[(y + h) * N + x + k]) break grow;
        }
        h++;
      }
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) visited[yy * N + xx] = true;
      }
      rects.push({ x, y, w, h });
    }
  }

  // Force exactly nine rectangles so the 9-block genome maps one-to-one.
  while (rects.length < 9) {
    let bi = 0;
    for (let i = 1; i < rects.length; i++) {
      if (rects[i].w * rects[i].h > rects[bi].w * rects[bi].h) bi = i;
    }
    const r = rects[bi];
    if (r.w >= r.h && r.w > 1) {
      const w1 = Math.floor(r.w / 2);
      rects.splice(bi, 1,
        { x: r.x, y: r.y, w: w1, h: r.h },
        { x: r.x + w1, y: r.y, w: r.w - w1, h: r.h });
    } else if (r.h > 1) {
      const h1 = Math.floor(r.h / 2);
      rects.splice(bi, 1,
        { x: r.x, y: r.y, w: r.w, h: h1 },
        { x: r.x, y: r.y + h1, w: r.w, h: r.h - h1 });
    } else {
      break; // no splittable rectangle left
    }
  }
  if (rects.length > 9) {
    rects.sort((a, b) => b.w * b.h - a.w * a.h);
    rects.length = 9;
  }
  return rects;
}

/**
 * Derive the legacy `{cols, rows, width}` street summary from a structure.
 * `cols` are the columns of N–S rails/roads, `rows` the rows of E–W rails/roads.
 *
 * @param {import('./config.js').Structure} structure
 * @returns {{cols:number[], rows:number[], width:number}}
 */
export function streetsFromStructure(structure) {
  const st = structure || DEFAULT_STRUCTURE;
  const cols = new Set();
  const rows = new Set();
  for (const line of [...(st.rails || []), ...(st.roads || [])]) {
    if (line.axis === 'v') cols.add(line.x);
    else rows.add(line.y);
  }
  return {
    cols: [...cols].sort((a, b) => a - b),
    rows: [...rows].sort((a, b) => a - b),
    width: 1,
  };
}

/**
 * Deep-copy a structure (fixed per design; never mutated by `mutateDesign`).
 * @param {import('./config.js').Structure} s
 * @returns {import('./config.js').Structure}
 */
export function cloneStructure(s) {
  const st = s || DEFAULT_STRUCTURE;
  return {
    rails: (st.rails || []).map((r) => ({ ...r })),
    roads: (st.roads || []).map((r) => ({ ...r })),
    greenCorridor: st.greenCorridor ? { ...st.greenCorridor } : null,
    existingBlocks: (st.existingBlocks || []).map((b) => ({ ...b })),
  };
}

/** Clamp a value to [0, 1]. @param {number} x @returns {number} */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Clamp a value to [lo, hi]. @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Local PRNG factory (avoids a circular import with prng.js at module top).
 * @param {number} seed
 * @returns {() => number}
 */
function makeLocalRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Deterministic per-cell PRNG derived from a block seed and cell coordinates.
 * @param {number} seed
 * @param {number} gx
 * @param {number} gy
 * @returns {() => number}
 */
function cellRng(seed, gx, gy) {
  let s = (seed >>> 0) || 1;
  s ^= Math.imul(gx + 1, 0x9e3779b1);
  s ^= Math.imul(gy + 1, 0x85ebca6b);
  s ^= s << 13; s ^= s >> 17; s ^= s << 5;
  return function () {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Deep-copy a block. @param {Block} b @returns {Block} */
function cloneBlock(b) {
  return {
    id: b.id, x: b.x, y: b.y, w: b.w, h: b.h,
    landUse: b.landUse, pattern: b.pattern, baseHeight: b.baseHeight,
    heightProfile: b.heightProfile, density: b.density, seed: b.seed,
  };
}

/** Deep-copy a cell. @param {Cell} c @returns {Cell} */
function cloneCell(c) {
  return {
    klam: c.klam, height: c.height, footprint: c.footprint,
    roofType: c.roofType, buildingType: c.buildingType,
    street: c.street, blockId: c.blockId, rail: !!c.rail,
  };
}

/**
 * Build a default 9-block genome deterministically from `seed`, laid out in the
 * free regions of `structure`.
 * @param {number} seed
 * @param {import('./config.js').Structure} [structure]
 * @returns {Block[]}
 */
function defaultBlocks(seed, structure) {
  const rng = makeLocalRng(seed);
  const rects = computeFreeRects(structure);
  const blocks = [];
  for (let b = 0; b < rects.length; b++) {
    const rect = rects[b];
    blocks.push({
      id: b,
      x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      landUse: weightedPick(rng, DEFAULT_BIAS),
      pattern: pick(rng, PATTERNS),
      baseHeight: pick(rng, HEIGHT_LEVELS),
      heightProfile: pick(rng, PROFILES),
      density: pick(rng, DENSITY_LEVELS),
      seed: (seed + Math.imul(b + 1, 0x9e3779b1)) >>> 0,
    });
  }
  return blocks;
}

/**
 * Create a design. If `blocks` is omitted, a default 9-block genome is built
 * deterministically from `seed` and laid out in the free regions of
 * `structure`. The 100-cell raster is always derived via {@link rasterize}.
 *
 * @param {number} seed
 * @param {Block[]} [blocks]
 * @param {import('./config.js').Structure} [structure] - Site infrastructure retained in the design.
 * @param {{x:number,y:number}} [windDir] - Cold-air wind direction (grid units, x=east, y=south).
 * @returns {Design}
 */
export function createDesign(seed, blocks, structure, windDir) {
  const st = structure || DEFAULT_STRUCTURE;
  const d = {
    id: 0,
    seed,
    windDir: normalizeDir(windDir),
    structure: cloneStructure(st),
    blocks: blocks ? blocks.map(cloneBlock) : defaultBlocks(seed, st),
    streets: streetsFromStructure(st),
    cells: [],
    metrics: null,
    descriptor: null,
    fitness: null,
    archetype: null,
  };
  rasterize(d);
  ensureInvariants(d);
  return d;
}

/**
 * True for a retained-structure cell: a street/rail, the green corridor or a
 * pre-existing block. These are never overwritten by the invariant repair, so
 * the site structure is retained in every design.
 * @param {Cell} c
 * @returns {boolean}
 */
function isStructureCell(c) {
  return c.street || c.blockId < 0;
}

/** First mutable (non-structure) cell index, or -1. @param {Cell[]} cells @returns {number} */
function firstNonStreet(cells) {
  for (let i = 0; i < cells.length; i++) if (!isStructureCell(cells[i])) return i;
  return -1;
}

/**
 * Deterministically guarantee ≥1 building cell and ≥1 permeable cell so every
 * design satisfies the renderer/metric invariants. Applied by `createDesign`
 * after `rasterize` (mutation applies its own randomized repair).
 * @param {Design} d
 */
function ensureInvariants(d) {
  let hasBuilding = false;
  let hasPermeable = false;
  for (const c of d.cells) {
    if (isBuilding(c.klam) && c.height > 0) hasBuilding = true;
    if (PERMEABLE.has(c.klam)) hasPermeable = true;
  }

  if (!hasPermeable) {
    const i = firstNonStreet(d.cells);
    if (i >= 0) {
      d.cells[i] = {
        klam: 'KLAM_GRASS', height: 0, footprint: 0,
        roofType: 'flat', buildingType: 'none', street: false,
        blockId: d.cells[i].blockId, rail: false,
      };
    }
  }

  if (!hasBuilding) {
    let i = -1;
    for (let k = 0; k < d.cells.length; k++) {
      const c = d.cells[k];
      if (!c.street && !PERMEABLE.has(c.klam)) { i = k; break; }
    }
    if (i < 0) i = firstNonStreet(d.cells);
    if (i >= 0) {
      const c = d.cells[i];
      c.klam = 'KLAM_RESIDENTIAL_LOW';
      c.height = 1;
      c.footprint = 0.5;
      c.buildingType = 'KLAM_RESIDENTIAL_LOW';
    }
  }
}

/**
 * Deep-copy a design (structure, blocks, streets and cells).
 *
 * @param {Design} d
 * @returns {Design}
 */
export function cloneDesign(d) {
  return {
    id: d.id,
    seed: d.seed,
    windDir: d.windDir ? { ...d.windDir } : { ...DEFAULT_WIND_DIR },
    structure: cloneStructure(d.structure),
    blocks: d.blocks.map(cloneBlock),
    streets: { cols: d.streets.cols.slice(), rows: d.streets.rows.slice(), width: d.streets.width },
    cells: d.cells.map(cloneCell),
    metrics: null,
    descriptor: null,
    fitness: null,
    archetype: d.archetype ?? null,
  };
}

/** Building class for a block (towerPark forces high-rise). @param {Block} block @returns {string} */
function buildingKlamFor(block) {
  if (block.pattern === 'towerPark') return 'KLAM_URBAN_HIGH';
  return isBuilding(block.landUse) ? block.landUse : 'KLAM_RESIDENTIAL_LOW';
}

/**
 * Height offset (stories) contributed by a block's height profile.
 * @param {Block} block
 * @param {{x:number,y:number,w:number,h:number}} rect - The block's free-region rectangle.
 * @param {number} gx
 * @param {number} gy
 * @param {() => number} rng
 * @returns {number}
 */
function profileOffset(block, rect, gx, gy, rng) {
  switch (block.heightProfile) {
    case 'stepped': {
      const cx = rect.x + (rect.w - 1) / 2;
      const cy = rect.y + (rect.h - 1) / 2;
      return Math.round(Math.hypot(gx - cx, gy - cy));
    }
    case 'random':
      return randInt(rng, -1, 1);
    case 'pitched':
    case 'flat':
    default:
      return 0;
  }
}

/**
 * Roof type implied by a block's height profile.
 * @param {Block} block
 * @param {() => number} rng
 * @returns {string}
 */
function roofTypeFor(block, rng) {
  switch (block.heightProfile) {
    case 'stepped': return 'stepped';
    case 'pitched': return 'pitched';
    case 'random': return pick(rng, ['flat', 'stepped', 'pitched']);
    case 'flat':
    default: return 'flat';
  }
}

/**
 * Write a building cell into the raster.
 * @param {Cell[]} cells
 * @param {number} gx
 * @param {number} gy
 * @param {Block} block
 * @param {string} klam
 * @param {number} baseHeight
 */
function setBuilding(cells, gx, gy, block, klam, baseHeight, rect) {
  const i = gy * N + gx;
  const rng = cellRng(block.seed, gx, gy);
  const [lo, hi] = heightRangeFor(klam);
  const offset = profileOffset(block, rect, gx, gy, rng);
  const height = clamp(Math.round(baseHeight + offset), lo, hi);
  const footprint = clamp(block.density + (rng() - 0.5) * 0.1, 0.35, 0.9);
  cells[i] = {
    klam,
    height,
    footprint,
    roofType: roofTypeFor(block, rng),
    buildingType: klam,
    street: false,
    blockId: block.id,
    rail: false,
  };
}

/**
 * Write a non-building (green/blue) cell into the raster.
 * @param {Cell[]} cells
 * @param {number} gx
 * @param {number} gy
 * @param {Block} block
 * @param {string} klam
 */
function setGround(cells, gx, gy, block, klam) {
  cells[gy * N + gx] = {
    klam,
    height: 0,
    footprint: 0,
    roofType: 'flat',
    buildingType: 'none',
    street: false,
    blockId: block.id,
    rail: false,
  };
}

/**
 * Apply a block's morphology pattern to its free-region rectangle.
 * @param {Cell[]} cells
 * @param {Block} block
 * @param {{x:number,y:number,w:number,h:number}} rect - The block's free-region rectangle.
 */
function applyPattern(cells, block, rect) {
  const { x, y, w, h } = rect;
  const pattern = block.pattern;
  const klam = buildingKlamFor(block);
  const baseHeight = block.baseHeight;

  if (pattern === 'water') {
    for (let gy = y; gy < y + h; gy++) {
      for (let gx = x; gx < x + w; gx++) setGround(cells, gx, gy, block, 'KLAM_WATER');
    }
    return;
  }

  if (pattern === 'green') {
    for (let gy = y; gy < y + h; gy++) {
      for (let gx = x; gx < x + w; gx++) {
        const n = valueNoise2D(block.seed, gx, gy, 2.5);
        setGround(cells, gx, gy, block, n > 0.55 ? 'KLAM_FOREST' : 'KLAM_GRASS');
      }
    }
    return;
  }

  if (pattern === 'towerPark') {
    for (let gy = y; gy < y + h; gy++) {
      for (let gx = x; gx < x + w; gx++) {
        const n = valueNoise2D(block.seed, gx, gy, 2.5);
        setGround(cells, gx, gy, block, n > 0.6 ? 'KLAM_FOREST' : 'KLAM_GRASS');
      }
    }
    setBuilding(cells, x, y, block, 'KLAM_URBAN_HIGH', baseHeight, rect);
    if (w >= 2 && h >= 2) {
      setBuilding(cells, x + w - 1, y + h - 1, block, 'KLAM_URBAN_HIGH', baseHeight, rect);
    }
    return;
  }

  if (pattern === 'detached') {
    for (let gy = y; gy < y + h; gy++) {
      for (let gx = x; gx < x + w; gx++) {
        const rng = cellRng(block.seed, gx, gy);
        if (rng() < 0.45) setBuilding(cells, gx, gy, block, klam, baseHeight, rect);
        else setGround(cells, gx, gy, block, 'KLAM_GRASS');
      }
    }
    return;
  }

  if (pattern === 'row') {
    for (let gy = y; gy < y + h; gy++) {
      for (let gx = x; gx < x + w; gx++) {
        if ((gy - y) % 2 === 0) setBuilding(cells, gx, gy, block, klam, baseHeight, rect);
        else setGround(cells, gx, gy, block, 'KLAM_GRASS');
      }
    }
    return;
  }

  // perimeter / courtyard: buildings on the edge ring, courtyard inside.
  const isCourtyard = pattern === 'courtyard';
  const bh = isCourtyard ? Math.max(1, baseHeight - 1) : baseHeight;
  for (let gy = y; gy < y + h; gy++) {
    for (let gx = x; gx < x + w; gx++) {
      const lx = gx - x;
      const ly = gy - y;
      const onRing = lx === 0 || lx === w - 1 || ly === 0 || ly === h - 1;
      let isBuildingCell = onRing;
      if (isCourtyard && w >= 3 && h >= 3) {
        // Remove edge midpoints → a larger inner courtyard.
        const edgeCenter = (lx === 1 && (ly === 0 || ly === h - 1)) ||
                           (ly === 1 && (lx === 0 || lx === w - 1));
        if (edgeCenter) isBuildingCell = false;
      }
      if (isBuildingCell) setBuilding(cells, gx, gy, block, klam, bh, rect);
      else setGround(cells, gx, gy, block, 'KLAM_GRASS');
    }
  }
}

/**
 * Write a retained infrastructure line into the raster as `KLAM_STREET`.
 * @param {Cell[]} cells
 * @param {import('./config.js').StructureLine} line
 * @param {boolean} isRail
 */
function markStructureLine(cells, line, isRail) {
  if (!line) return;
  const from = Math.max(0, Math.min(N - 1, line.from));
  const to = Math.max(0, Math.min(N - 1, line.to));
  for (let t = from; t <= to; t++) {
    const gx = line.axis === 'v' ? line.x : t;
    const gy = line.axis === 'h' ? line.y : t;
    if (gx < 0 || gx >= N || gy < 0 || gy >= N) continue;
    cells[gy * N + gx] = {
      klam: 'KLAM_STREET', height: 0, footprint: 0,
      roofType: 'flat', buildingType: 'none', street: true, blockId: -1, rail: !!isRail,
    };
  }
}

/**
 * Write a permeable green corridor into the raster (grass/forest).
 * @param {Cell[]} cells
 * @param {import('./config.js').StructureLine} line
 */
function markGreenCorridor(cells, line) {
  if (!line) return;
  const from = Math.max(0, Math.min(N - 1, line.from));
  const to = Math.max(0, Math.min(N - 1, line.to));
  for (let t = from; t <= to; t++) {
    const gx = line.axis === 'v' ? line.x : t;
    const gy = line.axis === 'h' ? line.y : t;
    if (gx < 0 || gx >= N || gy < 0 || gy >= N) continue;
    const n = valueNoise2D(0x9e3779b1, gx, gy, 2.5);
    cells[gy * N + gx] = {
      klam: n > 0.55 ? 'KLAM_FOREST' : 'KLAM_GRASS',
      height: 0, footprint: 0, roofType: 'flat',
      buildingType: 'none', street: false, blockId: -1, rail: false,
    };
  }
}

/**
 * Write a pre-existing block into the raster (retained verbatim).
 * @param {Cell[]} cells
 * @param {{x:number,y:number,w:number,h:number,landUse:string}} eb
 */
function markExistingBlock(cells, eb) {
  const klam = isBuilding(eb.landUse) ? eb.landUse : 'KLAM_COMMERCIAL';
  const [lo, hi] = heightRangeFor(klam);
  const height = hi > 0 ? clamp(Math.round((lo + hi) / 2), lo, hi) : 0;
  for (let gy = eb.y; gy < eb.y + eb.h; gy++) {
    for (let gx = eb.x; gx < eb.x + eb.w; gx++) {
      if (gx < 0 || gx >= N || gy < 0 || gy >= N) continue;
      cells[gy * N + gx] = {
        klam,
        height,
        footprint: height > 0 ? 0.8 : 0,
        roofType: 'flat',
        buildingType: height > 0 ? klam : 'none',
        street: false,
        blockId: -2,
        rail: false,
      };
    }
  }
}

/**
 * Derive the 100-cell raster from the block genome and the site structure.
 *
 * Pure and deterministic: reads `d.structure` / `d.blocks`, writes `d.cells`.
 * 1. All cells start as grass.
 * 2. Retained rails and roads become `KLAM_STREET` (rails also get `rail:true`).
 * 3. The green corridor becomes permeable grass/forest.
 * 4. Each genome block applies its pattern to its free-region rectangle.
 * 5. Pre-existing blocks are written verbatim.
 *
 * @param {Design} d
 * @returns {Cell[]}
 */
export function rasterize(d) {
  const structure = d.structure || DEFAULT_STRUCTURE;
  const cells = new Array(N * N);
  for (let i = 0; i < N * N; i++) {
    cells[i] = {
      klam: 'KLAM_GRASS', height: 0, footprint: 0,
      roofType: 'flat', buildingType: 'none', street: false, blockId: -1, rail: false,
    };
  }

  // Layer order: green corridor first, then roads, then rails, so the street
  // network stays continuous and rail detail wins at rail/road crossings.
  if (structure.greenCorridor) markGreenCorridor(cells, structure.greenCorridor);
  for (const line of structure.roads || []) markStructureLine(cells, line, false);
  for (const line of structure.rails || []) markStructureLine(cells, line, true);

  const rects = computeFreeRects(structure);
  for (const block of d.blocks) {
    const rect = rects[block.id % rects.length] || { x: block.x, y: block.y, w: block.w, h: block.h };
    applyPattern(cells, block, rect);
  }

  for (const eb of structure.existingBlocks || []) markExistingBlock(cells, eb);

  d.cells = cells;
  return cells;
}

/**
 * Mutate a single block in place (one attribute per call).
 * @param {Block} block
 * @param {() => number} rng
 */
function mutateBlock(block, rng) {
  switch (randInt(rng, 0, 4)) {
    case 0: {
      const kernel = TRANSITIONS[block.landUse] || DEFAULT_BIAS;
      block.landUse = weightedPick(rng, kernel);
      break;
    }
    case 1:
      block.pattern = pick(rng, PATTERNS);
      break;
    case 2:
      block.baseHeight = clamp(block.baseHeight + (rng() < 0.5 ? -1 : 1), 1, 8);
      break;
    case 3:
      block.heightProfile = pick(rng, PROFILES);
      break;
    case 4:
      block.density = clamp(block.density + (rng() < 0.5 ? -0.2 : 0.2), 0.35, 0.9);
      break;
    default:
      break;
  }
}

/**
 * Global structural mutation: turn one N–S block column into a green/blue
 * cold-air finger.
 * @param {Design} d
 * @param {() => number} rng
 */
function globalMutate(d, rng) {
  const col = randInt(rng, 0, 2);
  const greenKlam = rng() < 0.5 ? 'KLAM_GRASS' : 'KLAM_WATER';
  for (const block of d.blocks) {
    const colIndex = block.x < 4 ? 0 : block.x < 8 ? 1 : 2;
    if (colIndex === col) {
      block.landUse = greenKlam;
      block.pattern = greenKlam === 'KLAM_WATER' ? 'water' : 'green';
      block.density = 0.4;
    }
  }
}

/**
 * Pick a random non-street cell index.
 * @param {Cell[]} cells
 * @param {() => number} rng
 * @returns {number}
 */
function pickNonStreet(cells, rng) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const i = randInt(rng, 0, cells.length - 1);
    if (!isStructureCell(cells[i])) return i;
  }
  for (let i = 0; i < cells.length; i++) if (!isStructureCell(cells[i])) return i;
  return -1;
}

/**
 * Repair a rasterized design in place: clamp heights, guarantee ≥1 permeable
 * cell and ≥1 building cell.
 * @param {Design} d
 * @param {() => number} rng
 */
function repair(d, rng) {
  let hasPermeable = false;
  let hasBuilding = false;
  for (const c of d.cells) {
    if (PERMEABLE.has(c.klam)) hasPermeable = true;
    if (isBuilding(c.klam) && c.height > 0) hasBuilding = true;
    const [lo, hi] = heightRangeFor(c.klam);
    if (hi <= 0) {
      c.height = 0;
      c.footprint = 0;
    } else {
      c.height = clamp(Math.round(c.height), lo, hi);
      if (!(c.footprint > 0)) c.footprint = 0.5;
    }
  }

  if (!hasPermeable) {
    const i = pickNonStreet(d.cells, rng);
    if (i >= 0) {
      d.cells[i] = {
        klam: 'KLAM_GRASS', height: 0, footprint: 0,
        roofType: 'flat', buildingType: 'none', street: false,
        blockId: d.cells[i].blockId, rail: false,
      };
    }
  }

  if (!hasBuilding) {
    const i = pickNonStreet(d.cells, rng);
    if (i >= 0) {
      const c = d.cells[i];
      c.klam = 'KLAM_RESIDENTIAL_LOW';
      c.height = 1;
      c.footprint = 0.5;
      c.buildingType = 'KLAM_RESIDENTIAL_LOW';
    }
  }
}

/**
 * Mutate a design, returning a NEW Design (the input is not modified).
 *
 * Order: block-level primary mutation (land use via `TRANSITIONS`, pattern,
 * base height ±1, height profile, density ±0.2) → optional global mutation
 * (green-finger column) with `SIM.GLOBAL_MUTATION_RATE` → `rasterize` →
 * bounded per-cell jitter (`rate*0.25`, ±1 story) → repair.
 *
 * @param {Design} d
 * @param {() => number} rng
 * @param {number} rate - Per-block mutation probability.
 * @returns {Design}
 */
export function mutateDesign(d, rng, rate) {
  const out = cloneDesign(d);

  for (const block of out.blocks) {
    if (rng() < rate) mutateBlock(block, rng);
  }

  if (rng() < SIM.GLOBAL_MUTATION_RATE) globalMutate(out, rng);

  rasterize(out);

  const jitterRate = rate * 0.25;
  for (const c of out.cells) {
    if (c.height > 0 && rng() < jitterRate) {
      const [lo, hi] = heightRangeFor(c.klam);
      c.height = clamp(c.height + (rng() < 0.5 ? -1 : 1), lo, hi);
    }
  }

  repair(out, rng);
  return out;
}

/**
 * Count distinct contiguous building structures in the raster.
 *
 * A structure is a **4-connected** component of cells with `height > 0`
 * (edge-adjacency only; diagonally touching cells are separate structures).
 * This is the QD "number of buildings" feature: it counts built masses rather
 * than built cells, so a perimeter block counts once while a row of detached
 * structures counts many times. Pre-existing blocks and genome blocks that
 * touch merge into a single structure.
 *
 * Pure and deterministic; O(N*N) with an iterative flood fill.
 *
 * @param {Cell[]} cells - Row-major 100-cell raster (index = gy*N + gx).
 * @returns {number} Number of connected building components (0..N*N).
 */
export function countStructures(cells) {
  const n = N * N;
  const seen = new Uint8Array(n);
  let structures = 0;
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const c0 = cells[start];
    if (!c0 || !(c0.height > 0)) continue;
    structures++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      const gx = i % N;
      const gy = (i - gx) / N;
      if (gx > 0) {
        const j = i - 1;
        if (!seen[j] && cells[j] && cells[j].height > 0) { seen[j] = 1; stack.push(j); }
      }
      if (gx < N - 1) {
        const j = i + 1;
        if (!seen[j] && cells[j] && cells[j].height > 0) { seen[j] = 1; stack.push(j); }
      }
      if (gy > 0) {
        const j = i - N;
        if (!seen[j] && cells[j] && cells[j].height > 0) { seen[j] = 1; stack.push(j); }
      }
      if (gy < N - 1) {
        const j = i + N;
        if (!seen[j] && cells[j] && cells[j].height > 0) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  return structures;
}

/**
 * Compute and cache the footprint-aware metrics bundle for a design.
 *
 * - `grz = Σ footprint_i / count`
 * - `gfz = Σ (height_i * footprint_i) / count` (real floor-area ratio)
 * - `homes = Σ (height_i * footprint_i * dwellingsPerFloor_i * residentsPerDwelling_i)`
 * - `greenSpace = 100 * (grass+forest+water count) / 100`
 * - Cold-air flux with street canyons and footprints, sheltering accumulated
 *   upstream along the design's `windDir` (default N→S).
 * - `sigma` uses block-level base-height variance so coherent designs are not
 *   penalised.
 *
 * @param {Design} d
 * @returns {Metrics}
 */
export function computeMetrics(d) {
  const cells = d.cells;
  const count = cells.length;

  let footprintSum = 0;
  let gfzSum = 0;
  let homes = 0;
  let greenCount = 0;
  let buildingCount = 0;
  let z0Sum = 0;
  const classCount = {};
  for (const id of KLAM_IDS) classCount[id] = 0;

  const z0 = new Array(count);
  const pCold = new Array(count);

  for (let i = 0; i < count; i++) {
    const c = cells[i];
    const k = KLAM[c.klam] || KLAM.KLAM_GRASS;
    const fp = c.footprint || 0;
    footprintSum += fp;
    gfzSum += c.height * fp;
    homes += c.height * fp * k.dwellingsPerFloor * k.residentsPerDwelling;
    if (c.height > 0) buildingCount++;
    if (PERMEABLE.has(c.klam)) greenCount++;
    z0Sum += k.z0;
    if (classCount[c.klam] !== undefined) classCount[c.klam]++;
    z0[i] = k.z0;
    pCold[i] = k.pCold;
  }

  // Distinct contiguous building structures (4-connected components of built
  // cells) — the QD "number of buildings" feature. Counted separately from
  // `buildingCount` (built cells) so the porosity objective stays cell-based.
  const structureCount = countStructures(cells);

  // Cold-air flux with upstream sheltering along the city's cold-air direction.
  // For each cell we walk backwards along `-windDir`, accumulating the
  // roughness/footprint of the cells the air passes over before reaching it.
  // The formula shape and constants are unchanged; only the walk direction is
  // generalized (the legacy N→S walk is the `dir = (0,1)` special case).
  const wind = normalizeDir(d.windDir);
  const wx = wind.x;
  const wy = wind.y;
  const cols = (d.streets && d.streets.cols) || [];
  const rows = (d.streets && d.streets.rows) || [];
  const nsAlign = Math.abs(wy); // alignment of a N–S street with the wind
  const ewAlign = Math.abs(wx); // alignment of an E–W street with the wind
  const MAX_STEPS = 4 * N;
  let vFlux = 0;
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const i = gy * N + gx;
      let acc = 0;
      let x = gx;
      let y = gy;
      let last = -1;
      for (let s = 0; s < MAX_STEPS; s++) {
        x -= wx;
        y -= wy;
        if (x < -0.5 || x > N - 0.5 || y < -0.5 || y > N - 0.5) break;
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (cx < 0 || cx >= N || cy < 0 || cy >= N) break;
        const j = cy * N + cx;
        if (j === last) continue;
        last = j;
        const cj = cells[j];
        let channel = 1.0;
        if (cj.street) {
          const onNS = cols.includes(cx);
          const onEW = rows.includes(cy);
          const aligned = (onNS && nsAlign >= 0.5) || (onEW && ewAlign >= 0.5);
          if (aligned) channel = 0.25;
        }
        acc += z0[j] * (cj.street ? 0.2 : (cj.footprint || 0)) * channel;
      }
      const shelter = Math.exp(-acc * SIM.SHELTER_K);
      vFlux += pCold[i] * CELL_AREA * shelter;
    }
  }
  vFlux /= 3600;

  const grz = footprintSum / count;
  const gfz = gfzSum / count;
  const greenNorm = greenCount / count;
  const greenSpace = 100 * greenNorm;
  const freshAirInflow = 100 * clamp01(vFlux / V_FLUX_REF);
  const z0Mean = z0Sum / count;
  // Porosity is the QD objective: the fraction of the parcel left unbuilt.
  const porosity = 1 - buildingCount / count;

  // Block-level base-height variance (coherent designs are not penalised).
  const blocks = d.blocks || [];
  let hStd = 0;
  if (blocks.length > 0) {
    let mean = 0;
    for (const b of blocks) mean += b.baseHeight;
    mean /= blocks.length;
    let varSum = 0;
    for (const b of blocks) {
      const dh = b.baseHeight - mean;
      varSum += dh * dh;
    }
    hStd = Math.sqrt(varSum / blocks.length);
  }
  const heightVarNorm = clamp01(hStd / 4);

  const sigma = clamp01(0.08 + 0.35 * heightVarNorm + 0.25 * grz + 0.20 * (1 - greenNorm));

  const classPct = {};
  for (const id of KLAM_IDS) classPct[id] = (classCount[id] / count) * 100;

  const metrics = {
    layman: {
      homes,
      freshAirInflow,
      greenSpace,
      summaryBadge: summaryBadge(freshAirInflow, homes),
    },
    planner: {
      grz,
      gfz,
      vFlux,
      z0Mean,
      sigma,
      buildingCount,
      structureCount,
      porosity,
      classPct,
    },
  };
  d.metrics = metrics;
  return metrics;
}

/**
 * Choose a layman summary badge from thresholds.
 *
 * Thresholds (documented):
 *  - 'Cool & Green'  : freshAirInflow ≥ 60 %
 *  - 'High Capacity' : homes ≥ 4000 residents
 *  - 'Dense & Warm'  : freshAirInflow < 30 %
 *  - 'Balanced'      : otherwise
 *
 * @param {number} freshAirInflow
 * @param {number} homes
 * @returns {'Cool & Green'|'Balanced'|'Dense & Warm'|'High Capacity'}
 */
function summaryBadge(freshAirInflow, homes) {
  if (freshAirInflow >= 60) return 'Cool & Green';
  if (homes >= 4000) return 'High Capacity';
  if (freshAirInflow < 30) return 'Dense & Warm';
  return 'Balanced';
}

/**
 * Module-level adaptive descriptor scale for both QD axes.
 *
 * The *fixed* reference constants (`SIM.GFZ_MAX = 6`, `SIM.STRUCT_MAX`) do not
 * match the value ranges actually reachable by the block genome: real `gfz`
 * only reaches ≈1.47, and the number of contiguous building structures is far
 * below `N*N`. When a scale is installed by
 * {@link module:simulation.generateCandidates}, each raw feature is linearly
 * mapped through the observed 2nd–98th percentile range of the candidate
 * population, so candidates spread across all `BINS` bins. Both mappings stay
 * strictly monotonic (higher raw value → higher normalized value). `null`
 * restores the legacy fixed-reference behaviour.
 *
 * @type {{floorLo:number, floorHi:number, structLo:number, structHi:number}|null}
 */
let descriptorScale = null;

/**
 * Install (or clear) the adaptive descriptor normalization scale. Called once,
 * deterministically, from `generateCandidates` after measuring the candidate
 * population. Passing `null` restores the legacy fixed-reference mapping.
 *
 * @param {{floorLo:number, floorHi:number, structLo:number, structHi:number}|null} scale
 */
export function setDescriptorScale(scale) {
  descriptorScale = scale || null;
}

/**
 * Read the currently installed descriptor scale (mainly for tests).
 * @returns {{floorLo:number, floorHi:number, structLo:number, structHi:number}|null}
 */
export function getDescriptorScale() {
  return descriptorScale;
}

/**
 * Compute and cache the 2-D QD descriptor `{floorArea, structureCount}`.
 *
 * `floorArea` is the normalized floor-area ratio (`gfz`) in 0..1, using the
 * adaptive {@link setDescriptorScale|descriptorScale} when installed and
 * otherwise the fixed `SIM.GFZ_MAX` fallback. `structureCount` is the raw
 * integer number of contiguous building structures (4-connected components of
 * built cells) — a genuine QD feature, not an optimization target. It is
 * deliberately distinct from the cell-based `buildingCount` used by the
 * porosity objective.
 *
 * @param {Design} d
 * @returns {{floorArea:number, structureCount:number}}
 */
export function computeDescriptor(d) {
  const m = d.metrics || computeMetrics(d);
  const s = descriptorScale;
  const floorArea = s
    ? clamp01((m.planner.gfz - s.floorLo) / ((s.floorHi - s.floorLo) || 1))
    : clamp01(m.planner.gfz / SIM.GFZ_MAX);
  const structureCount = m.planner.structureCount;
  const descriptor = { floorArea, structureCount };
  d.descriptor = descriptor;
  return descriptor;
}

/**
 * Compute and cache the scalar fitness in [0, 1].
 *
 * The objective is **porosity** — the fraction of the parcel left unbuilt
 * (`1 - buildingCount / (N*N)`). The two descriptor axes (floor area and
 * building count) are QD *features*, not optimization targets, so fitness is
 * deliberately a pure function of porosity (no housing/permeability blend and
 * no uncertainty penalty, which would dilute the stated objective).
 *
 * @param {Design} d
 * @returns {number}
 */
export function computeFitness(d) {
  const m = d.metrics || computeMetrics(d);
  const fitness = clamp01(m.planner.porosity);
  d.fitness = fitness;
  return fitness;
}

/**
 * Bin the floor-area descriptor axis into `[0, BINS-1]`.
 *
 * @param {number} floorArea - Normalized floor-area ratio 0..1.
 * @returns {number}
 */
export function binOfX(floorArea) {
  const b = Math.floor(clamp01(floorArea) * BINS);
  return b < 0 ? 0 : b >= BINS ? BINS - 1 : b;
}

/**
 * Bin the legacy cell-based building-count axis into `[0, BINS-1]`.
 *
 * Maps `0 → 0` and `N*N → BINS-1`, monotonically and integer-safely, so the
 * top bin always includes the maximum possible count. Retained for cell-based
 * uses; the QD archive axis now uses {@link binOfYStructures}.
 *
 * @param {number} buildingCount - Integer number of built cells (0..N*N).
 * @returns {number}
 */
export function binOfY(buildingCount) {
  const n = N * N;
  const v = Number.isFinite(buildingCount) ? buildingCount : 0;
  const b = Math.floor((v * BINS) / (n + 1));
  return b < 0 ? 0 : b >= BINS ? BINS - 1 : b;
}

/**
 * Bin the structure-count descriptor axis into `[0, BINS-1]`.
 *
 * The raw structure count is normalized through the adaptive
 * {@link setDescriptorScale|descriptorScale} structure range when installed
 * (2nd–98th percentile of the candidate pool), otherwise through the fixed
 * `SIM.STRUCT_MAX` fallback, then mapped monotonically onto the bins. The
 * mapping is strictly monotonic: more structures always yields a higher bin.
 *
 * @param {number} structureCount - Integer number of contiguous building structures.
 * @returns {number}
 */
export function binOfYStructures(structureCount) {
  const v = Number.isFinite(structureCount) ? structureCount : 0;
  const s = descriptorScale;
  const norm = s && Number.isFinite(s.structLo) && Number.isFinite(s.structHi)
    ? clamp01((v - s.structLo) / ((s.structHi - s.structLo) || 1))
    : clamp01(v / SIM.STRUCT_MAX);
  const b = Math.floor(norm * BINS);
  return b < 0 ? 0 : b >= BINS ? BINS - 1 : b;
}

/**
 * Map a 2-D bin coordinate to a flat archive index.
 *
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
export function binIndex(bx, by) {
  return by * BINS + bx;
}
