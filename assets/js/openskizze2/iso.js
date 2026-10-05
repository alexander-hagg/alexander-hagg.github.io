/**
 * OpenSKIZZE 2.0 — isometric city renderer (R2 graphics upgrade).
 *
 * Renders a parcel as a believable low-poly city: a sky gradient, a soft ground
 * plane, footprint-based building prisms with flat/pitched/stepped roofs,
 * facade banding, contact shadows, ambient occlusion, clustered tree canopies
 * and gradient water. The module stays free of DOM/state coupling (it only
 * reads a canvas' bounding box in `computeGeom` and optionally creates an
 * offscreen canvas for the cached ground layer).
 *
 * Public API preserved for `main.js` / `ui.js` / `airflow.js`:
 *   `isoProject`, `computeGeom`, `drawIsoGround`, `drawIsoBox`,
 *   `renderThumbnail`, `selectedDesign`, `describeCell`, `createIsoViewer`.
 *
 * Pure ES module: no side effects on import, no `Math.random`.
 */

import { N } from './config.js';
import { KLAM, isBuilding } from './klam.js';
import { PALETTE, paletteFor } from './palette.js';

/**
 * Directional light model. The three face tones come from the per-KLAM palette
 * ramp (top lightest, left mid, right darkest); `outline` is the shared
 * silhouette colour.
 */
export const LIGHT = { top: 1.00, left: 0.78, right: 0.55, outline: 'rgba(15,23,42,0.35)' };

/** Height scale as a fraction of tile height (taller, more believable city). */
const HEIGHT_SCALE_FACTOR = 0.7;

/**
 * Elevation of the cold-air streamline layer, in storeys (≈2 m at 3 m/storey).
 *
 * Cold airflow happens in the lowest part of the atmosphere, close to the
 * ground, so the airflow layer is drawn at this low height rather than at
 * building height. It is consumed by `airflow.js` when projecting particles and
 * static streamlines, so they read as flowing through the street canyons at
 * pedestrian level. The value is deliberately small relative to any building
 * (≥1 storey ≈ 3 m).
 *
 * @type {number}
 */
export const COLD_AIR_LAYER_ELEVATION = 2 / 3;

/** Sky gradient stops (top → bottom). */
const SKY_STOPS = ['#0b1220', '#1e293b', '#334155'];

/** Soft contact-shadow layers: `[alpha, offsetFactor]`. */
const SHADOW_LAYERS = [[0.10, 1], [0.07, 1.7], [0.04, 2.4]];

/**
 * Rotate grid coordinates by `o` quarter-turns clockwise about the grid centre.
 * `o` is the iso view orientation (0..3); it is chosen per city so the cold-air
 * direction always projects to a downward screen vector.
 *
 * @param {number} gx
 * @param {number} gy
 * @param {number} o
 * @returns {{x:number,y:number}}
 */
function rotateGrid(gx, gy, o) {
  if (o === 1) return { x: gy, y: N - 1 - gx };
  if (o === 2) return { x: N - 1 - gx, y: N - 1 - gy };
  if (o === 3) return { x: N - 1 - gy, y: gx };
  return { x: gx, y: gy };
}

/**
 * Depth-sorted cell orders for each iso orientation (0..3 quarter-turns CW).
 * Painter's order is by rotated `gx + gy`, then rotated `gx`. Computed once at
 * module load so the renderer never sorts per frame.
 * @type {[number, number][][]}
 */
const DEPTH_ORDERS = (() => {
  const orders = [];
  for (let o = 0; o < 4; o++) {
    const cells = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const r = rotateGrid(gx, gy, o);
        cells.push([gx, gy, r.x + r.y, r.x]);
      }
    }
    cells.sort((a, b) => (a[2] - b[2]) || (a[3] - b[3]));
    orders.push(cells.map((e) => [e[0], e[1]]));
  }
  return orders;
})();

/** Default (unrotated) depth order, used by the static thumbnail renderer. */
const DEPTH_ORDER = DEPTH_ORDERS[0];

/**
 * Project a grid cell + elevation into a reused output object, applying the
 * geometry's iso orientation (see {@link orientationForDir}).
 *
 * @param {number} gx
 * @param {number} gy
 * @param {number} elevation
 * @param {{tileWidth:number,tileHeight:number,originX:number,originY:number,heightScale:number,orientation?:number}} geom
 * @param {{x:number,y:number}} out
 * @returns {{x:number,y:number}}
 */
export function isoProjectInto(gx, gy, elevation, geom, out) {
  const { tileWidth, tileHeight, originX, originY, heightScale } = geom;
  const o = geom.orientation | 0;
  let rx = gx;
  let ry = gy;
  if (o === 1) { rx = gy; ry = N - 1 - gx; }
  else if (o === 2) { rx = N - 1 - gx; ry = N - 1 - gy; }
  else if (o === 3) { rx = N - 1 - gy; ry = gx; }
  out.x = (rx - ry) * (tileWidth / 2) + originX;
  out.y = (rx + ry) * (tileHeight / 2) + originY - elevation * heightScale;
  return out;
}

/**
 * Project a grid cell + elevation to screen coordinates, applying the geometry's
 * iso orientation.
 *
 * @param {number} gx - Grid x (0..N-1).
 * @param {number} gy - Grid y (0..N-1, 0 = North).
 * @param {number} elevation - Vertical offset in screen px (already scaled).
 * @param {{tileWidth:number,tileHeight:number,originX:number,originY:number,heightScale:number,orientation?:number}} geom
 * @returns {{x:number,y:number}}
 */
export function isoProject(gx, gy, elevation, geom) {
  return isoProjectInto(gx, gy, elevation, geom, { x: 0, y: 0 });
}

/**
 * Project a grid position expressed in **cell-centre coordinates** (the centre
 * of cell `(gx,gy)` is `(gx+0.5, gy+0.5)`) to the screen point at the centre of
 * that ground tile, raised by `elevation`.
 *
 * This is the single source of truth for the ground / solution-grid transform
 * shared by the iso ground renderer and the airflow layer. It reuses
 * {@link isoProjectInto} — so it inherits the exact same `geom`, orientation and
 * origin convention — and folds in the two conventions the ground renderer
 * applies on top of the raw projection:
 *   - the `-0.5` shift maps cell-centre coordinates to the cell's reference
 *     corner, which is the coordinate {@link isoProjectInto} expects; and
 *   - the `+tileHeight/2` shift moves the projected reference vertex down to the
 *     diamond's centre (the ground renderer draws every tile centred at
 *     `isoProject(gx,gy,...) + tileHeight/2`).
 *
 * Because both shifts are constant in the rotated frame, and the grid rotation
 * in {@link isoProjectInto} is affine, `projectCell(gx+0.5, gy+0.5, e, geom)` is
 * exactly the centre of ground tile `(gx,gy)` at elevation `e` for **all four
 * orientations** — i.e. the streamline layer sits on the solution grid.
 *
 * @param {number} gx - Grid x in cell-centre units (0.5 .. N-0.5).
 * @param {number} gy - Grid y in cell-centre units (0.5 .. N-0.5).
 * @param {number} elevation - Elevation in storeys (scaled by `heightScale`).
 * @param {{tileWidth:number,tileHeight:number,originX:number,originY:number,heightScale:number,orientation?:number}} geom
 * @param {{x:number,y:number}} out - Reused output object (no allocation).
 * @returns {{x:number,y:number}}
 */
export function projectCellInto(gx, gy, elevation, geom, out) {
  isoProjectInto(gx - 0.5, gy - 0.5, elevation, geom, out);
  out.y += geom.tileHeight / 2;
  return out;
}

/**
 * Allocating convenience wrapper around {@link projectCellInto}.
 *
 * @param {number} gx - Grid x in cell-centre units (0.5 .. N-0.5).
 * @param {number} gy - Grid y in cell-centre units (0.5 .. N-0.5).
 * @param {number} elevation - Elevation in storeys (scaled by `heightScale`).
 * @param {{tileWidth:number,tileHeight:number,originX:number,originY:number,heightScale:number,orientation?:number}} geom
 * @returns {{x:number,y:number}}
 */
export function projectCell(gx, gy, elevation, geom) {
  return projectCellInto(gx, gy, elevation, geom, { x: 0, y: 0 });
}

/**
 * Choose the iso view orientation (0..3 quarter-turns CW) that maps a city's
 * cold-air direction to a downward screen vector. The standard iso basis maps a
 * grid vector `(dx,dy)` to screen `((dx-dy)*w/2, (dx+dy)*h/2)`, so a direction
 * with `dx+dy == 0` (e.g. NE→SW `(-1,1)`) would render as a purely horizontal
 * flow. Rotating the grid basis by 90° fixes this. The orientation with the
 * largest downward component (`dx'+dy'`) wins; ties keep the smallest rotation.
 *
 * @param {{x:number,y:number}} dir - Cold-air direction (grid units, x=east, y=south).
 * @returns {number} Orientation in {0,1,2,3}.
 */
export function orientationForDir(dir) {
  let dx = dir && Number.isFinite(dir.x) ? dir.x : 0;
  let dy = dir && Number.isFinite(dir.y) ? dir.y : 1;
  let bestK = 0;
  let bestSum = -Infinity;
  for (let k = 0; k < 4; k++) {
    const sum = dx + dy;
    if (sum > bestSum) { bestSum = sum; bestK = k; }
    const t = dx; dx = dy; dy = -t; // rotate 90° CW
  }
  return bestK;
}

/** @type {Map<string, object>} */
const _geomCache = new Map();

/**
 * Fit an isometric geometry to a canvas, leaving headroom for the tallest
 * building. Results are cached by canvas size + grid side + max height.
 *
 * @param {HTMLCanvasElement|{getBoundingClientRect?:Function,width?:number,height?:number}} canvas
 * @param {number} n - Grid side length.
 * @param {number} maxHeight - Tallest building in stories.
 * @returns {{tileWidth:number,tileHeight:number,originX:number,originY:number,heightScale:number,width:number,height:number}}
 */
export function computeGeom(canvas, n, maxHeight, orientation) {
  let W = 1;
  let H = 1;
  if (canvas && typeof canvas.getBoundingClientRect === 'function') {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
  } else if (canvas) {
    W = Math.max(1, canvas.width || 1);
    H = Math.max(1, canvas.height || 1);
  }

  const mh = Math.max(0, maxHeight || 0);
  const o = orientation | 0;
  const key = `${W.toFixed(1)}x${H.toFixed(1)}x${n}x${mh}x${o}`;
  const hit = _geomCache.get(key);
  if (hit) return hit;

  const padX = W * 0.06;
  const padY = H * 0.06;
  const availW = Math.max(1, W - padX * 2);
  const availH = Math.max(1, H - padY * 2);

  const twByW = availW / n;
  // usedH = maxHeight*heightScale + n*tileHeight, with heightScale = tileHeight*F
  //       = tileWidth * (F/2*maxHeight + n/2)
  const twByH = availH / (n / 2 + (HEIGHT_SCALE_FACTOR / 2) * mh);
  const tileWidth = Math.max(1, Math.min(twByW, twByH));
  const tileHeight = tileWidth / 2;
  const heightScale = tileHeight * HEIGHT_SCALE_FACTOR;

  const usedH = mh * heightScale + n * tileHeight;
  const originX = W / 2;
  const originY = (H - usedH) / 2 + mh * heightScale;

  const geom = { tileWidth, tileHeight, originX, originY, heightScale, width: W, height: H, orientation: o };
  if (_geomCache.size > 64) _geomCache.clear();
  _geomCache.set(key, geom);
  return geom;
}

// ===========================================================================
// Low-level drawing primitives
// ===========================================================================

/** Trace a diamond centred at `(cx,cy)` with half-extents `(hw,hh)`. */
function diamondAt(ctx, cx, cy, hw, hh) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

/** Trace a ground diamond whose top vertex is `p`. */
function diamondPath(ctx, p, geom) {
  diamondAt(ctx, p.x, p.y + geom.tileHeight / 2, geom.tileWidth / 2, geom.tileHeight / 2);
}

/**
 * Draw a single flat ground tile tinted by its palette ramp (no per-tile
 * stroke — seams are handled by a single low-alpha grid overlay).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number}} p - Top vertex.
 * @param {object} geom
 * @param {{top:string}} palette
 */
function drawTile(ctx, p, geom, palette) {
  diamondPath(ctx, p, geom);
  ctx.fillStyle = palette.top;
  ctx.fill();
}

/**
 * Draw a single grid overlay at low alpha (replaces per-tile strokes).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom
 */
function drawGridOverlay(ctx, geom) {
  ctx.save();
  ctx.strokeStyle = 'rgba(15,23,42,0.12)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= N; i++) {
    const a = isoProject(i, 0, 0, geom);
    const b = isoProject(i, N, 0, geom);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const c = isoProject(0, i, 0, geom);
    const d = isoProject(N, i, 0, geom);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw a water tile: linear gradient fill + specular highlight. Ripples are
 * drawn separately (see `drawWaterRipples`) so the base can be cached.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} gx
 * @param {number} gy
 * @param {object} geom
 * @param {{top:string,right:string}} palette
 */
function drawWater(ctx, gx, gy, geom, palette) {
  const p = isoProject(gx, gy, 0, geom);
  const { tileWidth: tw, tileHeight: th } = geom;
  const cx = p.x;
  const cy = p.y + th / 2;

  const g = ctx.createLinearGradient(cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2);
  g.addColorStop(0, palette.top);
  g.addColorStop(1, palette.right);
  diamondAt(ctx, cx, cy, tw / 2, th / 2);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#eaf7ff';
  ctx.beginPath();
  ctx.ellipse(cx - tw * 0.12, cy - th * 0.12, tw * 0.16, th * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw subtle animated ripple lines on a water tile.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} gx
 * @param {number} gy
 * @param {object} geom
 * @param {number} phase - 0..1 animation phase.
 */
function drawWaterRipples(ctx, gx, gy, geom, phase) {
  const p = isoProject(gx, gy, 0, geom);
  const { tileWidth: tw, tileHeight: th } = geom;
  const cx = p.x;
  const cy = p.y + th / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 2; k++) {
    const off = ((phase + k * 0.5) % 1) * th * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - tw * 0.22, cy - th * 0.1 + off);
    ctx.lineTo(cx + tw * 0.22, cy - th * 0.1 + off);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw 3–5 overlapping low-poly canopy blobs with 2-tone shading and a trunk.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} gx
 * @param {number} gy
 * @param {object} geom
 * @param {number} seed - Per-cell deterministic seed.
 */
function drawTrees(ctx, gx, gy, geom, seed) {
  const p = isoProject(gx, gy, 0, geom);
  const { tileWidth: tw, tileHeight: th } = geom;
  const cx = p.x;
  const cy = p.y + th / 2;

  // Trunk.
  const trunkH = th * 0.18;
  ctx.fillStyle = '#5b4636';
  ctx.fillRect(cx - tw * 0.02, cy - trunkH, tw * 0.04, trunkH);

  const blobs = 3 + (seed % 3); // 3..5
  for (let b = 0; b < blobs; b++) {
    const a = ((seed * 7 + b * 13) % 100) / 100;
    const c = ((seed * 3 + b * 5) % 100) / 100;
    const bx = cx + (a - 0.5) * tw * 0.42;
    const by = cy - th * 0.1 + (c - 0.5) * th * 0.3;
    const r = tw * (0.10 + ((seed + b) % 3) * 0.015);

    // Dark bottom-right lobe.
    ctx.beginPath();
    ctx.arc(bx + r * 0.15, by + r * 0.15, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1c4f31';
    ctx.fill();

    // Light top-left lobe.
    ctx.beginPath();
    ctx.arc(bx - r * 0.12, by - r * 0.12, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = '#4fa06b';
    ctx.fill();
  }
}

// ===========================================================================
// Building prisms
// ===========================================================================

/**
 * Draw the soft layered contact shadow under a footprint diamond.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} hw
 * @param {number} hh
 * @param {number} tw
 * @param {number} th
 */
function drawContactShadow(ctx, cx, cy, hw, hh, tw, th) {
  const sx = tw * 0.14;
  const sy = th * 0.14;
  ctx.save();
  ctx.fillStyle = '#000';
  for (let i = 0; i < SHADOW_LAYERS.length; i++) {
    const alpha = SHADOW_LAYERS[i][0];
    const off = SHADOW_LAYERS[i][1];
    ctx.globalAlpha = alpha;
    diamondAt(ctx, cx + sx * off, cy + sy * off, hw, hh);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw horizontal floor lines on the left/right faces.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number}} L
 * @param {{x:number,y:number}} B
 * @param {{x:number,y:number}} R
 * @param {number} baseE
 * @param {number} topE
 * @param {number} height
 */
function drawFacadeBands(ctx, L, B, R, baseE, topE, height) {
  const bands = Math.min(4, Math.max(0, Math.floor(height) - 1));
  if (bands <= 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(15,23,42,0.22)';
  ctx.lineWidth = 1;
  for (let k = 1; k <= bands; k++) {
    const e = baseE + (topE - baseE) * (k / (bands + 1));
    ctx.beginPath();
    ctx.moveTo(L.x, L.y - e);
    ctx.lineTo(B.x, B.y - e);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(B.x, B.y - e);
    ctx.lineTo(R.x, R.y - e);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Darken the base of the left/right faces (contact darkening).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number}} L
 * @param {{x:number,y:number}} B
 * @param {{x:number,y:number}} R
 * @param {number} baseE
 * @param {number} topE
 */
function drawContactDarkening(ctx, L, B, R, baseE, topE) {
  const bandH = (topE - baseE) * 0.16;
  if (bandH <= 0.5) return;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(L.x, L.y - baseE);
  ctx.lineTo(B.x, B.y - baseE);
  ctx.lineTo(B.x, B.y - baseE - bandH);
  ctx.lineTo(L.x, L.y - baseE - bandH);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(B.x, B.y - baseE);
  ctx.lineTo(R.x, R.y - baseE);
  ctx.lineTo(R.x, R.y - baseE - bandH);
  ctx.lineTo(B.x, B.y - baseE - bandH);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the three faces of a prism between two elevations, plus facade banding,
 * contact darkening and a silhouette outline.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} hw
 * @param {number} hh
 * @param {number} baseE
 * @param {number} topE
 * @param {{id?:string,top:string,left:string,right:string}} palette
 * @param {number} height
 * @param {boolean} band - Whether to draw facade floor lines.
 */
function drawPrismBody(ctx, cx, cy, hw, hh, baseE, topE, palette, height, band) {
  const T = { x: cx, y: cy - hh };
  const R = { x: cx + hw, y: cy };
  const B = { x: cx, y: cy + hh };
  const L = { x: cx - hw, y: cy };

  // Left face (mid-tone).
  ctx.beginPath();
  ctx.moveTo(L.x, L.y - topE);
  ctx.lineTo(B.x, B.y - topE);
  ctx.lineTo(B.x, B.y - baseE);
  ctx.lineTo(L.x, L.y - baseE);
  ctx.closePath();
  ctx.fillStyle = palette.left;
  ctx.fill();

  // Right face (darkest).
  ctx.beginPath();
  ctx.moveTo(B.x, B.y - topE);
  ctx.lineTo(R.x, R.y - topE);
  ctx.lineTo(R.x, R.y - baseE);
  ctx.lineTo(B.x, B.y - baseE);
  ctx.closePath();
  ctx.fillStyle = palette.right;
  ctx.fill();

  // Top face (lightest).
  ctx.beginPath();
  ctx.moveTo(T.x, T.y - topE);
  ctx.lineTo(R.x, R.y - topE);
  ctx.lineTo(B.x, B.y - topE);
  ctx.lineTo(L.x, L.y - topE);
  ctx.closePath();
  ctx.fillStyle = palette.top;
  ctx.fill();

  const isCommercial = palette.id === 'KLAM_COMMERCIAL';
  if (band && height > 1 && !isCommercial) {
    drawFacadeBands(ctx, L, B, R, baseE, topE, height);
  }
  drawContactDarkening(ctx, L, B, R, baseE, topE);

  // Silhouette outline.
  ctx.beginPath();
  ctx.moveTo(L.x, L.y - baseE);
  ctx.lineTo(L.x, L.y - topE);
  ctx.lineTo(T.x, T.y - topE);
  ctx.lineTo(R.x, R.y - topE);
  ctx.lineTo(R.x, R.y - baseE);
  ctx.lineTo(B.x, B.y - baseE);
  ctx.closePath();
  ctx.strokeStyle = LIGHT.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Draw a 1–2 px parapet outline on a flat top face.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} hw
 * @param {number} hh
 * @param {number} e
 */
function drawParapet(ctx, cx, cy, hw, hh, e) {
  diamondAt(ctx, cx, cy - e, hw, hh);
  ctx.strokeStyle = 'rgba(15,23,42,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Draw a gable roof: two slopes meeting at a raised ridge.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} hw
 * @param {number} hh
 * @param {number} e
 * @param {{top:string,left:string}} palette
 */
function drawPitchedRoof(ctx, cx, cy, hw, hh, e, palette) {
  const ridgeH = hh * 0.8;
  const T = { x: cx, y: cy - hh - e };
  const R = { x: cx + hw, y: cy - e };
  const B = { x: cx, y: cy + hh - e };
  const L = { x: cx - hw, y: cy - e };
  const midLT = { x: (L.x + T.x) / 2, y: (L.y + T.y) / 2 - ridgeH };
  const midRB = { x: (R.x + B.x) / 2, y: (R.y + B.y) / 2 - ridgeH };

  // South-west slope (darker).
  ctx.beginPath();
  ctx.moveTo(L.x, L.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(midRB.x, midRB.y);
  ctx.lineTo(midLT.x, midLT.y);
  ctx.closePath();
  ctx.fillStyle = palette.left;
  ctx.fill();

  // North-east slope (lighter).
  ctx.beginPath();
  ctx.moveTo(T.x, T.y);
  ctx.lineTo(R.x, R.y);
  ctx.lineTo(midRB.x, midRB.y);
  ctx.lineTo(midLT.x, midLT.y);
  ctx.closePath();
  ctx.fillStyle = palette.top;
  ctx.fill();

  // Ridge line.
  ctx.beginPath();
  ctx.moveTo(midLT.x, midLT.y);
  ctx.lineTo(midRB.x, midRB.y);
  ctx.strokeStyle = 'rgba(15,23,42,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Draw a stepped (setback) building as 2–3 stacked prisms with decreasing
 * footprint and height.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} hw
 * @param {number} hh
 * @param {number} e
 * @param {{id?:string,top:string,left:string,right:string}} palette
 * @param {number} height
 */
function drawStepped(ctx, cx, cy, hw, hh, e, palette, height) {
  const levels = [
    { fp: 1.0, h: 0.5 },
    { fp: 0.75, h: 0.3 },
    { fp: 0.5, h: 0.2 },
  ];
  let baseE = 0;
  for (let i = 0; i < levels.length; i++) {
    const lhw = hw * levels[i].fp;
    const lhh = hh * levels[i].fp;
    const topE = baseE + e * levels[i].h;
    drawPrismBody(ctx, cx, cy, lhw, lhh, baseE, topE, palette, height, i === 0);
    drawParapet(ctx, cx, cy, lhw, lhh, topE);
    baseE = topE;
  }
}

/**
 * Draw a footprint-based building prism with roof, parapet, facade banding,
 * soft contact shadow and silhouette outline.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} gx
 * @param {number} gy
 * @param {number} height - Building height in stories.
 * @param {number} footprint - Footprint fraction 0..1.
 * @param {string} roofType - 'flat' | 'pitched' | 'stepped'.
 * @param {object} geom
 * @param {{id?:string,top:string,left:string,right:string}} palette
 */
export function drawIsoPrism(ctx, gx, gy, height, footprint, roofType, geom, palette) {
  if (!(height > 0)) return;
  const { tileWidth: tw, tileHeight: th, heightScale } = geom;
  const p = isoProject(gx, gy, 0, geom);
  const cx = p.x;
  const cy = p.y + th / 2;

  const fp = Math.max(0.15, Math.min(1, footprint || 0.6));
  const inset = (1 - fp) / 2;
  const hw = (tw / 2) * (1 - inset);
  const hh = (th / 2) * (1 - inset);
  const e = height * heightScale;

  drawContactShadow(ctx, cx, cy, hw, hh, tw, th);

  if (roofType === 'stepped') {
    drawStepped(ctx, cx, cy, hw, hh, e, palette, height);
  } else {
    drawPrismBody(ctx, cx, cy, hw, hh, 0, e, palette, height, true);
    if (roofType === 'pitched') drawPitchedRoof(ctx, cx, cy, hw, hh, e, palette);
    else drawParapet(ctx, cx, cy, hw, hh, e);
  }
}

/**
 * Compatibility wrapper: draw a full-cell flat-roofed prism. Prefer
 * {@link drawIsoPrism} for new code.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} gx
 * @param {number} gy
 * @param {number} height
 * @param {object} geom
 * @param {{top?:string,left?:string,right?:string}} [colors]
 */
export function drawIsoBox(ctx, gx, gy, height, geom, colors) {
  const palette = {
    id: 'compat',
    top: (colors && colors.top) || '#e8f2f5',
    left: (colors && colors.left) || '#9ab0bb',
    right: (colors && colors.right) || '#6f8590',
  };
  drawIsoPrism(ctx, gx, gy, height, 1, 'flat', geom, palette);
}

// ===========================================================================
// Environment (sky, ground plane, vignette)
// ===========================================================================

/**
 * Build the environment gradients for a geometry. Reused across frames when
 * cached by the caller.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom
 * @returns {{sky:CanvasGradient,horizon:CanvasGradient,ground:CanvasGradient,vignette:CanvasGradient}}
 */
function makeEnvGradients(ctx, geom) {
  const { width: W, height: H, originX, originY, tileWidth: tw, tileHeight: th } = geom;

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, SKY_STOPS[0]);
  sky.addColorStop(0.55, SKY_STOPS[1]);
  sky.addColorStop(1, SKY_STOPS[2]);

  const hy = originY + (N * th) / 2;
  const horizon = ctx.createLinearGradient(0, hy - H * 0.12, 0, hy + H * 0.12);
  horizon.addColorStop(0, 'rgba(148,163,184,0)');
  horizon.addColorStop(0.5, 'rgba(148,163,184,0.14)');
  horizon.addColorStop(1, 'rgba(148,163,184,0)');

  const gcx = originX;
  const gcy = originY + (N * th) / 2;
  const ground = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, Math.max(W, H) * 0.6);
  ground.addColorStop(0, 'rgba(30,41,59,0.55)');
  ground.addColorStop(1, 'rgba(15,23,42,0)');

  const vignette = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.25,
    W / 2, H / 2, Math.max(W, H) * 0.75
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.45)');

  return { sky, horizon, ground, vignette };
}

/** Fill the sky gradient and a faint horizon glow band. */
function drawSky(ctx, geom, env) {
  ctx.fillStyle = env.sky;
  ctx.fillRect(0, 0, geom.width, geom.height);
  const hy = geom.originY + (N * geom.tileHeight) / 2;
  ctx.fillStyle = env.horizon;
  ctx.fillRect(0, hy - geom.height * 0.12, geom.width, geom.height * 0.24);
}

/** Draw a large soft ground diamond with a whole-parcel drop shadow. */
function drawGroundPlane(ctx, geom, env) {
  const { tileWidth: tw, tileHeight: th, originX, originY } = geom;
  const cx = originX;
  const cy = originY + (N * th) / 2;
  const hw = ((N * tw) / 2) * 1.18;
  const hh = ((N * th) / 2) * 1.18;

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  diamondAt(ctx, cx + tw * 0.5, cy + th * 0.5, hw, hh);
  ctx.fill();
  ctx.restore();

  diamondAt(ctx, cx, cy, hw, hh);
  ctx.fillStyle = env.ground;
  ctx.fill();
}

// ===========================================================================
// Ground layer
// ===========================================================================

/**
 * Whether a cell is a repurposed rail cell.
 * @param {object} design
 * @param {number} gx
 * @param {number} gy
 * @returns {boolean}
 */
function railAt(design, gx, gy) {
  if (gx < 0 || gx >= N || gy < 0 || gy >= N) return false;
  const c = design.cells[gy * N + gx];
  return !!(c && c.rail);
}

/**
 * Draw subtle rail detail (sleepers + twin rails) on a repurposed rail cell so
 * the retained rail corridor reads as a railway. Direction is inferred from rail
 * neighbours so E–W and N–S tracks render correctly.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} gx
 * @param {number} gy
 * @param {object} geom
 * @param {object} design
 */
function drawRailDetail(ctx, gx, gy, geom, design) {
  const p = isoProject(gx, gy, 0, geom);
  const { tileWidth: tw, tileHeight: th } = geom;
  const cx = p.x;
  const cy = p.y + th / 2;
  const horizontal = railAt(design, gx - 1, gy) || railAt(design, gx + 1, gy);

  // Screen-space track direction from the projected neighbour cell, so the
  // detail follows the iso orientation.
  const a = isoProject(gx, gy, 0, geom);
  const b = horizontal ? isoProject(gx + 1, gy, 0, geom) : isoProject(gx, gy + 1, 0, geom);
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  const tlen = Math.hypot(tx, ty) || 1;
  const ux = tx / tlen;
  const uy = ty / tlen;
  const px = -uy;
  const py = ux;
  const half = tlen * 0.34;
  const tieLen = tlen * 0.20;

  ctx.save();
  // Sleepers (ties).
  ctx.strokeStyle = 'rgba(30,41,59,0.72)';
  ctx.lineWidth = Math.max(0.8, tw * 0.032);
  for (let k = -1; k <= 1; k++) {
    const bx = cx + ux * half * k;
    const by = cy + uy * half * k;
    ctx.beginPath();
    ctx.moveTo(bx - px * tieLen, by - py * tieLen);
    ctx.lineTo(bx + px * tieLen, by + py * tieLen);
    ctx.stroke();
  }
  // Twin rails.
  ctx.strokeStyle = 'rgba(226,232,240,0.55)';
  ctx.lineWidth = Math.max(0.6, tw * 0.018);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx - ux * half + px * tieLen * 0.55 * s, cy - uy * half + py * tieLen * 0.55 * s);
    ctx.lineTo(cx + ux * half + px * tieLen * 0.55 * s, cy + uy * half + py * tieLen * 0.55 * s);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw the static ground layer: tiles, water, rail detail, ambient occlusion
 * and the grid overlay. Suitable for caching to an offscreen canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} design
 * @param {object} geom
 * @param {Float32Array} ao
 */
function drawGroundLayer(ctx, design, geom, ao) {
  for (let s = 0; s <= 2 * (N - 1); s++) {
    for (let gx = 0; gx < N; gx++) {
      const gy = s - gx;
      if (gy < 0 || gy >= N) continue;
      const i = gy * N + gx;
      const cell = design.cells[i];
      const palette = paletteFor(cell.klam);
      const p = isoProject(gx, gy, 0, geom);

      if (cell.klam === 'KLAM_WATER') {
        drawWater(ctx, gx, gy, geom, palette);
      } else {
        drawTile(ctx, p, geom, palette);
      }

      if (cell.rail) drawRailDetail(ctx, gx, gy, geom, design);

      if (ao[i] > 0) {
        diamondPath(ctx, p, geom);
        ctx.globalAlpha = ao[i];
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  drawGridOverlay(ctx, geom);
}

/**
 * Draw the 10×10 ground tiles in painter's order. Kept for API compatibility;
 * the viewer uses the cached {@link drawGroundLayer} path.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} design
 * @param {object} geom
 */
export function drawIsoGround(ctx, design, geom) {
  for (let s = 0; s <= 2 * (N - 1); s++) {
    for (let gx = 0; gx < N; gx++) {
      const gy = s - gx;
      if (gy < 0 || gy >= N) continue;
      const cell = design.cells[gy * N + gx];
      const palette = paletteFor(cell.klam);
      const p = isoProject(gx, gy, 0, geom);
      if (cell.klam === 'KLAM_WATER') drawWater(ctx, gx, gy, geom, palette);
      else drawTile(ctx, p, geom, palette);
      if (cell.rail) drawRailDetail(ctx, gx, gy, geom, design);
    }
  }
  drawGridOverlay(ctx, geom);
}

/**
 * Cheap deterministic signature of a design's structure, used to invalidate the
 * cached ground layer when the retained infrastructure changes.
 * @param {object} design
 * @returns {string}
 */
function structureKey(design) {
  const s = design && design.structure;
  if (!s) return '';
  const lines = (arr) => (arr || [])
    .map((l) => `${l.axis}:${l.x == null ? '' : l.x}:${l.y == null ? '' : l.y}:${l.from}:${l.to}`)
    .join(',');
  return `${lines(s.rails)}|${lines(s.roads)}|${JSON.stringify(s.greenCorridor || null)}|${JSON.stringify(s.existingBlocks || [])}`;
}

// ===========================================================================
// Thumbnail
// ===========================================================================

/**
 * Convenience: draw a complete static scene (sky, ground, buildings, trees,
 * water, vignette) into `ctx`. Used by the Phase-2 preview and archive
 * thumbnails.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} design
 * @param {object} geom
 */
export function renderThumbnail(ctx, design, geom) {
  ctx.clearRect(0, 0, geom.width, geom.height);
  const env = makeEnvGradients(ctx, geom);
  drawSky(ctx, geom, env);
  drawGroundPlane(ctx, geom, env);

  const ao = computeAO(design);
  drawGroundLayer(ctx, design, geom, ao);

  // Static water ripples.
  for (let s = 0; s <= 2 * (N - 1); s++) {
    for (let gx = 0; gx < N; gx++) {
      const gy = s - gx;
      if (gy < 0 || gy >= N) continue;
      if (design.cells[gy * N + gx].klam === 'KLAM_WATER') drawWaterRipples(ctx, gx, gy, geom, 0);
    }
  }

  // Depth-sorted buildings + trees.
  for (const [gx, gy] of DEPTH_ORDER) {
    const cell = design.cells[gy * N + gx];
    if (cell.klam === 'KLAM_FOREST') {
      drawTrees(ctx, gx, gy, geom, gy * N + gx);
      continue;
    }
    if (!isBuilding(cell.klam) || cell.height <= 0) continue;
    drawIsoPrism(ctx, gx, gy, cell.height, cell.footprint, cell.roofType, geom, paletteFor(cell.klam));
  }

  ctx.fillStyle = env.vignette;
  ctx.fillRect(0, 0, geom.width, geom.height);
}

/**
 * Draw a subtle wind-direction compass in the iso viewer corner. The arrow is
 * oriented to the city's `coldAir.dir` (rotated into the iso view basis) and
 * labelled with `coldAir.label`, so the cue is consistent with the macro-map
 * arrow and the streamlines.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom
 * @param {boolean} isStatic - True under reduced motion (no pulse).
 * @param {number} now - Animation clock (ms).
 * @param {{x:number,y:number}} dir - Cold-air direction (grid units).
 * @param {string} [label] - Human-readable direction label (e.g. 'NE → SW').
 */
function drawWindCue(ctx, geom, isStatic, now, dir, label) {
  const radius = Math.max(15, Math.min(24, geom.width * 0.032));
  const cx = 16 + radius;
  const cy = 16 + radius;
  ctx.save();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15,23,42,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Rotate the grid direction into the iso view basis (same rotation as the
  // projection), then map it through the iso basis to a screen vector.
  const o = geom.orientation | 0;
  let dx = dir && Number.isFinite(dir.x) ? dir.x : 0;
  let dy = dir && Number.isFinite(dir.y) ? dir.y : 1;
  for (let k = 0; k < o; k++) { const t = dx; dx = dy; dy = -t; }
  const dirX = (dx - dy) * (geom.tileWidth / 2);
  const dirY = (dx + dy) * (geom.tileHeight / 2);
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  const pulse = isStatic ? 1 : 0.85 + 0.15 * Math.sin(now / 600);
  const ax = cx + ux * radius * 0.58;
  const ay = cy + uy * radius * 0.58;

  ctx.strokeStyle = 'rgba(56,189,248,0.95)';
  ctx.fillStyle = 'rgba(56,189,248,0.95)';
  ctx.lineWidth = 2 * pulse;
  ctx.beginPath();
  ctx.moveTo(cx - ux * radius * 0.5, cy - uy * radius * 0.5);
  ctx.lineTo(ax, ay);
  ctx.stroke();

  const hx = -uy;
  const hy = ux;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - ux * 5 + hx * 4, ay - uy * 5 + hy * 4);
  ctx.lineTo(ax - ux * 5 - hx * 4, ay - uy * 5 - hy * 4);
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, cy + radius + 3);
  }
  ctx.restore();
}

// ===========================================================================
// Full isometric viewer
// ===========================================================================

/**
 * Resolve the currently selected design from app state. Archive bins hold
 * `{design, fitness, bx, by}` wrappers in Phases 2–3; falls back to the
 * archive best when the id is missing.
 *
 * @param {object} state
 * @returns {object|null}
 */
export function selectedDesign(state) {
  const id = state && state.selectedDesignId;
  const bins = state && state.archive && state.archive.bins ? state.archive.bins : [];
  if (id != null) {
    for (const b of bins) {
      if (b && b.design && b.design.id === id) return b.design;
    }
  }
  if (state && state.archive && state.archive.best) return state.archive.best.design;
  return null;
}

/** Tallest building in a design (stories). @param {object} design @returns {number} */
function maxHeightOf(design) {
  let m = 1;
  for (const c of design.cells) if (c.height > m) m = c.height;
  return m;
}

/**
 * Per-cell ambient-occlusion alpha from the sum of neighbour building heights.
 * @param {object} design
 * @returns {Float32Array}
 */
function computeAO(design) {
  const out = new Float32Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      let sum = 0;
      if (gx + 1 < N) sum += design.cells[gy * N + gx + 1].height;
      if (gx - 1 >= 0) sum += design.cells[gy * N + gx - 1].height;
      if (gy + 1 < N) sum += design.cells[(gy + 1) * N + gx].height;
      if (gy - 1 >= 0) sum += design.cells[(gy - 1) * N + gx].height;
      out[gy * N + gx] = 0.22 * Math.min(1, sum / 8);
    }
  }
  return out;
}

/**
 * Describe a cell for the hover tooltip.
 *
 * @param {object} design
 * @param {number} gx
 * @param {number} gy
 * @returns {{klam:string,label:string,z0:number,height:number}|null}
 */
export function describeCell(design, gx, gy) {
  if (!design || gx < 0 || gx >= N || gy < 0 || gy >= N) return null;
  const cell = design.cells[gy * N + gx];
  const klam = KLAM[cell.klam] || KLAM.KLAM_GRASS;
  return { klam: cell.klam, label: klam.label, z0: klam.z0, height: cell.height };
}

/**
 * Create an offscreen canvas, or `null` when unavailable (e.g. headless).
 * @param {number} w
 * @param {number} h
 * @returns {HTMLCanvasElement|OffscreenCanvas|null}
 */
function makeOffscreen(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(w, h);
    } catch (e) {
      // fall through to DOM canvas
    }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/**
 * Create the full Phase-3 isometric viewer.
 *
 * Renders the selected design with a sky/ground environment, a cached ground
 * layer, depth-sorted footprint prisms, ambient occlusion, forest canopies,
 * gradient water, optional cold-pool and airflow layers, and a prism hover
 * highlight. Delegates airflow drawing to an injected `airflow` controller
 * (back pass before buildings, front pass after).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{store?:object, airflow?:object, reducedMotion?:boolean}} [opts]
 * @returns {{
 *   resize:()=>void,
 *   render:(state:object, now?:number)=>void,
 *   hitTest:(mx:number,my:number)=>({gx:number,gy:number}|null),
 *   onPointerMove:(mx:number,my:number)=>({gx:number,gy:number}|null),
 *   onPointerLeave:()=>void,
 *   cellScreenPos:(gx:number,gy:number)=>({x:number,y:number}|null),
 *   onKeyDown:(key:string)=>boolean,
 *   setWind:(dir:{x:number,y:number}, label?:string)=>void
 * }}
 */
export function createIsoViewer(canvas, opts = {}) {
  const store = opts.store || null;
  const airflow = opts.airflow || null;
  const ctx = canvas.getContext('2d');

  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let lastGeom = null;

  /** False while the canvas is hidden/zero-sized (skip all rendering). */
  let hasSize = false;

  /** Per-design derived-buffer caches (avoids per-frame reallocation). */
  let aoCacheRef = null;
  let aoCache = null;

  /** Cached environment gradients, keyed by canvas size. */
  let envCache = null;
  let envKey = '';

  /** Cached static ground layer (offscreen canvas), keyed by design + size. */
  let groundCache = null;

  /** City cold-air direction + label driving the iso orientation and wind cue. */
  let windDir = { x: 0, y: 1 };
  let windLabel = '';

  const motionMQL = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  /** Whether reduced motion is requested (static, no ripples). */
  function reducedMotion() {
    if (opts.reducedMotion) return true;
    return !!(motionMQL && motionMQL.matches);
  }

  /**
   * Set the city's cold-air direction and label. The direction selects the iso
   * view orientation (so the flow reads downhill) and orients the wind cue.
   * @param {{x:number,y:number}} dir
   * @param {string} [label]
   */
  function setWind(dir, label) {
    windDir = dir && Number.isFinite(dir.x) && Number.isFinite(dir.y)
      ? { x: dir.x, y: dir.y }
      : { x: 0, y: 1 };
    windLabel = label || '';
  }

  /** DPR-aware resize (cap 2). */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    hasSize = rect.width > 0 && rect.height > 0;
    dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    groundCache = null;
    envCache = null;
  }

  /**
   * Return the cached static ground layer for a design, building it if needed.
   * @param {object} design
   * @param {object} geom
   * @param {Float32Array} ao
   * @returns {{canvas:object}|null}
   */
  function getGroundLayer(design, geom, ao) {
    const sizeKey = `${Math.round(geom.width)}x${Math.round(geom.height)}x${dpr}x${geom.orientation | 0}`;
    if (groundCache && groundCache.designRef === design && groundCache.sizeKey === sizeKey) {
      return groundCache;
    }
    const structKey = structureKey(design);
    const off = makeOffscreen(Math.round(geom.width * dpr), Math.round(geom.height * dpr));
    if (!off) return null;
    const octx = off.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, geom.width, geom.height);
    drawGroundLayer(octx, design, geom, ao);
    groundCache = { canvas: off, designRef: design, sizeKey, structKey };
    return groundCache;
  }

  /**
   * Render one frame.
   * @param {object} state
   * @param {number} [now]
   */
  function render(state, now) {
    if (!hasSize) return;
    ctx.clearRect(0, 0, cssW, cssH);
    const design = selectedDesign(state);
    if (!design) return;

    const orientation = orientationForDir(windDir);
    const geom = computeGeom(canvas, N, maxHeightOf(design), orientation);
    lastGeom = geom;
    const layers = state.layers || {};

    // --- Environment --------------------------------------------------------
    const key = `${Math.round(geom.width)}x${Math.round(geom.height)}`;
    if (!envCache || envKey !== key) {
      envCache = makeEnvGradients(ctx, geom);
      envKey = key;
    }
    drawSky(ctx, geom, envCache);
    drawGroundPlane(ctx, geom, envCache);

    // --- Derived buffers (cached by design identity) ------------------------
    if (design !== aoCacheRef) {
      aoCacheRef = design;
      aoCache = computeAO(design);
    }
    const ao = aoCache;

    // --- Ground layer (cached offscreen, else direct) -----------------------
    const gl = getGroundLayer(design, geom, ao);
    if (gl) {
      ctx.drawImage(gl.canvas, 0, 0, cssW, cssH);
    } else {
      drawGroundLayer(ctx, design, geom, ao);
    }

    // --- Animated water ripples (gated on reduced motion) -------------------
    if (!reducedMotion()) {
      const phase = ((now || 0) / 2000) % 1;
      for (let s = 0; s <= 2 * (N - 1); s++) {
        for (let gx = 0; gx < N; gx++) {
          const gy = s - gx;
          if (gy < 0 || gy >= N) continue;
          if (design.cells[gy * N + gx].klam === 'KLAM_WATER') {
            drawWaterRipples(ctx, gx, gy, geom, phase);
          }
        }
      }
    }

    // --- Cold-pool fog (unified with the airflow pooling visual language) ---
    if (layers.coldPool && airflow && typeof airflow.renderPool === 'function') {
      airflow.renderPool(ctx, geom, state);
    }

    // --- Airflow background pass --------------------------------------------
    if (layers.airflow && airflow) airflow.render(ctx, geom, state, 'back');

    // --- Buildings + trees (depth-sorted painter's order) -------------------
    for (const [gx, gy] of DEPTH_ORDERS[orientation]) {
      const cell = design.cells[gy * N + gx];
      if (cell.klam === 'KLAM_FOREST') {
        drawTrees(ctx, gx, gy, geom, gy * N + gx);
        continue;
      }
      if (!isBuilding(cell.klam) || cell.height <= 0) continue;
      drawIsoPrism(ctx, gx, gy, cell.height, cell.footprint, cell.roofType, geom, paletteFor(cell.klam));
    }

    // --- Airflow foreground pass --------------------------------------------
    if (layers.airflow && airflow) airflow.render(ctx, geom, state, 'front');

    // --- Hover highlight (prism outline, not just the ground diamond) -------
    const hov = state.hoveredCell;
    if (hov && hov.gx >= 0 && hov.gx < N && hov.gy >= 0 && hov.gy < N) {
      const cell = design.cells[hov.gy * N + hov.gx];
      const p = isoProject(hov.gx, hov.gy, 0, geom);
      const cx = p.x;
      const cy = p.y + geom.tileHeight / 2;
      ctx.save();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      if (isBuilding(cell.klam) && cell.height > 0) {
        const fp = Math.max(0.15, Math.min(1, cell.footprint || 0.6));
        const inset = (1 - fp) / 2;
        const hw = (geom.tileWidth / 2) * (1 - inset);
        const hh = (geom.tileHeight / 2) * (1 - inset);
        const e = cell.height * geom.heightScale;
        diamondAt(ctx, cx, cy, hw, hh);
        ctx.stroke();
        diamondAt(ctx, cx, cy - e, hw, hh);
        ctx.stroke();
      } else {
        diamondAt(ctx, cx, cy, geom.tileWidth / 2, geom.tileHeight / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- Vignette -----------------------------------------------------------
    ctx.fillStyle = envCache.vignette;
    ctx.fillRect(0, 0, cssW, cssH);

    // --- Wind-direction cue -------------------------------------------------
    drawWindCue(ctx, geom, reducedMotion(), now || 0, windDir, windLabel);
  }

  /**
   * Inverse-project a CSS-pixel point to a grid cell.
   * @param {number} mx
   * @param {number} my
   * @returns {{gx:number,gy:number}|null}
   */
  function hitTest(mx, my) {
    if (!lastGeom) return null;
    const { tileWidth: tw, tileHeight: th, originX, originY } = lastGeom;
    const o = lastGeom.orientation | 0;
    const dx = mx - originX;
    const dy = my - originY;
    const rx = dx / tw + dy / th;
    const ry = dy / th - dx / tw;
    let gx;
    let gy;
    if (o === 1) { gx = N - 1 - ry; gy = rx; }
    else if (o === 2) { gx = N - 1 - rx; gy = N - 1 - ry; }
    else if (o === 3) { gx = ry; gy = N - 1 - rx; }
    else { gx = rx; gy = ry; }
    gx = Math.floor(gx);
    gy = Math.floor(gy);
    if (gx < 0 || gx >= N || gy < 0 || gy >= N) return null;
    return { gx, gy };
  }

  /**
   * Pointer-move handler: hit-tests, dispatches `HOVER_CELL`, returns the cell.
   * @param {number} mx
   * @param {number} my
   * @returns {{gx:number,gy:number}|null}
   */
  function onPointerMove(mx, my) {
    const cell = hitTest(mx, my);
    if (store) store.dispatch({ type: 'HOVER_CELL', cell });
    return cell;
  }

  /** Pointer-leave handler: clears the hovered cell. */
  function onPointerLeave() {
    if (store) store.dispatch({ type: 'HOVER_CELL', cell: null });
  }

  /**
   * Project a grid cell to canvas-local CSS pixels (used to anchor the
   * keyboard tooltip).
   *
   * @param {number} gx
   * @param {number} gy
   * @returns {{x:number,y:number}|null}
   */
  function cellScreenPos(gx, gy) {
    if (!lastGeom) return null;
    return isoProject(gx, gy, 0, lastGeom);
  }

  /**
   * Keyboard navigation of the hovered cell. Arrow keys move the hover; Escape
   * clears it. Dispatches `HOVER_CELL` through the store.
   *
   * @param {string} key
   * @returns {boolean} true if the key was handled.
   */
  function onKeyDown(key) {
    if (key === 'Escape') {
      if (store) store.dispatch({ type: 'HOVER_CELL', cell: null });
      return true;
    }

    const cur = store ? store.getState().hoveredCell : null;
    let gx;
    let gy;
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      gx = cur ? cur.gx : Math.floor(N / 2);
      gy = cur ? cur.gy : Math.floor(N / 2);
    } else {
      return false;
    }

    if (key === 'ArrowLeft') gx--;
    else if (key === 'ArrowRight') gx++;
    else if (key === 'ArrowUp') gy--;
    else if (key === 'ArrowDown') gy++;
    gx = Math.max(0, Math.min(N - 1, gx));
    gy = Math.max(0, Math.min(N - 1, gy));

    if (store) store.dispatch({ type: 'HOVER_CELL', cell: { gx, gy } });
    return true;
  }

  return { resize, render, hitTest, onPointerMove, onPointerLeave, cellScreenPos, onKeyDown, setWind };
}
