/**
 * OpenSKIZZE 2.0 — macro 2D city-context planning schematic with site selection.
 *
 * The map is a deliberately *diagrammatic* municipal planning map, not an
 * illustration. Each site preset owns a distinct imaginary city, described
 * data-drivenly by `preset.city` in `config.js`:
 *
 *   - `city.terrain` is an ordered list of zones (hills, mountains, meadow,
 *     river, lake, railyard, suburb, urban) that the map draws generically.
 *   - `city.coldAir.dir` is a grid vector (x = east, y = south) giving the
 *     downhill cold-air drainage direction from the green source into the city;
 *     `city.coldAir.label` is its compass shorthand (e.g. "N → S").
 *
 * Switching preset therefore changes the whole surrounding city: its terrain,
 * its legend and the direction of the animated cold-air vector arrow.
 *
 * Zones are flat-filled with thin strokes and never overlap. City blocks sit on
 * strict, non-overlapping grids inside their zone, so street gaps stay visible.
 *
 * On top sits the 10×10 site grid, drawn as a neutral planning grid inside the
 * selection box. The Phase-1 selection screen intentionally shows no generated
 * design — only the underlying terrain and the dashed selection box.
 *
 * A legend, north arrow, scale bar, an animated cold-air vector arrow and a
 * draggable/resizable selection box complete the map. All decoration uses a
 * seeded PRNG — never `Math.random`.
 *
 * Pure ES module: no side effects on import.
 */

import { PRESETS } from './config.js';
import { makePRNG } from './prng.js';
import { loc, t } from './i18n.js';

/** Macro map grid dimensions (cells). */
const MAP_COLS = 16;
const MAP_ROWS = 16;

/** Minimum site-box size (cells) — matches the parcel grid. */
const MIN_SITE = 10;

/** Fixed seed for map decoration so the backdrop is stable across reloads. */
const DECOR_SEED = 0xc17a5;

/** Neutral base fill drawn beneath the terrain zones. */
const BASE_COLOR = '#0b1220';

/** Restrained warm palette for urban heat-island blocks. */
const URBAN_PALETTE = ['#c2410c', '#ea580c', '#b91c1c', '#d97706', '#9a3412'];

/**
 * FNV-1a string hash → unsigned 32-bit int. Used to seed the map decoration
 * PRNG so the backdrop is deterministic per city.
 *
 * @param {string} s
 * @returns {number}
 */
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Clamp a number to [lo, hi]. @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
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

  /** Current cell size in CSS pixels. @returns {{cw:number, ch:number}} */
  function cellSize() {
    return { cw: cssW / MAP_COLS, ch: cssH / MAP_ROWS };
  }

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
  }

  // ---------------------------------------------------------------------------
  // Backdrop: macro zoning
  // ---------------------------------------------------------------------------

  /**
   * Convert a terrain zone's grid rect (x,y,w,h in cells) to CSS pixels using
   * the macro map cell size.
   *
   * @param {{x:number,y:number,w:number,h:number}} z
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  function zoneRect(z) {
    const cw = cssW / MAP_COLS;
    const ch = cssH / MAP_ROWS;
    return { x: z.x * cw, y: z.y * ch, w: z.w * cw, h: z.h * ch };
  }

  /** Flat fill for a zone; keeps the diagrammatic look. @param {object} z */
  function fillZone(z) {
    const r = zoneRect(z);
    ctx.fillStyle = z.color || '#334155';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  /**
   * High ground (hills / alpine slopes): flat fill, a darker rim band and a few
   * deterministic triangular peaks confined to the zone.
   *
   * @param {object} z
   * @param {() => number} rng
   */
  function drawHills(z, rng) {
    const r = zoneRect(z);
    fillZone(z);
    ctx.fillStyle = 'rgba(15,23,42,0.20)';
    ctx.fillRect(r.x, r.y, r.w, Math.max(2, r.h * 0.12));
    const cols = Math.max(2, Math.round(z.w));
    const cw = r.w / cols;
    ctx.fillStyle = 'rgba(241,245,249,0.20)';
    for (let i = 0; i < cols; i++) {
      if (rng() < 0.3) continue;
      const px = r.x + i * cw + cw * 0.5;
      const py = r.y + r.h * (0.45 + rng() * 0.3);
      const pw = cw * 0.34;
      const ph = r.h * (0.22 + rng() * 0.18);
      ctx.beginPath();
      ctx.moveTo(px, py - ph);
      ctx.lineTo(px - pw, py);
      ctx.lineTo(px + pw, py);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Meadow / green source: flat fill with sparse deterministic vegetation.
   *
   * @param {object} z
   * @param {() => number} rng
   */
  function drawMeadow(z, rng) {
    const r = zoneRect(z);
    fillZone(z);
    const cols = Math.max(3, Math.round(z.w * 1.5));
    const rows = Math.max(2, Math.round(z.h * 1.5));
    const cw = r.w / cols;
    const ch = r.h / rows;
    ctx.fillStyle = 'rgba(20,83,45,0.45)';
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        if (rng() < 0.5) continue;
        ctx.beginPath();
        ctx.arc(r.x + xx * cw + cw * 0.5, r.y + yy * ch + ch * 0.5, Math.min(cw, ch) * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Lake: a flat, inset rounded rectangle with a thin rim. @param {object} z */
  function drawLake(z) {
    const r = zoneRect(z);
    const inset = Math.min(r.w, r.h) * 0.12;
    ctx.fillStyle = z.color || '#5bb8e8';
    roundRectPath(ctx, r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, Math.min(r.w, r.h) * 0.3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,232,240,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** River: a straight polyline (no curves) with a thin highlight. @param {object} z */
  function drawRiver(z) {
    const cw = cssW / MAP_COLS;
    const ch = cssH / MAP_ROWS;
    const pts = z.points || [];
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = z.color || '#3d8fbb';
    ctx.lineWidth = Math.max(3, ch * 0.4);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i].x * cw;
      const y = pts[i].y * ch;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226,232,240,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** Railyard / brownfield: flat grey band with simple parallel rail lines. @param {object} z */
  function drawRailyard(z) {
    const r = zoneRect(z);
    fillZone(z);
    ctx.strokeStyle = 'rgba(226,232,240,0.55)';
    ctx.lineWidth = 1.5;
    const lines = 3;
    for (let i = 1; i <= lines; i++) {
      const y = r.y + (r.h * i) / (lines + 1);
      ctx.beginPath();
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.stroke();
    }
  }

  /**
   * Suburb: flat tinted band with small, non-overlapping house squares.
   *
   * @param {object} z
   * @param {() => number} rng
   */
  function drawSuburb(z, rng) {
    const r = zoneRect(z);
    fillZone(z);
    const cols = Math.max(3, Math.round(z.w * 1.4));
    const rows = Math.max(2, Math.round(z.h * 1.4));
    const cw = r.w / cols;
    const ch = r.h / rows;
    ctx.fillStyle = 'rgba(120,53,15,0.55)';
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        if (rng() < 0.25) continue;
        const bw = cw * 0.56;
        const bh = ch * 0.5;
        ctx.fillRect(r.x + xx * cw + (cw - bw) / 2, r.y + yy * ch + (ch - bh) / 2, bw, bh);
      }
    }
  }

  /**
   * Dense urban core: a warm base with a strict, non-overlapping block grid and
   * thin street lines. Only colour and a height hint vary — never geometry.
   *
   * @param {object} z
   * @param {() => number} rng
   */
  function drawUrban(z, rng) {
    const r = zoneRect(z);
    fillZone(z);
    const cols = Math.max(2, Math.round(z.w * 0.7));
    const rows = Math.max(2, Math.round(z.h * 0.7));
    const cw = r.w / cols;
    const ch = r.h / rows;
    const margin = Math.min(cw, ch) * 0.18;

    ctx.strokeStyle = 'rgba(15,23,42,0.30)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(r.x + c * cw, r.y);
      ctx.lineTo(r.x + c * cw, r.y + r.h);
      ctx.stroke();
    }
    for (let rr = 0; rr <= rows; rr++) {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y + rr * ch);
      ctx.lineTo(r.x + r.w, r.y + rr * ch);
      ctx.stroke();
    }

    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const bx = r.x + cc * cw + margin;
        const by = r.y + rr * ch + margin;
        const bw = cw - margin * 2;
        const bh = ch - margin * 2;
        if (bw <= 1 || bh <= 1) continue;
        const color = URBAN_PALETTE[Math.floor(rng() * URBAN_PALETTE.length)];
        const height = 1 + Math.floor(rng() * 4);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, bw, bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(15,23,42,' + (0.06 + height * 0.05).toFixed(2) + ')';
        ctx.fillRect(bx, by, bw, Math.max(1, bh * 0.14));
      }
    }
  }

  /**
   * Draw the whole city context: a neutral base plus every terrain zone drawn
   * generically from `city.terrain`. Decoration is seeded by the city name so
   * each city is deterministic yet visually distinct.
   *
   * @param {{name?:string, terrain?:Array<object>}} city
   */
  function drawTerrain(city) {
    ctx.fillStyle = BASE_COLOR;
    ctx.fillRect(0, 0, cssW, cssH);

    const terrain = (city && city.terrain) || [];
    // Seed on the English city name so the backdrop decoration stays stable
    // across language switches (localised names are display-only).
    const seedName = (city && city.name && city.name.en)
      || (city && typeof city.name === 'string' ? city.name : 'city');
    const rng = makePRNG((DECOR_SEED ^ hashString(seedName)) >>> 0);

    for (const z of terrain) {
      switch (z.type) {
        case 'hills':
        case 'mountains':
          drawHills(z, rng);
          break;
        case 'meadow':
          drawMeadow(z, rng);
          break;
        case 'lake':
          drawLake(z);
          break;
        case 'river':
          drawRiver(z);
          break;
        case 'railyard':
          drawRailyard(z);
          break;
        case 'suburb':
          drawSuburb(z, rng);
          break;
        case 'urban':
          drawUrban(z, rng);
          break;
        default:
          fillZone(z);
          break;
      }
    }
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
   * Draw each labelled terrain zone's name inside its own rectangle, so labels
   * never collide with one another.
   *
   * @param {{terrain?:Array<object>}} city
   */
  function drawLabels(city) {
    const terrain = (city && city.terrain) || [];
    const cw = cssW / MAP_COLS;
    const ch = cssH / MAP_ROWS;
    for (const z of terrain) {
      const text = loc(z.label);
      if (!text) continue;
      if (z.w < 3 && z.h < 3) continue;
      const x = Math.min(cssW - 160, z.x * cw + 10);
      const y = z.y * ch + 10;
      label(text, x, y, { size: 12, weight: 600 });
    }
  }

  /**
   * Bottom-left legend listing the selected city's labelled zones.
   *
   * @param {{name?:string, terrain?:Array<object>}} city
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
  // Site grid
  // ---------------------------------------------------------------------------

  /**
   * Draw the neutral 10×10 site grid inside the selection box. The Phase-1
   * selection screen deliberately shows no generated design — only the
   * underlying terrain and this planning grid — so the dashed selection box
   * (drawn separately by {@link drawSelectionBox}) clearly outlines the region.
   *
   * @param {object} state
   */
  function drawSiteGrid(state) {
    const { cw, ch } = cellSize();
    const box = state.site.box;
    const ox = box.x * cw;
    const oy = box.y * ch;
    const bw = Math.max(1, box.w);
    const bh = Math.max(1, box.h);

    // Grid lines.
    ctx.strokeStyle = 'rgba(15,23,42,0.35)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= bw; gx++) {
      ctx.beginPath();
      ctx.moveTo(ox + gx * cw, oy);
      ctx.lineTo(ox + gx * cw, oy + bh * ch);
      ctx.stroke();
    }
    for (let gy = 0; gy <= bh; gy++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + gy * ch);
      ctx.lineTo(ox + bw * cw, oy + gy * ch);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------

  /**
   * Animated cold-air vector arrow. Runs diagonally across the map from the
   * upstream green source toward the downstream city, following the selected
   * city's `coldAir.dir` grid vector (x = east, y = south), and is labelled with
   * the city's compass shorthand.
   *
   * @param {{coldAir?:{dir?:{x:number,y:number}, label?:string}}} city
   */
  function drawColdAirArrow(city) {
    const dir = (city && city.coldAir && city.coldAir.dir) || { x: 0, y: 1 };
    let dx = dir.x;
    let dy = dir.y;
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
   * Draw the draggable/resizable selection box with corner handles.
   * @param {object} state
   */
  function drawSelectionBox(state) {
    const { cw, ch } = cellSize();
    const box = state.site.box;
    const x = box.x * cw;
    const y = box.y * ch;
    const w = box.w * cw;
    const h = box.h * ch;

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);

    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = 'rgba(15,23,42,0.8)';
    ctx.lineWidth = 1;
    const hs = 7;
    const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
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

    ctx.clearRect(0, 0, cssW, cssH);
    drawTerrain(city);
    drawLabels(city);
    drawLegend(city);
    drawNorthArrow();
    drawScaleBar();
    drawSiteGrid(state);
    drawColdAirArrow(city);
    drawSelectionBox(state);
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  /**
   * Whether a CSS-pixel point lies inside the current selection box.
   * @param {number} mx
   * @param {number} my
   * @returns {boolean}
   */
  function hitTest(mx, my) {
    const { cw, ch } = cellSize();
    const box = store.getState().site.box;
    const cx = mx / cw;
    const cy = my / ch;
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
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
   * Begin a resize (corner handle) or move (inside box) drag.
   * @param {number} mx
   * @param {number} my
   * @returns {boolean} true if a drag started.
   */
  function onPointerDown(mx, my) {
    const { cw, ch } = cellSize();
    const box = store.getState().site.box;
    const x = box.x * cw;
    const y = box.y * ch;
    const w = box.w * cw;
    const h = box.h * ch;

    // Corner handles take priority.
    const hr = 12;
    const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    for (let i = 0; i < corners.length; i++) {
      if (Math.abs(mx - corners[i][0]) <= hr && Math.abs(my - corners[i][1]) <= hr) {
        dragging = true;
        resizeCorner = i;
        return true;
      }
    }

    if (!hitTest(mx, my)) return false;
    dragging = true;
    resizeCorner = -1;
    dragDX = mx / cw - box.x;
    dragDY = my / ch - box.y;
    return true;
  }

  /**
   * Update the selection box while dragging/resizing (clamped to map bounds).
   * @param {number} mx
   * @param {number} my
   */
  function onPointerMove(mx, my) {
    if (!dragging) return;
    const { cw, ch } = cellSize();
    const box = store.getState().site.box;

    if (resizeCorner >= 0) {
      const [ax, ay] = cornerAnchors(box)[resizeCorner];
      const mcx = clamp(Math.round(mx / cw), 0, MAP_COLS);
      const mcy = clamp(Math.round(my / ch), 0, MAP_ROWS);
      const nb = resizeBox(ax, ay, mcx, mcy);
      if (nb.x !== box.x || nb.y !== box.y || nb.w !== box.w || nb.h !== box.h) {
        store.dispatch({ type: 'SET_SELECTION_BOX', box: nb });
      }
      return;
    }

    const nx = clamp(Math.round(mx / cw - dragDX), 0, MAP_COLS - box.w);
    const ny = clamp(Math.round(my / ch - dragDY), 0, MAP_ROWS - box.h);
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
