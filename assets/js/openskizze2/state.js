/**
 * OpenSKIZZE 2.0 — central application state store.
 *
 * A tiny Redux-style store: a pure `reducer(state, action)` plus a
 * `createStore` factory exposing `{ getState, dispatch, subscribe }`.
 *
 * The reducer is immutable — every handled action returns a NEW state object
 * (nested objects that change are shallow-copied). Unhandled actions return the
 * previous state unchanged, so later subtasks can add behaviour safely.
 *
 * Pure ES module: no side effects, no DOM access on import.
 */

import { SIM, BINS, PRESETS } from './config.js';
import {
  computeMetrics,
  computeDescriptor,
  computeFitness,
  binIndex,
} from './design.js';
import { createArchive, deriveArchetypes } from './simulation.js';

/**
 * @typedef {Object} SiteState
 * @property {string} presetId - Active preset id (see `PRESETS`).
 * @property {{x:number,y:number,w:number,h:number}} box - Selection box in cell units.
 */

/**
 * @typedef {Object} AppState
 * @property {'SELECT'|'OPTIMIZING'|'EXPLORE'} phase
 * @property {SiteState} site
 * @property {number} candidatesEvaluated
 * @property {number} totalCandidates
 * @property {{bins:(object|null)[], coverage:number, best:(object|null), pareto:number[]}} archive
 * @property {object[]} archetypes
 * @property {number|null} selectedDesignId
 * @property {string|null} selectedArchetype
 * @property {{airflow:boolean, coldPool:boolean, legend:boolean}} layers
 * @property {'layman'|'planner'} audience
 * @property {{gx:number,gy:number}|null} hoveredCell
 * @property {boolean} paused
 * @property {{t:number, running:boolean, startedAt:number}} animation
 */

/**
 * Build a fresh initial state. Used both for the exported `initialState` and
 * for the `RESTART` action (which must return an independent clone).
 *
 * @returns {AppState}
 */
export function makeInitialState() {
  // The initial selection box must match the default preset so the app opens
  // with the selection already centred on it (no jump on first preset click).
  const defaultPreset = PRESETS[0];
  return {
    phase: 'SELECT',                       // 'SELECT' | 'OPTIMIZING' | 'EXPLORE'
    site: { presetId: defaultPreset.id, box: { ...defaultPreset.box } },
    candidatesEvaluated: 0,
    totalCandidates: SIM.TOTAL_CANDIDATES,
    archive: { bins: new Array(144).fill(null), coverage: 0, best: null, pareto: [] },
    archetypes: [],
    selectedDesignId: null,
    selectedArchetype: null,
    layers: { airflow: true, coldPool: false, legend: false },
    audience: 'layman',
    hoveredCell: null,
    paused: false,
    animation: { t: 0, running: false, startedAt: 0 },
  };
}

/** The canonical initial state (a fresh object, safe to hand to the store). */
export const initialState = makeInitialState();

/** Empty archive factory (kept local so state.js has no simulation dependency). */
function emptyArchive() {
  return { bins: new Array(144).fill(null), coverage: 0, best: null, pareto: [] };
}

/**
 * Pure reducer. Returns a new state object for every handled action.
 *
 * Phase-1 actions are fully implemented. Actions owned by later subtasks
 * (`TICK`, `SEARCH_COMPLETE`, `SELECT_DESIGN`, `SELECT_ARCHETYPE`,
 * `TOGGLE_LAYER`, `SWITCH_AUDIENCE`, `HOVER_CELL`) are implemented as
 * no-op-safe state updates so the store contract is stable.
 *
 * @param {AppState} state
 * @param {{type:string, [k:string]:any}} action
 * @returns {AppState}
 */
export function reducer(state, action) {
  switch (action.type) {
    case 'SET_PRESET': {
      const box = action.box ? { ...action.box } : { ...state.site.box };
      return {
        ...state,
        phase: 'SELECT',
        site: { presetId: action.presetId, box },
        candidatesEvaluated: 0,
        archive: emptyArchive(),
        archetypes: [],
        selectedDesignId: null,
        selectedArchetype: null,
        animation: { t: 0, running: false, startedAt: 0 },
      };
    }

    case 'SET_SELECTION_BOX': {
      if (!action.box) return state;
      return {
        ...state,
        site: { ...state.site, box: { ...action.box } },
      };
    }

    case 'RUN_SEARCH': {
      return {
        ...state,
        phase: 'OPTIMIZING',
        candidatesEvaluated: 0,
        archive: createArchive(),
        archetypes: [],
        selectedDesignId: null,
        selectedArchetype: null,
        animation: { t: 0, running: true, startedAt: performance.now() },
      };
    }

    case 'TICK': {
      const design = action.design;
      if (!design) return state;

      // Evaluate the candidate if it has not been cached already.
      if (!design.metrics) computeMetrics(design);
      const desc = design.descriptor || computeDescriptor(design);
      const fitness = design.fitness != null ? design.fitness : computeFitness(design);

      let bx = Math.floor(desc.housing * BINS);
      let by = Math.floor(desc.permeability * BINS);
      if (bx < 0) bx = 0; else if (bx >= BINS) bx = BINS - 1;
      if (by < 0) by = 0; else if (by >= BINS) by = BINS - 1;

      const idx = binIndex(bx, by);
      const bins = state.archive.bins.slice();
      const cur = bins[idx];
      if (!cur || fitness > cur.fitness) {
        bins[idx] = { design, fitness, bx, by };
      }

      // Recompute coverage and best over the (small) 144-bin archive.
      let filled = 0;
      let best = null;
      for (const b of bins) {
        if (!b) continue;
        filled++;
        if (!best || b.fitness > best.fitness) best = b;
      }

      return {
        ...state,
        candidatesEvaluated: state.candidatesEvaluated + 1,
        archive: {
          ...state.archive,
          bins,
          coverage: filled / (BINS * BINS),
          best,
        },
      };
    }

    case 'SEARCH_COMPLETE': {
      const archive = state.archive;
      const elites = archive.bins.filter(Boolean);

      // Pareto set on raw (housingNorm, permeabilityNorm).
      const pareto = [];
      for (const a of elites) {
        const ah = a.design.descriptor.housing;
        const ap = a.design.descriptor.permeability;
        let dominated = false;
        for (const b of elites) {
          if (a === b) continue;
          const bh = b.design.descriptor.housing;
          const bp = b.design.descriptor.permeability;
          if (bh >= ah && bp >= ap && (bh > ah || bp > ap)) {
            dominated = true;
            break;
          }
        }
        if (!dominated) pareto.push(a.design.id);
      }

      // `deriveArchetypes` expects raw designs in `bins`; adapt the wrapper
      // archive without modifying the Subtask-1 simulation module.
      const rawArchive = {
        ...archive,
        bins: archive.bins.map((b) => (b ? b.design : null)),
      };
      const archetypes = deriveArchetypes(rawArchive);

      // Select the highest-fitness archetype medoid, else the archive best.
      const fitnessById = new Map();
      for (const b of elites) fitnessById.set(b.design.id, b.fitness);

      let selectedDesignId = archive.best ? archive.best.design.id : null;
      let selectedArchetype = null;
      let bestMedoidFit = -Infinity;
      for (const a of archetypes) {
        if (a.medoidId == null) continue;
        const f = fitnessById.has(a.medoidId) ? fitnessById.get(a.medoidId) : -Infinity;
        if (f > bestMedoidFit) {
          bestMedoidFit = f;
          selectedDesignId = a.medoidId;
          selectedArchetype = a.id;
        }
      }

      return {
        ...state,
        phase: 'EXPLORE',
        archive: { ...archive, pareto },
        archetypes,
        selectedDesignId,
        selectedArchetype,
        candidatesEvaluated: state.totalCandidates,
        animation: { ...state.animation, running: false },
      };
    }

    case 'SELECT_DESIGN':
      return { ...state, selectedDesignId: action.designId ?? null };

    case 'SELECT_ARCHETYPE': {
      const id = action.archetypeId ?? null;
      // Selecting an archetype also selects its medoid so the iso viewer
      // renders the representative design (Subtask 4).
      let selectedDesignId = state.selectedDesignId;
      if (id) {
        const a = (state.archetypes || []).find((x) => x.id === id);
        if (a && a.medoidId != null) selectedDesignId = a.medoidId;
      }
      return { ...state, selectedArchetype: id, selectedDesignId };
    }

    case 'TOGGLE_LAYER': {
      const key = action.layer;
      if (!key || !(key in state.layers)) return state;
      return { ...state, layers: { ...state.layers, [key]: !state.layers[key] } };
    }

    case 'SWITCH_AUDIENCE':
      return { ...state, audience: action.audience || state.audience };

    case 'HOVER_CELL':
      return { ...state, hoveredCell: action.cell ?? null };

    case 'SET_PAUSED':
      return { ...state, paused: !!action.paused };

    case 'RESTART':
      return makeInitialState();

    default:
      return state;
  }
}

/**
 * Create a store around a reducer.
 *
 * @param {(state:AppState, action:object) => AppState} reducerFn
 * @param {AppState} init
 * @returns {{getState:()=>AppState, dispatch:(action:object)=>AppState, subscribe:(fn:(s:AppState,a:object)=>void)=>()=>void}}
 */
export function createStore(reducerFn, init) {
  let state = init;
  const listeners = new Set();

  return {
    /** @returns {AppState} */
    getState() {
      return state;
    },

    /**
     * Run the reducer and notify subscribers.
     * @param {{type:string, [k:string]:any}} action
     * @returns {AppState}
     */
    dispatch(action) {
      state = reducerFn(state, action);
      for (const fn of listeners) fn(state, action);
      return state;
    },

    /**
     * Subscribe to state changes.
     * @param {(s:AppState, a:object)=>void} fn
     * @returns {()=>void} unsubscribe
     */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
