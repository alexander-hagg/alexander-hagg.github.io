/**
 * OpenSKIZZE 2.0 — 2 m cold-air flow layer: obstacle-aware velocity field and
 * streamline ribbon system (R5).
 *
 * The cold-air layer is modelled at **~2 m above ground** (see
 * {@link COLD_AIR_LAYER_ELEVATION}). At that height every building is an
 * obstacle (buildings are ≥1 storey ≈ 3 m), while streets, courtyards, gardens,
 * grass, forest and water are passable. The field is therefore built on a
 * **sub-cell-resolution occupancy grid** derived from the design's `cells`
 * (`height`, `footprint`, `street`): `SUB × SUB` samples per 10 m cell give a
 * `FN × FN = 40 × 40` fine grid (1600 samples).
 *
 * Field construction (documented choice — distance-field deflection):
 *   1. Occupancy grid: a sample is solid when it lies inside a building
 *      footprint sub-rectangle (`height > 0`, footprint fraction centred in the
 *      cell). Streets and non-building cells are free.
 *   2. Openness potential: 1 on free samples, 0 on obstacles, diffused with a
 *      few Jacobi iterations so the flow sees a smooth corridor structure.
 *   3. Velocity: the city's `coldAir.dir` base wind, accelerated where the
 *      openness potential is high (streets / courtyards / green corridors) and
 *      deflected **up the openness gradient** — i.e. away from buildings and
 *      toward open space — so the flow goes around obstacles and channels
 *      through streets. Obstacle samples are pinned to zero.
 *   4. A couple of obstacle-aware Jacobi smoothing passes remove sample-scale
 *      artefacts while preserving direction.
 *   5. Coarse upstream pooling (faint fog) accumulates blockage along
 *      `-coldAir.dir`, so tall/dense blocks stagnate the air in front of them.
 *
 * Particles are advected with bilinear sampling and a **collision step**: a
 * move that would enter an obstacle sample is slid along the wall (x-only or
 * y-only) or the particle respawns, so no particle ever penetrates a building.
 * They spawn on the upstream boundary, weighted by the wind components, and
 * respawn on exit or death.
 *
 * The fine field is **cached per design identity + wind direction** and rebuilt
 * only when the selected design or preset changes. All buffers are reused across
 * frames — the hot path performs no per-frame allocation.
 *
 * Pure ES module: no side effects on import, no `Math.random`. The renderer is
 * DOM-free (it only receives a 2D context and a geometry object).
 */

import { N } from './config.js';
import { makePRNG } from './prng.js';
import { projectCellInto, COLD_AIR_LAYER_ELEVATION } from './iso.js';

/**
 * Re-exported elevation of the cold-air streamline layer (storeys, ≈2 m).
 * Defined in `iso.js` (the renderer's notion of the layer height) and applied
 * here when projecting particles and static streamlines.
 */
export { COLD_AIR_LAYER_ELEVATION };

/** Sub-cell samples per cell edge (4×4 = 16 samples/cell → 40×40 fine grid). */
export const SUB = 4;

/** Fine grid side length (`N * SUB` = 40). */
export const FN = N * SUB;

/** Fine grid sample count (1600). */
const FLEN = FN * FN;

/** Base wind speed (fine-grid units/s) before per-sample modulation. */
const BASE_SPEED = 1.0;

/** Global advection multiplier (fine-grid units/s); scaled by `SUB` so the
 * physical crossing speed matches the previous per-cell field. */
const SPEED = 2.6 * SUB;

/** Maximum field magnitude after deflection (prevents runaway near walls). */
const MAX_SPEED = 2.2;

/** Particle lifetime range in seconds. */
const LIFE_MIN = 3.5;
const LIFE_MAX = 7.0;

/** Fixed seed for deterministic particle spawning. */
const SEED = 0xa1f10;

/** Desktop / narrow-viewport particle counts. */
const COUNT_DESKTOP = 180;
const COUNT_NARROW = 90;

/** Number of historical positions retained per particle (ribbon length). */
const TRAIL_LEN = 14;

/** Lateral deflection gain from the openness gradient. */
const DEFLECT = 2.2;

/** Jacobi iterations diffusing the openness potential. */
const PERM_ITERS = 3;

/** Obstacle-aware Jacobi smoothing iterations for the velocity field. */
const FIELD_ITERS = 2;

/** Upstream pooling accumulation constants. */
const POOL_K = 0.9;
const POOL_DECAY = 0.82;

/** Backward-walk step count for directional pooling accumulation. */
const POOL_STEPS = 4 * N;

/** Soft depth-blend half-width for the back/front pass split (no popping). */
const DEPTH_BLEND = 1.6;

/** Clamp to [0,1]. @param {number} x @returns {number} */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Build the 2 m occupancy grid from a design's `cells`.
 *
 * A sample is an obstacle when its parent cell has `height > 0` and the sample
 * lies inside the cell's footprint sub-rectangle (footprint fraction centred in
 * the cell). Streets and non-building cells are free. Pure and deterministic.
 *
 * @param {object} design - A design with a `cells` array (row-major, `gy*N+gx`).
 * @returns {Uint8Array} Length `FN*FN`; 1 = obstacle, 0 = free.
 */
export function buildOccupancyGrid(design) {
  const grid = new Uint8Array(FLEN);
  if (!design || !design.cells) return grid;
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const cell = design.cells[gy * N + gx];
      if (!cell || !(cell.height > 0)) continue;
      const fp = Math.max(0.15, Math.min(1, cell.footprint || 0.6));
      const inset = (1 - fp) / 2;
      const lo = inset;
      const hi = 1 - inset;
      for (let sy = 0; sy < SUB; sy++) {
        const ly = (sy + 0.5) / SUB;
        if (ly < lo || ly > hi) continue;
        for (let sx = 0; sx < SUB; sx++) {
          const lx = (sx + 0.5) / SUB;
          if (lx < lo || lx > hi) continue;
          grid[(gy * SUB + sy) * FN + (gx * SUB + sx)] = 1;
        }
      }
    }
  }
  return grid;
}

/**
 * Rotated fine-grid depth (`rx + ry`) for the iso orientation `o`, matching the
 * painter's order used by `iso.js`. Used for the soft back/front pass split.
 * @param {number} x
 * @param {number} y
 * @param {number} o
 * @returns {number}
 */
function rotatedDepth(x, y, o) {
  if (o === 1) return y + (FN - 1 - x);
  if (o === 2) return (FN - 1 - x) + (FN - 1 - y);
  if (o === 3) return (FN - 1 - y) + x;
  return x + y;
}

/**
 * In-place 4-neighbour Jacobi smoothing of a scalar grid. Obstacle samples are
 * expected to already be 0, so openness diffuses toward them.
 * @param {Float32Array} a - Grid to smooth (mutated).
 * @param {Float32Array} tmp - Scratch buffer of equal length.
 * @param {number} iters
 */
function smoothScalar(a, tmp, iters) {
  for (let it = 0; it < iters; it++) {
    for (let gy = 0; gy < FN; gy++) {
      for (let gx = 0; gx < FN; gx++) {
        const i = gy * FN + gx;
        let s = a[i] * 4;
        let w = 4;
        if (gx > 0) { s += a[i - 1]; w++; }
        if (gx < FN - 1) { s += a[i + 1]; w++; }
        if (gy > 0) { s += a[i - FN]; w++; }
        if (gy < FN - 1) { s += a[i + FN]; w++; }
        tmp[i] = s / w;
      }
    }
    a.set(tmp);
  }
}

/**
 * Obstacle-aware 4-neighbour Jacobi smoothing of a 2-component vector field.
 * Obstacle samples stay zero; obstacle neighbours contribute the centre value
 * (a Neumann-like condition) so the flow is not pulled into walls.
 * @param {Float32Array} f - Field of length `2*FLEN` (vx,vy interleaved, mutated).
 * @param {Uint8Array} obst - Occupancy grid of length `FLEN`.
 * @param {Float32Array} tmp - Scratch buffer of length `2*FLEN`.
 * @param {number} iters
 */
function smoothField(f, obst, tmp, iters) {
  for (let it = 0; it < iters; it++) {
    for (let gy = 0; gy < FN; gy++) {
      for (let gx = 0; gx < FN; gx++) {
        const i = gy * FN + gx;
        const c = i * 2;
        if (obst[i]) { tmp[c] = 0; tmp[c + 1] = 0; continue; }
        let vx = f[c] * 4;
        let vy = f[c + 1] * 4;
        let w = 4;
        if (gx > 0) {
          const j = i - 1;
          if (obst[j]) { vx += f[c]; vy += f[c + 1]; } else { vx += f[j * 2]; vy += f[j * 2 + 1]; }
          w++;
        }
        if (gx < FN - 1) {
          const j = i + 1;
          if (obst[j]) { vx += f[c]; vy += f[c + 1]; } else { vx += f[j * 2]; vy += f[j * 2 + 1]; }
          w++;
        }
        if (gy > 0) {
          const j = i - FN;
          if (obst[j]) { vx += f[c]; vy += f[c + 1]; } else { vx += f[j * 2]; vy += f[j * 2 + 1]; }
          w++;
        }
        if (gy < FN - 1) {
          const j = i + FN;
          if (obst[j]) { vx += f[c]; vy += f[c + 1]; } else { vx += f[j * 2]; vy += f[j * 2 + 1]; }
          w++;
        }
        tmp[c] = vx / w;
        tmp[c + 1] = vy / w;
      }
    }
    f.set(tmp);
  }
}

/**
 * Bilinearly sample a 2-component fine-grid vector field at fractional grid
 * coords, writing into `out` so the hot path performs no per-frame allocation.
 * Clamps at the borders.
 *
 * @param {Float32Array} f - Field of length `2*FN*FN` (vx,vy interleaved).
 * @param {number} x - Fine-grid x (0..FN-1).
 * @param {number} y - Fine-grid y (0..FN-1).
 * @param {{vx:number,vy:number}} out - Reused output object.
 * @returns {{vx:number, vy:number}}
 */
export function sampleFieldInto(f, x, y, out) {
  const cx = Math.max(0, Math.min(FN - 1, x));
  const cy = Math.max(0, Math.min(FN - 1, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(FN - 1, x0 + 1);
  const y1 = Math.min(FN - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;

  const i00 = (y0 * FN + x0) * 2;
  const i10 = (y0 * FN + x1) * 2;
  const i01 = (y1 * FN + x0) * 2;
  const i11 = (y1 * FN + x1) * 2;

  out.vx =
    (f[i00] * (1 - fx) + f[i10] * fx) * (1 - fy) +
    (f[i01] * (1 - fx) + f[i11] * fx) * fy;
  out.vy =
    (f[i00 + 1] * (1 - fx) + f[i10 + 1] * fx) * (1 - fy) +
    (f[i01 + 1] * (1 - fx) + f[i11 + 1] * fx) * fy;
  return out;
}

/**
 * Allocating convenience wrapper around {@link sampleFieldInto}.
 * @param {Float32Array} f
 * @param {number} x
 * @param {number} y
 * @returns {{vx:number, vy:number}}
 */
export function sampleField(f, x, y) {
  return sampleFieldInto(f, x, y, { vx: 0, vy: 0 });
}

/**
 * Chronological ring-buffer index for trail sample `k` (0 = oldest).
 * @param {object} p
 * @param {number} k
 * @returns {number}
 */
function trailIndex(p, k) {
  const start = p.filled < TRAIL_LEN ? 0 : p.head;
  return (start + k) % TRAIL_LEN;
}

/**
 * Create the airflow controller.
 *
 * @param {{reducedMotion?:boolean}} [opts]
 * @returns {{
 *   buildField:(design:object, dir?:{x:number,y:number})=>void,
 *   update:(dt:number, design:object)=>void,
 *   render:(ctx:CanvasRenderingContext2D, geom:object, state:object, pass?:string)=>void,
 *   renderPool:(ctx:CanvasRenderingContext2D, geom:object, state:object)=>void,
 *   setCount:(n:number)=>void,
 *   getCount:()=>number,
 *   setReducedMotion:(flag:boolean)=>void,
 *   setWindDir:(dir:{x:number,y:number})=>void,
 *   getWindDir:()=>({x:number,y:number}),
 *   getField:()=>Float32Array|null,
 *   getOccupancy:()=>Uint8Array|null,
 *   getParticles:()=>object[]
 * }}
 */
export function createAirflow(opts = {}) {
  const rng = makePRNG(SEED);

  /** Reused sample output (avoids per-particle allocation in the hot path). */
  const samp = { vx: 0, vy: 0 };

  /** Reused projection output (avoids per-particle allocation in the hot path). */
  const proj = { x: 0, y: 0 };

  /** Normalized cold-air wind direction (grid units, x=east, y=south). */
  let windDir = { x: 0, y: 1 };

  /** Current particle count (for viewport-driven resizing). */
  let particleCount = 0;

  /** Fine velocity field (vx,vy interleaved, length 2*FLEN). */
  let field = null;

  /** Fine occupancy grid (1 = obstacle). */
  let obst = null;

  /** Coarse per-cell pooling value 0..1 (smoothed upstream shelter). */
  let pool = new Float32Array(N * N);

  /** Free boundary samples per upstream edge, for spawning. */
  let spawnEdges = { x0: [], xN: [], y0: [], yN: [] };

  /** Cached radial-gradient sprite for pooling fog (avoids per-cell gradients). */
  let poolSprite = null;

  /** Active particles in fine-grid coordinates. */
  let particles = [];

  /** Field cache key: design identity + wind direction. */
  let fieldDesignRef = null;
  let fieldDir = { x: NaN, y: NaN };

  /** Reduced-motion flag (static streamlines, no advection). */
  let reducedMotion = !!opts.reducedMotion;
  if (!reducedMotion && typeof window !== 'undefined' && window.matchMedia) {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Default particle count for the current viewport. */
  function defaultCount() {
    if (typeof window !== 'undefined' && window.innerWidth < 1280) return COUNT_NARROW;
    return COUNT_DESKTOP;
  }

  /**
   * Allocate a particle with a reused trail buffer.
   * @returns {object}
   */
  function makeParticle() {
    return {
      x: 0, y: 0, age: 0, life: 1, head: 0, filled: 0,
      trail: new Float32Array(TRAIL_LEN * 2),
      sx: new Float32Array(TRAIL_LEN),
      sy: new Float32Array(TRAIL_LEN),
      dirty: false,
    };
  }

  /**
   * Set the base cold-air wind direction (normalized). Rebuild the field to
   * apply it.
   * @param {{x:number,y:number}} dir
   */
  function setWindDir(dir) {
    const x = dir && Number.isFinite(dir.x) ? dir.x : 0;
    const y = dir && Number.isFinite(dir.y) ? dir.y : 1;
    const len = Math.hypot(x, y);
    windDir = len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 1 };
  }

  /** @returns {{x:number,y:number}} The normalized base wind direction. */
  function getWindDir() {
    return { x: windDir.x, y: windDir.y };
  }

  /**
   * Whether a fine-grid point lies in an obstacle sample. Points outside the
   * grid are treated as free (the caller respawns them).
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  function obstacleAt(x, y) {
    if (!obst) return false;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= FN || iy < 0 || iy >= FN) return false;
    return obst[iy * FN + ix] === 1;
  }

  /**
   * Collect the free samples on each of the four grid edges, so spawning can
   * always place a particle on passable ground.
   * @returns {{x0:number[],xN:number[],y0:number[],yN:number[]}}
   */
  function buildSpawnEdges() {
    const e = { x0: [], xN: [], y0: [], yN: [] };
    for (let k = 0; k < FN; k++) {
      if (!obst[k * FN]) e.x0.push(k);
      if (!obst[k * FN + (FN - 1)]) e.xN.push(k);
      if (!obst[k]) e.y0.push(k);
      if (!obst[(FN - 1) * FN + k]) e.yN.push(k);
    }
    return e;
  }

  /**
   * Spawn a particle on the upstream boundary (the edge the wind comes from).
   * For a direction `(dx,dy)` the upstream edges are opposite the flow; one is
   * chosen weighted by the magnitude of the corresponding component, and a free
   * boundary sample is picked so the particle never starts inside a building.
   * @param {object} p
   */
  function spawn(p) {
    const dx = windDir.x;
    const dy = windDir.y;
    const edges = [];
    if (dx > 0) edges.push({ key: 'x0', w: Math.abs(dx) });
    else if (dx < 0) edges.push({ key: 'xN', w: Math.abs(dx) });
    if (dy > 0) edges.push({ key: 'y0', w: Math.abs(dy) });
    else if (dy < 0) edges.push({ key: 'yN', w: Math.abs(dy) });
    if (edges.length === 0) edges.push({ key: 'y0', w: 1 });

    let total = 0;
    for (const e of edges) total += e.w;
    let edge = edges[0];
    let r = rng() * total;
    for (const e of edges) { r -= e.w; if (r <= 0) { edge = e; break; } }

    const list = spawnEdges[edge.key];
    if (list && list.length) {
      const k = list[Math.min(list.length - 1, Math.floor(rng() * list.length))] + 0.5;
      if (edge.key === 'x0') { p.x = 0; p.y = k; }
      else if (edge.key === 'xN') { p.x = FN - 1; p.y = k; }
      else if (edge.key === 'y0') { p.y = 0; p.x = k; }
      else { p.y = FN - 1; p.x = k; }
    } else {
      if (edge.key === 'x0') { p.x = 0; p.y = rng() * FN; }
      else if (edge.key === 'xN') { p.x = FN - 1; p.y = rng() * FN; }
      else if (edge.key === 'y0') { p.y = 0; p.x = rng() * FN; }
      else { p.y = FN - 1; p.x = rng() * FN; }
    }

    p.age = 0;
    p.life = LIFE_MIN + rng() * (LIFE_MAX - LIFE_MIN);
    p.head = 0;
    p.filled = 0;
    p.dirty = true;
  }

  /**
   * (Re)build the particle array.
   * @param {number} n
   */
  function setCount(n) {
    const count = Math.max(1, Math.round(n));
    particleCount = count;
    particles = new Array(count);
    for (let i = 0; i < count; i++) {
      const p = makeParticle();
      spawn(p);
      p.age = rng() * p.life; // stagger initial ages
      particles[i] = p;
    }
  }

  /** @returns {number} The current particle count. */
  function getCount() {
    return particleCount;
  }

  setCount(defaultCount());

  /**
   * Build the fine 2 m velocity field and coarse pooling grid for a design.
   *
   * Cached by design identity + wind direction: calling it again with the same
   * design and direction is a no-op, so the field is rebuilt only when the
   * selected design or preset changes.
   *
   * @param {object} design
   * @param {{x:number,y:number}} [dir] - Cold-air direction; updates the stored wind.
   */
  function buildField(design, dir) {
    if (dir) setWindDir(dir);
    if (design && design === fieldDesignRef &&
        windDir.x === fieldDir.x && windDir.y === fieldDir.y) {
      return;
    }
    fieldDesignRef = design;
    fieldDir = { x: windDir.x, y: windDir.y };

    obst = buildOccupancyGrid(design);
    field = new Float32Array(2 * FLEN);
    pool = new Float32Array(N * N);
    spawnEdges = buildSpawnEdges();
    if (!design || !design.cells) return;

    const wx = windDir.x;
    const wy = windDir.y;

    // 1. Openness potential: 1 free, 0 obstacle, diffused a few samples.
    const perm = new Float32Array(FLEN);
    const tmp = new Float32Array(FLEN);
    for (let i = 0; i < FLEN; i++) perm[i] = obst[i] ? 0 : 1;
    smoothScalar(perm, tmp, PERM_ITERS);

    // 2. Per-sample street flag (streets channel and accelerate the flow).
    const street = new Uint8Array(FLEN);
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const cell = design.cells[gy * N + gx];
        if (!cell || !cell.street) continue;
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            street[(gy * SUB + sy) * FN + (gx * SUB + sx)] = 1;
          }
        }
      }
    }

    // 3. Base wind + deflection up the openness gradient (away from buildings).
    for (let i = 0; i < FLEN; i++) {
      if (obst[i]) { field[i * 2] = 0; field[i * 2 + 1] = 0; continue; }
      const gx = i % FN;
      const gy = (i / FN) | 0;
      let speed = BASE_SPEED * (0.35 + 0.95 * perm[i]);
      if (street[i]) speed *= 1.25;

      const xm = gx > 0 ? i - 1 : i;
      const xp = gx < FN - 1 ? i + 1 : i;
      const ym = gy > 0 ? i - FN : i;
      const yp = gy < FN - 1 ? i + FN : i;
      const dx = xp === xm ? 0 : (perm[xp] - perm[xm]) / (xp - xm);
      const dy = yp === ym ? 0 : (perm[yp] - perm[ym]) / (yp - ym);

      let vx = wx * speed + DEFLECT * dx;
      let vy = wy * speed + DEFLECT * dy;
      const mag = Math.hypot(vx, vy);
      if (mag > MAX_SPEED) { const s = MAX_SPEED / mag; vx *= s; vy *= s; }
      field[i * 2] = vx;
      field[i * 2 + 1] = vy;
    }

    // 4. Obstacle-aware smoothing of the vector field.
    const tmp2 = new Float32Array(2 * FLEN);
    smoothField(field, obst, tmp2, FIELD_ITERS);

    // 5. Coarse pooling: calm shelter accumulated upstream along -windDir.
    const blockage = new Float32Array(N * N);
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        let cnt = 0;
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            if (obst[(gy * SUB + sy) * FN + (gx * SUB + sx)]) cnt++;
          }
        }
        const cell = design.cells[gy * N + gx];
        const h = cell && cell.height > 0 ? cell.height : 0;
        blockage[gy * N + gx] = (cnt / (SUB * SUB)) * (1 + h / 8);
      }
    }
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const i = gy * N + gx;
        let acc = 0;
        let weight = POOL_DECAY;
        let x = gx;
        let y = gy;
        let last = -1;
        for (let s = 0; s < POOL_STEPS; s++) {
          x -= wx;
          y -= wy;
          if (x < -0.5 || x > N - 0.5 || y < -0.5 || y > N - 0.5) break;
          const cx = Math.round(x);
          const cy = Math.round(y);
          if (cx < 0 || cx >= N || cy < 0 || cy >= N) break;
          const j = cy * N + cx;
          if (j === last) continue;
          last = j;
          acc += blockage[j] * weight;
          weight *= POOL_DECAY;
        }
        pool[i] = 1 - Math.exp(-acc * POOL_K);
      }
    }
  }

  /**
   * Bilinear pooling value at fractional coarse-grid coords.
   * @param {number} x - Coarse-grid x (0..N-1).
   * @param {number} y - Coarse-grid y (0..N-1).
   * @returns {number}
   */
  function poolAt(x, y) {
    const cx = Math.max(0, Math.min(N - 1, x));
    const cy = Math.max(0, Math.min(N - 1, y));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(N - 1, x0 + 1);
    const y1 = Math.min(N - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const a = pool[y0 * N + x0] * (1 - fx) + pool[y0 * N + x1] * fx;
    const b = pool[y1 * N + x0] * (1 - fx) + pool[y1 * N + x1] * fx;
    return a * (1 - fy) + b * fy;
  }

  /**
   * Advance particles by `dt` seconds. A step that would enter an obstacle
   * sample is slid along the wall (x-only or y-only) or the particle respawns,
   * so particles never penetrate a building.
   * @param {number} dt
   * @param {object} design
   */
  function update(dt, design) {
    if (reducedMotion) return;
    if (!field) buildField(design);
    if (!field) return;

    const step = dt * SPEED;
    for (const p of particles) {
      const v = sampleFieldInto(field, p.x, p.y, samp);
      let nx = p.x + v.vx * step;
      let ny = p.y + v.vy * step;

      if (obstacleAt(nx, ny)) {
        if (!obstacleAt(nx, p.y)) ny = p.y;
        else if (!obstacleAt(p.x, ny)) nx = p.x;
        else { spawn(p); continue; }
      }

      p.x = nx;
      p.y = ny;
      p.age += dt;

      // Push the new position into the reusable ring buffer.
      p.trail[p.head * 2] = p.x;
      p.trail[p.head * 2 + 1] = p.y;
      p.head = (p.head + 1) % TRAIL_LEN;
      if (p.filled < TRAIL_LEN) p.filled++;
      p.dirty = true;

      if (p.x < -0.5 || p.x > FN - 0.5 || p.y < -0.5 || p.y > FN - 0.5 || p.age > p.life) spawn(p);
    }
  }

  /**
   * Build `count` start points distributed along the free upstream boundary
   * samples.
   * @param {number} count
   * @returns {{x:number,y:number}[]}
   */
  function upstreamStarts(count) {
    const dx = windDir.x;
    const dy = windDir.y;
    const total = Math.abs(dx) + Math.abs(dy) || 1;
    const pts = [];
    const addEdge = (key, w) => {
      const list = spawnEdges[key];
      if (!list || !list.length) return;
      const n = Math.max(1, Math.round((w / total) * count));
      for (let k = 0; k < n; k++) {
        const idx = Math.min(list.length - 1, Math.floor(((k + 0.5) / n) * list.length));
        const t = list[idx] + 0.5;
        if (key === 'x0') pts.push({ x: 0, y: t });
        else if (key === 'xN') pts.push({ x: FN - 1, y: t });
        else if (key === 'y0') pts.push({ x: t, y: 0 });
        else pts.push({ x: t, y: FN - 1 });
      }
    };
    if (dx > 0) addEdge('x0', Math.abs(dx));
    else if (dx < 0) addEdge('xN', Math.abs(dx));
    if (dy > 0) addEdge('y0', Math.abs(dy));
    else if (dy < 0) addEdge('yN', Math.abs(dy));
    if (pts.length === 0) addEdge('y0', 1);
    return pts;
  }

  /**
   * Draw the static reduced-motion streamline set as fading ribbons at the
   * ~2 m cold-air layer elevation. Streamlines stop at obstacles.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} geom
   */
  function drawStreamlines(ctx, geom) {
    if (!field) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(56,189,248,1)';
    const starts = upstreamStarts(12);
    for (const st of starts) {
      let x = st.x;
      let y = st.y;
      const px = [];
      const py = [];
      for (let step = 0; step < 220; step++) {
        const v = sampleFieldInto(field, x, y, samp);
        // Particles live in fine-grid units; the shared projection consumes
        // cell-centre grid units, so divide by SUB (= cell-centre alignment).
        projectCellInto(x / SUB, y / SUB, COLD_AIR_LAYER_ELEVATION, geom, proj);
        px.push(proj.x);
        py.push(proj.y);
        const nx = x + v.vx * 0.05 * SPEED;
        const ny = y + v.vy * 0.05 * SPEED;
        if (obstacleAt(nx, ny)) break;
        x = nx;
        y = ny;
        if (x < 0 || x > FN || y < 0 || y > FN) break;
      }
      const n = px.length;
      for (let s = 0; s < n - 1; s++) {
        const t = (s + 1) / Math.max(1, n - 1);
        ctx.globalAlpha = 0.12 + 0.4 * t;
        ctx.lineWidth = 0.8 + 1.2 * t;
        ctx.beginPath();
        ctx.moveTo(px[s], py[s]);
        ctx.lineTo(px[s + 1], py[s + 1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Render the airflow streamline layer at the ~2 m cold-air elevation.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} geom
   * @param {object} state
   * @param {'back'|'front'|'all'} [pass]
   */
  function render(ctx, geom, state, pass = 'all') {
    if (reducedMotion) {
      if (pass === 'back' || pass === 'all') drawStreamlines(ctx, geom);
      return;
    }
    if (!field) return;

    const mid = FN - 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of particles) {
      if (p.filled < 2) continue;

      // Soft depth-based pass split: particles near the seam are drawn in both
      // passes with complementary alpha, so they fade rather than pop.
      let passAlpha = 1;
      if (pass === 'back' || pass === 'front') {
        const depth = rotatedDepth(p.x, p.y, geom.orientation | 0);
        const t = clamp01((depth - (mid - DEPTH_BLEND)) / (2 * DEPTH_BLEND));
        passAlpha = pass === 'front' ? t : 1 - t;
        if (passAlpha <= 0.02) continue;
      }

      const lifeFrac = Math.max(0, 1 - p.age / p.life);
      const pooled = poolAt(p.x / SUB, p.y / SUB);
      const baseA = lifeFrac * (pass === 'front' ? 0.85 : 0.72) * passAlpha * (1 - 0.35 * pooled);
      if (baseA <= 0.02) continue;

      ctx.strokeStyle = pooled > 0.5 ? 'rgba(148,163,184,1)' : 'rgba(56,189,248,1)';

      const n = p.filled;
      for (let k = 0; k < n; k++) {
        const idx = trailIndex(p, k);
        const gx = p.trail[idx * 2];
        const gy = p.trail[idx * 2 + 1];
        // Same shared ground/solution-grid transform as the iso tiles; the
        // fine-grid trail coords are converted to cell-centre grid units.
        projectCellInto(gx / SUB, gy / SUB, COLD_AIR_LAYER_ELEVATION, geom, proj);
        p.sx[k] = proj.x;
        p.sy[k] = proj.y;
      }
      for (let k = 0; k < n - 1; k++) {
        const t = (k + 1) / (n - 1);
        ctx.globalAlpha = baseA * (0.15 + 0.85 * t);
        ctx.lineWidth = 0.7 + 1.5 * t;
        ctx.beginPath();
        ctx.moveTo(p.sx[k], p.sy[k]);
        ctx.lineTo(p.sx[k + 1], p.sy[k + 1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Lazily build (and cache) a 64×64 radial-gradient sprite for the pooling fog.
   * Blitting this sprite avoids allocating a gradient + colour string per cell
   * per frame. Returns null when no canvas backend is available.
   *
   * @returns {HTMLCanvasElement|OffscreenCanvas|null}
   */
  function getPoolSprite() {
    if (poolSprite) return poolSprite;
    const size = 64;
    let cv = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      try { cv = new OffscreenCanvas(size, size); } catch (e) { cv = null; }
    }
    if (!cv && typeof document !== 'undefined' && typeof document.createElement === 'function') {
      cv = document.createElement('canvas');
      cv.width = size;
      cv.height = size;
    }
    if (!cv) return null;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(125,145,170,1)');
    grad.addColorStop(1, 'rgba(125,145,170,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    poolSprite = cv;
    return cv;
  }

  /**
   * Render the unified cold-air pooling fog (grey/blue radial blobs). Used both
   * by the animated airflow layer and, via `iso.js`, by the `coldPool` layer so
   * the phenomenon has a single visual language. The hot path blits a cached
   * sprite (no per-cell gradient/string allocation).
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} geom
   * @param {object} [state]
   */
  function renderPool(ctx, geom, state) {
    if (!field) return;
    const sprite = getPoolSprite();
    const tw = geom.tileWidth;
    ctx.save();
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const val = pool[gy * N + gx];
        if (val <= 0.06) continue;
        // Cell-centre of tile (gx,gy) via the shared projection.
        projectCellInto(gx + 0.5, gy + 0.5, 0, geom, proj);
        const cx = proj.x;
        const cy = proj.y;
        const r = tw * (0.55 + 0.6 * val);
        if (sprite) {
          ctx.globalAlpha = 0.34 * val;
          ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
        } else {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(125,145,170,' + (0.34 * val).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(125,145,170,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** @param {boolean} flag */
  function setReducedMotion(flag) {
    reducedMotion = !!flag;
  }

  /** @returns {Float32Array|null} The fine velocity field (introspection/tests). */
  function getField() {
    return field;
  }

  /** @returns {Uint8Array|null} The fine occupancy grid (introspection/tests). */
  function getOccupancy() {
    return obst;
  }

  /** @returns {object[]} The live particle array (introspection/tests). */
  function getParticles() {
    return particles;
  }

  return {
    buildField, update, render, renderPool, setCount, getCount,
    setReducedMotion, setWindDir, getWindDir,
    getField, getOccupancy, getParticles,
  };
}
