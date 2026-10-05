/**
 * OpenSKIZZE 2.0 — application bootstrap and single RAF loop.
 *
 * Creates the store, the city-map controller, the archive heatmap and the
 * preview thumbnail, then drives one requestAnimationFrame loop that updates
 * and renders whichever phase is active.
 *
 * Phase 2 (OPTIMIZING) is driven here: candidates are generated once on
 * `RUN_SEARCH`, then `update(dt)` advances a time-based ticker that dispatches
 * one `TICK` per candidate so the search always completes in ~`SIM.DURATION_MS`
 * regardless of frame rate. Rendering is throttled to ~20 fps.
 *
 * The preview renderer is owned by this module (it needs the RAF `now` clock
 * for the flash effect); `ui.js` only updates the DOM ticker.
 *
 * This is the only module with a side effect: it bootstraps on DOMContentLoaded.
 */

import { SIM, N, PRESETS } from './config.js';
import { createStore, reducer, initialState } from './state.js';
import { createCityMap } from './citymap.js';
import { initUI } from './ui.js';
import { generateCandidates } from './simulation.js';
import { computeMetrics, computeDescriptor, computeFitness } from './design.js';
import { createArchiveView } from './archiveview.js';
import { computeGeom, renderThumbnail, createIsoViewer, selectedDesign } from './iso.js';
import { createAirflow } from './airflow.js';
import { createDashboard } from './dashboard.js';

/** Candidates for the current search (generated once on RUN_SEARCH). */
let candidates = null;

/** Design id whose airflow field is currently built. */
let lastFieldDesignId = null;

/** Minimum ms between archive/preview redraws (~20 fps). */
const DRAW_INTERVAL_MS = 50;

/**
 * Create a small isometric preview renderer for the Phase-2 candidate canvas.
 * Owned by main.js so it can use the RAF clock for the rapid flash.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{resize:()=>void, render:(design:object|null, now:number, flashing:boolean)=>void}}
 */
function createPreview(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let hasSize = false;

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

  /** Tallest building in the design (stories). @param {object} design */
  function maxHeightOf(design) {
    let m = 1;
    for (const c of design.cells) if (c.height > m) m = c.height;
    return m;
  }

  /**
   * @param {object|null} design
   * @param {number} now
   * @param {boolean} flashing
   */
  function render(design, now, flashing) {
    if (!hasSize) return;
    ctx.clearRect(0, 0, cssW, cssH);
    if (!design) return;
    const geom = computeGeom(canvas, N, maxHeightOf(design));
    renderThumbnail(ctx, design, geom);
    if (flashing && Math.floor(now / 90) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#fde047';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }
  }

  return { resize, render };
}

/**
 * Resolve the selected preset's cold-air direction from app state.
 * @param {object} state
 * @returns {{x:number,y:number}}
 */
function resolveWindDir(state) {
  const preset = PRESETS.find((p) => p.id === state.site.presetId) || PRESETS[0];
  const dir = preset && preset.city && preset.city.coldAir && preset.city.coldAir.dir;
  return dir ? { x: dir.x, y: dir.y } : { x: 0, y: 1 };
}

/**
 * Resolve the selected preset's cold-air direction label from app state.
 * @param {object} state
 * @returns {string}
 */
function resolveWindLabel(state) {
  const preset = PRESETS.find((p) => p.id === state.site.presetId) || PRESETS[0];
  return (preset && preset.city && preset.city.coldAir && preset.city.coldAir.label) || '';
}

/** Boot the application. */
function boot() {
  const store = createStore(reducer, initialState);

  // --- Controllers -----------------------------------------------------------
  const cityCanvas = document.getElementById('CityMapCanvas');
  const citymap = cityCanvas ? createCityMap(cityCanvas, store) : null;

  const archiveCanvas = document.getElementById('ArchiveCanvas');
  const archive = archiveCanvas ? createArchiveView(archiveCanvas) : null;

  const previewCanvas = document.getElementById('PreviewCanvas');
  const preview = previewCanvas ? createPreview(previewCanvas) : null;

  // --- Phase-3 controllers ---------------------------------------------------
  const archive2Canvas = document.getElementById('ArchiveCanvas2');
  const archive2 = archive2Canvas
    ? createArchiveView(archive2Canvas, { showArchetypes: true, showPareto: true, interactive: true })
    : null;

  const airflow = createAirflow();
  const isoCanvas = document.getElementById('IsoViewerCanvas');
  const iso = isoCanvas ? createIsoViewer(isoCanvas, { store, airflow }) : null;

  // Apply the initial city's cold-air direction to the airflow + iso viewer.
  {
    const s0 = store.getState();
    const d0 = resolveWindDir(s0);
    if (airflow) airflow.setWindDir(d0);
    if (iso && iso.setWind) iso.setWind(d0, resolveWindLabel(s0));
  }

  const dashboard = createDashboard(store);

  // --- Reduced motion --------------------------------------------------------
  const motionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let reducedMotion = !!(motionQuery && motionQuery.matches);

  /** Apply the current reduced-motion preference to renderers and CSS. */
  function applyReducedMotion(flag) {
    reducedMotion = !!flag;
    if (airflow) airflow.setReducedMotion(reducedMotion);
    if (document.body) document.body.classList.toggle('reduced-motion', reducedMotion);
  }
  applyReducedMotion(reducedMotion);
  if (motionQuery) {
    const onMotionChange = (e) => applyReducedMotion(e.matches);
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }

  initUI(store, { citymap, archive, archive2, iso, dashboard, resizeAll });

  // --- Candidate generation (once per RUN_SEARCH) ----------------------------
  store.subscribe((state, action) => {
    // Keep the airflow base wind and the iso orientation/cue in sync with the
    // selected city whenever the preset or search changes.
    if (action && (action.type === 'RUN_SEARCH' || action.type === 'SET_PRESET')) {
      const dir = resolveWindDir(state);
      if (airflow) airflow.setWindDir(dir);
      if (iso && iso.setWind) iso.setWind(dir, resolveWindLabel(state));
      lastFieldDesignId = null; // force a field rebuild for the new city
    }
    if (action && action.type === 'RUN_SEARCH') {
      // `state.site` carries only {presetId, box}; resolve the full preset so
      // `generateCandidates` receives its land-use `bias` (otherwise generation
      // silently falls back to all-grass and archive coverage collapses).
      const preset = PRESETS.find((p) => p.id === state.site.presetId) || PRESETS[0];
      candidates = generateCandidates(preset, SIM.TOTAL_CANDIDATES, SIM.SEED);
      // Precompute evaluation so ticking is cheap.
      for (const d of candidates) {
        computeMetrics(d);
        computeDescriptor(d);
        computeFitness(d);
      }
    }
  });

  // --- Resize orchestration --------------------------------------------------
  function resizeAll() {
    // Halve particle counts on narrow (<1280px) viewports.
    const wantCount = window.innerWidth < 1280 ? 90 : 180;
    if (airflow && airflow.getCount && airflow.getCount() !== wantCount) {
      airflow.setCount(wantCount);
    }
    if (citymap) citymap.resize();
    if (archive) archive.resize();
    if (preview) preview.resize();
    if (archive2) archive2.resize();
    if (iso) iso.resize();
  }

  resizeAll();

  // Re-measure when the active phase changes (a previously hidden canvas has
  // zero size until it becomes visible).
  let lastPhase = store.getState().phase;
  store.subscribe((state, action) => {
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      requestAnimationFrame(resizeAll);
    }
    // Lock the preview onto the best design once the search completes.
    if (action && action.type === 'SEARCH_COMPLETE' && preview) {
      const best = state.archive && state.archive.best ? state.archive.best.design : null;
      if (best) {
        requestAnimationFrame(() => {
          preview.resize();
          preview.render(best, performance.now(), false);
        });
      }
    }
  });

  // --- Update / render -------------------------------------------------------
  /**
   * Advance the MAP-Elites search animation. Time-based so it always finishes
   * in ~`SIM.DURATION_MS` regardless of frame rate.
   * @param {number} dt - Seconds since the previous frame (capped at 0.05).
   */
  function update(dt) {
    let state = store.getState();

    // Phase 3: advect the cold-air particles for the selected design.
    if (state.phase === 'EXPLORE') {
      airflow.update(dt, selectedDesign(state));
      return;
    }

    if (state.phase !== 'OPTIMIZING' || !candidates) return;

    state.animation.t += dt;
    const durationS = SIM.DURATION_MS / 1000;
    const target = Math.floor((state.animation.t / durationS) * SIM.TOTAL_CANDIDATES);
    const cap = Math.min(target, SIM.TOTAL_CANDIDATES);

    while (state.candidatesEvaluated < cap) {
      store.dispatch({ type: 'TICK', design: candidates[state.candidatesEvaluated] });
      state = store.getState();
    }

    if (state.candidatesEvaluated >= SIM.TOTAL_CANDIDATES) {
      store.dispatch({ type: 'SEARCH_COMPLETE' });
    }
  }

  let lastArchiveDraw = 0;
  let lastPreviewDraw = 0;
  let lastArchive2Draw = 0;

  /** Render whichever phase is currently active. */
  function renderActive() {
    const state = store.getState();
    const now = performance.now();

    if (state.phase === 'SELECT') {
      if (citymap) citymap.render(state);
    } else if (state.phase === 'OPTIMIZING') {
      if (archive && now - lastArchiveDraw >= DRAW_INTERVAL_MS) {
        lastArchiveDraw = now;
        archive.render(state, now);
      }
      if (preview && now - lastPreviewDraw >= DRAW_INTERVAL_MS) {
        lastPreviewDraw = now;
        const idx = Math.max(0, state.candidatesEvaluated - 1);
        const design = candidates ? candidates[Math.min(idx, candidates.length - 1)] : null;
        preview.render(design, now, !reducedMotion);
      }
    } else if (state.phase === 'EXPLORE') {
      // Rebuild the airflow field whenever the selected design changes.
      const design = selectedDesign(state);
      if (design && design.id !== lastFieldDesignId) {
        lastFieldDesignId = design.id;
        airflow.buildField(design, resolveWindDir(state));
      }
      if (archive2 && now - lastArchive2Draw >= DRAW_INTERVAL_MS) {
        lastArchive2Draw = now;
        archive2.render(state, now);
      }
      if (iso) iso.render(state, now);
    }
  }

  // --- Single RAF loop -------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const state = store.getState();
    if (!state.paused && !document.hidden) {
      update(dt);
      renderActive();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Window resize / orientation (debounced 100ms) ------------------------
  let resizeTimer = 0;
  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeAll, 100);
  }
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);

  // --- Visibility pause ------------------------------------------------------
  document.addEventListener('visibilitychange', () => {
    store.dispatch({ type: 'SET_PAUSED', paused: document.hidden });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
