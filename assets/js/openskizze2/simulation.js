/**
 * OpenSKIZZE 2.0 — surrogate-assisted MAP-Elites simulation core.
 *
 * Candidates are enumerated over the **block genome** (land-use assignment,
 * morphology pattern, base height, density, height profile) rather than over
 * flat per-cell shuffles, so the archive spans coherent urban morphologies.
 *
 * Pure ES module: no side effects, no DOM access, no `Math.random`.
 * All randomness is seeded and deterministic.
 */

import { N, BINS, SIM, ARCHETYPE_DEFS, DEFAULT_STRUCTURE, PATTERNS, PROFILES } from './config.js';
import { makePRNG, weightedPick } from './prng.js';
import {
  createDesign,
  mutateDesign,
  computeMetrics,
  computeDescriptor,
  computeFitness,
  binIndex,
  binOfX,
  binOfY,
  setDescriptorScale,
  computeFreeRects,
} from './design.js';

/**
 * @typedef {import('./design.js').Design} Design
 * @typedef {import('./design.js').Block} Block
 * @typedef {import('./design.js').Cell} Cell
 */

/**
 * MAP-Elites archive.
 * @typedef {Object} Archive
 * @property {(Design|null)[]} bins - 144 bins (12x12), null when empty.
 * @property {number} coverage - Fraction of non-empty bins 0..1.
 * @property {Design|null} best - Highest-fitness elite.
 * @property {number[]} pareto - Ids of elites non-dominated on (floorArea, buildingCount).
 */

/**
 * A labelled design archetype.
 * @typedef {Object} Archetype
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} badge
 * @property {number[]} centroid - 9-dim feature centroid.
 * @property {number|null} medoidId - Representative elite id, or null if empty.
 * @property {number[]} memberIds - Elite ids in this cluster.
 */

/** Number of archetype clusters. */
const K = 4;

/**
 * Per-block mutation rate used when generating candidates. Deliberately higher
 * than `SIM.MUTATION_RATE` so each base genome spreads across a neighbourhood
 * of descriptor bins (improves archive coverage).
 */
const CANDIDATE_MUTATION_RATE = 0.12;

/** Fraction of candidates generated as fully random genomes (fills gaps). */
const RANDOM_FRACTION = 0.2;

/** Discrete base-height levels swept during enumeration. */
const HEIGHT_LEVELS = [1, 2, 4, 6, 8];

/** Discrete density levels swept during enumeration. */
const DENSITY_LEVELS = [0.4, 0.6, 0.8];


/** Clamp a value to [0, 1]. @param {number} x @returns {number} */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Linear-interpolated percentile of an ascending-sorted numeric array.
 * @param {number[]} sorted - Ascending-sorted values.
 * @param {number} p - Fraction in [0,1].
 * @returns {number}
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Column index (0..2) of a block from its x origin. @param {number} x @returns {number} */
function blockColumn(x) {
  return x < 4 ? 0 : x < 8 ? 1 : 2;
}

/**
 * Build a set of land-use assignment maps (each an array of 9 class ids):
 * a dominant-bias map, three noise-blended maps, and a green-finger map.
 *
 * @param {Record<string, number>} bias
 * @param {number} seed
 * @param {{x:number,y:number,w:number,h:number}[]} rects - Free-region rectangles.
 * @returns {string[][]}
 */
function landUseMaps(bias, seed, rects) {
  const keys = Object.keys(bias);
  const dominant = keys.reduce((a, b) => (bias[b] > bias[a] ? b : a), keys[0]);
  const maps = [new Array(9).fill(dominant)];

  for (let m = 0; m < 3; m++) {
    const rng = makePRNG(seed + m * 7919);
    const map = [];
    for (let b = 0; b < 9; b++) map.push(weightedPick(rng, bias));
    maps.push(map);
  }

  // Green cold-air finger: one N–S block column becomes green.
  {
    const rng = makePRNG(seed + 104729);
    const map = [];
    for (let b = 0; b < 9; b++) {
      map.push(blockColumn(rects[b].x) === 1 ? 'KLAM_GRASS' : weightedPick(rng, bias));
    }
    maps.push(map);
  }

  return maps;
}

/**
 * Pattern schemes: one uniform scheme per pattern plus a set of mixed schemes.
 *
 * The mixed schemes are chosen to spread candidates across the *2-D* descriptor
 * plane: north green/blue strips (upstream cold-air sources) are combined with
 * dense building patterns downstream so that high `floorArea` co-occurs with a
 * high `buildingCount` (upper-right region), while forest-heavy and water-heavy
 * schemes reach the low/low and low/high corners. Schemes are indexed row-major
 * (block b is at grid column `b % 3`, row `floor(b / 3)`; row 0 is North).
 *
 * @returns {string[][]}
 */
function patternSchemes() {
  const schemes = [];
  for (const p of PATTERNS) schemes.push(new Array(9).fill(p));
  schemes.push(['perimeter', 'courtyard', 'perimeter', 'courtyard', 'perimeter', 'courtyard', 'perimeter', 'courtyard', 'perimeter']);
  schemes.push(['towerPark', 'green', 'towerPark', 'green', 'towerPark', 'green', 'towerPark', 'green', 'towerPark']);
  schemes.push(['row', 'row', 'detached', 'row', 'row', 'detached', 'row', 'row', 'detached']);
  schemes.push(['green', 'detached', 'row', 'green', 'detached', 'row', 'green', 'detached', 'row']);
  // North water/green strip + dense downstream blocks → high floor area AND building count.
  schemes.push(['water', 'water', 'water', 'perimeter', 'row', 'courtyard', 'perimeter', 'row', 'courtyard']);
  schemes.push(['water', 'green', 'water', 'towerPark', 'row', 'perimeter', 'towerPark', 'row', 'perimeter']);
  schemes.push(['green', 'green', 'green', 'towerPark', 'perimeter', 'courtyard', 'towerPark', 'perimeter', 'courtyard']);
  // Green/blue N–S fingers interlaced with buildings → porous mid-range cover.
  schemes.push(['water', 'perimeter', 'green', 'green', 'perimeter', 'water', 'water', 'perimeter', 'green']);
  schemes.push(['water', 'row', 'water', 'perimeter', 'water', 'perimeter', 'water', 'row', 'water']);
  // Forest-heavy (high z0 shelters flux) → low floor area / low building count corner.
  schemes.push(['green', 'green', 'green', 'green', 'green', 'green', 'green', 'green', 'green']);
  return schemes;
}

/**
 * Assemble a 9-block genome from an enumeration tuple, laid out in the free
 * regions of the site structure.
 *
 * @param {number} seed
 * @param {string[]} landUseMap
 * @param {string[]} patternScheme
 * @param {number} baseHeight
 * @param {number} density
 * @param {string} profile
 * @param {{x:number,y:number,w:number,h:number}[]} rects - Free-region rectangles.
 * @returns {Block[]}
 */
function buildBlocks(seed, landUseMap, patternScheme, baseHeight, density, profile, rects) {
  const blocks = [];
  for (let b = 0; b < 9; b++) {
    const rect = rects[b];
    blocks.push({
      id: b,
      x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      landUse: landUseMap[b],
      pattern: patternScheme[b],
      baseHeight,
      heightProfile: profile,
      density,
      seed: (seed + Math.imul(b + 1, 0x9e3779b1)) >>> 0,
    });
  }
  return blocks;
}

/**
 * Generate a population of candidate designs for a site.
 *
 * Enumerates block genomes across land-use assignment, morphology pattern,
 * base-height level, density level and height profile, then greedily selects a
 * diverse subset that covers as many distinct descriptor bins as possible. The
 * selected genomes are emitted verbatim first (guaranteeing archive coverage),
 * followed by mutated variants and a small fraction of fully random genomes.
 *
 * Every candidate retains the site's `structure` (rails/roads/green corridor/
 * existing blocks), so all designs share the same existing infrastructure and
 * blocks are laid out in the free regions between it.
 *
 * Deterministic: all randomness comes from the seeded PRNG.
 *
 * @param {{bias: Record<string, number>, structure?: import('./config.js').Structure}} site - Site preset (uses `bias` and `structure`).
 * @param {number} count - Number of candidates to generate.
 * @param {number} seed - Master seed.
 * @returns {Design[]}
 */
export function generateCandidates(site, count, seed) {
  const rng = makePRNG(seed);
  const bias = site && site.bias ? site.bias : { KLAM_GRASS: 1 };
  const structure = (site && site.structure) || DEFAULT_STRUCTURE;
  // The city's cold-air direction drives the metric's upstream sheltering walk.
  const windDir = (site && site.city && site.city.coldAir && site.city.coldAir.dir) || undefined;
  const rects = computeFreeRects(structure);

  // --- 1. Block-genome enumeration pool -------------------------------------
  const maps = landUseMaps(bias, seed, rects);
  const schemes = patternSchemes();
  const pool = [];
  for (const map of maps) {
    for (const scheme of schemes) {
      for (const baseHeight of HEIGHT_LEVELS) {
        for (const density of DENSITY_LEVELS) {
          for (const profile of PROFILES) {
            pool.push(buildBlocks(seed, map, scheme, baseHeight, density, profile, rects));
          }
        }
      }
    }
  }

  // --- 2. Measure the population and install adaptive normalization ---------
  // The fixed GFZ_MAX does not match the achievable floor-area range, packing
  // all candidates into a few bins. Measure the raw population once
  // (deterministically) and map the observed 2nd–98th percentile range onto
  // [0,1], so the floor-area axis stays monotonic but fills all bins. The
  // building-count axis is an integer count and needs no adaptive scale.
  const probes = pool.map((blocks) => {
    const probe = createDesign(0, blocks, structure, windDir);
    computeMetrics(probe);
    return probe;
  });
  const gfzVals = probes.map((d) => d.metrics.planner.gfz).sort((a, b) => a - b);
  setDescriptorScale({
    floorLo: percentile(gfzVals, 0.02),
    floorHi: percentile(gfzVals, 0.98),
  });

  // --- 3. Greedy selection of a bin-covering subset -------------------------
  const selected = [];
  const seen = new Set();
  for (const probe of probes) {
    const desc = computeDescriptor(probe);
    const key = binOfY(desc.buildingCount) * BINS + binOfX(desc.floorArea);
    if (!seen.has(key)) {
      seen.add(key);
      selected.push(probe.blocks);
    }
  }

  // --- 4. Emit candidates ---------------------------------------------------
  const out = [];
  const randomEvery = Math.max(2, Math.round(1 / RANDOM_FRACTION));
  for (let i = 0; i < count; i++) {
    let design;
    if (selected.length > 0 && i < selected.length) {
      // Emit each selected genome verbatim so its exact descriptor bin is covered.
      design = createDesign(seed + i, selected[i], structure, windDir);
    } else if (i % randomEvery === randomEvery - 1) {
      design = createDesign(seed + i, null, structure, windDir);
    } else if (selected.length > 0) {
      const base = createDesign(seed + i, selected[i % selected.length], structure, windDir);
      design = mutateDesign(base, rng, CANDIDATE_MUTATION_RATE);
    } else {
      design = createDesign(seed + i, null, structure, windDir);
    }
    design.id = i;
    design.seed = seed + i;
    out.push(design);
  }
  return out;
}

/**
 * Create an empty MAP-Elites archive.
 *
 * @returns {Archive}
 */
export function createArchive() {
  return {
    bins: new Array(BINS * BINS).fill(null),
    coverage: 0,
    best: null,
    pareto: [],
  };
}

/**
 * Insert candidates into a MAP-Elites archive, replacing a bin when the
 * candidate has higher fitness. Recomputes coverage, best and the Pareto set.
 *
 * @param {Design[]} candidates
 * @param {Archive} archive
 * @returns {Archive} The same archive, mutated.
 */
export function runMAPElites(candidates, archive) {
  for (const d of candidates) {
    computeMetrics(d);
    const desc = computeDescriptor(d);
    const fit = computeFitness(d);

    const bx = binOfX(desc.floorArea);
    const by = binOfY(desc.buildingCount);

    const idx = binIndex(bx, by);
    const cur = archive.bins[idx];
    if (!cur || fit > cur.fitness) archive.bins[idx] = d;
  }

  const elites = archive.bins.filter(Boolean);
  archive.coverage = elites.length / (BINS * BINS);

  let best = null;
  for (const e of elites) {
    if (!best || e.fitness > best.fitness) best = e;
  }
  archive.best = best;

  // Pareto set on the two QD features (floorArea, buildingCount).
  const pareto = [];
  for (const a of elites) {
    let dominated = false;
    for (const b of elites) {
      if (a === b) continue;
      const af = a.descriptor.floorArea, ab = a.descriptor.buildingCount;
      const bf = b.descriptor.floorArea, bb = b.descriptor.buildingCount;
      if (bf >= af && bb >= ab && (bf > af || bb > ab)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) pareto.push(a.id);
  }
  archive.pareto = pareto;

  return archive;
}

/**
 * Build the 9-dim normalized feature vector for an elite design.
 * [floorArea, buildingCountNorm, greenNorm, meanHeightNorm,
 *  waterFrac, forestFrac, sealedFrac, meanFootprint, streetFraction]
 *
 * @param {Design} d
 * @returns {number[]}
 */
function featureVector(d) {
  const m = d.metrics || computeMetrics(d);
  const desc = d.descriptor || computeDescriptor(d);
  const pct = m.planner.classPct;

  let fpSum = 0;
  let bCount = 0;
  let streetCount = 0;
  for (const c of d.cells) {
    if (c.street) streetCount++;
    if (c.height > 0 && c.footprint > 0) {
      fpSum += c.footprint;
      bCount++;
    }
  }
  const meanFootprint = bCount > 0 ? fpSum / bCount : 0;
  const streetFraction = d.cells.length > 0 ? streetCount / d.cells.length : 0;

  return [
    clamp01(desc.floorArea),
    clamp01(desc.buildingCount / (N * N)),
    clamp01(m.layman.greenSpace / 100),
    clamp01(m.planner.gfz / SIM.GFZ_MAX),
    clamp01((pct.KLAM_WATER || 0) / 100),
    clamp01((pct.KLAM_FOREST || 0) / 100),
    clamp01(m.planner.grz),
    clamp01(meanFootprint),
    clamp01(streetFraction),
  ];
}

/** Squared Euclidean distance between two vectors. */
function distSq(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

/**
 * k-means++ centroid initialization.
 *
 * @param {() => number} rng
 * @param {number[][]} points
 * @param {number} k
 * @returns {number[][]}
 */
function kmeansPlusPlus(rng, points, k) {
  const centroids = [];
  const first = Math.floor(rng() * points.length);
  centroids.push(points[first].slice());

  while (centroids.length < k) {
    const dists = points.map((p) => {
      let best = Infinity;
      for (const c of centroids) {
        const d = distSq(p, c);
        if (d < best) best = d;
      }
      return best;
    });
    let total = 0;
    for (const d of dists) total += d;

    let chosen = points.length - 1;
    if (total > 0) {
      let r = rng() * total;
      for (let i = 0; i < dists.length; i++) {
        r -= dists[i];
        if (r <= 0) { chosen = i; break; }
      }
    } else {
      chosen = Math.floor(rng() * points.length);
    }
    centroids.push(points[chosen].slice());
  }
  return centroids;
}

/**
 * Run k-means clustering.
 *
 * @param {number[][]} points
 * @param {number} k
 * @param {number} seed
 * @param {number} iters
 * @returns {{centroids:number[][], assignments:number[]}}
 */
function kmeans(points, k, seed, iters) {
  const rng = makePRNG(seed);
  let centroids = kmeansPlusPlus(rng, points, k);
  const assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < iters; iter++) {
    // Assignment step.
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distSq(points[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      assignments[i] = best;
    }

    // Update step.
    const dim = points[0].length;
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < points.length; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) sums[c][j] += points[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let j = 0; j < dim; j++) centroids[c][j] = sums[c][j] / counts[c];
      }
      // Empty clusters keep their previous centroid.
    }
  }

  // Empty-cluster fallback: reassign the worst-fit point to each empty cluster.
  for (let c = 0; c < k; c++) {
    let count = 0;
    for (let i = 0; i < points.length; i++) if (assignments[i] === c) count++;
    if (count > 0) continue;

    let worst = -1;
    let worstD = -1;
    for (let i = 0; i < points.length; i++) {
      const d = distSq(points[i], centroids[assignments[i]]);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst >= 0) assignments[worst] = c;
  }

  return { centroids, assignments };
}

/**
 * Derive four labelled archetypes from the archive elites via k-means.
 *
 * Labels are assigned deterministically:
 *  - D = cluster with max mean floorArea
 *  - A = among remaining, max mean porosity (preferring greenNorm ≥ 0.4)
 *  - C = among remaining, max mean meanHeightNorm
 *  - B = last remaining
 *
 * @param {Archive} archive
 * @returns {Archetype[]} Four archetypes matching ARCHETYPE_DEFS.
 */
export function deriveArchetypes(archive) {
  const elites = archive.bins.filter(Boolean);

  // Degenerate case: not enough elites to cluster.
  if (elites.length < K) {
    return ARCHETYPE_DEFS.map((def) => ({
      id: def.id,
      name: def.name,
      color: def.color,
      badge: def.badge,
      centroid: new Array(9).fill(0),
      medoidId: elites.length ? elites[0].id : null,
      memberIds: elites.map((e) => e.id),
    }));
  }

  const points = elites.map(featureVector);
  const { centroids, assignments } = kmeans(points, K, SIM.KMEANS_SEED, SIM.KMEANS_ITERS);

  // Group members per cluster.
  const members = Array.from({ length: K }, () => []);
  for (let i = 0; i < assignments.length; i++) members[assignments[i]].push(i);

  // Per-cluster mean feature stats.
  const stats = centroids.map((cent, c) => {
    const idxs = members[c];
    if (idxs.length === 0) {
      return { floorArea: -Infinity, buildingCount: -Infinity, porosity: -Infinity, green: -Infinity, meanHeight: -Infinity };
    }
    let fa = 0, bc = 0, g = 0, mh = 0;
    for (const i of idxs) {
      fa += points[i][0]; bc += points[i][1]; g += points[i][2]; mh += points[i][3];
    }
    const n = idxs.length;
    const buildingCount = bc / n;
    return { floorArea: fa / n, buildingCount, porosity: 1 - buildingCount, green: g / n, meanHeight: mh / n };
  });

  // Deterministic label assignment.
  const remaining = [0, 1, 2, 3];
  const labelOf = {};

  const argmax = (cands, key) => {
    let best = cands[0];
    for (const c of cands) if (stats[c][key] > stats[best][key]) best = c;
    return best;
  };
  const remove = (c) => {
    const i = remaining.indexOf(c);
    if (i >= 0) remaining.splice(i, 1);
  };

  const dIdx = argmax(remaining, 'floorArea');
  labelOf[dIdx] = 'D';
  remove(dIdx);

  let aCands = remaining.filter((c) => stats[c].green >= 0.4);
  if (aCands.length === 0) aCands = remaining.slice();
  const aIdx = argmax(aCands, 'porosity');
  labelOf[aIdx] = 'A';
  remove(aIdx);

  const cIdx = argmax(remaining, 'meanHeight');
  labelOf[cIdx] = 'C';
  remove(cIdx);

  const bIdx = remaining[0];
  labelOf[bIdx] = 'B';

  // Build archetypes keyed by label.
  const byLabel = {};
  for (let c = 0; c < K; c++) {
    const label = labelOf[c];
    const idxs = members[c];
    const memberIds = idxs.map((i) => elites[i].id);

    let medoidId = null;
    if (idxs.length > 0) {
      let bestLocal = idxs[0];
      let bestSum = Infinity;
      for (const i of idxs) {
        let sum = 0;
        for (const j of idxs) sum += distSq(points[i], points[j]);
        if (sum < bestSum || (sum === bestSum && elites[i].id < elites[bestLocal].id)) {
          bestSum = sum;
          bestLocal = i;
        }
      }
      medoidId = elites[bestLocal].id;
    }

    byLabel[label] = {
      centroid: centroids[c].slice(),
      medoidId,
      memberIds,
    };
  }

  return ARCHETYPE_DEFS.map((def) => {
    const info = byLabel[def.id] || { centroid: new Array(9).fill(0), medoidId: null, memberIds: [] };
    return {
      id: def.id,
      name: def.name,
      color: def.color,
      badge: def.badge,
      centroid: info.centroid,
      medoidId: info.medoidId,
      memberIds: info.memberIds,
    };
  });
}
