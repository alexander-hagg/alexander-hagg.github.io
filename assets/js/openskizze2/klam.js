/**
 * OpenSKIZZE 2.0 — KLAM land-use class table and accessors.
 *
 * KLAM ("Klimaangepasste Landnutzung / Anpassungsmaßnahmen") classes describe
 * the physical surface and building properties of a parcel cell.
 *
 * Pure ES module: no side effects, no DOM access.
 */

/**
 * @typedef {Object} KlamClass
 * @property {number} pCold - Cold-air production coefficient (m³/h per m²).
 * @property {number} z0 - Aerodynamic roughness length (m).
 * @property {number} sealed - Sealed fraction 0..1.
 * @property {number} dwellingsPerFloor - Dwellings per floor per cell.
 * @property {number} residentsPerDwelling - Residents per dwelling.
 * @property {string} label - Human-readable label.
 * @property {string} color - Display colour (hex).
 */

/** @type {Record<string, KlamClass>} */
export const KLAM = {
  KLAM_GRASS:            { pCold:12,  z0:0.03,  sealed:0.0, dwellingsPerFloor:0, residentsPerDwelling:0,   label:'Grass / Meadow',    color:'#8fd694' },
  KLAM_FOREST:           { pCold:8,   z0:1.0,   sealed:0.0, dwellingsPerFloor:0, residentsPerDwelling:0,   label:'Forest',            color:'#2f7d4f' },
  KLAM_WATER:            { pCold:14,  z0:0.005, sealed:0.0, dwellingsPerFloor:0, residentsPerDwelling:0,   label:'Water',             color:'#5bb8e8' },
  KLAM_RESIDENTIAL_LOW:  { pCold:4,   z0:0.4,   sealed:0.6, dwellingsPerFloor:4, residentsPerDwelling:2.2, label:'Residential (low)', color:'#e8b06a' },
  KLAM_URBAN_HIGH:       { pCold:0.5, z0:2.5,   sealed:0.9, dwellingsPerFloor:6, residentsPerDwelling:2.0, label:'Urban high-rise',   color:'#9aa7b4' },
  KLAM_COMMERCIAL:       { pCold:0,   z0:1.8,   sealed:1.0, dwellingsPerFloor:0, residentsPerDwelling:0,   label:'Commercial',        color:'#c9c2b6' },
  KLAM_STREET:           { pCold:0,   z0:0.05,  sealed:0.9, dwellingsPerFloor:0, residentsPerDwelling:0,   label:'Street / Plaza',    color:'#6b7280' },
};

/** Ordered list of all KLAM class ids. */
export const KLAM_IDS = Object.keys(KLAM);

/** Valid height (stories) ranges per building class. */
export const HEIGHT_RANGE = {
  KLAM_RESIDENTIAL_LOW: [1, 2],
  KLAM_URBAN_HIGH: [4, 8],
  KLAM_COMMERCIAL: [1, 1],
  KLAM_STREET: [0, 0],
};

/**
 * Class-transition kernel used by block-level mutation: maps a class to a
 * weighted set of plausible neighbour classes. Higher weight = more likely
 * target when a block's land use mutates.
 *
 * @type {Record<string, Record<string, number>>}
 */
export const TRANSITIONS = {
  KLAM_GRASS:           { KLAM_GRASS:3, KLAM_FOREST:2, KLAM_WATER:1, KLAM_RESIDENTIAL_LOW:1 },
  KLAM_FOREST:          { KLAM_FOREST:3, KLAM_GRASS:2, KLAM_WATER:1, KLAM_RESIDENTIAL_LOW:1 },
  KLAM_WATER:           { KLAM_WATER:3, KLAM_GRASS:2, KLAM_FOREST:1, KLAM_RESIDENTIAL_LOW:1 },
  KLAM_RESIDENTIAL_LOW: { KLAM_RESIDENTIAL_LOW:3, KLAM_GRASS:2, KLAM_URBAN_HIGH:1, KLAM_COMMERCIAL:1 },
  KLAM_URBAN_HIGH:      { KLAM_URBAN_HIGH:3, KLAM_RESIDENTIAL_LOW:2, KLAM_COMMERCIAL:1, KLAM_GRASS:1 },
  KLAM_COMMERCIAL:      { KLAM_COMMERCIAL:3, KLAM_URBAN_HIGH:2, KLAM_RESIDENTIAL_LOW:1, KLAM_GRASS:1 },
  KLAM_STREET:          { KLAM_STREET:3, KLAM_GRASS:2, KLAM_RESIDENTIAL_LOW:1 },
};

/**
 * Look up a KLAM class definition.
 *
 * @param {string} id
 * @returns {KlamClass|undefined}
 */
export function getKlam(id) {
  return KLAM[id];
}

/**
 * Height range (stories) for a class. Non-building classes return [0, 0].
 *
 * @param {string} id
 * @returns {[number, number]}
 */
export function heightRangeFor(id) {
  return HEIGHT_RANGE[id] || [0, 0];
}

/**
 * Whether a class represents a building (has a non-zero height range).
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isBuilding(id) {
  const r = HEIGHT_RANGE[id];
  return !!r && r[1] > 0;
}
