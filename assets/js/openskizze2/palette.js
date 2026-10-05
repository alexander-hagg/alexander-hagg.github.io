/**
 * OpenSKIZZE 2.0 — cached per-KLAM isometric colour ramps (R2).
 *
 * Each KLAM class maps to a three-tone ramp used by the isometric renderer:
 * `top` (lightest, lit from the upper-left), `left` (mid-tone) and `right`
 * (darkest). The ramps are plain string constants so the renderer never has to
 * mix colours per building per frame.
 *
 * Pure ES module: no side effects on import, no DOM access, no `Math.random`.
 */

/**
 * @typedef {Object} PaletteRamp
 * @property {string} id - KLAM class id (or 'compat' for ad-hoc ramps).
 * @property {string} top - Lightest face colour (hex).
 * @property {string} left - Mid-tone face colour (hex).
 * @property {string} right - Darkest face colour (hex).
 */

/** @type {Record<string, PaletteRamp>} */
export const PALETTE = {
  KLAM_GRASS:           { id: 'KLAM_GRASS',           top: '#a8e0a8', left: '#6aa86d', right: '#4f8a54' },
  KLAM_FOREST:          { id: 'KLAM_FOREST',          top: '#4fa06b', left: '#276a42', right: '#1c4f31' },
  KLAM_WATER:           { id: 'KLAM_WATER',           top: '#8fd4f0', left: '#3d8fbb', right: '#2c6f93' },
  KLAM_RESIDENTIAL_LOW: { id: 'KLAM_RESIDENTIAL_LOW', top: '#f2c894', left: '#c08f57', right: '#9a7043' },
  KLAM_URBAN_HIGH:      { id: 'KLAM_URBAN_HIGH',      top: '#c3ccd6', left: '#7f8b98', right: '#5f6a76' },
  KLAM_COMMERCIAL:      { id: 'KLAM_COMMERCIAL',      top: '#e2ddd4', left: '#a9a296', right: '#857f74' },
  KLAM_STREET:          { id: 'KLAM_STREET',          top: '#8b93a1', left: '#565d68', right: '#3f454e' },
};

/** @type {Map<string, PaletteRamp>} */
const _cache = new Map();

/**
 * Look up the cached colour ramp for a KLAM class. Unknown ids fall back to
 * the grass ramp. Results are memoised so repeated calls are allocation-free.
 *
 * @param {string} klam - KLAM class id.
 * @returns {PaletteRamp}
 */
export function paletteFor(klam) {
  const key = klam || 'KLAM_GRASS';
  let ramp = _cache.get(key);
  if (!ramp) {
    ramp = PALETTE[key] || PALETTE.KLAM_GRASS;
    _cache.set(key, ramp);
  }
  return ramp;
}
