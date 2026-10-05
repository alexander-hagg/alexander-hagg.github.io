/**
 * OpenSKIZZE 2.0 — multi-audience impact dashboard (R4 + F2).
 *
 * Renders the selected design's metrics into two panels: a friendly "Layman
 * Mode" (big KPI numbers for homes, fresh-air gauge with a reference
 * comparison, green space, summary badge) and a technical "Urban Planner Mode"
 * (GRZ/GFZ bars with statutory target bands, V_flux vs. all-grass reference,
 * roughness, surrogate uncertainty, a 7-class KLAM land-use donut, and a short
 * "why this design" narrative derived from the metrics).
 *
 * A third "Planning Department" view (F2) briefs urban-design competitions from
 * the **consensus of the whole selected archetype cluster** (not just the
 * medoid). It presents the new consensus model honestly: a revised per-cell map
 * that only shows a dominant class above a confidence threshold (low-confidence
 * cells become a neutral "mixed / flexible" shade), a per-class probability heat
 * toggle, a program bar of mean ± std area share per class, and requirements
 * grouped into PROGRAM / PLACEMENT / AVOID. The consensus is cached per
 * archetype id and invalidated when the archive changes.
 *
 * Visibility is driven by `state.audience`.
 *
 * Pure ES module: no side effects on import, no `Math.random`.
 */

import { KLAM, KLAM_IDS } from './klam.js';
import { selectedDesign } from './iso.js';
import { SIM, V_FLUX_REF, N } from './config.js';
import { collectClusterDesigns, computeConsensus, formatBrief } from './consensus.js';
import { loc, t, getLang } from './i18n.js';

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

/** Friendly, localised copy for the layman summary badge. @param {string} badge @returns {string} */
function badgeCopy(badge) {
  switch (badge) {
    case 'Cool & Green':
      return t('dash.badgeCoolGreen');
    case 'High Capacity':
      return t('dash.badgeHighCapacity');
    case 'Dense & Warm':
      return t('dash.badgeDenseWarm');
    default:
      return t('dash.badgeBalanced');
  }
}

/** Qualitative, localised label for the fresh-air inflow percentage. @param {number} pct @returns {string} */
function airLabel(pct) {
  if (pct >= 75) return t('dash.airExcellent');
  if (pct >= 50) return t('dash.airGood');
  if (pct >= 30) return t('dash.airModerate');
  return t('dash.airWeak');
}

/** Qualitative, localised label for the surrogate uncertainty. @param {number} sigma @returns {string} */
function sigmaLabel(sigma) {
  if (sigma < 0.15) return t('dash.sigmaLow');
  if (sigma < 0.3) return t('dash.sigmaModerate');
  return t('dash.sigmaHigh');
}

/** Colour for a KLAM class swatch. @param {string} id @returns {string} */
function classColor(id) {
  return (KLAM[id] && KLAM[id].color) || '#94a3b8';
}

/** Human label for a KLAM class. @param {string} id @returns {string} */
function classLabel(id) {
  return KLAM[id] ? loc(KLAM[id].label) : id;
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
    '<svg viewBox="0 0 120 120" class="w-28 h-28 shrink-0" role="img" aria-label="' + t('dash.klamAria') + '">' +
      '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="13"></circle>' +
      arcs +
      '<circle cx="60" cy="60" r="30" fill="rgba(15,23,42,0.55)"></circle>' +
      '<text x="60" y="58" text-anchor="middle" fill="#e2e8f0" font-size="11" font-family="system-ui">' + t('dash.donutTop') + '</text>' +
      '<text x="60" y="70" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui">' + t('dash.donutBottom') + '</text>' +
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

  if (p.grz >= 0.45) sentences.push(t('dash.narrDense'));
  else if (p.grz <= 0.2) sentences.push(t('dash.narrOpen'));
  else sentences.push(t('dash.narrModerate'));

  if (p.vFlux >= V_FLUX_REF * 0.6) {
    sentences.push(t('dash.narrVentDeep'));
  } else if (p.vFlux < V_FLUX_REF * 0.3) {
    sentences.push(t('dash.narrVentRestricted'));
  } else {
    sentences.push(t('dash.narrVentAdequate'));
  }

  const green = m.layman.greenSpace;
  if (green >= 40) sentences.push(t('dash.narrGreenExtensive'));
  else if (green < 15) sentences.push(t('dash.narrGreenScarce'));

  if (p.sigma >= 0.3) sentences.push(t('dash.narrUncertain'));

  return sentences.join(' ');
}

// ===========================================================================
// Planning Department view (F2)
// ===========================================================================

/** Normalized entropy above which a consensus cell is flagged as uncertain. */
const UNCERTAIN_ENTROPY = 0.5;

/**
 * Per-cell confidence at or above which the dominant class is shown on the
 * consensus map. Below it the cell is rendered as a neutral "mixed / flexible"
 * shade rather than pretending a class dominates.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** Neutral grey hatch used for low-confidence (mixed / flexible) cells. */
const MIXED_SHADE =
  'repeating-linear-gradient(45deg,rgba(148,163,184,0.45) 0 2px,rgba(71,85,105,0.25) 2px 5px)';

/**
 * Resolve the archetype to brief: the explicitly selected one, else the
 * archetype owning `state.selectedDesignId`, else the first archetype.
 *
 * @param {object} state
 * @returns {object|null}
 */
function resolveArchetype(state) {
  const archs = (state && state.archetypes) || [];
  if (!archs.length) return null;
  if (state.selectedArchetype) {
    const a = archs.find((x) => x.id === state.selectedArchetype);
    if (a) return a;
  }
  if (state.selectedDesignId != null) {
    const a = archs.find((x) => (x.memberIds || []).includes(state.selectedDesignId));
    if (a) return a;
  }
  return archs[0];
}

/**
 * Header card: archetype name + badge + member count, plus the consensus
 * confidence and mean uncertainty from `stats`.
 *
 * @param {object} archetype
 * @param {object} consensus
 * @returns {string}
 */
function departmentHeader(archetype, consensus) {
  const stats = consensus.stats;
  return (
    '<div class="glass p-4">' +
      '<div class="flex items-center gap-2">' +
        '<span class="w-6 h-6 rounded flex items-center justify-center fs-12 font-bold text-slate-900 shrink-0" ' +
          'style="background:' + (archetype.color || '#94a3b8') + '">' + (archetype.badge || '?') + '</span>' +
        '<span class="fs-16 font-semibold text-slate-100 flex-1 truncate">' + (loc(archetype.name) || t('dept.archetype')) + '</span>' +
      '</div>' +
      '<div class="fs-12 text-slate-300 mt-1">' + t('brief.designCount', { n: stats.designs }) + '</div>' +
      '<div class="fs-12 text-slate-300 mt-1">' + t('dept.confidence') + ' ' +
        '<span class="text-cold font-semibold">' + Math.round(stats.meanConfidence * 100) + '%</span>' +
        ' · ' + t('brief.uncertainty') + ' <span class="font-mono text-slate-100">' + fmt(stats.meanEntropy, 2) + '</span>' +
      '</div>' +
    '</div>'
  );
}

/**
 * 10×10 consensus land-use map with two modes.
 *
 *  - **dominant** (default): a cell shows its dominant class colour at
 *    `opacity = confidence` only when `confidence >= CONFIDENCE_THRESHOLD`;
 *    below the threshold the cell is drawn as a neutral grey "mixed / flexible"
 *    hatch instead of pretending a class dominates. Confident cells with high
 *    normalized entropy keep the diagonal uncertainty hatch.
 *  - **heat**: for a selected class, each cell is tinted with the class colour
 *    at `opacity = classDist[klam]`, so a scattered-but-abundant class is
 *    visibly spread across the site rather than washed out.
 *
 * Axes are labelled (N at top, S at bottom) and a legend lists the classes
 * present (dominant mode) or the selected class (heat mode).
 *
 * @param {object} consensus
 * @param {{mode?:'dominant'|'heat', klam?:string|null}} [view]
 * @returns {string}
 */
export function consensusMap(consensus, view) {
  const cells = (consensus && consensus.cells) || [];
  const mode = view && view.mode === 'heat' ? 'heat' : 'dominant';
  const heatKlam = mode === 'heat' && view && view.klam ? view.klam : null;
  const present = new Set();

  let grid =
    '<div class="grid gap-px rounded overflow-hidden" data-mode="' + mode + '" ' +
    'style="grid-template-columns:repeat(' + N + ',1fr)">';

  for (const c of cells) {
    const conf = clamp01(c.confidence);
    const ent = clamp01(c.entropy);

    if (heatKlam) {
      const p = clamp01((c.classDist && c.classDist[heatKlam]) || 0);
      grid +=
        '<div class="relative" data-heat="' + heatKlam + '" data-p="' + p.toFixed(3) + '" ' +
          'style="aspect-ratio:1;background:rgba(255,255,255,0.04)" ' +
          'title="' + t('dash.heatTitle', { label: classLabel(heatKlam), pct: Math.round(p * 100) }) + '">' +
          '<div class="absolute inset-0" style="background:' + classColor(heatKlam) + ';opacity:' + p.toFixed(2) + '"></div>' +
        '</div>';
      continue;
    }

    present.add(c.dominant);
    if (conf >= CONFIDENCE_THRESHOLD) {
      const hatch = ent >= UNCERTAIN_ENTROPY
        ? 'background-image:repeating-linear-gradient(45deg,rgba(15,23,42,0.85) 0 1px,transparent 1px 4px);opacity:' + ent.toFixed(2) + ';'
        : '';
      grid +=
        '<div class="relative" data-dominant="' + c.dominant + '" data-conf="' + conf.toFixed(3) + '" ' +
          'style="aspect-ratio:1;background:rgba(255,255,255,0.04)" ' +
          'title="' + t('dash.cellTitle', { label: classLabel(c.dominant), pct: Math.round(conf * 100), u: ent.toFixed(2) }) + '">' +
          '<div class="absolute inset-0" style="background:' + classColor(c.dominant) + ';opacity:' + conf.toFixed(2) + '"></div>' +
          (hatch ? '<div class="absolute inset-0" style="' + hatch + '"></div>' : '') +
        '</div>';
    } else {
      grid +=
        '<div class="relative" data-mixed="1" data-conf="' + conf.toFixed(3) + '" ' +
          'style="aspect-ratio:1;background:rgba(255,255,255,0.04)" ' +
          'title="' + t('dash.mixedTitle', { pct: Math.round(conf * 100) }) + '">' +
          '<div class="absolute inset-0" style="background-image:' + MIXED_SHADE + '"></div>' +
        '</div>';
    }
  }
  grid += '</div>';

  let legend = '<div class="mt-3 flex flex-wrap gap-x-3 gap-y-1">';
  if (heatKlam) {
    legend +=
      '<span class="flex items-center gap-1 fs-11 text-slate-300">' +
        '<span class="w-3 h-3 rounded-sm shrink-0" style="background:' + classColor(heatKlam) + '"></span>' +
        t('dash.probabilityLegend', { label: classLabel(heatKlam) }) +
      '</span>';
  } else {
    for (const id of KLAM_IDS) {
      if (!present.has(id)) continue;
      legend +=
        '<span class="flex items-center gap-1 fs-11 text-slate-300">' +
          '<span class="w-3 h-3 rounded-sm shrink-0" style="background:' + classColor(id) + '"></span>' +
          classLabel(id) +
        '</span>';
    }
    legend +=
      '<span class="flex items-center gap-1 fs-11 text-slate-300">' +
        '<span class="w-3 h-3 rounded-sm shrink-0" style="background-image:' + MIXED_SHADE + '"></span>' +
        t('dash.mixed') +
      '</span>';
  }
  legend += '</div>';

  const title = heatKlam ? t('dash.probability', { label: classLabel(heatKlam) }) : t('dash.consensusMap');
  return (
    '<div class="glass p-4" data-map="1">' +
      '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-2">' + title + '</div>' +
      '<div class="fs-11 text-slate-400 text-center mb-1">' + t('dash.north') + '</div>' +
      grid +
      '<div class="fs-11 text-slate-400 text-center mt-1">' + t('dash.south') + '</div>' +
      legend +
    '</div>'
  );
}

/**
 * Program / composition bar. A stacked bar shows each class's `meanShare` of
 * the site; below it, one row per class shows the mean as a solid fill and the
 * `stdShare` as a lighter ± band, with the numeric `mean% ±std%`.
 *
 * This is the key fix made visible: a scattered-but-abundant class keeps a
 * solid share even when its map location is flexible.
 *
 * @param {object[]} program - `consensus.program` entries.
 * @returns {string}
 */
export function programBar(program) {
  const list = (program || []).filter((p) => p.meanShare > 0.001);
  if (!list.length) return '';

  let stack = '<div class="flex h-3 rounded-full overflow-hidden bg-white/10" data-program-bar="1">';
  for (const p of list) {
    stack +=
      '<div style="width:' + (p.meanShare * 100).toFixed(2) + '%;background:' + classColor(p.klam) + '" ' +
        'title="' + loc(p.label) + ' ' + Math.round(p.meanShare * 100) + '%"></div>';
  }
  stack += '</div>';

  let rows = '<div class="mt-3 space-y-1.5">';
  for (const p of list) {
    const mean = p.meanShare * 100;
    const std = p.stdShare * 100;
    const lo = Math.max(0, mean - std);
    const hi = Math.min(100, mean + std);
    rows +=
      '<div class="flex items-center gap-2" data-program-class="' + p.klam + '">' +
        '<span class="w-3 h-3 rounded-sm shrink-0" style="background:' + classColor(p.klam) + '"></span>' +
        '<span class="fs-11 text-slate-300 w-28 truncate">' + loc(p.label) + '</span>' +
        '<span class="relative flex-1 h-2 rounded-full bg-white/10 overflow-hidden">' +
          '<span class="absolute inset-y-0 bg-white/20" style="left:' + lo.toFixed(1) + '%;width:' + Math.max(0.5, hi - lo).toFixed(1) + '%"></span>' +
          '<span class="absolute inset-y-0 left-0 rounded-full" style="width:' + mean.toFixed(1) + '%;background:' + classColor(p.klam) + '"></span>' +
        '</span>' +
        '<span class="fs-11 font-mono text-slate-200 w-20 text-right">' + mean.toFixed(0) + '% ±' + std.toFixed(0) + '%</span>' +
      '</div>';
  }
  rows += '</div>';

  return (
    '<div class="glass p-4" data-program-section="1">' +
      '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-2">' + t('dash.programBar') + '</div>' +
      stack + rows +
    '</div>'
  );
}

/**
 * Class selector for the map layer: a "Dominant" button plus one heat button
 * per class present in the program. Buttons carry `data-dept-mode` (and
 * `data-klam` for heat) so the controller can re-render on selection.
 *
 * @param {object[]} program - `consensus.program` entries.
 * @param {{mode?:'dominant'|'heat', klam?:string|null}} [view]
 * @returns {string}
 */
export function classSelector(program, view) {
  const list = (program || []).filter((p) => p.meanShare > 0.001);
  const mode = view && view.mode === 'heat' ? 'heat' : 'dominant';
  const klam = view && view.klam ? view.klam : null;
  const btn = (active, attrs, label) =>
    '<button type="button" ' + attrs + ' class="fs-11 px-2 py-1 rounded-md border transition ' +
      (active ? 'border-cold/60 bg-cold/20 text-cold' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10') +
      '">' + label + '</button>';

  let html =
    '<div class="glass p-3" id="dept-class-selector" data-dept-selector="1">' +
      '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-2">' + t('dash.mapLayer') + '</div>' +
      '<div class="flex flex-wrap gap-1">';
  html += btn(mode === 'dominant', 'data-dept-mode="dominant"', t('dash.dominant'));
  for (const p of list) {
    html += btn(mode === 'heat' && klam === p.klam, 'data-dept-mode="heat" data-klam="' + p.klam + '"', loc(p.label));
  }
  html += '</div></div>';
  return html;
}

/**
 * One requirement row. Quantity shows mean ± std; concentrated placement gets a
 * solid accent with zone + tolerance; flexible placement gets a dashed, muted
 * accent and "location unrestricted"; avoid gets a red accent.
 *
 * @param {object} r
 * @returns {string}
 */
function requirementItem(r) {
  const swatch = '<span class="w-3 h-3 rounded-sm shrink-0" style="background:' + classColor(r.klam) + '"></span>';
  const label = '<span class="fs-13 font-semibold text-slate-100 flex-1 truncate">' + loc(r.label) + '</span>';
  let accent;
  let badge;
  let badgeCls;
  let meta;

  if (r.kind === 'quantity') {
    accent = 'border-emerald-400/60';
    badge = t('dash.quantity');
    badgeCls = 'bg-emerald-400/15 text-emerald-300';
    meta = t('dash.mean', {
      mean: Math.round((r.meanShare || 0) * 100),
      std: Math.round((r.stdShare || 0) * 100),
    });
  } else if (r.kind === 'placement' && r.flexible) {
    accent = 'border-dashed border-slate-400/50';
    badge = t('dash.flexible');
    badgeCls = 'bg-slate-400/15 text-slate-300';
    meta = t('dash.locationUnrestricted');
  } else if (r.kind === 'placement') {
    accent = 'border-emerald-400/60';
    badge = t('dash.placement');
    badgeCls = 'bg-emerald-400/15 text-emerald-300';
    const tol = r.tolerance || 0;
    meta = t('dash.zoneMeta', {
      zone: r.zone || '',
      tol,
      unit: t(tol === 1 ? 'req.zoneUnit' : 'req.zoneUnits'),
    });
  } else {
    accent = 'border-rose-400/60';
    badge = t('dash.avoid');
    badgeCls = 'bg-rose-400/15 text-rose-300';
    meta = t('dash.notPart');
  }

  return (
    '<div class="border-l-2 ' + accent + ' pl-3 py-1" data-req-kind="' + r.kind + '"' +
      (r.flexible ? ' data-flexible="1"' : '') + '>' +
      '<div class="flex items-center gap-2">' + swatch + label +
        '<span class="fs-10 px-1.5 py-0.5 rounded ' + badgeCls + '">' + badge + '</span>' +
      '</div>' +
      '<div class="fs-11 text-slate-300 mt-0.5">' + meta + '</div>' +
      '<div class="fs-12 text-slate-200 mt-1 leading-snug">' + r.text + '</div>' +
    '</div>'
  );
}

/**
 * Requirement list grouped into three labelled sections, in order: PROGRAM
 * (quantities), PLACEMENT (where) and AVOID. Empty sections show "(none)".
 *
 * @param {object[]} requirements
 * @returns {string}
 */
export function requirementList(requirements) {
  const list = requirements || [];
  if (!list.length) {
    return '<div class="glass p-4 fs-13 text-slate-300">' + t('dash.noRequirements') + '</div>';
  }
  const sections = [
    { kind: 'quantity', title: t('brief.program') },
    { kind: 'placement', title: t('brief.placement') },
    { kind: 'avoid', title: t('brief.avoid') },
  ];
  let html = '<div class="glass p-4 space-y-4" data-requirements="1">';
  for (const sec of sections) {
    const items = list.filter((r) => r.kind === sec.kind);
    html +=
      '<div data-req-section="' + sec.kind + '">' +
        '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-2">' + sec.title + '</div>';
    if (!items.length) {
      html += '<div class="fs-11 text-slate-400 italic">' + t('brief.none') + '</div>';
    } else {
      html += '<div class="space-y-2">';
      for (const r of items) html += requirementItem(r);
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

/**
 * Full Planning Department panel HTML for an archetype and its consensus.
 *
 * @param {object} archetype
 * @param {object} consensus
 * @param {{mode?:'dominant'|'heat', klam?:string|null}} [view]
 * @returns {string}
 */
export function departmentHTML(archetype, consensus, view) {
  return (
    '<div class="space-y-4">' +
      departmentHeader(archetype, consensus) +
      consensusMap(consensus, view) +
      classSelector(consensus.program, view) +
      programBar(consensus.program) +
      requirementList(consensus.requirements) +
      exportSection() +
    '</div>'
  );
}

/** Export controls: copy-brief button and a .txt download button. @returns {string} */
function exportSection() {
  return (
    '<div class="glass p-4 flex items-center gap-2">' +
      '<button type="button" id="dept-copy-brief" ' +
        'class="flex-1 fs-12 px-3 py-2 rounded-md border border-cold/50 bg-cold/20 text-cold hover:bg-cold/30 transition">' +
        t('dash.copyBrief') + '</button>' +
      '<button type="button" id="dept-download-brief" ' +
        'class="fs-12 px-3 py-2 rounded-md border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 transition">' +
        t('dash.downloadBrief') + '</button>' +
    '</div>'
  );
}

/**
 * Copy text to the clipboard, preferring the async Clipboard API and falling
 * back to a hidden textarea + `execCommand`. Shows a transient "Copied!"
 * confirmation on the triggering button.
 *
 * @param {string} text
 * @param {HTMLElement|null} btn
 */
function copyToClipboard(text, btn) {
  const done = () => {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = t('dash.copied');
    setTimeout(() => { btn.textContent = prev; }, 1500);
  };
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) { /* clipboard unavailable — silently ignore */ }
  };
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

/**
 * Trigger a client-side download of `text` as a `.txt` file.
 *
 * @param {string} text
 * @param {string} filename
 */
function downloadText(text, filename) {
  try {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) { /* download unavailable — silently ignore */ }
}

/**
 * Create the dashboard controller.
 *
 * @param {{getState:()=>object}} store
 * @param {{computeConsensus?:Function}} [deps] - Optional injection point for
 *   tests (defaults to the consensus engine's `computeConsensus`).
 * @returns {{render:(state:object)=>void}}
 */
export function createDashboard(store, deps) {
  const compute = deps && typeof deps.computeConsensus === 'function' ? deps.computeConsensus : computeConsensus;
  const laymanEl = typeof document !== 'undefined' ? document.getElementById('dashboard-layman') : null;
  const plannerEl = typeof document !== 'undefined' ? document.getElementById('dashboard-planner') : null;
  const departmentEl = typeof document !== 'undefined' ? document.getElementById('dashboard-department') : null;

  /** Consensus cache keyed by archetype id; cleared when the archive changes. */
  const consensusCache = new Map();
  let cacheArchive = null;

  /** Current department map view: dominant consensus or a per-class heat layer. */
  let deptView = { mode: 'dominant', klam: null };

  /**
   * Return the cached consensus for an archetype, computing it on first use.
   * The cache is invalidated whenever the archive object identity changes
   * (i.e. on `SEARCH_COMPLETE` / `RESTART` / a new search).
   *
   * @param {object} state
   * @param {object} archetype
   * @param {object[]} designs
   * @returns {object}
   */
  function getConsensus(state, archetype, designs) {
    if (state.archive !== cacheArchive) {
      consensusCache.clear();
      cacheArchive = state.archive;
    }
    const key = archetype.id;
    if (consensusCache.has(key)) return consensusCache.get(key);
    const consensus = compute(designs);
    consensusCache.set(key, consensus);
    return consensus;
  }

  /**
   * Render the Planning Department panel for the resolved archetype, honouring
   * the current {@link deptView} map mode, then wire its controls.
   * @param {object} state
   */
  function renderDepartment(state) {
    if (!departmentEl) return;
    const archetype = resolveArchetype(state);
    if (!archetype) {
      departmentEl.innerHTML =
        '<div class="glass p-4 fs-14 text-slate-300">' + t('dash.selectArchetype') + '</div>';
      return;
    }
    const designs = collectClusterDesigns(state.archive, archetype);
    if (!designs.length) {
      departmentEl.innerHTML =
        '<div class="glass p-4 fs-14 text-slate-300">' + t('dash.noDesigns') + '</div>';
      return;
    }
    const consensus = getConsensus(state, archetype, designs);
    departmentEl.innerHTML = departmentHTML(archetype, consensus, deptView);

    const brief = formatBrief(consensus, archetype);
    const copyBtn = departmentEl.querySelector ? departmentEl.querySelector('#dept-copy-brief') : null;
    if (copyBtn) copyBtn.addEventListener('click', () => copyToClipboard(brief, copyBtn));
    const dlBtn = departmentEl.querySelector ? departmentEl.querySelector('#dept-download-brief') : null;
    if (dlBtn) {
      dlBtn.addEventListener('click', () => {
        const safe = String(archetype.id || 'archetype').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
        downloadText(brief, 'openskizze-brief-' + safe + '.txt');
      });
    }

    const selector = departmentEl.querySelector ? departmentEl.querySelector('#dept-class-selector') : null;
    if (selector && selector.querySelectorAll) {
      for (const btn of selector.querySelectorAll('[data-dept-mode]')) {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.deptMode === 'heat' ? 'heat' : 'dominant';
          deptView = { mode, klam: mode === 'heat' ? btn.dataset.klam : null };
          renderDepartment(store.getState());
        });
      }
    }
  }

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
          '<div class="fs-12 uppercase tracking-wider text-slate-300">' + t('dash.homes') + '</div>' +
          '<div class="mt-1 flex items-baseline gap-2">' +
            '<span class="fs-28 font-bold text-cold leading-none">' + fmtInt(homes) + '</span>' +
            '<span class="fs-14 text-slate-200">' + t('dash.residents') + '</span>' +
          '</div>' +
          '<div class="mt-2 fs-16 tracking-widest">🏠🏠🏠🏠🏠</div>' +
        '</div>' +

        '<div class="glass p-4">' +
          '<div class="flex items-center justify-between">' +
            '<span class="fs-12 uppercase tracking-wider text-slate-300">' + t('dash.freshAir') + '</span>' +
            '<span class="fs-16 font-semibold text-cold">' + airPct + '%</span>' +
          '</div>' +
          '<div class="mt-2 h-3 rounded-full bg-white/10 overflow-hidden">' +
            '<div class="h-full bg-gradient-to-r from-sky-400 to-cyan-300" style="width:' + airPct + '%"></div>' +
          '</div>' +
          '<div class="mt-1 fs-12 text-slate-300">' + airLabel(air) + '</div>' +
          '<div class="mt-1 fs-11 text-slate-300">' + t('dash.vsReference', { pct: refPct }) + '</div>' +
        '</div>' +

        '<div class="glass p-4">' +
          '<div class="flex items-center justify-between">' +
            '<span class="fs-12 uppercase tracking-wider text-slate-300">' + t('dash.greenSpace') + '</span>' +
            '<span class="fs-16 font-semibold text-green">' + greenPct + '%</span>' +
          '</div>' +
          '<div class="mt-2 h-3 rounded-full bg-white/10 overflow-hidden">' +
            '<div class="h-full bg-gradient-to-r from-emerald-500 to-green-400" style="width:' + greenPct + '%"></div>' +
          '</div>' +
          '<div class="mt-1 fs-12 text-slate-300">' + t('dash.greenDetail', { pct: greenPct }) + '</div>' +
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
          '<div class="fs-11 text-slate-300">' + t('dash.grz') + '</div>' +
        '</div>' +
        '<div class="glass p-3">' +
          '<div class="fs-11 uppercase tracking-wider text-slate-300">GFZ</div>' +
          '<div class="fs-20 font-bold text-slate-100 leading-tight">' + fmt(p.gfz, 2) + '</div>' +
          '<div class="fs-11 text-slate-300">' + t('dash.gfz') + '</div>' +
        '</div>' +
      '</div>';

    // GRZ / GFZ bars with target bands.
    const ratios =
      '<div class="glass p-4 space-y-3">' +
        '<div>' +
          '<div class="flex items-center justify-between fs-12 text-slate-300 mb-1">' +
            '<span>GRZ</span><span class="font-mono text-slate-100">' + fmt(p.grz, 2) + ' / ' + t('dash.target', { lo: '0.25', hi: '0.50' }) + '</span></div>' +
          bandBar(p.grz, 1, 0.25, 0.5, '#38bdf8') +
        '</div>' +
        '<div>' +
          '<div class="flex items-center justify-between fs-12 text-slate-300 mb-1">' +
            '<span>GFZ</span><span class="font-mono text-slate-100">' + fmt(p.gfz, 2) + ' / ' + t('dash.target', { lo: '1.0', hi: '2.5' }) + '</span></div>' +
          bandBar(p.gfz, SIM.GFZ_MAX, 1.0, 2.5, '#a78bfa') +
        '</div>' +
      '</div>';

    // Reference comparison + technical table.
    const rows = [
      [t('dash.vflux'), fmt(p.vFlux, 1) + ' m³/s'],
      [t('dash.reference'), fmt(V_FLUX_REF, 1) + ' m³/s (' + refPct + '%)'],
      [t('dash.z0'), fmt(p.z0Mean, 2) + ' m'],
      [t('dash.sigma'), sigmaLabel(p.sigma) + ' (' + fmt(p.sigma, 2) + ')'],
    ];
    let table = '<div class="glass p-4 space-y-2">';
    table += '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-1">' + t('dash.reference') + '</div>';
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
        '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-2">' + t('dash.classDist') + '</div>' +
        klamDonut(p.classPct || {}) +
      '</div>';

    // Derived narrative.
    const why =
      '<div class="glass p-4 fs-14 leading-relaxed text-slate-100">' +
        '<div class="fs-12 uppercase tracking-wider text-slate-300 mb-1">' + t('dash.why') + '</div>' +
        narrative(p, m) +
      '</div>';

    plannerEl.innerHTML = '<div class="space-y-4">' + kpis + ratios + table + dist + why + '</div>';
  }

  /** Signature of the last render (avoids per-TICK rebuilds). */
  let lastSig = null;

  /**
   * Render the active panel and toggle visibility by audience. The department
   * panel is driven by the selected archetype (not the selected design), so its
   * signature also tracks the archetype id and cluster size.
   *
   * @param {object} state
   */
  function render(state) {
    const design = selectedDesign(state);
    const archs = (state && state.archetypes) || [];
    const archSig = state.audience === 'department'
      ? (state.selectedArchetype || 'auto') + ':' + archs.length
      : '';
    const sig = (design ? design.id : 'none') + '#' + state.audience + '#' + archSig + '#' + getLang();
    if (sig === lastSig) return;
    lastSig = sig;

    const m = design && design.metrics ? design.metrics : null;

    if (laymanEl) laymanEl.classList.toggle('hidden', state.audience !== 'layman');
    if (plannerEl) plannerEl.classList.toggle('hidden', state.audience !== 'planner');
    if (departmentEl) departmentEl.classList.toggle('hidden', state.audience !== 'department');

    if (state.audience === 'department') {
      renderDepartment(state);
      return;
    }

    if (!m) {
      const msg = '<div class="text-slate-300 fs-14">' + t('dash.noDesignSelected') + '</div>';
      if (laymanEl) laymanEl.innerHTML = msg;
      if (plannerEl) plannerEl.innerHTML = msg;
      return;
    }

    renderLayman(m);
    renderPlanner(m);
  }

  return { render };
}
