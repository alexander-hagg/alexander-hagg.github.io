/**
 * OpenSKIZZE 2.0 — MAP-Elites archive heatmap renderer.
 *
 * Draws the 12×12 archive as a heatmap whose filled cells carry a tiny
 * isometric thumbnail of the elite design (rendered once into an offscreen
 * canvas cache keyed by design id, then blitted). Empty niches are slate.
 * Newly filled niches flash white/yellow with a short scale pulse.
 *
 * Phase 3 adds a clearer Pareto frontier (thick stepped polyline with endpoint
 * dots and a label) and archetype **badges** (a letter in a coloured circle).
 *
 * Rendering is state-cheap: when nothing relevant changed and no flash is
 * active, `render()` returns early; thumbnails are only rendered on first
 * appearance and on selection. See `USE_THUMBNAILS` for the fallback path.
 *
 * Pure ES module: no side effects on import.
 */

import { BINS, N } from './config.js';
import { KLAM } from './klam.js';
import { renderThumbnail, computeGeom } from './iso.js';
import { t, getLang } from './i18n.js';

/** Empty-niche fill. */
const EMPTY_COLOR = '#1e293b';

/** New-elite flash colour. */
const FLASH_COLOR = '#fde047';

/** Heat gradient endpoints (RGB): orange #f97316 → cyan #38bdf8. */
const HEAT_LO = [249, 115, 22];
const HEAT_HI = [56, 189, 248];

/** Flash duration in milliseconds. */
const FLASH_MS = 400;

/** Thumbnail backing-store size (px). */
const THUMB_SIZE = 40;

/**
 * Master switch for the thumbnail path. When false, every cell falls back to a
 * 3×3 block-colour mini-grid + height bar (cheaper on very weak devices).
 */
const USE_THUMBNAILS = true;

/** Cap on cached thumbnails before off-screen entries are pruned. */
const THUMB_CACHE_SOFT_MAX = 256;

/** Clamp a number to [0, 1]. @param {number} x @returns {number} */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Memoised heat-colour ramp. Fitness is quantised to 64 levels so the archive
 * hot path never allocates a colour string per cell per frame.
 * @type {Map<number, string>}
 */
const HEAT_CACHE = new Map();

/**
 * Heat colour for a fitness value (orange → cyan, interpolated in RGB).
 * @param {number} fitness
 * @returns {string} `rgb(...)`
 */
function heatColor(fitness) {
  const q = Math.round(clamp01(fitness) * 64);
  const hit = HEAT_CACHE.get(q);
  if (hit) return hit;
  const t = q / 64;
  const r = Math.round(HEAT_LO[0] + (HEAT_HI[0] - HEAT_LO[0]) * t);
  const g = Math.round(HEAT_LO[1] + (HEAT_HI[1] - HEAT_LO[1]) * t);
  const b = Math.round(HEAT_LO[2] + (HEAT_HI[2] - HEAT_LO[2]) * t);
  const color = `rgb(${r},${g},${b})`;
  HEAT_CACHE.set(q, color);
  return color;
}

/** Tallest building in a design (stories). @param {object} design @returns {number} */
function maxHeightOf(design) {
  let m = 1;
  for (const c of design.cells) if (c.height > m) m = c.height;
  return m;
}

/**
 * Allocate a thumbnail backing canvas. Prefers `OffscreenCanvas`, falls back to
 * a detached `<canvas>`; returns null when neither is available.
 * @returns {HTMLCanvasElement|OffscreenCanvas|null}
 */
function makeThumbCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = THUMB_SIZE;
    c.height = THUMB_SIZE;
    return c;
  }
  return null;
}

/**
 * Fallback thumbnail: a 3×3 block-colour mini-grid plus a height bar.
 * @param {CanvasRenderingContext2D} g
 * @param {object} design
 * @param {number} x
 * @param {number} y
 * @param {number} size
 */
function drawMiniGrid(g, design, x, y, size) {
  const p = size * 0.1;
  const inner = size - 2 * p;
  const cw = inner / 3;
  const blocks = design.blocks || [];
  for (let by = 0; by < 3; by++) {
    for (let bx = 0; bx < 3; bx++) {
      const b = blocks[by * 3 + bx];
      const color = (b && KLAM[b.landUse] && KLAM[b.landUse].color) || '#8fd694';
      g.fillStyle = color;
      g.fillRect(x + p + bx * cw, y + p + by * cw, cw, cw);
    }
  }
  let mh = 1;
  for (const c of design.cells) if (c.height > mh) mh = c.height;
  const barH = inner * Math.min(1, mh / 8);
  g.fillStyle = '#fde047';
  g.fillRect(x + size - p * 0.55, y + p + inner - barH, p * 0.35, barH);
}

/**
 * Create an archive-view controller bound to a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{showArchetypes?:boolean, showPareto?:boolean, interactive?:boolean}} [opts]
 * @returns {{
 *   resize:()=>void,
 *   render:(state:object, now?:number)=>void,
 *   hitTest:(mx:number,my:number)=>({bx:number,by:number,elite:object|null}|null),
 *   onPointerDown:(mx:number,my:number)=>({bx:number,by:number,elite:object|null}|null),
 *   onKeyDown:(key:string)=>({handled:boolean, select:{designId:number}|null}),
 *   setFocused:(f:boolean)=>void
 * }}
 */
export function createArchiveView(canvas, opts = {}) {
  const showArchetypes = !!opts.showArchetypes;
  const showPareto = !!opts.showPareto;
  const interactive = !!opts.interactive;

  const ctx = canvas.getContext('2d');

  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  /** False while the canvas is hidden/zero-sized (skip all rendering). */
  let hasSize = false;

  /** Keyboard focus cursor over the archive grid, or null when inactive. */
  let focusBin = null;

  /** Whether the canvas currently holds keyboard focus. */
  let isFocused = false;

  /** Last computed grid layout (CSS px), used by `hitTest`. */
  let layout = { ox: 0, oy: 0, cell: 0 };

  /** Bins from the most recent `render()` call, used by `hitTest`. */
  let lastBins = [];

  /** Indices filled at the previous render (for new-elite detection). */
  const prevFilled = new Set();

  /** idx → flash start timestamp (ms). */
  const flashStart = new Map();

  /** design id → `{mode:'thumb', canvas}` | `{mode:'grid'}`. */
  const thumbCache = new Map();

  /** Design ids whose thumbnail has already been requested. */
  const seenThumbs = new Set();

  /** Signature of the last rendered state (for cheap skip). */
  let lastSig = null;

  /** Whether the previous render had any filled bins (archive-reset detect). */
  let lastHadFilled = false;

  /** DPR-aware resize: cap DPR at 2, backing = CSS × DPR, reset transform. */
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

  /**
   * Ensure a thumbnail cache record exists for a design (render once).
   * @param {object} design
   * @returns {{mode:string, canvas?:object}|null}
   */
  function ensureThumb(design) {
    if (!design) return null;
    const id = design.id;
    const hit = thumbCache.get(id);
    if (hit) return hit;

    if (!USE_THUMBNAILS) {
      const rec = { mode: 'grid' };
      thumbCache.set(id, rec);
      return rec;
    }
    const cv = makeThumbCanvas();
    const tctx = cv && cv.getContext ? cv.getContext('2d') : null;
    if (!cv || !tctx) {
      const rec = { mode: 'grid' };
      thumbCache.set(id, rec);
      return rec;
    }
    const geom = computeGeom(cv, N, maxHeightOf(design));
    renderThumbnail(tctx, design, geom);
    const rec = { mode: 'thumb', canvas: cv };
    thumbCache.set(id, rec);
    return rec;
  }

  /**
   * Keep the thumbnail cache bounded to the currently visible design ids.
   * @param {Set<number>} currentIds
   */
  function pruneThumbs(currentIds) {
    if (thumbCache.size <= THUMB_CACHE_SOFT_MAX) return;
    for (const id of Array.from(thumbCache.keys())) {
      if (!currentIds.has(id)) thumbCache.delete(id);
    }
  }

  /**
   * Render one frame of the archive heatmap.
   * @param {object} state - App state (uses `state.archive`, `state.archetypes`,
   *   `state.selectedArchetype`).
   * @param {number} [now] - Timestamp in ms (defaults to `performance.now()`).
   */
  function render(state, now) {
    if (!hasSize) return;
    const nowMs = now != null ? now : performance.now();
    const archive = state.archive || { bins: [], coverage: 0, best: null, pareto: [] };
    const bins = archive.bins || [];
    lastBins = bins;

    // --- Filled set + lightweight signature ---------------------------------
    const current = new Set();
    const idToIdx = new Map();
    const currentIds = new Set();
    let sig = 0;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      if (!b || !b.design) continue;
      current.add(i);
      idToIdx.set(b.design.id, i);
      currentIds.add(b.design.id);
      sig = (Math.imul(sig, 31) + (b.design.id | 0)) >>> 0;
    }

    // Archive reset (new search): drop stale caches.
    if (current.size === 0 && lastHadFilled) {
      thumbCache.clear();
      seenThumbs.clear();
      prevFilled.clear();
      flashStart.clear();
    }
    lastHadFilled = current.size > 0;

    // Drop expired flashes so the skip check stays accurate. Deleting during
    // Map iteration is safe and avoids an intermediate array allocation.
    for (const [idx, st] of flashStart) {
      if (nowMs - st >= FLASH_MS) flashStart.delete(idx);
    }
    const flashActive = flashStart.size > 0;

    const sigStr = [
      state.phase,
      current.size,
      sig,
      archive.best && archive.best.design ? archive.best.design.id : '-',
      state.selectedDesignId,
      state.selectedArchetype,
      (state.archetypes || []).length,
      (archive.pareto || []).length,
      focusBin ? `${focusBin.bx}:${focusBin.by}` : '-',
      isFocused ? 1 : 0,
      getLang(),
    ].join('|');

    // Nothing changed and no animation running → cheap early-out.
    if (sigStr === lastSig && !flashActive) return;
    lastSig = sigStr;

    ctx.clearRect(0, 0, cssW, cssH);

    // --- Layout -------------------------------------------------------------
    const padL = 48;
    const padR = 16;
    const padT = 18;
    const padB = 44;
    const gw = Math.max(1, cssW - padL - padR);
    const gh = Math.max(1, cssH - padT - padB);
    const cell = Math.max(1, Math.min(gw / BINS, gh / BINS));
    const gridW = cell * BINS;
    const gridH = cell * BINS;
    const ox = padL + (gw - gridW) / 2;
    const oy = padT + (gh - gridH) / 2;
    layout = { ox, oy, cell };

    // --- New-elite detection + thumbnail generation -------------------------
    for (const i of current) if (!prevFilled.has(i)) flashStart.set(i, nowMs);
    prevFilled.clear();
    for (const i of current) prevFilled.add(i);

    for (const i of current) {
      const d = bins[i].design;
      if (!seenThumbs.has(d.id)) {
        seenThumbs.add(d.id);
        ensureThumb(d);
      }
    }
    pruneThumbs(currentIds);

    // --- Cells --------------------------------------------------------------
    for (let by = 0; by < BINS; by++) {
      for (let bx = 0; bx < BINS; bx++) {
        const idx = by * BINS + bx;
        const x = ox + bx * cell;
        const y = oy + by * cell;
        const elite = bins[idx];

        if (!elite) {
          ctx.fillStyle = EMPTY_COLOR;
          ctx.fillRect(x, y, cell, cell);
          continue;
        }

        // Heat border + thumbnail/grid inset inside the cell.
        ctx.fillStyle = heatColor(elite.fitness);
        ctx.fillRect(x, y, cell, cell);
        const rec = thumbCache.get(elite.design.id) || ensureThumb(elite.design);
        if (rec && rec.mode === 'thumb' && rec.canvas) {
          const inset = Math.max(1, cell * 0.1);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cell, cell);
          ctx.clip();
          ctx.drawImage(rec.canvas, x + inset, y + inset, cell - 2 * inset, cell - 2 * inset);
          ctx.restore();
        } else {
          drawMiniGrid(ctx, elite.design, x, y, cell);
        }

        // Flash overlay on first appearance.
        const age = nowMs - (flashStart.has(idx) ? flashStart.get(idx) : -Infinity);
        if (age >= 0 && age < FLASH_MS) {
          const k = 1 - age / FLASH_MS;
          ctx.save();
          ctx.globalAlpha = 0.35 + 0.5 * k;
          ctx.fillStyle = FLASH_COLOR;
          ctx.fillRect(x, y, cell, cell);
          ctx.restore();
        }
      }
    }

    // --- Grid lines ---------------------------------------------------------
    ctx.strokeStyle = 'rgba(15,23,42,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= BINS; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + i * cell, oy);
      ctx.lineTo(ox + i * cell, oy + gridH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox, oy + i * cell);
      ctx.lineTo(ox + gridW, oy + i * cell);
      ctx.stroke();
    }

    // --- Non-colour encodings: best star + selection outline ----------------
    const bestId = archive.best && archive.best.design ? archive.best.design.id : null;
    if (bestId != null && idToIdx.has(bestId)) {
      const i = idToIdx.get(bestId);
      const bx = i % BINS;
      const by = Math.floor(i / BINS);
      const scx = ox + (bx + 0.5) * cell;
      const scy = oy + (by + 0.5) * cell;
      ctx.save();
      ctx.fillStyle = '#fde047';
      ctx.font = '700 ' + Math.round(cell * 0.8) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u2605', scx, scy + cell * 0.04);
      ctx.restore();
    }

    if (state.selectedDesignId != null && idToIdx.has(state.selectedDesignId)) {
      const i = idToIdx.get(state.selectedDesignId);
      const bx = i % BINS;
      const by = Math.floor(i / BINS);
      const x = ox + bx * cell;
      const y = oy + by * cell;
      ctx.save();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.fillStyle = '#f8fafc';
      const hs = Math.max(4, cell * 0.16);
      for (const [hx, hy] of [
        [x, y], [x + cell, y], [x, y + cell], [x + cell, y + cell],
      ]) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
      ctx.restore();
    }

    // --- Keyboard focus cursor ----------------------------------------------
    if (focusBin && isFocused) {
      const x = ox + focusBin.bx * cell;
      const y = oy + focusBin.by * cell;
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // --- Pareto front (stepped polyline, endpoints, label) ------------------
    if (showPareto && archive.pareto && archive.pareto.length) {
      const idToBin = new Map();
      for (let i = 0; i < bins.length; i++) if (bins[i]) idToBin.set(bins[i].design.id, i);
      const pts = [];
      for (const id of archive.pareto) {
        const i = idToBin.get(id);
        if (i == null) continue;
        const bx = i % BINS;
        const by = Math.floor(i / BINS);
        pts.push({ x: ox + (bx + 0.5) * cell, y: oy + (by + 0.5) * cell, bx });
      }
      pts.sort((a, b) => a.bx - b.bx);
      if (pts.length > 1) {
        ctx.save();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i - 1].y); // horizontal step
          ctx.lineTo(pts[i].x, pts[i].y);     // vertical step
        }
        ctx.stroke();

        // Endpoint dots.
        const ends = [pts[0], pts[pts.length - 1]];
        ctx.fillStyle = '#f8fafc';
        for (const p of ends) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(3, cell * 0.09), 0, Math.PI * 2);
          ctx.fill();
        }

        // Label.
        const lastP = pts[pts.length - 1];
        ctx.font = '700 11px Inter, system-ui, sans-serif';
        ctx.textAlign = lastP.x > ox + gridW * 0.6 ? 'right' : 'left';
        ctx.textBaseline = 'bottom';
        const lx = lastP.x > ox + gridW * 0.6 ? lastP.x - 8 : lastP.x + 8;
        ctx.fillText(t('archive.pareto'), lx, Math.max(oy + 10, lastP.y - 6));
        ctx.restore();
      }
    }

    // --- Archetype badges + selected medoid outline -------------------------
    if (showArchetypes && state.archetypes && state.archetypes.length) {
      const idToArch = new Map();
      for (const a of state.archetypes) {
        for (const id of a.memberIds || []) idToArch.set(id, a);
      }

      // Selected-archetype member highlight.
      if (state.selectedArchetype) {
        const sel = state.archetypes.find((x) => x.id === state.selectedArchetype);
        if (sel) {
          const memberSet = new Set(sel.memberIds || []);
          for (let i = 0; i < bins.length; i++) {
            const b = bins[i];
            if (!b || !memberSet.has(b.design.id)) continue;
            const bx = i % BINS;
            const by = Math.floor(i / BINS);
            ctx.save();
            ctx.globalAlpha = 0.28;
            ctx.fillStyle = sel.color;
            ctx.fillRect(ox + bx * cell, oy + by * cell, cell, cell);
            ctx.restore();
            ctx.strokeStyle = sel.color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(ox + bx * cell + 0.75, oy + by * cell + 0.75, cell - 1.5, cell - 1.5);
          }
        }
      }

      // Letter badges in coloured circles (top-right of each member cell).
      const r = Math.max(6, cell * 0.17);
      for (let i = 0; i < bins.length; i++) {
        const b = bins[i];
        if (!b) continue;
        const a = idToArch.get(b.design.id);
        if (!a) continue;
        const bx = i % BINS;
        const by = Math.floor(i / BINS);
        const cx = ox + (bx + 0.8) * cell;
        const cy = oy + (by + 0.2) * cell;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = a.color || '#38bdf8';
        ctx.fill();
        ctx.strokeStyle = 'rgba(15,23,42,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.font = `700 ${Math.round(r * 1.25)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.badge || a.id || '?', cx, cy + 0.5);
      }

      // Selected medoid outline.
      if (state.selectedArchetype) {
        const a = state.archetypes.find((x) => x.id === state.selectedArchetype);
        if (a && a.medoidId != null) {
          for (let i = 0; i < bins.length; i++) {
            if (bins[i] && bins[i].design.id === a.medoidId) {
              const bx = i % BINS;
              const by = Math.floor(i / BINS);
              ctx.strokeStyle = a.color;
              ctx.lineWidth = 2.5;
              ctx.strokeRect(ox + bx * cell + 1, oy + by * cell + 1, cell - 2, cell - 2);
              break;
            }
          }
        }
      }
    }

    // --- Axis labels --------------------------------------------------------
    ctx.save();
    ctx.fillStyle = 'rgba(226,232,240,0.85)';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(t('archive.xAxis'), ox + gridW / 2, oy + gridH + 8);
    // The Y axis increases downward (by = 0 is the top row), so the label is
    // rotated +90°: it reads top-to-bottom and its trailing arrow points down.
    ctx.translate(14, oy + gridH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(t('archive.yAxis'), 0, 0);
    ctx.restore();

    // --- Coverage readout ---------------------------------------------------
    const filled = current.size;
    const pct = Math.round((filled / (BINS * BINS)) * 100);
    ctx.save();
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t('archive.coverage', { filled, total: BINS * BINS, pct }), padL, 2);
    ctx.restore();
  }

  /**
   * Map a CSS-pixel point to a bin. Only meaningful after a `render()`.
   * @param {number} mx
   * @param {number} my
   * @returns {{bx:number,by:number,elite:object|null}|null}
   */
  function hitTest(mx, my) {
    const { ox, oy, cell } = layout;
    if (cell <= 0) return null;
    const bx = Math.floor((mx - ox) / cell);
    const by = Math.floor((my - oy) / cell);
    if (bx < 0 || bx >= BINS || by < 0 || by >= BINS) return null;
    const idx = by * BINS + bx;
    return { bx, by, elite: lastBins[idx] || null };
  }

  /**
   * Pointer-down handler. Returns the hit bin when `interactive`, else null.
   * @param {number} mx
   * @param {number} my
   * @returns {{bx:number,by:number,elite:object|null}|null}
   */
  function onPointerDown(mx, my) {
    if (!interactive) return null;
    return hitTest(mx, my);
  }

  /**
   * Keyboard navigation over the archive grid. Arrow keys move a focused cell;
   * Enter/Space select the elite in that bin; Escape clears the cursor.
   *
   * @param {string} key
   * @returns {{handled:boolean, select:{designId:number}|null}}
   */
  function onKeyDown(key) {
    if (key === 'Escape') {
      if (!focusBin) return { handled: false, select: null };
      focusBin = null;
      return { handled: true, select: null };
    }

    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      if (!focusBin) focusBin = { bx: 0, by: 0 };
      const elite = lastBins[focusBin.by * BINS + focusBin.bx] || null;
      if (elite && elite.design) {
        return { handled: true, select: { designId: elite.design.id } };
      }
      return { handled: true, select: null };
    }

    let bx = focusBin ? focusBin.bx : 0;
    let by = focusBin ? focusBin.by : 0;
    if (key === 'ArrowLeft') bx--;
    else if (key === 'ArrowRight') bx++;
    else if (key === 'ArrowUp') by--;
    else if (key === 'ArrowDown') by++;
    else return { handled: false, select: null };

    focusBin = {
      bx: Math.max(0, Math.min(BINS - 1, bx)),
      by: Math.max(0, Math.min(BINS - 1, by)),
    };
    return { handled: true, select: null };
  }

  /** Track canvas focus so the keyboard cursor is only drawn when focused. */
  function setFocused(f) {
    isFocused = !!f;
    if (!isFocused) focusBin = null;
  }

  return { resize, render, hitTest, onPointerDown, onKeyDown, setFocused };
}
