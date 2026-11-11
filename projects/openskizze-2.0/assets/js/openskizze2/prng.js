/**
 * OpenSKIZZE 2.0 — seeded pseudo-random number generation.
 *
 * Pure ES module: no side effects, no DOM access, no `Math.random`.
 * The core generator is an xorshift32 PRNG adapted from the legacy
 * OpenSKIZZE demo's `makePRNG`.
 */

/**
 * Create a deterministic xorshift32 PRNG.
 *
 * @param {number} seed - Any integer; coerced to an unsigned 32-bit value.
 * @returns {() => number} Function returning a float in [0, 1).
 */
export function makePRNG(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Uniform integer in [min, maxInclusive].
 *
 * @param {() => number} rng
 * @param {number} min
 * @param {number} maxInclusive
 * @returns {number}
 */
export function randInt(rng, min, maxInclusive) {
  if (maxInclusive < min) return min;
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

/**
 * Pick a uniformly random element from an array.
 *
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T|undefined}
 */
export function pick(rng, arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Return a new array shuffled with the Fisher–Yates algorithm.
 * The input array is not mutated.
 *
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

/**
 * Weighted random key selection.
 *
 * Weights are normalized defensively: negative/NaN weights are treated as 0,
 * and if the total is 0 the first key is returned.
 *
 * @param {() => number} rng
 * @param {Record<string, number>} weightMap - Map of key -> weight/probability.
 * @returns {string|undefined} The chosen key, or undefined for an empty map.
 */
export function weightedPick(rng, weightMap) {
  const keys = Object.keys(weightMap || {});
  if (keys.length === 0) return undefined;

  let total = 0;
  const weights = keys.map((k) => {
    const w = Number(weightMap[k]);
    const safe = Number.isFinite(w) && w > 0 ? w : 0;
    total += safe;
    return safe;
  });

  if (total <= 0) return keys[0];

  let r = rng() * total;
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i];
    if (r < 0) return keys[i];
  }
  return keys[keys.length - 1];
}

/**
 * Hash a 2-D integer lattice point to a float in [0, 1) using the xorshift32
 * PRNG. Deterministic and free of `Math.random`.
 *
 * @param {number} seed
 * @param {number} ix
 * @param {number} iy
 * @returns {number}
 */
function hashLattice(seed, ix, iy) {
  let s = (seed >>> 0) || 1;
  s ^= Math.imul(ix | 0, 0x9e3779b1);
  s ^= Math.imul(iy | 0, 0x85ebca6b);
  s ^= s << 13; s ^= s >> 17; s ^= s << 5;
  return (s >>> 0) / 4294967296;
}

/** Smoothstep interpolation (3t² − 2t³). @param {number} t @returns {number} */
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * 2-D value noise with bilinear interpolation, seeded and deterministic.
 *
 * Lattice values are hashed from `(seed, ix, iy)`; the fractional part is
 * smoothstep-interpolated so the field is continuous. `scale` is the lattice
 * cell size in world units (larger = smoother).
 *
 * @param {number} seed - Integer seed.
 * @param {number} x - World x coordinate.
 * @param {number} y - World y coordinate.
 * @param {number} scale - Lattice spacing (> 0).
 * @returns {number} Noise value in [0, 1].
 */
export function valueNoise2D(seed, x, y, scale) {
  const s = scale > 0 ? scale : 1;
  const fx = x / s;
  const fy = y / s;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);

  const v00 = hashLattice(seed, x0, y0);
  const v10 = hashLattice(seed, x0 + 1, y0);
  const v01 = hashLattice(seed, x0, y0 + 1);
  const v11 = hashLattice(seed, x0 + 1, y0 + 1);

  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}
