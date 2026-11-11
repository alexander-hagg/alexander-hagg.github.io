/**
 * OpenSKIZZE 2.0 — 3D isometric city-context preview with site selection.
 *
 * The large Phase-1 window (`#CityMapCanvas`) shows a self-contained 3D
 * isometric preview of the selected preset's surrounding city, described
 * data-drivenly by `preset.city` in `config.js`:
 *
 *   - `city.terrain` is an ordered list of zones (hills, mountains, meadow,
 *     river, lake, railyard, suburb, urban) that the preview draws generically
 *     as projected ground quads. `hills`/`mountains` are raised into a simple
 *     hillside whose upstream edge (opposite `city.coldAir.dir`) is highest.
 *   - `city.coldAir.dir` is a grid vector (x = east, y = south) giving the
 *     downhill cold-air drainage direction from the green source into the city;
 *     `city.coldAir.label` is its compass shorthand (e.g. "N → S"). The vector
 *     also selects the iso view orientation so the flow reads downhill.
 *
 * This module deliberately does NOT reuse `iso.js`'s N=10 machinery: it
 * implements its own local projection for the 16×16 macro grid (only the
 * grid-size-independent `orientationForDir` is imported). The projection is
 * invertible at elevation 0, so the draggable/resizable selection box keeps
 * working in grid coordinates.
 *
 * A legend, north arrow, scale bar, an animated cold-air vector arrow and the
 * dashed selection box (drawn on the 3D ground) complete the scene. All
 * decoration uses a seeded PRNG — never `Math.random`.
 *
 * Pure ES module: no side effects on import.
 */

import { PRESETS } from './config.js';
import { loc, t } from './i18n.js';
import { orientationForDir, contextBoxHeight, contextTreeAt } from './iso.js';

/** Macro map grid dimensions (cells). */
const MAP_COLS = 16;
const MAP_ROWS = 16;

/** Minimum site-box size (cells) — matches the parcel grid. */
const MIN_SITE = 10;

/** Neutral base fill drawn beneath the terrain zones. */
const BASE_COLOR = '#0b1220';

/** Soft ground-plane fill for the whole 16×16 diamond. */
const GROUND_COLOR = '#1e293b';

/** Sky gradient stops (top → bottom), consistent with the app aesthetic. */
const SKY_STOPS = ['#0b1220', '#1e293b', '#334155'];

/** Peak hillside elevation, in elevation units (scaled by `heightScale`). */
const MAX_ELEV_UNITS = 3;

/** Height scale as a fraction of tile height (matches the iso aesthetic). */
const HEIGHT_SCALE_FACTOR = 0.7;

/** Clamp a number to [lo, hi]. @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Multiply a hex colour's RGB channels by `f` (clamped), returning an `rgb()`
 * string. Used to flat-shade the three faces of a projected prism.
 *
 * @param {string} hex
 * @param {number} f
 * @returns {string}
 */
function shade(hex, f) {
  let h = String(hex || '#334155').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return hex;
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/**
 * Trace a rounded rectangle path (manual, for broad canvas compatibility).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Fallback city context used only if a preset somehow lacks `city`. */
const FALLBACK_CITY = {
  name: 'City',
  tagline: '',
  coldAir: { dir: { x: 0, y: 1 }, label: 'N → S' },
  terrain: [],
};

/**
 * Resolve the selected preset's city context from app state.
 *
 * @param {object} state
 * @returns {{name:string, tagline:string, coldAir:{dir:{x:number,y:number},label:string}, terrain:Array<object>}}
 */
function resolveCity(state) {
  const presetId = state && state.site ? state.site.presetId : null;
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  return (preset && preset.city) || (PRESETS[0] && PRESETS[0].city) || FALLBACK_CITY;
}

/**
 * Create a city-map controller bound to a canvas and the central store.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{getState:()=>object, dispatch:(a:object)=>object}} store
 * @returns {{
 *   resize:()=>void,
 *   render:(state:object)=>void,
 *   hitTest:(mx:number,my:number)=>boolean,
 *   onPointerDown:(mx:number,my:number)=>boolean,
 *   onPointerMove:(mx:number,my:number)=>void,
 *   onPointerUp:()=>void,
 *   onKeyDown:(key:string)=>boolean,
 *   debugBlocks:()=>Array<{x:number,y:number,w:number,h:number,color:string,height:number}>
 * }}
 */
export function createCityMap(canvas, store) {
  const ctx = canvas.getContext('2d');

  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let hasSize = false;
  let dragging = false;
  let resizeCorner = -1;
  let dragDX = 0;
  let dragDY = 0;
  let time = 0;
  let lastNow = 0;

  /** Current iso geometry (recomputed when the canvas size or city changes). */
  let G = null;
  let geomW = -1;
  let geomH = -1;
  let geomOrientation = -1;

  /**
   * DPR-aware resize: cap DPR at 2, size the backing store to CSS × DPR and
   * reset the transform so all drawing uses CSS pixels.
   */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    hasSize = rect.width > 0 && rect.height > 0;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    G = null;
  }

  // ---------------------------------------------------------------------------
  // Local 16×16 isometric projection
  // ---------------------------------------------------------------------------

  /**
   * Rotate grid coordinates by `o` quarter-turns clockwise about the grid
   * centre, using the macro grid dimensions (not `iso.js`'s N).
   *
   * @param {number} gx
   * @param {number} gy
   * @param {number} o
   * @returns {{x:number,y:number}}
   */
  function rotate(gx, gy, o) {
    if (o === 1) return { x: gy, y: MAP_ROWS - 1 - gx };
    if (o === 2) return { x: MAP_COLS - 1 - gx, y: MAP_ROWS - 1 - gy };
    if (o === 3) return { x: MAP_COLS - 1 - gy, y: gx };
    return { x: gx, y: gy };
  }

  /**
   * Fit an iso geometry to the canvas with headroom for the raised hillside.
   *
   * @param {{coldAir?:{dir?:{x:number,y:number}}}} city
   * @returns {{tileWidth:number,tileHeight:number,heightScale:number,originX:number,originY:number,orientation:number}}
   */
  function computeGeom(city) {
    const dir = (city && city.coldAir && city.coldAir.dir) || { x: 0, y: 1 };
    const orientation = orientationForDir(dir);

    const padX = cssW * 0.06;
    const padY = cssH * 0.06;
    const availW = Math.max(1, cssW - padX * 2);
    const availH = Math.max(1, cssH - padY * 2);

    // th = tw/2; usedH = n*th + MAX_ELEV_UNITS*HEIGHT_SCALE_FACTOR*th
    const twByW = availW / MAP_COLS;
    const twByH = (availH * 2) / (MAP_ROWS + MAX_ELEV_UNITS * HEIGHT_SCALE_FACTOR);
    const tileWidth = Math.max(1, Math.min(twByW, twByH));
    const tileHeight = tileWidth / 2;
    const heightScale = tileHeight * HEIGHT_SCALE_FACTOR;

    const usedH = MAP_ROWS * tileHeight + MAX_ELEV_UNITS * heightScale;
    const originX = cssW / 2;
    const originY = (cssH - usedH) / 2 + MAX_ELEV_UNITS * heightScale;

    return { tileWidth, tileHeight, heightScale, originX, originY, orientation };
  }

  /**
   * Ensure the geometry matches the current canvas size and city orientation.
   * @param {object} city
   */
  function ensureGeom(city) {
    const dir = (city && city.coldAir && city.coldAir.dir) || { x: 0, y: 1 };
    const o = orientationForDir(dir);
    if (!G || geomW !== cssW || geomH !== cssH || geomOrientation !== o) {
      G = computeGeom(city);
      geomW = cssW;
      geomH = cssH;
      geomOrientation = o;
    }
  }

  /**
   * Project a grid point + elevation to screen coordinates, applying the iso
   * orientation rotation and the iso basis.
   *
   * @param {number} gx
   * @param {number} gy
   * @param {number} [elev]
   * @returns {{x:number,y:number}}
   */
  function project(gx, gy, elev) {
    const { tileWidth: tw, tileHeight: th, originX, originY, heightScale: hs, orientation: o } = G;
    const r = rotate(gx, gy, o);
    return {
      x: (r.x - r.y) * (tw / 2) + originX,
      y: (r.x + r.y) * (th / 2) + originY - (elev || 0) * hs,
    };
  }

  /**
   * Inverse-project a CSS-pixel point to grid coordinates at elevation 0.
   *
   * @param {number} sx
   * @param {number} sy
   * @returns {{x:number,y:number}}
   */
  function unproject(sx, sy) {
    const { tileWidth: tw, tileHeight: th, originX, originY, orientation: o } = G;
    const dx = sx - originX;
    const dy = sy - originY;
    const rx = dx / tw + dy / th;
    const ry = dy / th - dx / tw;
    let gx;
    let gy;
    if (o === 1) { gx = MAP_ROWS - 1 - ry; gy = rx; }
    else if (o === 2) { gx = MAP_COLS - 1 - rx; gy = MAP_ROWS - 1 - ry; }
    else if (o === 3) { gx = ry; gy = MAP_COLS - 1 - rx; }
    else { gx = rx; gy = ry; }
    return { x: gx, y: gy };
  }

  /**
   * Elevation of a point on a hillside measured against the *zone's own* extent
   * along `dir`, so the zone's downstream edge sits exactly at z = 0 and meets
   * the surrounding flat land, while its upstream edge reaches `maxElev`.
   *
   * @param {object} z - Terrain zone (grid rect).
   * @param {number} gx
   * @param {number} gy
   * @param {{x:number,y:number}} dir
   * @param {number} maxElev
   * @returns {number}
   */
  function zoneElev(z, gx, gy, dir, maxElev) {
    let dx = dir && Number.isFinite(dir.x) ? dir.x : 0;
    let dy = dir && Number.isFinite(dir.y) ? dir.y : 1;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const zcx = z.x + z.w / 2;
    const zcy = z.y + z.h / 2;
    const proj = (gx - zcx) * dx + (gy - zcy) * dy;
    const half = (Math.abs(dx) * z.w + Math.abs(dy) * z.h) / 2 || 1;
    const tt = proj / half; // -1 upstream .. 1 downstream
    return maxElev * (1 - (tt + 1) / 2);
  }

  /**
   * Centre of the city's urban core (fallback: grid centre).
   * @param {object} city
   * @returns {{x:number,y:number}}
   */
  function cityCenter(city) {
    const urban = ((city && city.terrain) || []).find((z) => z.type === 'urban');
    if (urban) return { x: urban.x + urban.w / 2, y: urban.y + urban.h / 2 };
    return { x: MAP_COLS / 2, y: MAP_ROWS / 2 };
  }

  /**
   * Downhill direction for a hills zone: from the zone centre toward the city
   * core, so hills always slope down toward the city.
   * @param {object} city
   * @param {object} z
   * @returns {{x:number,y:number}}
   */
  function slopeDirFor(city, z) {
    const c = cityCenter(city);
    const zcx = z.x + z.w / 2;
    const zcy = z.y + z.h / 2;
    let dx = c.x - zcx;
    let dy = c.y - zcy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  /** Rotated depth key (rx + ry) for painter's-order sorting. @param {number} gx @param {number} gy @returns {number} */
  function depthOf(gx, gy) {
    const r = rotate(gx, gy, G.orientation);
    return r.x + r.y;
  }

  // ---------------------------------------------------------------------------
  // Scene: sky, ground, terrain zones, volumes
  // ---------------------------------------------------------------------------

  /** Fill the sky gradient background. */
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, SKY_STOPS[0]);
    g.addColorStop(0.55, SKY_STOPS[1]);
    g.addColorStop(1, SKY_STOPS[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  /** Draw the soft ground-plane diamond for the whole 16×16 grid. */
  function drawGroundPlane() {
    const corners = [[0, 0], [MAP_COLS, 0], [MAP_COLS, MAP_ROWS], [0, MAP_ROWS]];
    const pts = corners.map(([gx, gy]) => project(gx, gy, 0));

    // Whole-parcel drop shadow.
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(pts[0].x + G.tileWidth * 0.4, pts[0].y + G.tileHeight * 0.4);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + G.tileWidth * 0.4, pts[i].y + G.tileHeight * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const cx = (pts[0].x + pts[2].x) / 2;
    const cy = (pts[0].y + pts[2].y) / 2;
    const rad = Math.max(cssW, cssH) * 0.6;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, GROUND_COLOR);
    grad.addColorStop(1, BASE_COLOR);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draw a terrain zone. Flat zones are a single projected quad; `hills`/
   * `mountains` are drawn as a grid of tiles whose corners sit at their own
   * elevations, so the slope reads smoothly and meets the surrounding flat land
   * at z = 0 on the downstream (city-facing) edge.
   *
   * @param {object} z
   * @param {object} city
   */
  function drawZoneQuad(z, city) {
    const raised = z.type === 'hills' || z.type === 'mountains';
    if (!raised) {
      const corners = [
        [z.x, z.y],
        [z.x + z.w, z.y],
        [z.x + z.w, z.y + z.h],
        [z.x, z.y + z.h],
      ];
      const pts = corners.map(([gx, gy]) => project(gx, gy, 0));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = z.color || '#334155';
      ctx.fill();
      ctx.strokeStyle = 'rgba(15,23,42,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    const dir = slopeDirFor(city, z);
    const cells = [];
    for (let gy = z.y; gy < z.y + z.h; gy++) {
      for (let gx = z.x; gx < z.x + z.w; gx++) {
        cells.push({ gx, gy, depth: depthOf(gx + 0.5, gy + 0.5) });
      }
    }
    cells.sort((a, b) => a.depth - b.depth);
    for (const c of cells) {
      const e00 = zoneElev(z, c.gx, c.gy, dir, MAX_ELEV_UNITS);
      const e10 = zoneElev(z, c.gx + 1, c.gy, dir, MAX_ELEV_UNITS);
      const e11 = zoneElev(z, c.gx + 1, c.gy + 1, dir, MAX_ELEV_UNITS);
      const e01 = zoneElev(z, c.gx, c.gy + 1, dir, MAX_ELEV_UNITS);
      const p00 = project(c.gx, c.gy, e00);
      const p10 = project(c.gx + 1, c.gy, e10);
      const p11 = project(c.gx + 1, c.gy + 1, e11);
      const p01 = project(c.gx, c.gy + 1, e01);
      ctx.beginPath();
      ctx.moveTo(p00.x, p00.y);
      ctx.lineTo(p10.x, p10.y);
      ctx.lineTo(p11.x, p11.y);
      ctx.lineTo(p01.x, p01.y);
      ctx.closePath();
      ctx.fillStyle = z.color || '#334155';
      ctx.fill();
    }
  }

  /**
   * Draw a river zone as a projected polyline.
   * @param {object} z
   */
  function drawRiver(z) {
    const pts = z.points || [];
    if (pts.length < 2) return;
    const proj = pts.map((p) => project(p.x, p.y, 0));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = z.color || '#3d8fbb';
    ctx.lineWidth = Math.max(3, G.tileHeight * 0.5);
    ctx.beginPath();
    ctx.moveTo(proj[0].x, proj[0].y);
    for (let i = 1; i < proj.length; i++) ctx.lineTo(proj[i].x, proj[i].y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226,232,240,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw a simple flat-shaded prism on a cell (used for urban/suburb volume).
   *
   * @param {number} gx
   * @param {number} gy
   * @param {number} elev - Base elevation (elevation units).
   * @param {number} h - Height (elevation units).
   * @param {string} color
   * @param {number} fp - Footprint fraction 0..1.
   */
  function drawPrism(gx, gy, elev, h, color, fp) {
    const T = project(gx, gy, elev);
    const R = project(gx + 1, gy, elev);
    const B = project(gx + 1, gy + 1, elev);
    const L = project(gx, gy + 1, elev);
    const cx = (T.x + R.x + B.x + L.x) / 4;
    const cy = (T.y + R.y + B.y + L.y) / 4;
    const f = clamp(fp == null ? 0.7 : fp, 0.15, 1);
    const ins = (p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f });
    const t = ins(T);
    const r = ins(R);
    const b = ins(B);
    const l = ins(L);
    const e = h * G.heightScale;

    // Contact shadow (ambient occlusion) on the ground.
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(t.x + G.tileWidth * 0.12, t.y + G.tileHeight * 0.12);
    ctx.lineTo(r.x + G.tileWidth * 0.12, r.y + G.tileHeight * 0.12);
    ctx.lineTo(b.x + G.tileWidth * 0.12, b.y + G.tileHeight * 0.12);
    ctx.lineTo(l.x + G.tileWidth * 0.12, l.y + G.tileHeight * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Left face (mid-tone).
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x, b.y - e);
    ctx.lineTo(l.x, l.y - e);
    ctx.closePath();
    ctx.fillStyle = shade(color, 0.72);
    ctx.fill();

    // Right face (darkest).
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(r.x, r.y);
    ctx.lineTo(r.x, r.y - e);
    ctx.lineTo(b.x, b.y - e);
    ctx.closePath();
    ctx.fillStyle = shade(color, 0.55);
    ctx.fill();

    // Top face (lightest).
    ctx.beginPath();
    ctx.moveTo(t.x, t.y - e);
    ctx.lineTo(r.x, r.y - e);
    ctx.lineTo(b.x, b.y - e);
    ctx.lineTo(l.x, l.y - e);
    ctx.closePath();
    ctx.fillStyle = shade(color, 1.15);
    ctx.fill();

    // Silhouette outline.
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(l.x, l.y - e);
    ctx.lineTo(t.x, t.y - e);
    ctx.lineTo(r.x, r.y - e);
    ctx.lineTo(r.x, r.y);
    ctx.lineTo(b.x, b.y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(15,23,42,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * Simple tree (trunk + two canopy blobs) on a hillside cell.
   * @param {number} gx
   * @param {number} gy
   * @param {number} elev
   * @param {number} seed
   */
  function drawTree(gx, gy, elev, seed) {
    const p = project(gx, gy, elev);
    const tw = G.tileWidth;
    const th = G.tileHeight;
    const cx = p.x;
    const cy = p.y + th / 2;
    const r = tw * (0.10 + (seed % 3) * 0.012);
    ctx.fillStyle = '#5b4636';
    ctx.fillRect(cx - tw * 0.02, cy - th * 0.22, tw * 0.04, th * 0.22);
    ctx.beginPath();
    ctx.arc(cx + r * 0.12, cy - th * 0.26 + r * 0.12, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1c4f31';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - r * 0.1, cy - th * 0.30 - r * 0.1, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = '#4fa06b';
    ctx.fill();
  }

  /**
   * Draw the whole 3D city context: sky, ground plane, terrain zones (depth
   * sorted), simple urban/suburb volumes and trees on hills. Volumes and trees
   * use the same deterministic helpers as the solution views, so the surrounding
   * environment looks identical in every phase.
   *
   * @param {{name?:object, terrain?:Array<object>, coldAir?:{dir?:{x:number,y:number}}}} city
   */
  function drawTerrain(city) {
    drawSky();
    drawGroundPlane();

    const terrain = (city && city.terrain) || [];

    // Depth-sort zones so raised hillsides do not overlap incorrectly.
    const ordered = terrain
      .map((z) => ({ z, depth: depthOf(z.x + z.w / 2, z.y + z.h / 2) }))
      .sort((a, b) => a.depth - b.depth);

    for (const { z } of ordered) {
      if (z.type === 'river') drawRiver(z);
      else drawZoneQuad(z, city);
    }

    // Simple low volumes for urban/suburb zones, depth-sorted.
    const boxes = [];
    for (const z of terrain) {
      if (z.type !== 'urban' && z.type !== 'suburb') continue;
      for (let gy = z.y; gy < z.y + z.h; gy++) {
        for (let gx = z.x; gx < z.x + z.w; gx++) {
          const h = contextBoxHeight(z, gx, gy);
          if (h > 0) boxes.push({ gx, gy, h, color: z.color || '#b45309', depth: depthOf(gx + 0.5, gy + 0.5) });
        }
      }
    }
    boxes.sort((a, b) => a.depth - b.depth);
    for (const b of boxes) drawPrism(b.gx, b.gy, 0, b.h, b.color, 0.7);

    // Simple trees on hills (e.g. the Lower Slope Woods).
    const trees = [];
    for (const z of terrain) {
      if (z.type !== 'hills') continue;
      const dir = slopeDirFor(city, z);
      for (let gy = z.y; gy < z.y + z.h; gy++) {
        for (let gx = z.x; gx < z.x + z.w; gx++) {
          const seed = contextTreeAt(z, gx, gy);
          if (!seed) continue;
          const elev = zoneElev(z, gx, gy, dir, MAX_ELEV_UNITS);
          trees.push({ gx, gy, elev, depth: depthOf(gx + 0.5, gy + 0.5), seed });
        }
      }
    }
    trees.sort((a, b) => a.depth - b.depth);
    for (const t of trees) drawTree(t.gx, t.gy, t.elev, t.seed);
  }

  // ---------------------------------------------------------------------------
  // Backdrop: cartography
  // ---------------------------------------------------------------------------

  /**
   * Draw a legible label with a subtle dark backdrop.
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {{size?:number, weight?:number}} [opts]
   */
  function label(text, x, y, opts) {
    const size = (opts && opts.size) || 15;
    const weight = (opts && opts.weight) || 700;
    ctx.save();
    ctx.font = weight + ' ' + size + 'px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(15,23,42,0.6)';
    roundRectPath(ctx, x - 6, y - 4, w + 12, size + 9, 6);
    ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(241,245,249,0.97)';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /**
   * Draw each labelled terrain zone's name at its projected centre.
   *
   * @param {{terrain?:Array<object>, coldAir?:{dir?:{x:number,y:number}}}} city
   */
  function drawLabels(city) {
    const terrain = (city && city.terrain) || [];
    const dir = (city && city.coldAir && city.coldAir.dir) || { x: 0, y: 1 };
    for (const z of terrain) {
      const text = loc(z.label);
      if (!text) continue;
      if (z.w < 3 && z.h < 3) continue;
      const cx = z.x + z.w / 2;
      const cy = z.y + z.h / 2;
      const raised = z.type === 'hills' || z.type === 'mountains';
      const elev = raised ? zoneElev(z, cx, cy, dir, MAX_ELEV_UNITS) : 0;
      const p = project(cx, cy, elev);
      const x = clamp(p.x - 40, 8, Math.max(8, cssW - 170));
      const y = clamp(p.y - 8, 8, Math.max(8, cssH - 30));
      label(text, x, y, { size: 12, weight: 600 });
    }
  }

  /**
   * Bottom-left legend listing the selected city's labelled zones.
   *
   * @param {{name?:object, terrain?:Array<object>}} city
   */
  function drawLegend(city) {
    const terrain = (city && city.terrain) || [];
    const items = [];
    const seen = new Set();
    for (const z of terrain) {
      const text = loc(z.label);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      items.push([z.color || '#94a3b8', text]);
    }
    const pad = 8;
    const rowH = 18;
    const boxW = 210;
    const boxH = pad * 2 + 16 + items.length * rowH;
    const x = 12;
    const y = cssH - boxH - 12;

    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.72)';
    roundRectPath(ctx, x, y, boxW, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(226,232,240,0.95)';
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const cityName = loc(city && city.name);
    ctx.fillText(cityName ? cityName.toUpperCase() : t('city.legend'), x + pad, y + pad);

    for (let i = 0; i < items.length; i++) {
      const [color, text] = items[i];
      const iy = y + pad + 16 + i * rowH;
      ctx.fillStyle = color;
      ctx.fillRect(x + pad, iy + 1, 14, 10);
      ctx.fillStyle = 'rgba(226,232,240,0.92)';
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillText(text, x + pad + 20, iy - 1);
    }
    ctx.restore();
  }

  /** Top-right north arrow. */
  function drawNorthArrow() {
    const cx = cssW - 28;
    const cy = 32;
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,232,240,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy - 13);
    ctx.lineTo(cx - 6, cy + 2);
    ctx.lineTo(cx, cy - 1);
    ctx.lineTo(cx + 6, cy + 2);
    ctx.closePath();
    ctx.fillStyle = '#f8fafc';
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', cx, cy + 3);
    ctx.restore();
  }

  /** Bottom-right scale bar. */
  function drawScaleBar() {
    const w = 90;
    const x = cssW - w - 14;
    const y = cssH - 22;
    ctx.save();
    ctx.strokeStyle = 'rgba(226,232,240,0.9)';
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
    for (const tx of [x, x + w]) {
      ctx.beginPath();
      ctx.moveTo(tx, y - 4);
      ctx.lineTo(tx, y + 4);
      ctx.stroke();
    }
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('200 m', x + w / 2, y - 5);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------

  /**
   * Animated cold-air vector arrow. Runs across the 3D scene from the upstream
   * green source toward the downstream city, following the selected city's
   * `coldAir.dir` grid vector (x = east, y = south), and is labelled with the
   * city's compass shorthand.
   *
   * The grid direction is rotated into the iso view basis (the same quarter-turn
   * rotation the projection applies) and then mapped through the iso basis to a
   * screen vector, so the arrow points downhill in the rendered terrain rather
   * than in raw compass space.
   *
   * @param {{coldAir?:{dir?:{x:number,y:number}, label?:string}}} city
   */
  function drawColdAirArrow(city) {
    const dir = (city && city.coldAir && city.coldAir.dir) || { x: 0, y: 1 };
    const o = G ? (G.orientation | 0) : 0;
    let gdx = dir.x;
    let gdy = dir.y;
    for (let k = 0; k < o; k++) { const t = gdx; gdx = gdy; gdy = -t; }
    const tw = G ? G.tileWidth : 1;
    const th = G ? G.tileHeight : 1;
    let dx = (gdx - gdy) * (tw / 2);
    let dy = (gdx + gdy) * (th / 2);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    const cx = cssW / 2;
    const cy = cssH / 2;
    const half = Math.min(cssW, cssH) * 0.42;
    const x0 = cx - dx * half;
    const y0 = cy - dy * half;
    const x1 = cx + dx * half;
    const y1 = cy + dy * half;

    ctx.save();
    ctx.strokeStyle = 'rgba(56,189,248,0.9)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -((time * 40) % 18);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead at the downstream end.
    const ang = Math.atan2(dy, dx);
    const ah = 13;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ah * Math.cos(ang - 0.5), y1 - ah * Math.sin(ang - 0.5));
    ctx.lineTo(x1 - ah * Math.cos(ang + 0.5), y1 - ah * Math.sin(ang + 0.5));
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.95)';
    ctx.fill();
    ctx.restore();

    // Prominent label near the upstream (tail) end, clamped on-screen.
    const text = t('city.coldAir', { label: loc(city && city.coldAir && city.coldAir.label) });
    const lx = clamp(x0 + 12, 12, Math.max(12, cssW - 230));
    const ly = clamp(y0 + 12, 8, Math.max(8, cssH - 30));
    label(text, lx, ly, { size: 12, weight: 600 });
  }

  /**
   * The four projected screen corners of the selection box, in the order
   * `[TL, TR, BL, BR]` (matching {@link cornerAnchors}).
   *
   * @param {{x:number,y:number,w:number,h:number}} box
   * @returns {Array<{x:number,y:number}>}
   */
  function boxCorners(box) {
    return [
      project(box.x, box.y, 0),
      project(box.x + box.w, box.y, 0),
      project(box.x, box.y + box.h, 0),
      project(box.x + box.w, box.y + box.h, 0),
    ];
  }

  /**
   * Draw the draggable/resizable selection box on the 3D ground: a dashed cyan
   * quad with four corner handles.
   *
   * @param {object} state
   */
  function drawSelectionBox(state) {
    const box = state.site.box;
    const c = boxCorners(box);

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    ctx.lineTo(c[1].x, c[1].y);
    ctx.lineTo(c[3].x, c[3].y);
    ctx.lineTo(c[2].x, c[2].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = 'rgba(15,23,42,0.8)';
    ctx.lineWidth = 1;
    const hs = 7;
    for (const p of c) {
      ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
      ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  /**
   * Render one frame.
   * @param {object} state
   */
  function render(state) {
    if (!hasSize) return;
    const now = performance.now();
    const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
    lastNow = now;
    time += dt;

    const city = resolveCity(state);
    ensureGeom(city);

    ctx.clearRect(0, 0, cssW, cssH);
    drawTerrain(city);
    drawLabels(city);
    drawLegend(city);
    drawNorthArrow();
    drawScaleBar();
    drawColdAirArrow(city);
    drawSelectionBox(state);
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  /**
   * Whether a CSS-pixel point lies inside the current selection box (tested in
   * grid coordinates via the inverse projection).
   * @param {number} mx
   * @param {number} my
   * @returns {boolean}
   */
  function hitTest(mx, my) {
    if (!G) ensureGeom(resolveCity(store.getState()));
    const box = store.getState().site.box;
    const g = unproject(mx, my);
    return g.x >= box.x && g.x <= box.x + box.w && g.y >= box.y && g.y <= box.y + box.h;
  }

  /**
   * Opposite corner (in cell units) for each handle index, used as the fixed
   * anchor while resizing.
   * @param {{x:number,y:number,w:number,h:number}} box
   * @returns {[number, number][]}
   */
  function cornerAnchors(box) {
    return [
      [box.x + box.w, box.y + box.h], // TL handle → BR anchor
      [box.x, box.y + box.h],         // TR handle → BL anchor
      [box.x + box.w, box.y],         // BL handle → TR anchor
      [box.x, box.y],                 // BR handle → TL anchor
    ];
  }

  /**
   * Build a clamped box from a fixed anchor cell and a moving cell, enforcing
   * the minimum 10×10 size and map bounds.
   * @param {number} ax
   * @param {number} ay
   * @param {number} mx
   * @param {number} my
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  function resizeBox(ax, ay, mx, my) {
    let x0 = Math.min(ax, mx);
    let x1 = Math.max(ax, mx);
    let y0 = Math.min(ay, my);
    let y1 = Math.max(ay, my);

    if (x1 - x0 < MIN_SITE) { if (mx >= ax) x1 = x0 + MIN_SITE; else x0 = x1 - MIN_SITE; }
    if (y1 - y0 < MIN_SITE) { if (my >= ay) y1 = y0 + MIN_SITE; else y0 = y1 - MIN_SITE; }

    if (x0 < 0) { x0 = 0; x1 = Math.max(MIN_SITE, x1); }
    if (x1 > MAP_COLS) { x1 = MAP_COLS; x0 = Math.min(x1 - MIN_SITE, x0); }
    if (y0 < 0) { y0 = 0; y1 = Math.max(MIN_SITE, y1); }
    if (y1 > MAP_ROWS) { y1 = MAP_ROWS; y0 = Math.min(y1 - MIN_SITE, y0); }

    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * Begin a resize (corner handle) or move (inside box) drag. Handle hit-testing
   * is done in screen space against the projected corners; the move test uses
   * the inverse projection.
   * @param {number} mx
   * @param {number} my
   * @returns {boolean} true if a drag started.
   */
  function onPointerDown(mx, my) {
    if (!G) ensureGeom(resolveCity(store.getState()));
    const box = store.getState().site.box;
    const corners = boxCorners(box);

    // Corner handles take priority.
    const hr = 12;
    for (let i = 0; i < corners.length; i++) {
      if (Math.abs(mx - corners[i].x) <= hr && Math.abs(my - corners[i].y) <= hr) {
        dragging = true;
        resizeCorner = i;
        return true;
      }
    }

    if (!hitTest(mx, my)) return false;
    dragging = true;
    resizeCorner = -1;
    const g = unproject(mx, my);
    dragDX = g.x - box.x;
    dragDY = g.y - box.y;
    return true;
  }

  /**
   * Update the selection box while dragging/resizing (clamped to map bounds).
   * @param {number} mx
   * @param {number} my
   */
  function onPointerMove(mx, my) {
    if (!dragging) return;
    if (!G) ensureGeom(resolveCity(store.getState()));
    const box = store.getState().site.box;
    const g = unproject(mx, my);

    if (resizeCorner >= 0) {
      const [ax, ay] = cornerAnchors(box)[resizeCorner];
      const mcx = clamp(Math.round(g.x), 0, MAP_COLS);
      const mcy = clamp(Math.round(g.y), 0, MAP_ROWS);
      const nb = resizeBox(ax, ay, mcx, mcy);
      if (nb.x !== box.x || nb.y !== box.y || nb.w !== box.w || nb.h !== box.h) {
        store.dispatch({ type: 'SET_SELECTION_BOX', box: nb });
      }
      return;
    }

    const nx = clamp(Math.round(g.x - dragDX), 0, MAP_COLS - box.w);
    const ny = clamp(Math.round(g.y - dragDY), 0, MAP_ROWS - box.h);
    if (nx !== box.x || ny !== box.y) {
      store.dispatch({ type: 'SET_SELECTION_BOX', box: { ...box, x: nx, y: ny } });
    }
  }

  /** End the current drag/resize. */
  function onPointerUp() {
    dragging = false;
    resizeCorner = -1;
  }

  /**
   * Handle a keyboard key. Arrow keys move the box by one cell; Enter confirms
   * the site by dispatching `RUN_SEARCH`.
   *
   * @param {string} key
   * @returns {boolean} true if the key was handled.
   */
  function onKeyDown(key) {
    const box = store.getState().site.box;
    let dx = 0;
    let dy = 0;
    if (key === 'ArrowLeft') dx = -1;
    else if (key === 'ArrowRight') dx = 1;
    else if (key === 'ArrowUp') dy = -1;
    else if (key === 'ArrowDown') dy = 1;
    else if (key === 'Enter') {
      store.dispatch({ type: 'RUN_SEARCH' });
      return true;
    } else {
      return false;
    }

    const nx = clamp(box.x + dx, 0, MAP_COLS - box.w);
    const ny = clamp(box.y + dy, 0, MAP_ROWS - box.h);
    store.dispatch({ type: 'SET_SELECTION_BOX', box: { ...box, x: nx, y: ny } });
    return true;
  }

  /**
   * Debug helper: the current preset's terrain zones in grid coordinates
   * (`x,y,w,h` are cells; `height` is always 0 because zones are flat fills).
   * Mirrors the historical `debugBlocks` shape for tooling compatibility.
   *
   * @returns {Array<{x:number,y:number,w:number,h:number,color:string,height:number}>}
   */
  function debugBlocks() {
    const city = resolveCity(store.getState());
    return (city.terrain || []).map((z) => ({
      x: z.x, y: z.y, w: z.w, h: z.h, color: z.color || '#334155', height: 0,
    }));
  }

  return {
    resize,
    render,
    hitTest,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    debugBlocks,
  };
}
