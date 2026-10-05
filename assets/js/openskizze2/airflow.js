/**
 * OpenSKIZZE 2.0 — cold-air velocity field and streamline ribbon system (R4).
 *
 * Builds a smooth per-cell wind field from a design's KLAM classes and block
 * genome (aerodynamic roughness `z0`, building footprint, street channeling),
 * advects particles through it (bilinear sampling) and renders each particle as
 * a fading polyline (ribbon) backed by a reusable per-particle trail buffer.
 * Sheltered / pooled cells are rendered as soft radial-gradient fog blobs in a
 * single grey/blue visual language, shared with the `coldPool` iso layer.
 *
 * Respects `prefers-reduced-motion` by drawing static streamlines instead of
 * animating particles.
 *
 * Pure ES module: no side effects on import, no `Math.random`. The renderer is
 * DOM-free (it only receives a 2D context and a geometry object). All buffers
 * are reused across frames — the hot path performs no per-frame allocation.
 */

import { N } from './config.js';
import { makePRNG } from './prng.js';
import { KLAM } from './klam.js';
import { isoProject, isoProjectInto } from './iso.js';

/** Number of cells in the parcel grid. */
const FIELD_LEN = N * N;

/** Base wind speed (grid units/s) before per-cell modulation. */
const BASE_SPEED = 1.0;

/** Global advection multiplier (grid units/s). */
const SPEED = 2.6;

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

/** Roughness normaliser: z0 above this counts as a full obstruction. */
const Z0_MAX = 2.5;

/** Lateral deflection gain from the smoothed roughness gradient. */
const DEFLECT = 1.8;

/** Jacobi smoothing iterations for the roughness / obstruction grids. */
const SMOOTH_ITERS = 2;

/** Jacobi relaxation iterations for the velocity field. */
const RELAX_ITERS = 1;

/** Upstream pooling accumulation constants. */
const POOL_K = 0.9;
const POOL_DECAY = 0.82;

/** Backward-walk step count for directional pooling accumulation. */
const POOL_STEPS = 4 * N;

/** Soft depth-blend half-width for the back/front pass split (no popping). */
const DEPTH_BLEND = 1.6;

/** Whether a class is open terrain (concentrates flow). @param {string} klam @returns {boolean} */
function isOpen(klam) {
  return klam === 'KLAM_GRASS' || klam === 'KLAM_WATER';
}

/** Whether a class is a built structure. @param {string} klam @returns {boolean} */
function isBuilt(klam) {
  return klam === 'KLAM_RESIDENTIAL_LOW' || klam === 'KLAM_URBAN_HIGH' || klam === 'KLAM_COMMERCIAL';
}

/** Clamp to [0,1]. @param {number} x @returns {number} */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Rotated grid depth (`rx + ry`) for the iso orientation `o`, matching the
 * painter's order used by `iso.js`. Used for the soft back/front pass split.
 * @param {number} x
 * @param {number} y
 * @param {number} o
 * @returns {number}
 */
function rotatedDepth(x, y, o) {
  if (o === 1) return y + (N - 1 - x);
  if (o === 2) return (N - 1 - x) + (N - 1 - y);
  if (o === 3) return (N - 1 - y) + x;
  return x + y;
}

/**
 * In-place 4-neighbour averaging (Jacobi smoothing) of a scalar grid.
 * @param {Float32Array} a - Grid to smooth (mutated).
 * @param {Float32Array} tmp - Scratch buffer of equal length.
 * @param {number} iters
 */
function smoothGrid(a, tmp, iters) {
  for (let it = 0; it < iters; it++) {
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const i = gy * N + gx;
        let s = a[i] * 4;
        let w = 4;
        if (gx > 0) { s += a[i - 1]; w++; }
        if (gx < N - 1) { s += a[i + 1]; w++; }
        if (gy > 0) { s += a[i - N]; w++; }
        if (gy < N - 1) { s += a[i + N]; w++; }
        tmp[i] = s / w;
      }
    }
    a.set(tmp);
  }
}

/**
 * In-place 4-neighbour relaxation of a 2-component vector field, preserving
 * overall direction while removing checkerboard artefacts.
 * @param {Float32Array} f - Field of length 2*N*N (vx,vy interleaved, mutated).
 * @param {Float32Array} tmp - Scratch buffer of equal length.
 * @param {number} iters
 */
function relaxField(f, tmp, iters) {
  for (let it = 0; it < iters; it++) {
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const i = gy * N + gx;
        const c = i * 2;
        let vx = f[c] * 4;
        let vy = f[c + 1] * 4;
        let w = 4;
        if (gx > 0) { vx += f[c - 2]; vy += f[c - 1]; w++; }
        if (gx < N - 1) { vx += f[c + 2]; vy += f[c + 3]; w++; }
        if (gy > 0) { vx += f[c - N * 2]; vy += f[c - N * 2 + 1]; w++; }
        if (gy < N - 1) { vx += f[c + N * 2]; vy += f[c + N * 2 + 1]; w++; }
        tmp[c] = vx / w;
        tmp[c + 1] = vy / w;
      }
    }
    f.set(tmp);
  }
}

/**
 * Bilinearly sample a 2-component vector field at fractional grid coords,
 * writing into `out` so the hot path performs no per-frame allocation.
 * Clamps at the borders.
 *
 * @param {Float32Array} f - Field of length 2*N*N (vx,vy interleaved).
 * @param {number} x
 * @param {number} y
 * @param {{vx:number,vy:number}} out - Reused output object.
 * @returns {{vx:number, vy:number}}
 */
export function sampleFieldInto(f, x, y, out) {
  const cx = Math.max(0, Math.min(N - 1, x));
  const cy = Math.max(0, Math.min(N - 1, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(N - 1, x0 + 1);
  const y1 = Math.min(N - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;

  const i00 = (y0 * N + x0) * 2;
  const i10 = (y0 * N + x1) * 2;
  const i01 = (y1 * N + x0) * 2;
  const i11 = (y1 * N + x1) * 2;

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
 *   buildField:(design:object)=>void,
 *   update:(dt:number, design:object)=>void,
 *   render:(ctx:CanvasRenderingContext2D, geom:object, state:object, pass?:string)=>void,
 *   renderPool:(ctx:CanvasRenderingContext2D, geom:object, state:object)=>void,
 *   setCount:(n:number)=>void,
 *   getCount:()=>number,
 *   setReducedMotion:(flag:boolean)=>void,
 *   setWindDir:(dir:{x:number,y:number})=>void,
 *   getWindDir:()=>({x:number,y:number})
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

  /** Velocity field (vx,vy interleaved). */
  let field = null;

  /** Per-cell pooling value 0..1 (smoothed upstream shelter). */
  let pool = new Float32Array(FIELD_LEN);

  /** Cached radial-gradient sprite for pooling fog (avoids per-cell gradients). */
  let poolSprite = null;

  /** Active particles in grid coordinates. */
  let particles = [];

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
   * Spawn a particle on the upstream boundary (the edge the wind comes from).
   * For a direction `(dx,dy)` the upstream edges are opposite the flow; one is
   * chosen weighted by the magnitude of the corresponding component.
   * @param {object} p
   */
  function spawn(p) {
    const dx = windDir.x;
    const dy = windDir.y;
    const edges = [];
    if (dx > 0) edges.push({ axis: 'x', at: 0, w: Math.abs(dx) });
    else if (dx < 0) edges.push({ axis: 'x', at: N, w: Math.abs(dx) });
    if (dy > 0) edges.push({ axis: 'y', at: 0, w: Math.abs(dy) });
    else if (dy < 0) edges.push({ axis: 'y', at: N, w: Math.abs(dy) });
    if (edges.length === 0) edges.push({ axis: 'y', at: 0, w: 1 });

    let total = 0;
    for (const e of edges) total += e.w;
    let edge = edges[0];
    let r = rng() * total;
    for (const e of edges) { r -= e.w; if (r <= 0) { edge = e; break; } }

    if (edge.axis === 'x') { p.x = edge.at; p.y = rng() * N; }
    else { p.y = edge.at; p.x = rng() * N; }

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
   * Build the velocity field and pooled-fog grid for a design.
   * @param {object} design
   * @param {{x:number,y:number}} [dir] - Cold-air direction; updates the stored wind.
   */
  function buildField(design, dir) {
    if (dir) setWindDir(dir);
    field = new Float32Array(2 * FIELD_LEN);
    pool = new Float32Array(FIELD_LEN);
    if (!design || !design.cells) return;

    const wx = windDir.x;
    const wy = windDir.y;

    const z0 = new Float32Array(FIELD_LEN);
    const obst = new Float32Array(FIELD_LEN);
    const tmp = new Float32Array(FIELD_LEN);

    // 1. Roughness + obstruction grids (roughness drives the deflection field).
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const i = gy * N + gx;
        const cell = design.cells[i];
        const k = KLAM[cell.klam] || KLAM.KLAM_GRASS;
        let o = k.z0 / Z0_MAX;
        if (isBuilt(cell.klam) && cell.height > 0) {
          o = o * 0.55 + (cell.height / 8) * 0.45;
        }
        if (cell.street) o *= 0.35; // streets channel air
        z0[i] = k.z0;
        obst[i] = clamp01(o);
      }
    }
    smoothGrid(z0, tmp, SMOOTH_ITERS);
    smoothGrid(obst, tmp, SMOOTH_ITERS);

    // 2. Velocity field: base flow along the city's cold-air direction, slowed
    //    over rough/blocked cells, faster over open terrain and streets, and
    //    deflected by the roughness gradient perpendicular to the wind.
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const i = gy * N + gx;
        const cell = design.cells[i];
        const xm = gx > 0 ? gx - 1 : gx;
        const xp = gx < N - 1 ? gx + 1 : gx;
        const ym = gy > 0 ? gy - 1 : gy;
        const yp = gy < N - 1 ? gy + 1 : gy;
        const dzdx = xp === xm ? 0 : (z0[gy * N + xp] - z0[gy * N + xm]) / (xp - xm);
        const dzdy = yp === ym ? 0 : (z0[yp * N + gx] - z0[ym * N + gx]) / (yp - ym);

        let speed = BASE_SPEED * (1 - 0.85 * obst[i]);
        if (isOpen(cell.klam)) speed *= 1.25;
        if (cell.street) speed *= 1.2;

        // Perpendicular component of the roughness gradient (flow around obstacles).
        const gdotw = dzdx * wx + dzdy * wy;
        const gpx = dzdx - gdotw * wx;
        const gpy = dzdy - gdotw * wy;

        field[i * 2] = wx * speed - DEFLECT * gpx;
        field[i * 2 + 1] = wy * speed - DEFLECT * gpy;
      }
    }
    relaxField(field, tmp, RELAX_ITERS);

    // 3. Pooling: calm shelter accumulated upstream along -windDir.
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
          acc += obst[j] * weight;
          weight *= POOL_DECAY;
        }
        pool[i] = 1 - Math.exp(-acc * POOL_K);
      }
    }
  }

  /**
   * Bilinear pooling value at fractional coords.
   * @param {number} x
   * @param {number} y
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
   * Advance particles by `dt` seconds.
   * @param {number} dt
   * @param {object} design
   */
  function update(dt, design) {
    if (reducedMotion) return;
    if (!field) buildField(design);
    if (!field) return;

    for (const p of particles) {
      const v = sampleFieldInto(field, p.x, p.y, samp);
      p.x += v.vx * dt * SPEED;
      p.y += v.vy * dt * SPEED;
      p.age += dt;

      // Push the new position into the reusable ring buffer.
      p.trail[p.head * 2] = p.x;
      p.trail[p.head * 2 + 1] = p.y;
      p.head = (p.head + 1) % TRAIL_LEN;
      if (p.filled < TRAIL_LEN) p.filled++;
      p.dirty = true;

      if (p.x < -0.5 || p.x > N - 0.5 || p.y < -0.5 || p.y > N - 0.5 || p.age > p.life) spawn(p);
    }
  }

  /**
   * Draw the static reduced-motion streamline set as fading ribbons.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} geom
   */
  /**
   * Build `count` start points distributed along the upstream boundary edges.
   * @param {number} count
   * @returns {{x:number,y:number}[]}
   */
  function upstreamStarts(count) {
    const dx = windDir.x;
    const dy = windDir.y;
    const total = Math.abs(dx) + Math.abs(dy) || 1;
    const pts = [];
    const addEdge = (axis, at, w) => {
      const n = Math.max(1, Math.round((w / total) * count));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        if (axis === 'x') pts.push({ x: at, y: t * N });
        else pts.push({ x: t * N, y: at });
      }
    };
    if (dx > 0) addEdge('x', 0, Math.abs(dx));
    else if (dx < 0) addEdge('x', N, Math.abs(dx));
    if (dy > 0) addEdge('y', 0, Math.abs(dy));
    else if (dy < 0) addEdge('y', N, Math.abs(dy));
    if (pts.length === 0) addEdge('y', 0, 1);
    return pts;
  }

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
      for (let step = 0; step < 140; step++) {
        const v = sampleFieldInto(field, x, y, samp);
        isoProjectInto(x, y, 0, geom, proj);
        px.push(proj.x);
        py.push(proj.y);
        x += v.vx * 0.05 * SPEED;
        y += v.vy * 0.05 * SPEED;
        if (x < 0 || x > N || y < 0 || y > N) break;
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
   * Render the airflow streamline layer.
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

    const mid = N - 1;
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
      const pooled = poolAt(p.x, p.y);
      const baseA = lifeFrac * (pass === 'front' ? 0.85 : 0.72) * passAlpha * (1 - 0.35 * pooled);
      if (baseA <= 0.02) continue;

      ctx.strokeStyle = pooled > 0.5 ? 'rgba(148,163,184,1)' : 'rgba(56,189,248,1)';

      const n = p.filled;
      for (let k = 0; k < n; k++) {
        const idx = trailIndex(p, k);
        const gx = p.trail[idx * 2];
        const gy = p.trail[idx * 2 + 1];
        isoProjectInto(gx, gy, 0, geom, proj);
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
    const th = geom.tileHeight;
    ctx.save();
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const val = pool[gy * N + gx];
        if (val <= 0.06) continue;
        const p = isoProject(gx, gy, 0, geom);
        const cx = p.x;
        const cy = p.y + th / 2;
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

  return { buildField, update, render, renderPool, setCount, getCount, setReducedMotion, setWindDir, getWindDir };
}
