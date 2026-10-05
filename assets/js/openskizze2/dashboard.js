/**
 * OpenSKIZZE 2.0 — dual-audience impact dashboard (R4).
 *
 * Renders the selected design's metrics into two panels: a friendly "Layman
 * Mode" (big KPI numbers for homes, fresh-air gauge with a reference
 * comparison, green space, summary badge) and a technical "Urban Planner Mode"
 * (GRZ/GFZ bars with statutory target bands, V_flux vs. all-grass reference,
 * roughness, surrogate uncertainty, a 7-class KLAM land-use donut, and a short
 * "why this design" narrative derived from the metrics). Visibility is driven
 * by `state.audience`.
 *
 * Pure ES module: no side effects on import.
 */

import { KLAM, KLAM_IDS } from './klam.js';
import { selectedDesign } from './iso.js';
import { SIM, V_FLUX_REF } from './config.js';

/** Format a number with thousands separators. @param {number} n @returns {string} */
function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** Format a number to `d` decimals. @param {number} n @param {number} d @returns {string} */
function fmt(n, d) {
  return Number(n).toFixed(d);
}

/** Clamp to [0,1]. @param {number} x @returns {number} */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0;
}

/** Friendly copy for the layman summary badge. @param {string} badge @returns {string} */
function badgeCopy(badge) {
  switch (badge) {
    case 'Cool & Green':
      return '🌿 Recommended: Balances housing demand with regional climate protection.';
    case 'High Capacity':
      return '🏗️ High Capacity: Delivers many homes — keep an eye on ventilation.';
    case 'Dense & Warm':
      return '🏙️ Dense & Warm: Maximises housing but traps heat — add green corridors.';
    default:
      return '⚖️ Balanced: A solid all-rounder for housing and cooling.';
  }
}

/** Qualitative label for the fresh-air inflow percentage. @param {number} pct @returns {string} */
function airLabel(pct) {
  if (pct >= 75) return 'Excellent downstream cooling';
  if (pct >= 50) return 'Good ventilation';
  if (pct >= 30) return 'Moderate airflow';
  return 'Weak airflow — heat risk';
}

/** Qualitative label for the surrogate uncertainty. @param {number} sigma @returns {string} */
function sigmaLabel(sigma) {
  if (sigma < 0.15) return 'Low';
  if (sigma < 0.3) return 'Moderate';
  return 'High';
}

/** Colour for a KLAM class swatch. @param {string} id @returns {string} */
function classColor(id) {
  return (KLAM[id] && KLAM[id].color) || '#94a3b8';
}

/** Human label for a KLAM class. @param {string} id @returns {string} */
function classLabel(id) {
  return KLAM[id] ? KLAM[id].label : id;
}

/**
 * A horizontal bar with a shaded statutory target band and a value fill.
 *
 * @param {number} value
 * @param {number} max
 * @param {number} bandLo
 * @param {number} bandHi
 * @param {string} color
 * @returns {string}
 */
function bandBar(value, max, bandLo, bandHi, color) {
  const pct = (v) => (Math.max(0, Math.min(max, v)) / max) * 100;
  const vp = pct(value);
  const lo = pct(bandLo);
  const hi = pct(bandHi);
  return (
    '<div class="relative h-3 rounded-full bg-white/10 overflow-hidden">' +
      '<div class="absolute inset-y-0 bg-emerald-400/20 border-x border-emerald-300/50" ' +
        'style="left:' + lo.toFixed(1) + '%;width:' + Math.max(1, hi - lo).toFixed(1) + '%"></div>' +
      '<div class="h-full rounded-full" style="width:' + vp.toFixed(1) + '%;background:' + color + '"></div>' +
    '</div>'
  );
}

/**
 * SVG donut of the 7-class KLAM land-use distribution plus a full legend
 * (including zero-percent classes, so all seven appear).
 *
 * @param {Record<string, number>} classPct
 * @returns {string}
 */
function klamDonut(classPct) {
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  let arcs = '';
  for (const id of KLAM_IDS) {
    const pct = classPct[id] || 0;
    if (pct <= 0.01) continue;
    const dash = (pct / 100) * C;
    arcs +=
      '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="' + classColor(id) + '" ' +
      'stroke-width="13" stroke-dasharray="' + dash.toFixed(2) + ' ' + (C - dash).toFixed(2) + '" ' +
      'stroke-dashoffset="' + (-offset * C).toFixed(2) + '" transform="rotate(-90 60 60)"></circle>';
    offset += pct / 100;
  }

  const svg =
    '<svg viewBox="0 0 120 120" class="w-28 h-28 shrink-0" role="img" aria-label="KLAM land-use distribution">' +
      '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="13"></circle>' +
      arcs +
      '<circle cx="60" cy="60" r="30" fill="rgba(15,23,42,0.55)"></circle>' +
      '<text x="60" y="58" text-anchor="middle" fill="#e2e8f0" font-size="11" font-family="system-ui">land</text>' +
      '<text x="60" y="70" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">use</text>' +
    '</svg>';

  let legend = '<div class="grid grid-cols-1 gap-1 flex-1 min-w-0">';
  for (const id of KLAM_IDS) {
    const pct = classPct[id] || 0;
    legend +=
      '<div class="flex items-center gap-2" data-class="' + id + '">' +
        '<span class="w-3 h-3 rounded-sm shrink-0" style="background:' + classColor(id) + '"></span>' +
        '<span class="fs-12 text-slate-300 flex-1 truncate">' + classLabel(id) + '</span>' +
        '<span class="fs-12 font-mono text-slate-200">' + fmt(pct, 0) + '%</span>' +
      '</div>';
  }
  legend += '</div>';

  return '<div class="flex items-center gap-4">' + svg + legend + '</div>';
}

/**
 * Build a short "why this design" narrative from the metrics.
 * @param {object} p - planner metrics
 * @param {object} m - full metrics bundle
 * @returns {string}
 */
function narrative(p, m) {
  const sentences = [];

  if (p.grz >= 0.45) sentences.push('A dense building footprint maximises housing on the parcel.');
  else if (p.grz <= 0.2) sentences.push('An open, low-coverage layout leaves generous ground space.');
  else sentences.push('A moderately dense block structure balances built and open space.');

  if (p.vFlux >= V_FLUX_REF * 0.6) {
    sentences.push('Cold night air penetrates deep into the parcel, keeping the area well ventilated.');
  } else if (p.vFlux < V_FLUX_REF * 0.3) {
    sentences.push('Ventilation is restricted by roughness and sheltering, so heat may accumulate.');
  } else {
    sentences.push('Night-time ventilation is adequate but could be improved with green corridors.');
  }

  const green = m.layman.greenSpace;
  if (green >= 40) sentences.push('Extensive green and blue surfaces further cool the microclimate.');
  else if (green < 15) sentences.push('Green and water surfaces are scarce, limiting evaporative cooling.');

  if (p.sigma >= 0.3) sentences.push('The surrogate is less certain here, so treat the figures as indicative.');

  return sentences.join(' ');
}

/**
 * Create the dashboard controller.
 *
 * @param {{getState:()=>object}} store
 * @returns {{render:(state:object)=>void}}
 */
export function createDashboard(store) {
  const laymanEl = typeof document !== 'undefined' ? document.getElementById('dashboard-layman') : null;
  const plannerEl = typeof document !== 'undefined' ? document.getElementById('dashboard-planner') : null;

  /** Render the Layman panel. @param {object} m */
  function renderLayman(m) {
    if (!laymanEl) return;
    const homes = m.layman.homes;
    const air = m.layman.freshAirInflow;
    const green = m.layman.greenSpace;
    const airPct = Math.max(0, Math.min(100, Math.round(air)));
    const greenPct = Math.max(0, Math.min(100, Math.round(green)));
    const refPct = Math.min(100, Math.round((m.planner.vFlux / V_FLUX_REF) * 100));

    laymanEl.innerHTML =
      '<div class="space-y-4">' +
        '<div class="glass p-4">' +
          '<div class="fs-12 uppercase tracking-wider text-slate-300">Homes Created</div>' +
          '<div class="mt-1 flex items-baseline gap-2">' +
            '<span class="fs-28 font-bold text-cold leading-none">' + fmtInt(homes) + '</span>' +
            '<span class="fs-14 text-slate-200">Residents</span>' +
          '</div>' +
          '<div class="mt-2 fs-16 tracking-widest">🏠🏠🏠🏠🏠</div>' +
        '</div>' +

        '<div class="glass p-4">' +
          '<div class="flex items-center justify-between">' +
            '<span class="fs-12 uppercase tracking-wider text-slate-300">Fresh Air Inflow</span>' +
            '<span class="fs-16 font-semibold text-cold">' + airPct + '%</span>' +
          '</div>' +
          '<div class="mt-2 h-3 rounded-full bg-white/10 overflow-hidden">' +
            '<div class="h-full bg-gradient-to-r from-sky-400 to-cyan-300" style="width:' + airPct + '%"></div>' +
          '</div>' +
          '<div class="mt-1 fs-12 text-slate-300">' + airLabel(air) + '</div>' +
          '<div class="mt-1 fs-11 text-slate-300">vs. all-grass reference: ' + refPct + '% of its cold-air flux</div>' +
        '</div>' +

        '<div class="glass p-4">' +
          '<div class="flex items-center justify-between">' +
            '<span class="fs-12 uppercase tracking-wider text-slate-300">Green & Recreational Space</span>' +
            '<span class="fs-16 font-semibold text-green">' + greenPct + '%</span>' +
          '</div>' +
          '<div class="mt-2 h-3 rounded-full bg-white/10 overflow-hidden">' +
            '<div class="h-full bg-gradient-to-r from-emerald-500 to-green-400" style="width:' + greenPct + '%"></div>' +
          '</div>' +
          '<div class="mt-1 fs-12 text-slate-300">' + greenPct + '% Parks, meadows, forest & water</div>' +
        '</div>' +

        '<div class="glass p-4 fs-14 leading-relaxed text-slate-100">' +
          badgeCopy(m.layman.summaryBadge) +
        '</div>' +
      '</div>';
  }

  /** Render the Urban Planner panel. @param {object} m */
  function renderPlanner(m) {
    if (!plannerEl) return;
    const p = m.planner;
    const refPct = Math.round((p.vFlux / V_FLUX_REF) * 100);

    // Big KPI row.
    const kpis =
      '<div class="grid grid-cols-2 gap-3">' +
        '<div class="glass p-3">' +
          '<div class="fs-11 uppercase tracking-wider text-slate-300">GRZ</div>' +
          '<div class="fs-20 font-bold text-slate-100 leading-tight">' + fmt(p.grz, 2) + '</div>' +
          '<div class="fs-11 text-slate-300">ground area ratio</div>' +
        '</div>' +
        '<div class="glass p-3">' +
          '<div class="fs-11 uppercase tracking-wider text-slate-300">GFZ</div>' +
          '<div class="fs-20 font-bold text-slate-100 leading-tight">' + fmt(p.gfz, 2) + '</div>' +
          '<div class="fs-11 text-slate-300">floor space ratio</div>' +
        '</div>' +
      '</div>';

    // GRZ / GFZ bars with target bands.
    const ratios =
      '<div class="glass p-4 space-y-3">' +
        '<div>' +
          '<div class="flex items-center justify-between fs-12 text-slate-300 mb-1">' +
            '<span>GRZ</span><span class="font-mono text-slate-100">' + fmt(p.grz, 2) + ' / target 0.25–0.50</span></div>' +
          bandBar(p.grz, 1, 0.25, 0.5, '#38bdf8') +
        '</div>' +
        '<div>' +
          '<div class="flex items-center justify-between fs-12 text-slate-300 mb-1">' +
            '<span>GFZ</span><span class="font-mono text-slate-100">' + fmt(p.gfz, 2) + ' / target 1.0–2.5</span></div>' +
          bandBar(p.gfz, SIM.GFZ_MAX, 1.0, 2.5, '#a78bfa') +
        '</div>' +
      '</div>';

    // Reference comparison + technical table.
    const rows = [
      ['Cold Air Volume Flux', fmt(p.vFlux, 1) + ' m³/s'],
      ['All-grass reference', fmt(V_FLUX_REF, 1) + ' m³/s (' + refPct + '%)'],
      ['Effective Roughness (z0 mean)', fmt(p.z0Mean, 2) + ' m'],
      ['Surrogate Uncertainty (σ)', sigmaLabel(p.sigma) + ' (' + fmt(p.sigma, 2) + ')'],
    ];
    let table = '<div class="glass p-4 space-y-2">';
    table += '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-1">vs. all-grass reference</div>';
    for (const [label, value] of rows) {
      table +=
        '<div class="flex items-center justify-between gap-2">' +
          '<span class="fs-12 text-slate-300">' + label + '</span>' +
          '<span class="fs-12 font-mono text-slate-100">' + value + '</span>' +
        '</div>';
    }
    table += '</div>';

    // KLAM donut + 7-class legend.
    const dist =
      '<div class="glass p-4">' +
        '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-2">Statutory Land Use Distribution</div>' +
        klamDonut(p.classPct || {}) +
      '</div>';

    // Derived narrative.
    const why =
      '<div class="glass p-4 fs-14 leading-relaxed text-slate-100">' +
        '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-1">Why this design</div>' +
        narrative(p, m) +
      '</div>';

    plannerEl.innerHTML = '<div class="space-y-4">' + kpis + ratios + table + dist + why + '</div>';
  }

  /** Signature of the last render (avoids per-TICK rebuilds). */
  let lastSig = null;

  /**
   * Render both panels and toggle visibility by audience.
   * @param {object} state
   */
  function render(state) {
    const design = selectedDesign(state);
    const sig = (design ? design.id : 'none') + '#' + state.audience;
    if (sig === lastSig) return;
    lastSig = sig;

    const m = design && design.metrics ? design.metrics : null;

    if (laymanEl) laymanEl.classList.toggle('hidden', state.audience !== 'layman');
    if (plannerEl) plannerEl.classList.toggle('hidden', state.audience !== 'planner');

    if (!m) {
      const msg = '<div class="text-slate-300 fs-14">No design selected.</div>';
      if (laymanEl) laymanEl.innerHTML = msg;
      if (plannerEl) plannerEl.innerHTML = msg;
      return;
    }

    renderLayman(m);
    renderPlanner(m);
  }

  return { render };
}
