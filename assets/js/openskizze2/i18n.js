/**
 * OpenSKIZZE 2.0 — minimal, dependency-free internationalisation core.
 *
 * Provides:
 *   - a UI-string dictionary (`DICT`) keyed by stable string ids,
 *   - a `t(key, params)` lookup with `{param}` interpolation and en → key
 *     fallback,
 *   - a `loc(value)` helper that resolves a localised data field (`{en,de}`)
 *     or passes a plain string through unchanged,
 *   - `getLang` / `setLang` / `toggleLang` with `localStorage` persistence and
 *     `onChange` subscriptions,
 *   - `applyI18n(root)` to fill `[data-i18n]` / `[data-i18n-aria]` /
 *     `[data-i18n-title]` elements.
 *
 * Side-effect-light: on import it only reads the persisted/navigator language;
 * it performs no DOM work until `applyI18n` is called explicitly.
 *
 * Pure ES module, no `Math.random`.
 */

/** Supported language codes, in display order. @type {string[]} */
export const LANGS = ['en', 'de'];

/** `localStorage` key under which the chosen language is persisted. */
const STORAGE_KEY = 'openskizze.lang';

/**
 * UI string dictionary. Every key present in one language must be present in
 * the other; values may contain `{param}` placeholders for {@link t}.
 *
 * @type {Record<string, Record<string, string>>}
 */
export const DICT = {
  en: {
    'app.title': 'OpenSKIZZE 2.0 — Generative Urban Climate Design',
    'app.subtitle': 'Surrogate-assisted Quality-Diversity design for climate-adaptive urban planning',

    'stepper.site': 'Site',
    'stepper.search': 'Search',
    'stepper.explore': 'Explore',

    'btn.run': 'Run Generative Search (MAP-Elites)',
    'btn.instant': '⚡ Instant Demo Preset',
    'btn.presentation': '🖥️ Presentation',
    'btn.exitPresentation': '✕ Exit Presentation',
    'btn.fullWindow': '⛶ Full window',
    'btn.copyBrief': '📋 Copy brief',
    'btn.downloadBrief': '⬇ .txt',

    'aside.sitePresets': 'Site Presets',
    'aside.siteReadout': 'Site Readout',

    'layer.airflow': 'Animated Airflow Streamlines',
    'layer.coldPool': 'Cold Air Layer Depth',
    'layer.legend': 'KLAM_21 Land Use Legend',

    'audience.layman': 'Layman',
    'audience.planner': 'Urban Planner',
    'audience.department': 'Planning Dept',

    'ticker.evaluating': 'Evaluating candidate',
    'ticker.coverage': 'Niche coverage',

    'explainer.qd': 'What is a MAP-Elites archive?',
    'explainer.archetypes': 'What are the archetypes?',

    'aria.langToggle': 'Language',
    'aria.cityMap': 'Site map. Use arrow keys to move the selection box.',
    'aria.archive': 'MAP-Elites archive filling',
    'aria.archiveArchetypes': 'MAP-Elites archive with archetypes',
    'aria.iso': 'Isometric parcel viewer',

    'brief.designCount': '{n} designs in cluster',

    // --- Consensus requirements + planning brief ---------------------------
    'req.quantity': '{label}: provide approximately {pct}% of the site (±{tol}%).',
    'req.placementConcentrated':
      '{label}: concentrate in the {zone} (≈{share}% of its area there); tolerance ±{tol} {unit}.',
    'req.placementFlexible': '{label}: location unrestricted — distribute across the site.',
    'req.avoid': 'Avoid {label}: not part of this design family.',
    'req.zoneUnit': 'zone',
    'req.zoneUnits': 'zones',

    'brief.title': 'OpenSKIZZE 2.0 — Planning Brief',
    'brief.archetype': 'Archetype: {id} — {name} (n = {n} designs)',
    'brief.nDesigns': '{n} designs',
    'brief.confidence': 'Consensus confidence: {pct}%   Mean uncertainty: {sigma}',
    'brief.uncertainty': 'Mean uncertainty',
    'brief.program': 'PROGRAM (quantities)',
    'brief.placement': 'PLACEMENT (where)',
    'brief.avoid': 'AVOID',
    'brief.none': '(none)',

    // --- Compass zones ------------------------------------------------------
    'zone.NW': 'north-west',
    'zone.N': 'north',
    'zone.NE': 'north-east',
    'zone.W': 'west',
    'zone.C': 'centre',
    'zone.E': 'east',
    'zone.SW': 'south-west',
    'zone.S': 'south',
    'zone.SE': 'south-east',

    // --- Legacy compass-region phrases (describeRegion) ---------------------
    'region.nowhere': 'nowhere',
    'region.throughout': 'throughout the site',
    'region.centre': 'centre',
    'region.north': 'north',
    'region.south': 'south',
    'region.east': 'east',
    'region.west': 'west',
    'region.rows': 'rows {from}–{to}',
    'region.cols': 'cols {from}–{to}',

    // --- Dashboard: layman + planner ---------------------------------------
    'dash.homes': 'Homes Created',
    'dash.residents': 'Residents',
    'dash.freshAir': 'Fresh Air Inflow',
    'dash.greenSpace': 'Green & Recreational Space',
    'dash.greenDetail': '{pct}% Parks, meadows, forest & water',
    'dash.vsReference': 'vs. all-grass reference: {pct}% of its cold-air flux',
    'dash.summary': 'Summary',
    'dash.grz': 'ground area ratio',
    'dash.gfz': 'floor space ratio',
    'dash.vflux': 'Cold Air Volume Flux',
    'dash.reference': 'All-grass reference',
    'dash.z0': 'Effective Roughness (z0 mean)',
    'dash.sigma': 'Surrogate Uncertainty (σ)',
    'dash.classDist': 'Statutory Land Use Distribution',
    'dash.programBar': 'Program (share of site)',
    'dash.why': 'Why this design',
    'dash.selectArchetype': 'Select an archetype to generate a planning brief.',
    'dash.noDesigns': 'This archetype has no designs yet — run a search to populate the cluster.',
    'dash.copyBrief': '📋 Copy brief',
    'dash.downloadBrief': '⬇ .txt',
    'dash.copied': '✓ Copied!',
    'dash.noDesignSelected': 'No design selected.',
    'dash.noRequirements': 'No requirements derived from this cluster.',
    'dash.mapLayer': 'Map layer',
    'dash.dominant': 'Dominant',
    'dash.consensusMap': 'Consensus Land-Use Map',
    'dash.probability': '{label} Probability',
    'dash.probabilityLegend': '{label} probability (0 → transparent)',
    'dash.mixed': 'Mixed / flexible',
    'dash.mixedTitle': 'Mixed / flexible · confidence {pct}%',
    'dash.cellTitle': '{label} · confidence {pct}% · uncertainty {u}',
    'dash.heatTitle': '{label} · probability {pct}%',
    'dash.north': 'N ↑',
    'dash.south': 'S ↓',
    'dash.quantity': 'Quantity',
    'dash.flexible': 'Flexible',
    'dash.placement': 'Placement',
    'dash.avoid': 'Avoid',
    'dash.mean': 'mean {mean}% ±{std}%',
    'dash.locationUnrestricted': 'location unrestricted',
    'dash.zoneMeta': 'zone {zone} · ±{tol} {unit}',
    'dash.notPart': 'not part of this design family',
    'dash.donutTop': 'land',
    'dash.donutBottom': 'use',
    'dash.klamAria': 'KLAM land-use distribution',
    'dash.target': 'target {lo}–{hi}',
    'dash.airExcellent': 'Excellent downstream cooling',
    'dash.airGood': 'Good ventilation',
    'dash.airModerate': 'Moderate airflow',
    'dash.airWeak': 'Weak airflow — heat risk',
    'dash.sigmaLow': 'Low',
    'dash.sigmaModerate': 'Moderate',
    'dash.sigmaHigh': 'High',
    'dash.badgeCoolGreen':
      '🌿 Recommended: Balances housing demand with regional climate protection.',
    'dash.badgeHighCapacity':
      '🏗️ High Capacity: Delivers many homes — keep an eye on ventilation.',
    'dash.badgeDenseWarm':
      '🏙️ Dense & Warm: Maximises housing but traps heat — add green corridors.',
    'dash.badgeBalanced': '⚖️ Balanced: A solid all-rounder for housing and cooling.',
    'dash.narrDense': 'A dense building footprint maximises housing on the parcel.',
    'dash.narrOpen': 'An open, low-coverage layout leaves generous ground space.',
    'dash.narrModerate': 'A moderately dense block structure balances built and open space.',
    'dash.narrVentDeep':
      'Cold night air penetrates deep into the parcel, keeping the area well ventilated.',
    'dash.narrVentRestricted':
      'Ventilation is restricted by roughness and sheltering, so heat may accumulate.',
    'dash.narrVentAdequate':
      'Night-time ventilation is adequate but could be improved with green corridors.',
    'dash.narrGreenExtensive':
      'Extensive green and blue surfaces further cool the microclimate.',
    'dash.narrGreenScarce':
      'Green and water surfaces are scarce, limiting evaporative cooling.',
    'dash.narrUncertain':
      'The surrogate is less certain here, so treat the figures as indicative.',

    // --- Dashboard: planning department ------------------------------------
    'dept.title': 'Planning Department',
    'dept.mapDominant': 'Dominant',
    'dept.mapHeat': 'Heat',
    'dept.mixed': 'Mixed / flexible',
    'dept.confidence': 'Consensus confidence',
    'dept.tolerance': 'tolerance',
    'dept.flexible': 'Flexible',
    'dept.archetype': 'Archetype',

    // --- Tooltips + UI chrome ----------------------------------------------
    'tip.class': 'Class',
    'tip.height': 'Height',
    'tip.footprint': 'Footprint',
    'tip.roof': 'Roof',
    'tip.z0': 'z0',
    'tip.block': 'Block land use',
    'tip.storey': 'storey',
    'tip.storeys': 'storeys',
    'tip.street': 'Street / public realm',
    'iso.windCue': 'Cold air: {label}',
    'ui.noArchetypes': 'No archetypes yet.',
    'ui.klamLegendTitle': 'KLAM_21 Land Use',
    'readout.box': 'box: x={x}, y={y}, w={w}, h={h}',

    // --- Archive heatmap ----------------------------------------------------
    'archive.xAxis': 'Housing Capacity / Floor Area →',
    'archive.yAxis': 'Cold Air Permeability / Cooling Flux →',
    'archive.pareto': 'Pareto front',
    'archive.coverage': 'Coverage: {filled} / {total} ({pct}%)',

    // --- City map -----------------------------------------------------------
    'city.legend': 'LEGEND',
    'city.coldAir': 'Incoming cold air: {label}',

    // --- Explainer bodies ---------------------------------------------------
    'explainer.qdBody':
      '<strong class="text-slate-100">What is a MAP-Elites archive?</strong> ' +
      'Instead of searching for one "best" city, we keep the best design for ' +
      '<em>every</em> combination of two goals: how many homes it creates ' +
      '(left→right) and how well it lets cool night air flow through ' +
      '(bottom→top). Each cell is a niche; the colour shows overall quality. ' +
      'This is <em>Quality Diversity</em>: many good, different answers ' +
      'instead of a single winner.',
    'explainer.archetypesBody':
      '<strong class="text-slate-100">What are the archetypes?</strong> ' +
      'The archive is grouped into four recurring design families — a green ' +
      'cold-air finger, a porous courtyard carpet, a stepped windbreak, and a ' +
      'maximum-density block. Click one to see its most representative design.',
  },
  de: {
    'app.title': 'OpenSKIZZE 2.0 — Generative urbane Klimagestaltung',
    'app.subtitle': 'Surrogatgestützte Quality-Diversity-Planung für klimaangepasste Stadtentwicklung',

    'stepper.site': 'Standort',
    'stepper.search': 'Suche',
    'stepper.explore': 'Erkunden',

    'btn.run': 'Generative Suche starten (MAP-Elites)',
    'btn.instant': '⚡ Sofort-Demo',
    'btn.presentation': '🖥️ Präsentation',
    'btn.exitPresentation': '✕ Präsentation beenden',
    'btn.fullWindow': '⛶ Vollbild',
    'btn.copyBrief': '📋 Brief kopieren',
    'btn.downloadBrief': '⬇ .txt',

    'aside.sitePresets': 'Standort-Voreinstellungen',
    'aside.siteReadout': 'Standort-Übersicht',

    'layer.airflow': 'Animierte Luftströmungslinien',
    'layer.coldPool': 'Mächtigkeit der Kaltluftschicht',
    'layer.legend': 'KLAM_21 Landnutzungslegende',

    'audience.layman': 'Laie',
    'audience.planner': 'Stadtplaner',
    'audience.department': 'Planungsamt',

    'ticker.evaluating': 'Kandidat wird bewertet',
    'ticker.coverage': 'Nischen-Abdeckung',

    'explainer.qd': 'Was ist ein MAP-Elites-Archiv?',
    'explainer.archetypes': 'Was sind die Archetypen?',

    'aria.langToggle': 'Sprache',
    'aria.cityMap': 'Standortkarte. Mit den Pfeiltasten das Auswahlrechteck verschieben.',
    'aria.archive': 'MAP-Elites-Archiv füllt sich',
    'aria.archiveArchetypes': 'MAP-Elites-Archiv mit Archetypen',
    'aria.iso': 'Isometrische Parzellenansicht',

    'brief.designCount': '{n} Entwürfe im Cluster',

    // --- Konsens-Anforderungen + Planungsbrief -----------------------------
    'req.quantity': '{label}: etwa {pct}% der Fläche bereitstellen (±{tol}%).',
    'req.placementConcentrated':
      '{label}: im {zone} konzentrieren (≈{share}% der Fläche dort); Toleranz ±{tol} {unit}.',
    'req.placementFlexible': '{label}: Standort frei wählbar — über die Fläche verteilen.',
    'req.avoid': '{label} vermeiden: nicht Teil dieser Entwurfsfamilie.',
    'req.zoneUnit': 'Zone',
    'req.zoneUnits': 'Zonen',

    'brief.title': 'OpenSKIZZE 2.0 — Planungsbrief',
    'brief.archetype': 'Archetyp: {id} — {name} (n = {n} Entwürfe)',
    'brief.nDesigns': '{n} Entwürfe',
    'brief.confidence': 'Konsens-Konfidenz: {pct}%   Mittlere Unsicherheit: {sigma}',
    'brief.uncertainty': 'Mittlere Unsicherheit',
    'brief.program': 'PROGRAMM (Mengen)',
    'brief.placement': 'PLATZIERUNG (wo)',
    'brief.avoid': 'VERMEIDEN',
    'brief.none': '(keine)',

    // --- Himmelsrichtungen --------------------------------------------------
    'zone.NW': 'Nordwest',
    'zone.N': 'Nord',
    'zone.NE': 'Nordost',
    'zone.W': 'West',
    'zone.C': 'Zentrum',
    'zone.E': 'Ost',
    'zone.SW': 'Südwest',
    'zone.S': 'Süd',
    'zone.SE': 'Südost',

    // --- Legacy compass-region phrases (describeRegion) ---------------------
    'region.nowhere': 'nirgends',
    'region.throughout': 'über die gesamte Fläche',
    'region.centre': 'Zentrum',
    'region.north': 'Norden',
    'region.south': 'Süden',
    'region.east': 'Osten',
    'region.west': 'Westen',
    'region.rows': 'Zeilen {from}–{to}',
    'region.cols': 'Spalten {from}–{to}',

    // --- Dashboard: Laie + Planer ------------------------------------------
    'dash.homes': 'Geschaffene Wohnungen',
    'dash.residents': 'Bewohner',
    'dash.freshAir': 'Frischluftzufuhr',
    'dash.greenSpace': 'Grün- und Erholungsfläche',
    'dash.greenDetail': '{pct}% Parks, Wiesen, Wald & Wasser',
    'dash.vsReference': 'ggü. Referenz (nur Gras): {pct}% seines Kaltluftstroms',
    'dash.summary': 'Zusammenfassung',
    'dash.grz': 'Grundflächenzahl',
    'dash.gfz': 'Geschossflächenzahl',
    'dash.vflux': 'Kaltluftvolumenstrom',
    'dash.reference': 'Referenz (nur Gras)',
    'dash.z0': 'Effektive Rauigkeit (z0 Mittel)',
    'dash.sigma': 'Surrogat-Unsicherheit (σ)',
    'dash.classDist': 'Landnutzungsverteilung',
    'dash.programBar': 'Programm (Anteil der Fläche)',
    'dash.why': 'Warum dieser Entwurf',
    'dash.selectArchetype': 'Wählen Sie einen Archetyp, um einen Planungsbrief zu erstellen.',
    'dash.noDesigns':
      'Dieser Archetyp hat noch keine Entwürfe — starten Sie eine Suche, um das Cluster zu füllen.',
    'dash.copyBrief': '📋 Brief kopieren',
    'dash.downloadBrief': '⬇ .txt',
    'dash.copied': '✓ Kopiert!',
    'dash.noDesignSelected': 'Kein Entwurf ausgewählt.',
    'dash.noRequirements': 'Keine Anforderungen aus diesem Cluster abgeleitet.',
    'dash.mapLayer': 'Kartenebene',
    'dash.dominant': 'Dominant',
    'dash.consensusMap': 'Konsens-Landnutzungskarte',
    'dash.probability': '{label}-Wahrscheinlichkeit',
    'dash.probabilityLegend': '{label}-Wahrscheinlichkeit (0 → transparent)',
    'dash.mixed': 'Gemischt / flexibel',
    'dash.mixedTitle': 'Gemischt / flexibel · Konfidenz {pct}%',
    'dash.cellTitle': '{label} · Konfidenz {pct}% · Unsicherheit {u}',
    'dash.heatTitle': '{label} · Wahrscheinlichkeit {pct}%',
    'dash.north': 'N ↑',
    'dash.south': 'S ↓',
    'dash.quantity': 'Menge',
    'dash.flexible': 'Flexibel',
    'dash.placement': 'Platzierung',
    'dash.avoid': 'Vermeiden',
    'dash.mean': 'Mittel {mean}% ±{std}%',
    'dash.locationUnrestricted': 'Standort frei wählbar',
    'dash.zoneMeta': 'Zone {zone} · ±{tol} {unit}',
    'dash.notPart': 'nicht Teil dieser Entwurfsfamilie',
    'dash.donutTop': 'Land',
    'dash.donutBottom': 'nutzung',
    'dash.klamAria': 'KLAM-Landnutzungsverteilung',
    'dash.target': 'Ziel {lo}–{hi}',
    'dash.airExcellent': 'Ausgezeichnete Kühlung im Abstrom',
    'dash.airGood': 'Gute Durchlüftung',
    'dash.airModerate': 'Mäßige Luftströmung',
    'dash.airWeak': 'Schwache Luftströmung — Hitzerisiko',
    'dash.sigmaLow': 'Gering',
    'dash.sigmaModerate': 'Mittel',
    'dash.sigmaHigh': 'Hoch',
    'dash.badgeCoolGreen':
      '🌿 Empfohlen: Bringt Wohnraumbedarf und regionalen Klimaschutz in Einklang.',
    'dash.badgeHighCapacity':
      '🏗️ Hohe Kapazität: Liefert viele Wohnungen — auf die Durchlüftung achten.',
    'dash.badgeDenseWarm':
      '🏙️ Dicht & warm: Maximiert Wohnraum, staut aber Wärme — Grünkorridore ergänzen.',
    'dash.badgeBalanced': '⚖️ Ausgewogen: Ein solider Allrounder für Wohnen und Kühlung.',
    'dash.narrDense': 'Eine dichte Bebauung maximiert den Wohnraum auf der Fläche.',
    'dash.narrOpen': 'Eine offene, gering überbaute Anordnung lässt großzügigen Freiraum.',
    'dash.narrModerate':
      'Eine mäßig dichte Blockstruktur balanciert bebaute und offene Flächen.',
    'dash.narrVentDeep':
      'Kalte Nachtluft dringt tief in die Fläche ein und hält das Gebiet gut durchlüftet.',
    'dash.narrVentRestricted':
      'Die Durchlüftung ist durch Rauigkeit und Abschirmung eingeschränkt, sodass sich Wärme stauen kann.',
    'dash.narrVentAdequate':
      'Die nächtliche Durchlüftung ist ausreichend, könnte aber durch Grünkorridore verbessert werden.',
    'dash.narrGreenExtensive':
      'Ausgedehnte Grün- und Wasserflächen kühlen das Mikroklima zusätzlich.',
    'dash.narrGreenScarce':
      'Grün- und Wasserflächen sind knapp, was die Verdunstungskühlung begrenzt.',
    'dash.narrUncertain':
      'Das Surrogat ist hier unsicherer; die Werte sind daher als Richtwerte zu verstehen.',

    // --- Dashboard: Planungsamt --------------------------------------------
    'dept.title': 'Planungsamt',
    'dept.mapDominant': 'Dominant',
    'dept.mapHeat': 'Wärme',
    'dept.mixed': 'Gemischt / flexibel',
    'dept.confidence': 'Konsens-Konfidenz',
    'dept.tolerance': 'Toleranz',
    'dept.flexible': 'Flexibel',
    'dept.archetype': 'Archetyp',

    // --- Tooltips + UI ------------------------------------------------------
    'tip.class': 'Klasse',
    'tip.height': 'Höhe',
    'tip.footprint': 'Grundfläche',
    'tip.roof': 'Dach',
    'tip.z0': 'z0',
    'tip.block': 'Blocknutzung',
    'tip.storey': 'Geschoss',
    'tip.storeys': 'Geschosse',
    'tip.street': 'Straße / öffentlicher Raum',
    'iso.windCue': 'Kaltluft: {label}',
    'ui.noArchetypes': 'Noch keine Archetypen.',
    'ui.klamLegendTitle': 'KLAM_21 Landnutzung',
    'readout.box': 'Box: x={x}, y={y}, w={w}, h={h}',

    // --- Archiv-Heatmap -----------------------------------------------------
    'archive.xAxis': 'Wohnkapazität / Geschossfläche →',
    'archive.yAxis': 'Kaltluftdurchlässigkeit / Kühlstrom →',
    'archive.pareto': 'Pareto-Front',
    'archive.coverage': 'Abdeckung: {filled} / {total} ({pct}%)',

    // --- Stadtkarte ---------------------------------------------------------
    'city.legend': 'LEGENDE',
    'city.coldAir': 'Einströmende Kaltluft: {label}',

    // --- Erklärtexte --------------------------------------------------------
    'explainer.qdBody':
      '<strong class="text-slate-100">Was ist ein MAP-Elites-Archiv?</strong> ' +
      'Statt nach einer einzigen „besten“ Stadt zu suchen, behalten wir den ' +
      'besten Entwurf für <em>jede</em> Kombination zweier Ziele: wie viele ' +
      'Wohnungen entstehen (links→rechts) und wie gut kühle Nachtluft ' +
      'durchströmen kann (unten→oben). Jede Zelle ist eine Nische; die Farbe ' +
      'zeigt die Gesamtqualität. Das ist <em>Quality Diversity</em>: viele ' +
      'gute, unterschiedliche Antworten statt eines einzigen Siegers.',
    'explainer.archetypesBody':
      '<strong class="text-slate-100">Was sind die Archetypen?</strong> ' +
      'Das Archiv wird in vier wiederkehrende Entwurfsfamilien gruppiert — ein ' +
      'grüner Kaltluftfinger, ein poröser Hofteppich, ein gestaffelter ' +
      'Windschutz und ein Block maximaler Dichte. Klicken Sie auf einen, um ' +
      'seinen repräsentativsten Entwurf zu sehen.',
  },
};

/** Detect the initial language from `navigator.language` (German → `de`). */
function detectDefaultLang() {
  try {
    if (typeof navigator !== 'undefined' && navigator && navigator.language) {
      return String(navigator.language).toLowerCase().startsWith('de') ? 'de' : 'en';
    }
  } catch (e) { /* navigator unavailable (headless) — fall through */ }
  return 'en';
}

/** Read the persisted language, if valid. @returns {string|null} */
function readStoredLang() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && LANGS.indexOf(v) !== -1) return v;
    }
  } catch (e) { /* storage blocked — ignore */ }
  return null;
}

/** Current language code. @type {string} */
let lang = readStoredLang() || detectDefaultLang();

/** Active change subscribers. @type {Set<(lang:string)=>void>} */
const listeners = new Set();

/**
 * The current language code.
 * @returns {string} `'en'` or `'de'`.
 */
export function getLang() {
  return lang;
}

/**
 * Switch language and notify subscribers. Persists the choice; a no-op when the
 * code is unsupported or already active. Returns the (possibly unchanged) code.
 *
 * @param {string} next - `'en'` or `'de'`.
 * @returns {string}
 */
export function setLang(next) {
  if (LANGS.indexOf(next) === -1 || next === lang) return lang;
  const prev = lang;
  lang = next;
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  } catch (e) { /* storage blocked — ignore */ }
  for (const cb of Array.from(listeners)) {
    try { cb(lang, prev); } catch (e) { /* subscriber error — ignore */ }
  }
  return lang;
}

/**
 * Toggle between `en` and `de`.
 * @returns {string} The new language code.
 */
export function toggleLang() {
  return setLang(lang === 'en' ? 'de' : 'en');
}

/**
 * Subscribe to language changes.
 *
 * @param {(lang:string, prev:string)=>void} cb
 * @returns {() => void} Unsubscribe function.
 */
export function onChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Look up a UI string for the current language, with `{param}` interpolation.
 * Falls back to English, then to the key itself, when a translation is missing.
 *
 * @param {string} key
 * @param {Record<string, unknown>} [params] - Values for `{name}` placeholders.
 * @returns {string}
 */
export function t(key, params) {
  const table = DICT[lang] || DICT.en;
  let s;
  if (table && Object.prototype.hasOwnProperty.call(table, key)) s = table[key];
  else if (DICT.en && Object.prototype.hasOwnProperty.call(DICT.en, key)) s = DICT.en[key];
  else return typeof key === 'string' ? key : '';
  if (params && typeof s === 'string') {
    s = s.replace(/\{(\w+)\}/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m);
  }
  return s;
}

/**
 * Resolve a localised data value.
 *  - `{en, de}` → the current language's value (falling back to `en`),
 *  - plain string → returned unchanged,
 *  - `null` / `undefined` → `''`.
 *
 * @param {{en?:string, de?:string}|string|null|undefined} value
 * @returns {string}
 */
export function loc(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value[lang] != null && value[lang] !== '') return value[lang];
    if (value.en != null) return value.en;
    return '';
  }
  return String(value);
}

/**
 * Apply translations to `[data-i18n]` (textContent), `[data-i18n-html]`
 * (innerHTML, for copy that carries inline markup), `[data-i18n-aria]`
 * (`aria-label`) and `[data-i18n-title]` (`title`) elements within `root`.
 *
 * @param {ParentNode} [root] - Defaults to `document` when available.
 * @returns {void}
 */
export function applyI18n(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  for (const el of scope.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of scope.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  }
  for (const el of scope.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  }
  for (const el of scope.querySelectorAll('[data-i18n-title]')) {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  }
}
