/**
 * OpenSKIZZE 2.0 — consensus + requirement-extraction engine.
 *
 * Aggregates **all designs in a selected archetype cluster** into:
 *
 *  1. a per-cell consensus (land-use distribution + height/footprint statistics),
 *  2. a **program** of quantity statistics per KLAM class (area share per design,
 *     aggregated to mean/std/expected cells), and
 *  3. a **zone-based spatial aggregation** over a 3×3 compass grid, from which
 *     placement requirements are derived.
 *
 * The guiding principle is **"quantity always, location only when consistent"**:
 * a class that is abundant across the cluster always yields a quantity
 * requirement, even if it is placed differently in every design (e.g. scattered
 * water). A placement requirement is only emitted when the class's area is
 * spatially concentrated; otherwise an honest `flexible` ("location
 * unrestricted") requirement is emitted.
 *
 * This module is intentionally pure: no DOM, no state coupling, no
 * `Math.random`. The caller resolves the cluster's designs (see
 * {@link collectClusterDesigns}) and passes them in, so the engine is fully
 * testable headless and deterministic.
 *
 * Pure ES module: no side effects on import.
 */

import { N } from './config.js';
import { KLAM, KLAM_IDS } from './klam.js';

/**
 * @typedef {import('./design.js').Design} Design
 * @typedef {import('./design.js').Cell} Cell
 * @typedef {import('./simulation.js').Archive} Archive
 * @typedef {import('./simulation.js').Archetype} Archetype
 */

/**
 * A MAP-Elites archive bin as stored by the app store: a wrapper around a
 * design with its fitness and bin coordinates. Raw designs are also accepted.
 *
 * @typedef {Object} ArchiveBin
 * @property {Design} design
 * @property {number} fitness
 * @property {number} bx
 * @property {number} by
 */

/**
 * Per-cell consensus across a cluster of designs.
 *
 * @typedef {Object} ConsensusCell
 * @property {number} gx - Column (0 = West).
 * @property {number} gy - Row (0 = North).
 * @property {string} dominant - KLAM class with the highest mean frequency.
 * @property {number} confidence - `classDist[dominant]`, 0..1.
 * @property {Record<string, number>} classDist - Mean frequency of each KLAM class (sums to 1).
 * @property {number} entropy - Normalized Shannon entropy of `classDist`, 0..1.
 * @property {number} heightMean - Mean building height (stories) over all designs.
 * @property {number} heightStd - Population std-dev of height over all designs.
 * @property {number} footprintMean - Mean footprint fraction over all designs.
 * @property {number} footprintStd - Population std-dev of footprint over all designs.
 * @property {number} buildingFrac - Fraction of designs where the cell is a building.
 */

/**
 * Program (quantity) statistic for one KLAM class.
 *
 * @typedef {Object} ProgramEntry
 * @property {string} klam - KLAM class id.
 * @property {string} label - Human-readable class label.
 * @property {number} meanShare - Mean fraction of the 100 cells carrying the class across designs.
 * @property {number} stdShare - Population std-dev of the per-design area share.
 * @property {number} expectedCells - `meanShare * 100` (expected number of cells).
 * @property {number} presence - Fraction of designs in which the class occurs at least once.
 */

/**
 * Zone statistic for one KLAM class.
 *
 * @typedef {Object} ZoneEntry
 * @property {string} klam - KLAM class id.
 * @property {string} label - Human-readable class label.
 * @property {number} expectedCells - Expected number of cells for the class.
 * @property {Record<string, number>} zoneDist - Expected area (cells) per zone; sums to `expectedCells`.
 * @property {string} dominantZone - Zone id (`NW`..`SE`) with the largest expected area.
 * @property {number} concentration - `max(zoneDist) / expectedCells`, 1/9 (dispersed) .. 1 (one zone).
 * @property {number} zoneEntropy - Normalized Shannon entropy of the zone shares, 0..1.
 */

/**
 * A derived requirement for one KLAM class.
 *
 * @typedef {Object} Requirement
 * @property {'quantity'|'placement'|'avoid'} kind - Requirement category.
 * @property {string} klam - KLAM class id.
 * @property {string} label - Human-readable class label.
 * @property {string} region - Human-readable compass region (or "throughout the site").
 * @property {number[]} cells - Legacy cell-index list (kept for compatibility; may be empty).
 * @property {number} confidence - 0..1, meaning depends on kind.
 * @property {number} tolerance - ± freedom (cells for quantity, zones for placement; integer ≥ 0).
 * @property {string} text - Full human-readable requirement sentence.
 * @property {number} [meanShare] - Present for `quantity`.
 * @property {number} [stdShare] - Present for `quantity`.
 * @property {number} [expectedCells] - Present for `quantity`.
 * @property {string} [zone] - Present for `placement`.
 * @property {number} [concentration] - Present for `placement`.
 * @property {boolean} [flexible] - `true` for the "location unrestricted" placement.
 */

/**
 * Summary statistics for a consensus.
 *
 * @typedef {Object} ConsensusStats
 * @property {number} designs - Number of designs aggregated.
 * @property {number} meanConfidence - Mean per-cell confidence, 0..1.
 * @property {number} meanEntropy - Mean per-cell normalized entropy, 0..1.
 * @property {Record<string, number>} coverage - Fraction of cells where each class is dominant.
 */

/**
 * The full consensus result.
 *
 * @typedef {Object} Consensus
 * @property {ConsensusCell[]} cells - 100 per-cell consensus records.
 * @property {ProgramEntry[]} program - Per-class quantity statistics (all classes).
 * @property {ZoneEntry[]} zones - Per-class zone statistics (all classes).
 * @property {Requirement[]} requirements - Derived requirements (quantity/placement/avoid).
 * @property {ConsensusStats} stats - Summary statistics.
 */

/** Minimum mean area share for a class to receive a quantity requirement. */
export const QUANTITY_MIN = 0.03;

/** Minimum spatial concentration (max zone share) for a concentrated placement. */
export const PLACEMENT_MIN = 0.45;

/** Mean area share below which a class counts as "not part of this design family". */
export const AVOID_MAX = 0.005;

/** Minimum expected area (cells) before a class is eligible for a placement requirement. */
export const PLACEMENT_AREA_MIN = 2;

/** Minimum mean frequency for a class to count as the majority use of a cell. */
export const MAJORITY = 0.5;

/** Minimum number of majority cells before a positive requirement is emitted. */
export const MIN_CELLS = 2;

/** Mean frequency below which a class counts as "absent" from a cell. */
export const ABSENT = 0.1;

/** Minimum number of absent cells before an avoidance requirement is emitted. */
export const MIN_ABSENT_CELLS = 6;

/** Total number of cells in the parcel grid. */
const CELL_COUNT = N * N;

/**
 * Zone grid: a 3×3 compass partition of the N×N parcel. `ZONE_NAMES` is stored
 * row-major (north band first), so index = `zoneRow(gy) * 3 + zoneCol(gx)`.
 *
 * @type {string[]}
 */
export const ZONE_NAMES = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'];

/** Human-readable phrases for each zone id. @type {Record<string,string>} */
export const ZONE_PHRASES = {
  NW: 'north-west',
  N: 'north',
  NE: 'north-east',
  W: 'west',
  C: 'centre',
  E: 'east',
  SW: 'south-west',
  S: 'south',
  SE: 'south-east',
};

/** Lower zone-row/column breakpoints (rows/cols 0..Z1-1 = first band, etc.). */
const Z1 = Math.floor(N / 3);
const Z2 = Math.floor((2 * N) / 3);

/** Zone column (0..2) for a grid column. @param {number} gx @returns {number} */
function zoneCol(gx) {
  return gx < Z1 ? 0 : gx < Z2 ? 1 : 2;
}

/** Zone row (0..2) for a grid row (0 = North). @param {number} gy @returns {number} */
function zoneRow(gy) {
  return gy < Z1 ? 0 : gy < Z2 ? 1 : 2;
}

/** Row-major zone index (0..8) for a cell. @param {number} gx @param {number} gy @returns {number} */
function zoneIndexOf(gx, gy) {
  return zoneRow(gy) * 3 + zoneCol(gx);
}

/**
 * Compass zone id for a grid cell.
 *
 * @param {number} gx - Column (0 = West).
 * @param {number} gy - Row (0 = North).
 * @returns {string} One of {@link ZONE_NAMES}.
 */
export function zoneOf(gx, gy) {
  return ZONE_NAMES[zoneIndexOf(gx, gy)];
}

/**
 * Human-readable phrase for a zone id, for use inside a sentence.
 *
 * @param {string} zone - Zone id (`NW`..`SE`).
 * @returns {string} e.g. `"north"`, `"south-east"`.
 */
export function zonePhrase(zone) {
  return ZONE_PHRASES[zone] || zone;
}

/**
 * Build an id → design index from an archive. Accepts both the app store's
 * wrapper bins (`{ design, fitness, bx, by }`) and raw designs.
 *
 * @param {Archive|{bins:(ArchiveBin|Design|null)[]}} archive
 * @returns {Map<number, Design>}
 */
export function buildDesignIndex(archive) {
  const index = new Map();
  const bins = archive && Array.isArray(archive.bins) ? archive.bins : [];
  for (const bin of bins) {
    if (!bin) continue;
    const design = bin.design || bin;
    if (design && design.id != null) index.set(design.id, design);
  }
  return index;
}

/**
 * Resolve an archetype's member designs from an archive, in deterministic
 * (ascending id) order. Missing ids are skipped.
 *
 * @param {Archive|{bins:(ArchiveBin|Design|null)[]}} archive
 * @param {Archetype} archetype
 * @returns {Design[]}
 */
export function collectClusterDesigns(archive, archetype) {
  const index = buildDesignIndex(archive);
  const ids = archetype && Array.isArray(archetype.memberIds) ? archetype.memberIds : [];
  const out = [];
  for (const id of ids) {
    const design = index.get(id);
    if (design) out.push(design);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/**
 * Map a set of cells to a human-readable compass region.
 *
 * Kept for backwards compatibility with the map/UI; the requirement engine now
 * prefers the 3×3 {@link zoneOf} partition.
 *
 * @param {Array<{gx:number, gy:number}>} cells
 * @returns {string}
 */
export function describeRegion(cells) {
  if (!cells || cells.length === 0) return 'nowhere';

  let minGx = Infinity;
  let maxGx = -Infinity;
  let minGy = Infinity;
  let maxGy = -Infinity;
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    if (c.gx < minGx) minGx = c.gx;
    if (c.gx > maxGx) maxGx = c.gx;
    if (c.gy < minGy) minGy = c.gy;
    if (c.gy > maxGy) maxGy = c.gy;
    sx += c.gx;
    sy += c.gy;
  }
  const cx = sx / cells.length;
  const cy = sy / cells.length;

  const fullV = minGy === 0 && maxGy === N - 1;
  const fullH = minGx === 0 && maxGx === N - 1;
  if (fullV && fullH) return 'throughout the site';

  const vert = fullV ? 'centre' : maxGy <= 2 ? 'north' : minGy >= 7 ? 'south' : cy < 4 ? 'north' : cy > 5 ? 'south' : 'centre';
  const horiz = fullH ? 'centre' : maxGx <= 2 ? 'west' : minGx >= 7 ? 'east' : cx < 4 ? 'west' : cx > 5 ? 'east' : 'centre';

  let phrase;
  if (vert === 'centre' && horiz === 'centre') phrase = 'centre';
  else if (vert === 'centre') phrase = horiz;
  else if (horiz === 'centre') phrase = vert;
  else phrase = `${vert}-${horiz}`;

  const parts = [];
  if (vert !== 'centre') parts.push(`rows ${minGy}–${maxGy}`);
  if (horiz !== 'centre') parts.push(`cols ${minGx}–${maxGx}`);
  if (parts.length === 0) return 'centre';
  return `${phrase} (${parts.join(', ')})`;
}

/**
 * Root-mean-square radial deviation (in cells) of a class's per-design
 * centroids from their cluster mean. 0 when the class sits in the same place in
 * every design, larger when its location wanders. Designs in which the class is
 * absent contribute no centroid.
 *
 * @param {Design[]} designs
 * @param {string} klam
 * @returns {number}
 */
function classCentroidSpread(designs, klam) {
  const centroids = [];
  for (const d of designs) {
    const cells = d && d.cells;
    if (!cells) continue;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] && cells[i].klam === klam) {
        sx += i % N;
        sy += Math.floor(i / N);
        n++;
      }
    }
    if (n > 0) centroids.push([sx / n, sy / n]);
  }
  if (centroids.length < 2) return 0;

  let mx = 0;
  let my = 0;
  for (const [x, y] of centroids) {
    mx += x;
    my += y;
  }
  mx /= centroids.length;
  my /= centroids.length;

  let variance = 0;
  for (const [x, y] of centroids) {
    variance += (x - mx) * (x - mx) + (y - my) * (y - my);
  }
  variance /= centroids.length;

  return Math.sqrt(variance);
}

/**
 * Placement tolerance from the per-design centroid spread, converted to zone
 * units (one zone ≈ `N/3` cells), rounded and clamped to `[0, 2]`.
 *
 * @param {Design[]} designs
 * @param {string} klam
 * @returns {number}
 */
function classToleranceZones(designs, klam) {
  const spreadCells = classCentroidSpread(designs, klam);
  const zoneUnit = N / 3;
  const tol = Math.round(spreadCells / zoneUnit);
  return tol < 0 ? 0 : tol > 2 ? 2 : tol;
}

/**
 * Compute per-class program (quantity) statistics and zone statistics.
 *
 * @param {Design[]} designs
 * @returns {{program: ProgramEntry[], zones: ZoneEntry[]}}
 */
function computeProgramAndZones(designs) {
  const n = designs.length;
  const logZ = Math.log(ZONE_NAMES.length);

  /** @type {ProgramEntry[]} */
  const program = [];
  /** @type {ZoneEntry[]} */
  const zones = [];

  for (const klam of KLAM_IDS) {
    const label = KLAM[klam].label;
    const shares = [];
    let present = 0;
    const zoneTotals = new Array(ZONE_NAMES.length).fill(0);

    for (const d of designs) {
      const cells = d && d.cells;
      let count = 0;
      if (cells) {
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i];
          if (c && c.klam === klam) {
            count++;
            zoneTotals[zoneIndexOf(i % N, Math.floor(i / N))]++;
          }
        }
      }
      shares.push(count / CELL_COUNT);
      if (count > 0) present++;
    }

    const meanShare = n > 0 ? shares.reduce((a, s) => a + s, 0) / n : 0;
    const stdShare =
      n > 0
        ? Math.sqrt(shares.reduce((a, s) => a + (s - meanShare) * (s - meanShare), 0) / n)
        : 0;
    const expectedCells = meanShare * CELL_COUNT;
    const presence = n > 0 ? present / n : 0;

    const zoneDist = {};
    let totalArea = 0;
    let maxZone = ZONE_NAMES[0];
    let maxVal = -1;
    for (let z = 0; z < ZONE_NAMES.length; z++) {
      const area = n > 0 ? zoneTotals[z] / n : 0;
      zoneDist[ZONE_NAMES[z]] = area;
      totalArea += area;
      if (area > maxVal) {
        maxVal = area;
        maxZone = ZONE_NAMES[z];
      }
    }

    const concentration = totalArea > 0 ? maxVal / totalArea : 0;

    let zoneEntropy = 0;
    if (totalArea > 0) {
      let H = 0;
      for (const z of ZONE_NAMES) {
        const p = zoneDist[z] / totalArea;
        if (p > 0) H -= p * Math.log(p);
      }
      zoneEntropy = H / logZ;
    }

    program.push({ klam, label, meanShare, stdShare, expectedCells, presence });
    zones.push({
      klam,
      label,
      expectedCells,
      zoneDist,
      dominantZone: totalArea > 0 ? maxZone : ZONE_NAMES[0],
      concentration,
      zoneEntropy,
    });
  }

  return { program, zones };
}

/**
 * Derive the three kinds of requirement from the program/zone statistics.
 *
 *  - **quantity** (always, when `meanShare >= QUANTITY_MIN`): a firm area budget.
 *  - **placement** (when `expectedCells >= PLACEMENT_AREA_MIN`): a location
 *    requirement when `concentration >= PLACEMENT_MIN`, otherwise a `flexible`
 *    ("location unrestricted") requirement.
 *  - **avoid** (when `meanShare < AVOID_MAX` and the class has neither a
 *    quantity nor a placement requirement).
 *
 * Sorted: quantity (by mean share desc), then placement (concentrated before
 * flexible, by concentration desc), then avoid.
 *
 * @param {Design[]} designs
 * @param {ProgramEntry[]} program
 * @param {ZoneEntry[]} zones
 * @returns {Requirement[]}
 */
function computeRequirements(designs, program, zones) {
  const reqs = [];
  const zoneByKlam = new Map(zones.map((z) => [z.klam, z]));

  KLAM_IDS.forEach((klam, order) => {
    const p = program.find((x) => x.klam === klam);
    const z = zoneByKlam.get(klam);
    if (!p || !z) return;
    let kindRank = 3;
    let subRank = 0;

    // --- quantity (always, when significant) --------------------------------
    if (p.meanShare >= QUANTITY_MIN) {
      const pct = Math.round(p.meanShare * 100);
      const tolPct = Math.round(p.stdShare * 100);
      reqs.push({
        kind: 'quantity',
        klam,
        label: p.label,
        meanShare: p.meanShare,
        stdShare: p.stdShare,
        expectedCells: p.expectedCells,
        region: 'throughout the site',
        cells: [],
        confidence: p.presence,
        tolerance: tolPct,
        text: `${p.label}: provide approximately ${pct}% of the site (±${tolPct}%).`,
        order,
        kindRank: 0,
        subRank: 0,
      });
      kindRank = 0;
    }

    // --- placement (conditional) --------------------------------------------
    if (p.expectedCells >= PLACEMENT_AREA_MIN) {
      const tol = classToleranceZones(designs, klam);
      if (z.concentration >= PLACEMENT_MIN) {
        const share = Math.round(z.concentration * 100);
        reqs.push({
          kind: 'placement',
          klam,
          label: p.label,
          zone: z.dominantZone,
          region: zonePhrase(z.dominantZone),
          concentration: z.concentration,
          flexible: false,
          cells: [],
          confidence: z.concentration,
          tolerance: tol,
          text:
            `${p.label}: concentrate in the ${zonePhrase(z.dominantZone)} ` +
            `(≈${share}% of its area there); tolerance ±${tol} zone${tol === 1 ? '' : 's'}.`,
          order,
          kindRank: 1,
          subRank: 0,
        });
        if (kindRank > 1) kindRank = 1;
      } else {
        reqs.push({
          kind: 'placement',
          klam,
          label: p.label,
          zone: z.dominantZone,
          region: 'throughout the site',
          concentration: z.concentration,
          flexible: true,
          cells: [],
          confidence: 1 - z.concentration,
          tolerance: 0,
          text: `${p.label}: location unrestricted — distribute across the site.`,
          order,
          kindRank: 1,
          subRank: 1,
        });
        if (kindRank > 1) kindRank = 1;
      }
    }

    // --- avoid (program-based) ----------------------------------------------
    if (p.meanShare < AVOID_MAX && kindRank === 3) {
      reqs.push({
        kind: 'avoid',
        klam,
        label: p.label,
        region: 'throughout the site',
        cells: [],
        confidence: Math.max(0, 1 - p.meanShare / AVOID_MAX),
        tolerance: 0,
        text: `Avoid ${p.label}: not part of this design family.`,
        order,
        kindRank: 2,
        subRank: 0,
      });
    }
  });

  reqs.sort((a, b) => {
    if (a.kindRank !== b.kindRank) return a.kindRank - b.kindRank;
    if (a.subRank !== b.subRank) return a.subRank - b.subRank;
    if (a.kindRank === 0) return b.meanShare - a.meanShare || a.order - b.order;
    if (a.kindRank === 1) return b.concentration - a.concentration || a.order - b.order;
    return a.order - b.order;
  });
  return reqs.map(({ order, kindRank, subRank, ...rest }) => rest);
}

/**
 * Compute the per-cell consensus, program and zone statistics, and derived
 * requirements for a cluster of designs. Deterministic: the same designs always
 * yield the same result.
 *
 * @param {Design[]} designs - Designs in the selected archetype cluster.
 * @returns {Consensus}
 */
export function computeConsensus(designs) {
  const list = Array.isArray(designs) ? designs : [];
  const n = list.length;
  const logK = KLAM_IDS.length > 1 ? Math.log(KLAM_IDS.length) : 1;

  /** @type {ConsensusCell[]} */
  const cells = [];

  for (let i = 0; i < CELL_COUNT; i++) {
    const counts = Object.create(null);
    for (const k of KLAM_IDS) counts[k] = 0;

    let hSum = 0;
    let fSum = 0;
    let bCount = 0;

    for (const d of list) {
      const c = d && d.cells ? d.cells[i] : null;
      if (!c) continue;
      if (counts[c.klam] !== undefined) counts[c.klam]++;
      const h = c.height || 0;
      const f = c.footprint || 0;
      hSum += h;
      fSum += f;
      if (h > 0) bCount++;
    }

    const classDist = {};
    let dominant = KLAM_IDS[0];
    let best = -1;
    for (const k of KLAM_IDS) {
      const p = n > 0 ? counts[k] / n : 0;
      classDist[k] = p;
      if (p > best) {
        best = p;
        dominant = k;
      }
    }

    let H = 0;
    for (const k of KLAM_IDS) {
      const p = classDist[k];
      if (p > 0) H -= p * Math.log(p);
    }
    const entropy = n > 0 ? H / logK : 0;

    const heightMean = n > 0 ? hSum / n : 0;
    const footprintMean = n > 0 ? fSum / n : 0;

    let hVar = 0;
    let fVar = 0;
    for (const d of list) {
      const c = d && d.cells ? d.cells[i] : null;
      const h = c ? c.height || 0 : 0;
      const f = c ? c.footprint || 0 : 0;
      hVar += (h - heightMean) * (h - heightMean);
      fVar += (f - footprintMean) * (f - footprintMean);
    }
    const heightStd = n > 0 ? Math.sqrt(hVar / n) : 0;
    const footprintStd = n > 0 ? Math.sqrt(fVar / n) : 0;

    cells.push({
      gx: i % N,
      gy: Math.floor(i / N),
      dominant,
      confidence: best < 0 ? 0 : best,
      classDist,
      entropy,
      heightMean,
      heightStd,
      footprintMean,
      footprintStd,
      buildingFrac: n > 0 ? bCount / n : 0,
    });
  }

  const { program, zones } = computeProgramAndZones(list);
  const requirements = computeRequirements(list, program, zones);

  let confSum = 0;
  let entSum = 0;
  const dominantCounts = Object.create(null);
  for (const k of KLAM_IDS) dominantCounts[k] = 0;
  for (const c of cells) {
    confSum += c.confidence;
    entSum += c.entropy;
    dominantCounts[c.dominant]++;
  }
  const coverage = {};
  for (const k of KLAM_IDS) coverage[k] = dominantCounts[k] / CELL_COUNT;

  const stats = {
    designs: n,
    meanConfidence: CELL_COUNT > 0 ? confSum / CELL_COUNT : 0,
    meanEntropy: CELL_COUNT > 0 ? entSum / CELL_COUNT : 0,
    coverage,
  };

  return { cells, program, zones, requirements, stats };
}

/**
 * Render a consensus as a clean, copy-pasteable plain-text competition brief,
 * grouped into PROGRAM (quantities), PLACEMENT (where) and AVOID sections.
 *
 * @param {Consensus} consensus
 * @param {Archetype} [archetype]
 * @returns {string}
 */
export function formatBrief(consensus, archetype) {
  const stats =
    (consensus && consensus.stats) || { designs: 0, meanConfidence: 0, meanEntropy: 0 };
  const requirements = (consensus && consensus.requirements) || [];
  const a = archetype || {};
  const id = a.id || '?';
  const name = a.name || 'Unnamed archetype';

  const quantity = requirements.filter((r) => r.kind === 'quantity');
  const placement = requirements.filter((r) => r.kind === 'placement');
  const avoid = requirements.filter((r) => r.kind === 'avoid');

  const lines = [];
  lines.push('OpenSKIZZE 2.0 — Planning Brief');
  lines.push(`Archetype: ${id} — ${name} (n = ${stats.designs} designs)`);
  lines.push(
    `Consensus confidence: ${Math.round(stats.meanConfidence * 100)}%   ` +
      `Mean uncertainty: ${stats.meanEntropy.toFixed(2)}`
  );
  lines.push('');
  lines.push('PROGRAM (quantities)');
  if (quantity.length === 0) lines.push('(none)');
  else quantity.forEach((r, i) => lines.push(`${i + 1}. ${r.text}`));
  lines.push('');
  lines.push('PLACEMENT (where)');
  if (placement.length === 0) lines.push('(none)');
  else placement.forEach((r, i) => lines.push(`${i + 1}. ${r.text}`));
  lines.push('');
  lines.push('AVOID');
  if (avoid.length === 0) lines.push('(none)');
  else avoid.forEach((r, i) => lines.push(`${i + 1}. ${r.text}`));
  return lines.join('\n');
}
