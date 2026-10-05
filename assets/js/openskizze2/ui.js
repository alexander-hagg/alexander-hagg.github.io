/**
 * OpenSKIZZE 2.0 — DOM wiring for Phase 1 (site selection).
 *
 * Renders the preset list and site readout, wires the primary CTAs, keeps the
 * phase stepper in sync, toggles phase-section visibility, and delegates
 * pointer/keyboard input on the city-map canvas to the citymap controller.
 *
 * Later subtasks extend this module at the clearly-marked hooks below.
 *
 * Pure ES module: no side effects on import.
 */

import { PRESETS, N, BINS } from './config.js';
import { KLAM, KLAM_IDS } from './klam.js';
import { selectedDesign, describeCell } from './iso.js';

/**
 * Initialise all Phase-1 UI bindings.
 *
 * @param {{getState:()=>object, dispatch:(a:object)=>object, subscribe:(fn:Function)=>()=>void}} store
 * @param {{citymap: object|null}} deps
 */
export function initUI(store, deps) {
  const citymap = deps && deps.citymap ? deps.citymap : null;
  const resizeAll = deps && typeof deps.resizeAll === 'function' ? deps.resizeAll : null;
  const $ = (id) => document.getElementById(id);

  const presetList = $('preset-list');
  const siteReadout = $('site-readout');
  const btnRun = $('btn-run-search');
  const btnDemo = $('btn-instant-demo');
  const stepper = $('phase-stepper');
  const canvas = $('CityMapCanvas');
  const evalTicker = $('eval-ticker');
  const btnPresent = $('btn-present');

  const phases = {
    SELECT: $('phase-select'),
    OPTIMIZING: $('phase-optimizing'),
    EXPLORE: $('phase-explore'),
  };

  // ---------------------------------------------------------------------------
  // Preset list
  // ---------------------------------------------------------------------------

  function renderPresets() {
    if (!presetList) return;
    presetList.innerHTML = '';
    for (const p of PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.presetId = p.id;
      btn.className =
        'preset-btn text-left px-3 py-2 rounded-lg border border-white/10 bg-white/5 ' +
        'hover:bg-white/10 transition text-sm';
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        store.dispatch({ type: 'SET_PRESET', presetId: p.id, box: { ...p.box } });
      });
      presetList.appendChild(btn);
    }
  }

  /** Highlight the active preset button. @param {object} state */
  function markActivePreset(state) {
    if (!presetList) return;
    for (const btn of presetList.querySelectorAll('[data-preset-id]')) {
      const active = btn.dataset.presetId === state.site.presetId;
      btn.classList.toggle('border-cold', active);
      btn.classList.toggle('bg-cold/10', active);
    }
  }

  // ---------------------------------------------------------------------------
  // Site readout
  // ---------------------------------------------------------------------------

  /** @param {object} state */
  function renderReadout(state) {
    if (!siteReadout) return;
    const preset = PRESETS.find((p) => p.id === state.site.presetId) || PRESETS[0];
    const city = preset.city || { name: '', tagline: '' };
    const b = state.site.box;
    siteReadout.innerHTML =
      '<div class="fs-16 font-semibold text-slate-100">' + preset.name + '</div>' +
      (city.name
        ? '<div class="fs-13 font-semibold text-cold mt-0.5">' + city.name + '</div>' +
          '<div class="fs-12 text-slate-400 italic">' + (city.tagline || '') + '</div>'
        : '') +
      '<div class="fs-12 text-slate-300 mt-1">' +
      (preset.description || '') +
      '</div>' +
      '<div class="fs-12 text-slate-300 mt-1 leading-snug">' +
      (preset.rationale || '') +
      '</div>' +
      '<div class="mt-2 fs-12 font-mono text-cold">box: x=' + b.x +
      ', y=' + b.y + ', w=' + b.w + ', h=' + b.h + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Phase-2 evaluation ticker
  // ---------------------------------------------------------------------------

  /**
   * Render the live evaluation counter, progress bar and niche coverage.
   * The preview canvas itself is owned by main.js (it needs the RAF clock for
   * the flash effect); this module only updates the DOM readout.
   *
   * @param {object} state
   */
  function renderTicker(state) {
    if (!evalTicker) return;
    const total = state.totalCandidates || 1;
    const n = state.candidatesEvaluated || 0;
    const pct = Math.min(100, Math.round((n / total) * 100));
    const bins = state.archive && state.archive.bins ? state.archive.bins : [];
    let filled = 0;
    for (const b of bins) if (b) filled++;
    const binTotal = BINS * BINS;
    const covPct = Math.round((filled / binTotal) * 100);

    evalTicker.innerHTML =
      '<div class="flex items-center justify-between fs-12 text-slate-300">' +
        '<span>Evaluating candidate</span>' +
        '<span class="text-slate-100">' + n + ' / ' + total + '</span>' +
      '</div>' +
      '<div class="mt-1 h-2 rounded bg-white/10 overflow-hidden">' +
        '<div class="h-full bg-cold transition-all" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="mt-2 fs-12 text-slate-300">Niche coverage: ' +
        '<span class="text-cold font-semibold">' + filled + ' / ' + binTotal + '</span> (' + covPct + '%)' +
      '</div>';
  }

  // ---------------------------------------------------------------------------
  // Phase stepper + section visibility
  // ---------------------------------------------------------------------------

  /** @param {object} state */
  function renderStepper(state) {
    if (!stepper) return;
    for (const li of stepper.querySelectorAll('[data-phase]')) {
      const active = li.dataset.phase === state.phase;
      li.classList.toggle('text-cold', active);
      li.classList.toggle('font-semibold', active);
      li.classList.toggle('text-slate-300', !active);
    }
  }

  /** @param {object} state */
  function renderPhases(state) {
    for (const name of Object.keys(phases)) {
      const el = phases[name];
      if (!el) continue;
      const active = name === state.phase;
      el.classList.toggle('hidden', !active);
      el.classList.toggle('phase-active', active);
      el.classList.toggle('phase-enter', !active);
    }
  }

  // ---------------------------------------------------------------------------
  // Primary CTAs
  // ---------------------------------------------------------------------------

  if (btnRun) {
    btnRun.addEventListener('click', () => store.dispatch({ type: 'RUN_SEARCH' }));
  }

  if (btnDemo) {
    btnDemo.addEventListener('click', () => {
      // Restart the whole flow, then immediately kick off the search so a
      // presenter can replay the demo in ~1s.
      store.dispatch({ type: 'RESTART' });
      store.dispatch({ type: 'RUN_SEARCH' });
    });
  }

  if (btnPresent) {
    btnPresent.addEventListener('click', () => {
      const on = !document.body.classList.contains('presentation');
      document.body.classList.toggle('presentation', on);
      btnPresent.setAttribute('aria-pressed', String(on));
      btnPresent.textContent = on ? '✕ Exit Presentation' : '🖥️ Presentation';
      // Presentation mode changes the explore layout, so re-measure every
      // canvas (falls back to the two explore canvases when no orchestrator).
      requestAnimationFrame(() => {
        if (resizeAll) resizeAll();
        else {
          if (iso) iso.resize();
          if (archive2) archive2.resize();
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // City-map pointer + keyboard delegation
  // ---------------------------------------------------------------------------

  if (canvas && citymap) {
    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      const p = toLocal(e);
      if (citymap.onPointerDown(p.x, p.y)) {
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = toLocal(e);
      citymap.onPointerMove(p.x, p.y);
    });

    canvas.addEventListener('pointerup', () => citymap.onPointerUp());
    canvas.addEventListener('pointercancel', () => citymap.onPointerUp());

    canvas.addEventListener('keydown', (e) => {
      if (citymap.onKeyDown(e.key)) e.preventDefault();
    });
  }

  // ---------------------------------------------------------------------------
  // [Subtask 4] Phase-3 wiring: layers, tooltip, audience, archetypes, clicks
  // ---------------------------------------------------------------------------

  const archive = deps && deps.archive ? deps.archive : null;
  const archive2 = deps && deps.archive2 ? deps.archive2 : null;
  const iso = deps && deps.iso ? deps.iso : null;
  const dashboard = deps && deps.dashboard ? deps.dashboard : null;

  const layerToggles = $('layer-toggles');
  const audienceToggle = $('audience-toggle');
  const archetypeLegend = $('archetype-legend');
  const cellTooltip = $('cell-tooltip');
  const isoCanvas = $('IsoViewerCanvas');
  const archiveCanvas = $('ArchiveCanvas');
  const archive2Canvas = $('ArchiveCanvas2');

  const LAYER_DEFS = [
    { key: 'airflow', label: 'Animated Airflow Streamlines' },
    { key: 'coldPool', label: 'Cold Air Layer Depth' },
    { key: 'legend', label: 'KLAM_21 Land Use Legend' },
  ];

  const AUDIENCE_DEFS = [
    { key: 'layman', label: '👤 Layman' },
    { key: 'planner', label: '📐 Urban Planner' },
    { key: 'department', label: '🏛️ Planning Dept' },
  ];

  /** Build the three layer-toggle buttons once. */
  function buildLayerToggles() {
    if (!layerToggles) return;
    layerToggles.innerHTML = '';
    for (const def of LAYER_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.layer = def.key;
      btn.className = 'fs-12 px-2.5 py-1.5 rounded-md border transition text-left';
      btn.textContent = def.label;
      btn.addEventListener('click', () => store.dispatch({ type: 'TOGGLE_LAYER', layer: def.key }));
      layerToggles.appendChild(btn);
    }
  }

  /** Reflect layer on/off state in the toggle buttons. @param {object} state */
  function renderLayerToggles(state) {
    if (!layerToggles) return;
    for (const btn of layerToggles.querySelectorAll('[data-layer]')) {
      const on = !!state.layers[btn.dataset.layer];
      btn.classList.toggle('bg-cold/20', on);
      btn.classList.toggle('border-cold/50', on);
      btn.classList.toggle('text-cold', on);
      btn.classList.toggle('bg-white/5', !on);
      btn.classList.toggle('border-white/10', !on);
      btn.classList.toggle('text-slate-300', !on);
    }
  }

  /** Build the three audience-switch buttons once. */
  function buildAudienceToggle() {
    if (!audienceToggle) return;
    audienceToggle.innerHTML = '';
    for (const def of AUDIENCE_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.audience = def.key;
      btn.className = 'flex-1 text-xs px-2 py-1.5 rounded-md border transition';
      btn.textContent = def.label;
      btn.addEventListener('click', () => store.dispatch({ type: 'SWITCH_AUDIENCE', audience: def.key }));
      audienceToggle.appendChild(btn);
    }
  }

  /** Reflect the active audience in the switch buttons. @param {object} state */
  function renderAudienceToggle(state) {
    if (!audienceToggle) return;
    for (const btn of audienceToggle.querySelectorAll('[data-audience]')) {
      const on = btn.dataset.audience === state.audience;
      btn.classList.toggle('bg-cold/20', on);
      btn.classList.toggle('border-cold/50', on);
      btn.classList.toggle('text-cold', on);
      btn.classList.toggle('bg-white/5', !on);
      btn.classList.toggle('border-white/10', !on);
      btn.classList.toggle('text-slate-300', !on);
    }
  }

  /** Signature of the last-rendered archetype legend (avoids per-TICK rebuilds). */
  let lastLegendSig = null;

  /** Render the four archetype legend entries. @param {object} state */
  function renderArchetypeLegend(state) {
    if (!archetypeLegend) return;
    const archs = state.archetypes || [];
    const sig = archs.map((a) => a.id + ':' + a.medoidId + ':' + a.memberIds.length).join('|') +
      '#' + state.selectedArchetype;
    if (sig === lastLegendSig) return;
    lastLegendSig = sig;

    if (!archs.length) {
      archetypeLegend.innerHTML = '<div class="text-slate-300 fs-14">No archetypes yet.</div>';
      return;
    }
    archetypeLegend.innerHTML = '';
    for (const a of archs) {
      const active = state.selectedArchetype === a.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md border transition text-left ' +
        (active ? 'border-cold/60 bg-cold/10' : 'border-white/10 bg-white/5 hover:bg-white/10');
      btn.innerHTML =
        '<span class="w-5 h-5 rounded flex items-center justify-center fs-11 font-bold text-slate-900" style="background:' +
          a.color + '">' + a.badge + '</span>' +
        '<span class="flex-1 truncate fs-12">' + a.name + '</span>' +
        '<span class="text-slate-300 fs-12">' + (a.memberIds ? a.memberIds.length : 0) + '</span>';
      btn.addEventListener('click', () => store.dispatch({ type: 'SELECT_ARCHETYPE', archetypeId: a.id }));
      archetypeLegend.appendChild(btn);
    }
  }

  /** Lazily create the KLAM_21 legend overlay inside the iso container. */
  let klamLegend = null;
  function ensureKlamLegend() {
    if (klamLegend || !isoCanvas) return;
    const parent = isoCanvas.parentElement;
    if (!parent) return;
    klamLegend = document.createElement('div');
    klamLegend.id = 'klam-legend';
    klamLegend.className = 'absolute bottom-2 left-2 glass p-3 fs-11 text-slate-200 hidden';
    let html = '<div class="font-semibold mb-1 text-slate-100">KLAM_21 Land Use</div>';
    for (const id of KLAM_IDS) {
      const k = KLAM[id];
      html +=
        '<div class="flex items-center gap-2">' +
          '<span class="w-3 h-3 rounded-sm shrink-0" style="background:' + k.color + '"></span>' +
          '<span class="flex-1">' + k.label + '</span>' +
          '<span class="font-mono text-slate-300">z0 ' + k.z0 + ' · pCold ' + k.pCold + '</span>' +
        '</div>';
    }
    klamLegend.innerHTML = html;
    parent.appendChild(klamLegend);
  }

  /** Show/hide the KLAM legend by layer state. @param {object} state */
  function renderKlamLegend(state) {
    ensureKlamLegend();
    if (klamLegend) klamLegend.classList.toggle('hidden', !state.layers.legend);
  }

  /**
   * Place the tooltip next to the anchor, flipping and clamping so it never
   * leaves the iso panel. Updates the arrow position via `--arrow-x`.
   */
  function positionTooltip(clientX, clientY) {
    if (!cellTooltip || !isoCanvas) return;
    const panel = isoCanvas.parentElement || isoCanvas;
    const pr = panel.getBoundingClientRect();
    const pw = cellTooltip.offsetWidth || 180;
    const ph = cellTooltip.offsetHeight || 80;
    const localX = clientX - pr.left;
    const localY = clientY - pr.top;

    let left = localX + 14;
    let top = localY + 14;
    let above = false;
    if (left + pw > pr.width - 4) left = localX - pw - 14;
    if (left < 4) left = 4;
    if (top + ph > pr.height - 4) { top = localY - ph - 14; above = true; }
    if (top < 4) { top = 4; above = false; }

    cellTooltip.style.left = left + 'px';
    cellTooltip.style.top = top + 'px';
    cellTooltip.classList.toggle('tooltip-above', above);
    const arrowX = Math.max(10, Math.min(pw - 10, localX - left));
    cellTooltip.style.setProperty('--arrow-x', arrowX + 'px');
  }

  /** Position and fill the cell tooltip with richer cell + block details. */
  function showTooltip(state, cell, clientX, clientY) {
    if (!cellTooltip || !isoCanvas) return;
    const design = selectedDesign(state);
    if (!design) { cellTooltip.classList.add('hidden'); return; }
    const raw = design.cells[cell.gy * N + cell.gx];
    const info = describeCell(design, cell.gx, cell.gy);
    if (!raw || !info) { cellTooltip.classList.add('hidden'); return; }
    const fpPct = Math.round((raw.footprint || 0) * 100);
    const block = (raw.blockId >= 0 && design.blocks) ? design.blocks[raw.blockId] : null;
    const landUse = block
      ? (KLAM[block.landUse] ? KLAM[block.landUse].label : block.landUse)
      : 'Street / public realm';
    cellTooltip.innerHTML =
      '<div class="fs-14 font-semibold text-slate-100">' + info.label + '</div>' +
      '<div class="fs-11 text-slate-300 mt-0.5 font-mono">' + raw.klam + '</div>' +
      '<div class="fs-12 mt-1 space-y-0.5 text-slate-300">' +
        '<div>Height: <span class="text-slate-100">' + raw.height + ' ' + (raw.height === 1 ? 'storey' : 'storeys') + '</span></div>' +
        '<div>Footprint: <span class="text-slate-100">' + fpPct + '%</span></div>' +
        '<div>Roof: <span class="text-slate-100">' + raw.roofType + '</span></div>' +
        '<div>z0: <span class="text-slate-100">' + info.z0 + ' m</span></div>' +
        '<div>Block land use: <span class="text-slate-100">' + landUse + '</span></div>' +
      '</div>';
    cellTooltip.classList.remove('hidden');
    positionTooltip(clientX, clientY);
  }

  /** Hide the cell tooltip. */
  function hideTooltip() {
    if (cellTooltip) cellTooltip.classList.add('hidden');
  }

  /** Show the tooltip anchored to a cell via the viewer's own projection. */
  function showTooltipForCell(cell) {
    if (!cell || !isoCanvas || !iso) { hideTooltip(); return; }
    const pos = iso.cellScreenPos ? iso.cellScreenPos(cell.gx, cell.gy) : null;
    const r = isoCanvas.getBoundingClientRect();
    if (pos) showTooltip(store.getState(), cell, r.left + pos.x, r.top + pos.y);
    else showTooltip(store.getState(), cell, r.left + r.width / 2, r.top + 12);
  }

  if (isoCanvas && iso) {
    isoCanvas.addEventListener('pointermove', (e) => {
      const r = isoCanvas.getBoundingClientRect();
      const cell = iso.onPointerMove(e.clientX - r.left, e.clientY - r.top);
      if (cell) showTooltip(store.getState(), cell, e.clientX, e.clientY);
      else hideTooltip();
    });
    isoCanvas.addEventListener('pointerleave', () => {
      iso.onPointerLeave();
      hideTooltip();
    });
    // Keyboard navigation: arrow keys move the hovered cell, Escape clears it.
    isoCanvas.addEventListener('keydown', (e) => {
      if (!iso.onKeyDown(e.key)) return;
      e.preventDefault();
      showTooltipForCell(store.getState().hoveredCell);
    });
    isoCanvas.addEventListener('blur', () => {
      iso.onPointerLeave();
      hideTooltip();
    });
  }

  if (archive2Canvas && archive2) {
    archive2Canvas.addEventListener('pointerdown', (e) => {
      const r = archive2Canvas.getBoundingClientRect();
      const hit = archive2.onPointerDown(e.clientX - r.left, e.clientY - r.top);
      if (hit && hit.elite && hit.elite.design) {
        store.dispatch({ type: 'SELECT_DESIGN', designId: hit.elite.design.id });
      }
    });
  }

  /**
   * Wire focus + keyboard navigation for an archive heatmap: arrows move a
   * focused cell, Enter/Space selects its elite, Escape clears the cursor.
   *
   * @param {HTMLCanvasElement|null} canvasEl
   * @param {object|null} controller
   */
  function wireArchiveKeyboard(canvasEl, controller) {
    if (!canvasEl || !controller) return;
    canvasEl.addEventListener('focus', () => controller.setFocused(true));
    canvasEl.addEventListener('blur', () => controller.setFocused(false));
    canvasEl.addEventListener('keydown', (e) => {
      const res = controller.onKeyDown(e.key);
      if (!res || !res.handled) return;
      e.preventDefault();
      if (res.select && res.select.designId != null) {
        store.dispatch({ type: 'SELECT_DESIGN', designId: res.select.designId });
      }
    });
  }
  wireArchiveKeyboard(archiveCanvas, archive);
  wireArchiveKeyboard(archive2Canvas, archive2);

  buildLayerToggles();
  buildAudienceToggle();

  // ---------------------------------------------------------------------------
  // Store subscription
  // ---------------------------------------------------------------------------

  let lastTickerAt = 0;
  store.subscribe((state) => {
    renderReadout(state);
    renderStepper(state);
    renderPhases(state);
    markActivePreset(state);

    // Phase-2 ticker: throttled to ~10 fps (TICK fires ~230×/s).
    const now = performance.now();
    if (state.phase === 'OPTIMIZING' || state.phase === 'EXPLORE') {
      if (now - lastTickerAt > 100 || state.candidatesEvaluated >= state.totalCandidates) {
        lastTickerAt = now;
        renderTicker(state);
      }
    }

    // Phase-3 panels.
    renderLayerToggles(state);
    renderAudienceToggle(state);
    renderArchetypeLegend(state);
    renderKlamLegend(state);
    if (dashboard) dashboard.render(state);
  });

  // Initial paint.
  renderPresets();
  const s = store.getState();
  renderReadout(s);
  renderStepper(s);
  renderPhases(s);
  markActivePreset(s);
  renderTicker(s);
}
