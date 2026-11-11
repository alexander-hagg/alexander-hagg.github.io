'use strict';

/* ------------------------------------------------------------------ *
 *  Mirror Duet — a small dihedral mandala with a machine in the room.
 *  All art is generated locally. No assets, no libraries.
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = (sel) => document.querySelector(sel);

const PALETTES = {
  moss: {
    name: 'Moss',
    colors: ['#c9f26b', '#8fce6a', '#e6f7a8', '#4f8a52'],
    glow: '#c9f26b',
    note: 261.63
  },
  ember: {
    name: 'Ember',
    colors: ['#ff9a5c', '#ffd479', '#ff5e3a', '#f3e2c7'],
    glow: '#ff9a5c',
    note: 293.66
  },
  ultra: {
    name: 'Ultramarine',
    colors: ['#6f9bff', '#b7d4ff', '#7a6bff', '#e6eeff'],
    glow: '#6f9bff',
    note: 220.00
  },
  bone: {
    name: 'Bone',
    colors: ['#f3f1e8', '#cfd0c4', '#a9ad9e', '#c9f26b'],
    glow: '#e8e6d8',
    note: 246.94
  }
};

const BRIEFS = {
  calm: { palette: 'ultra', label: 'Calm', phrase: 'long, cool arcs' },
  electric: { palette: 'ember', label: 'Electric', phrase: 'short, bright zigzags' },
  bloom: { palette: 'moss', label: 'Bloom', phrase: 'petal loops and soft arcs' }
};

const FOLD_WORDS = { 4: 'four-fold', 6: 'six-fold', 8: 'eight-fold', 12: 'twelve-fold' };

/* ---------- small utilities ---------- */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _rgbaCache = new Map();
function rgba(hex, alpha) {
  const key = hex + alpha;
  if (_rgbaCache.has(key)) return _rgbaCache.get(key);
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const out = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  _rgbaCache.set(key, out);
  return out;
}

function readSeed() {
  try {
    const raw = new URLSearchParams(window.location.search).get('seed');
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0 && n < 100000) return n;
  } catch (e) { /* file:// is fine */ }
  return 7421;
}

/* ---------- state ---------- */
const state = {
  seed: readSeed(),
  symmetry: 8,
  palette: 'moss',
  brief: null,
  machine: true,
  sound: false,
  ink: 0,
  strokes: [],
  current: null,
  score: 0,
  peak: 0,
  completed: false,
  replyToken: 0,
  composeToken: 0
};

/* ---------- dom ---------- */
const stage = $('#stage');
const shell = $('#canvasShell');
const canvas = $('#art');
const ctx = canvas.getContext('2d');
const bgCanvas = document.createElement('canvas');
const bgx = bgCanvas.getContext('2d');
const artCanvas = document.createElement('canvas');
const artx = artCanvas.getContext('2d');
const fxCanvas = document.createElement('canvas');
const fxCtx = fxCanvas.getContext('2d');

const harmonyEl = $('#harmony');
const meterEl = $('#meter');
const meterFill = $('#meterFill');
const seedLabel = $('#seedLabel');
const briefLabel = $('#briefLabel');
const foldMini = $('#foldMini');
const foldLabel = $('#foldLabel');
const statusPill = $('#statusPill');
const statusText = $('#statusText');
const readout = $('#readout');
const liveEl = $('#live');
const badge = $('#badge');
const badgeScore = $('#badgeScore');
const fillBar = $('#fillBar');
const balanceBar = $('#balanceBar');
const colorBar = $('#colorBar');
const fillVal = $('#fillVal');
const balanceVal = $('#balanceVal');
const colorVal = $('#colorVal');
const machineToggle = $('#machineToggle');
const machineState = $('#machineState');
const soundToggle = $('#soundToggle');
const soundState = $('#soundState');

/* ---------- canvas geometry ---------- */
let size = 0;
let CX = 0;
let CY = 0;
let R = 0;
let DPR = 1;
let fitRaf = 0;

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced = motionQuery.matches;
motionQuery.addEventListener?.('change', (e) => { reduced = e.matches; });

/* ---------- deterministic grain ---------- */
const grainCanvas = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 180;
  const g = c.getContext('2d');
  const img = g.createImageData(180, 180);
  let s = 0x9e3779b9;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = s >>> 24;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 18;
  }
  g.putImageData(img, 0, 0);
  return c;
})();

/* ---------- background painting ---------- */
function paintBackground(g, S, cx, cy, r, sym, seed, palKey) {
  const pal = PALETTES[palKey];
  const rng = mulberry32(((seed * 2654435761) ^ 0x9e3779b9) >>> 0);

  g.save();
  g.fillStyle = '#080908';
  g.fillRect(0, 0, S, S);

  let grad = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.72);
  grad.addColorStop(0, rgba(pal.glow, 0.13));
  grad.addColorStop(0.34, rgba(pal.colors[2], 0.045));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  g.save();
  g.beginPath();
  g.arc(cx, cy, r * 1.01, 0, TAU);
  g.clip();

  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    const d = r * (0.15 + rng() * 0.62);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const rad = r * (0.22 + rng() * 0.42);
    const blob = g.createRadialGradient(x, y, 0, x, y, rad);
    blob.addColorStop(0, rgba(pal.colors[(i + 1) % 4], 0.055 + rng() * 0.05));
    blob.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = blob;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
  }

  g.lineWidth = 1;
  g.strokeStyle = 'rgba(243,241,232,.032)';
  for (let i = 0; i < sym * 2; i++) {
    const a = (i * Math.PI) / sym + Math.PI / (sym * 2);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * 0.18, cy + Math.sin(a) * r * 0.18);
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.stroke();
  }

  const bands = [0.2, 0.36, 0.52, 0.68, 0.84, 0.99];
  bands.forEach((b, i) => {
    g.beginPath();
    g.arc(cx, cy, r * b, 0, TAU);
    g.setLineDash(i === 1 || i === 4 ? [2, 8] : []);
    g.strokeStyle = rgba(i % 2 ? pal.colors[3] : '#f3f1e8', i % 2 ? 0.05 : 0.075);
    g.stroke();
  });
  g.setLineDash([]);

  const rot = rng() * TAU;
  g.beginPath();
  for (let i = 0; i < sym; i++) {
    const a = rot + (i * TAU) / sym;
    const rr = r * 0.63;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.strokeStyle = rgba(pal.glow, 0.06);
  g.stroke();

  for (let i = 0; i < 90; i++) {
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * r * 0.97;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    const rad = 0.35 + rng() * 1.35;
    g.fillStyle = rgba(i % 7 === 0 ? pal.glow : (i % 3 === 0 ? pal.colors[2] : '#f3f1e8'), 0.08 + rng() * 0.32);
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
  }

  const core = g.createRadialGradient(cx, cy, 0, cx, cy, r * 0.24);
  core.addColorStop(0, rgba(pal.glow, 0.08));
  core.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = core;
  g.fillRect(cx - r * 0.25, cy - r * 0.25, r * 0.5, r * 0.5);

  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.strokeStyle = 'rgba(243,241,232,.13)';
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, r * 0.105, 0, TAU);
  g.strokeStyle = rgba(pal.glow, 0.14);
  g.stroke();
  g.restore();

  grad = g.createRadialGradient(cx, cy, r * 0.28, cx, cy, S * 0.72);
  grad.addColorStop(0, 'rgba(5,6,4,0)');
  grad.addColorStop(0.72, 'rgba(5,6,4,.15)');
  grad.addColorStop(1, 'rgba(4,5,3,.9)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  const grain = g.createPattern(grainCanvas, 'repeat');
  if (grain) {
    g.globalAlpha = 0.55;
    g.globalCompositeOperation = 'overlay';
    g.fillStyle = grain;
    g.fillRect(0, 0, S, S);
  }
  g.restore();
}

/* ---------- stroke painting ---------- */
const copyCache = {};
function copiesFor(sym) {
  if (!copyCache[sym]) {
    const cos = [];
    const sin = [];
    for (let k = 0; k < sym; k++) {
      const a = (k * TAU) / sym;
      cos.push(Math.cos(a));
      sin.push(Math.sin(a));
    }
    copyCache[sym] = { cos, sin };
  }
  return copyCache[sym];
}

function paintSegmentsWith(g, stroke, i0, i1, cx, cy, r, copies, pal) {
  const pts = stroke.pts;
  const from = Math.max(1, i0);
  if (!pts || pts.length < 2 || i1 <= from) return;
  const col = pal.colors[(stroke.ci || 0) % 4];
  const { cos, sin } = copies;
  const coreAlpha = stroke.source === 'machine' ? 0.74 : 0.9;

  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Wide, low-alpha glow underneath everything.
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = rgba(col, 0.065);
  for (let k = 0; k < cos.length; k++) {
    const ca = cos[k];
    const sa = sin[k];
    for (let m = 0; m < 2; m++) {
      const flip = m ? -1 : 1;
      for (let i = from; i < i1; i++) {
        const p = pts[i - 1];
        const q = pts[i];
        const ax = cx + (p.x * ca - p.y * flip * sa) * r;
        const ay = cy + (p.x * sa + p.y * flip * ca) * r;
        const bx = cx + (q.x * ca - q.y * flip * sa) * r;
        const by = cy + (q.x * sa + q.y * flip * ca) * r;
        g.lineWidth = Math.max(0.8, ((p.w + q.w) / 2) * r * 3.1);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }
  }

  // Opaque-ish core keeps the palette colour readable where copies overlap.
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = rgba(col, coreAlpha);
  for (let k = 0; k < cos.length; k++) {
    const ca = cos[k];
    const sa = sin[k];
    for (let m = 0; m < 2; m++) {
      const flip = m ? -1 : 1;
      for (let i = from; i < i1; i++) {
        const p = pts[i - 1];
        const q = pts[i];
        const ax = cx + (p.x * ca - p.y * flip * sa) * r;
        const ay = cy + (p.x * sa + p.y * flip * ca) * r;
        const bx = cx + (q.x * ca - q.y * flip * sa) * r;
        const by = cy + (q.x * sa + q.y * flip * ca) * r;
        g.lineWidth = Math.max(0.55, ((p.w + q.w) / 2) * r);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }
  }

  // A thin additive sheen catches the light.
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,255,255,.075)';
  for (let k = 0; k < cos.length; k++) {
    const ca = cos[k];
    const sa = sin[k];
    for (let m = 0; m < 2; m++) {
      const flip = m ? -1 : 1;
      for (let i = from; i < i1; i++) {
        const p = pts[i - 1];
        const q = pts[i];
        const ax = cx + (p.x * ca - p.y * flip * sa) * r;
        const ay = cy + (p.x * sa + p.y * flip * ca) * r;
        const bx = cx + (q.x * ca - q.y * flip * sa) * r;
        const by = cy + (q.x * sa + q.y * flip * ca) * r;
        g.lineWidth = Math.max(0.3, ((p.w + q.w) / 2) * r * 0.28);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }
  }
}

function paintDotWith(g, stroke, cx, cy, r, copies, pal) {
  const p = stroke.pts[0];
  if (!p) return;
  const col = pal.colors[(stroke.ci || 0) % 4];
  const { cos, sin } = copies;
  for (let k = 0; k < cos.length; k++) {
    for (let m = 0; m < 2; m++) {
      const flip = m ? -1 : 1;
      const x = cx + (p.x * cos[k] - p.y * flip * sin[k]) * r;
      const y = cy + (p.x * sin[k] + p.y * flip * cos[k]) * r;
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba(col, 0.10);
      g.beginPath();
      g.arc(x, y, Math.max(1.2, p.w * r * 3.4), 0, TAU);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = rgba(col, 0.92);
      g.beginPath();
      g.arc(x, y, Math.max(0.8, p.w * r * 1.25), 0, TAU);
      g.fill();
    }
  }
}

function paintStrokesOn(g, cx, cy, r, sym, palKey, strokes) {
  const pal = PALETTES[palKey];
  const copies = copiesFor(sym);
  g.save();
  g.beginPath();
  g.arc(cx, cy, r * 1.005, 0, TAU);
  g.clip();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!stroke || !stroke.pts || !stroke.pts.length) continue;
    if (stroke.pts.length < 2) paintDotWith(g, stroke, cx, cy, r, copies, pal);
    else paintSegmentsWith(g, stroke, 1, stroke.pts.length, cx, cy, r, copies, pal);
  }
  g.restore();
}

function paintSegments(stroke, i0, i1) {
  if (!size || !stroke) return;
  artx.save();
  artx.beginPath();
  artx.arc(CX, CY, R * 1.005, 0, TAU);
  artx.clip();
  artx.globalCompositeOperation = 'lighter';
  artx.lineCap = 'round';
  artx.lineJoin = 'round';
  paintSegmentsWith(artx, stroke, i0, i1, CX, CY, R, copiesFor(state.symmetry), PALETTES[state.palette]);
  artx.restore();
}

function paintDot(stroke) {
  if (!size || !stroke) return;
  artx.save();
  artx.beginPath();
  artx.arc(CX, CY, R * 1.005, 0, TAU);
  artx.clip();
  artx.globalCompositeOperation = 'lighter';
  paintDotWith(artx, stroke, CX, CY, R, copiesFor(state.symmetry), PALETTES[state.palette]);
  artx.restore();
}

/* ---------- canvas sizing / compositing ---------- */
function scheduleFit() {
  if (fitRaf) return;
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    fit();
  });
}

function fit() {
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const s = Math.floor(Math.min(rect.width, rect.height));
  if (s < 140 || s === size) return;
  size = s;
  shell.style.width = size + 'px';
  shell.style.height = size + 'px';
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [canvas, bgCanvas, artCanvas, fxCanvas]) {
    c.width = Math.round(size * DPR);
    c.height = Math.round(size * DPR);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  bgx.setTransform(DPR, 0, 0, DPR, 0, 0);
  artx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  CX = size / 2;
  CY = size / 2;
  R = size * 0.455;
  drawBackground();
  redrawArt();
}

function drawBackground() {
  if (!size) return;
  bgx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bgx.clearRect(0, 0, size, size);
  paintBackground(bgx, size, CX, CY, R, state.symmetry, state.seed, state.palette);
}

function composite() {
  if (!size) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgCanvas, 0, 0);
  ctx.drawImage(artCanvas, 0, 0);
  ctx.drawImage(fxCanvas, 0, 0);
}

function redrawArt() {
  if (!size) return;
  markAnims.forEach((a) => { a.cancelled = true; });
  markAnims = [];
  artx.setTransform(1, 0, 0, 1, 0, 0);
  artx.clearRect(0, 0, artCanvas.width, artCanvas.height);
  artx.setTransform(DPR, 0, 0, DPR, 0, 0);
  paintStrokesOn(artx, CX, CY, R, state.symmetry, state.palette, state.strokes);
  if (state.current) {
    if (state.current.pts.length < 2) paintDot(state.current);
    else paintSegments(state.current, 1, state.current.pts.length);
  }
  composite();
}

/* ---------- scoring ---------- */
function computeScore() {
  const bands = new Array(6).fill(0);
  const used = new Set();
  for (const stroke of state.strokes) {
    if (!stroke.pts || !stroke.pts.length) continue;
    used.add((stroke.ci || 0) % 4);
    for (const p of stroke.pts) {
      const rr = Math.hypot(p.x, p.y);
      if (rr <= 1.02) bands[Math.min(5, Math.floor(rr * 6))] += 1;
    }
    for (let i = 1; i < stroke.pts.length; i++) {
      const a = stroke.pts[i - 1];
      const b = stroke.pts[i];
      const rr = Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (rr <= 1.02) bands[Math.min(5, Math.floor(rr * 6))] += 0.5;
    }
  }
  const total = bands.reduce((a, b) => a + b, 0);
  const occupied = bands.filter((n) => n > 1).length;
  const fill = occupied / 6;
  let balance = 0;
  if (total > 0) {
    for (const n of bands) {
      if (n > 0) {
        const p = n / total;
        balance -= p * Math.log(p);
      }
    }
    balance /= Math.log(6);
  }
  const color = used.size / 4;
  const score = Math.round(fill * 40 + balance * 30 + color * 30);
  return { score, fill, balance, color, occupied, bands };
}

function updateScoreUI() {
  const s = computeScore();
  state.score = s.score;
  state.peak = Math.max(state.peak, s.score);
  harmonyEl.textContent = String(s.score);
  meterFill.style.width = s.score + '%';
  meterEl.setAttribute('aria-valuenow', String(s.score));
  fillBar.style.width = Math.round(s.fill * 100) + '%';
  balanceBar.style.width = Math.round(s.balance * 100) + '%';
  colorBar.style.width = Math.round(s.color * 100) + '%';
  fillVal.textContent = String(Math.round(s.fill * 100));
  balanceVal.textContent = String(Math.round(s.balance * 100));
  colorVal.textContent = String(Math.round(s.color * 100));
  if (state.completed) badgeScore.textContent = String(state.peak);
  if (!state.completed && s.score >= 80 && state.strokes.length > 0) completeDuet();
}

function completeDuet() {
  state.completed = true;
  shell.classList.add('complete');
  badge.hidden = false;
  badgeScore.textContent = String(state.peak || state.score);
  setStatus('Complete', 'complete', false);
  liveEl.textContent = `Duet complete. Harmony ${state.score} out of 100.`;
  celebrate();
}

/* ---------- description / status ---------- */
function briefPhrase() {
  if (!state.brief) return 'Free play.';
  const b = BRIEFS[state.brief];
  return `The brief is ${b.label.toLowerCase()}: ${b.phrase}.`;
}

function describe() {
  const pal = PALETTES[state.palette];
  const s = computeScore();
  const mine = state.strokes.filter((x) => x.source === 'player').length;
  const mach = state.strokes.filter((x) => x.source === 'machine').length;
  const fold = FOLD_WORDS[state.symmetry];
  let text;
  if (!state.strokes.length) {
    text = `An empty ${fold} mirror in ${pal.name}. Draw inside the circle; every mark is reflected.`;
  } else {
    let who;
    if (mine === 0 && mach > 0) {
      who = `${mach} ${mach === 1 ? 'mark' : 'marks'} from the machine`;
    } else {
      const bits = [];
      if (mine) bits.push(`${mine} ${mine === 1 ? 'stroke' : 'strokes'} from you`);
      if (mach) bits.push(`${mach} ${mach === 1 ? 'reply' : 'replies'} from the machine`);
      who = bits.length ? bits.join(' and ') : 'no marks yet';
    }
    const art = fold.startsWith('eight') ? 'An' : 'A';
    text = `${art} ${fold} mirror in ${pal.name}. ${s.occupied} of 6 rings carry ink — ${who}. Harmony ${s.score}. ${briefPhrase()}`;
    if (state.completed) text += ' Duet complete.';
  }
  readout.textContent = text;
  canvas.setAttribute('aria-label', text + ' Interactive canvas: draw with a pointer or touch, or use Auto-compose.');
}

function setStatus(text, mode = 'idle', announce = true) {
  statusText.textContent = text;
  statusPill.dataset.mode = mode;
  if (announce) liveEl.textContent = text;
}

function refresh() {
  updateScoreUI();
  describe();
}

/* ---------- fx: reply pulses and completion ---------- */
let fxParticles = [];
let fxRings = [];
let fxRaf = 0;
let fxLast = 0;

function startFx() {
  if (reduced || fxRaf) return;
  fxLast = 0;
  fxRaf = requestAnimationFrame(fxTick);
}

function fxTick(now) {
  if (!fxLast) fxLast = now;
  const dt = Math.min(42, now - fxLast);
  fxLast = now;
  fxCtx.setTransform(1, 0, 0, 1, 0, 0);
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fxCtx.globalCompositeOperation = 'lighter';

  fxParticles = fxParticles.filter((p) => {
    p.life -= dt;
    if (p.life <= 0) return false;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.992;
    p.vy *= 0.992;
    const a = p.life / p.ttl;
    fxCtx.fillStyle = rgba(p.color, 0.75 * a);
    fxCtx.beginPath();
    fxCtx.arc(CX + p.x * R, CY + p.y * R, p.size * (0.6 + a * 0.6), 0, TAU);
    fxCtx.fill();
    return true;
  });

  fxRings = fxRings.filter((ring) => {
    ring.life -= dt;
    if (ring.life <= 0) return false;
    const t = 1 - ring.life / ring.ttl;
    const rad = (ring.r0 + (ring.r1 - ring.r0) * t) * R;
    fxCtx.strokeStyle = rgba(ring.color, 0.55 * (1 - t));
    fxCtx.lineWidth = 1.2;
    fxCtx.beginPath();
    fxCtx.arc(CX + ring.x * R, CY + ring.y * R, rad, 0, TAU);
    fxCtx.stroke();
    return true;
  });

  composite();
  if (fxParticles.length || fxRings.length) {
    fxRaf = requestAnimationFrame(fxTick);
  } else {
    fxRaf = 0;
    fxLast = 0;
    fxCtx.setTransform(1, 0, 0, 1, 0, 0);
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    composite();
  }
}

function pulseAt(x, y, color) {
  if (reduced) return;
  fxRings.push({ x, y, r0: 0.015, r1: 0.15, life: 720, ttl: 720, color });
  startFx();
}

function celebrate() {
  if (reduced) return;
  const pal = PALETTES[state.palette];
  for (let i = 0; i < 38; i++) {
    const a = Math.random() * TAU;
    const sp = 0.00006 + Math.random() * 0.00019;
    const ttl = 950 + Math.random() * 650;
    fxParticles.push({
      x: 0,
      y: 0,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: ttl,
      ttl,
      size: 0.7 + Math.random() * 1.9,
      color: pal.colors[i % 4]
    });
  }
  fxRings.push({ x: 0, y: 0, r0: 0.04, r1: 0.82, life: 1100, ttl: 1100, color: pal.glow });
  fxRings.push({ x: 0, y: 0, r0: 0.02, r1: 0.52, life: 780, ttl: 780, color: pal.colors[2] });
  startFx();
}

function clearFx() {
  fxParticles = [];
  fxRings = [];
  if (fxRaf) cancelAnimationFrame(fxRaf);
  fxRaf = 0;
  fxLast = 0;
  fxCtx.setTransform(1, 0, 0, 1, 0, 0);
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
}

/* ---------- machine replies ---------- */
let markAnims = [];

function addMachineMark(mark, delay) {
  state.strokes.push(mark);
  if (state.strokes.length > 220) state.strokes.shift();
  const job = { stroke: mark, drawn: 1, cancelled: false };
  markAnims.push(job);

  if (reduced) {
    paintSegments(mark, 1, mark.pts.length);
    composite();
    markAnims = markAnims.filter((x) => x !== job);
    pulseAt(mark.pts[0].x, mark.pts[0].y, PALETTES[state.palette].colors[mark.ci % 4]);
    return;
  }

  const start = performance.now() + delay;
  const duration = 430;
  const frame = (now) => {
    if (job.cancelled || !size) return;
    if (now < start) {
      requestAnimationFrame(frame);
      return;
    }
    const target = Math.min(mark.pts.length, 1 + Math.floor(((now - start) / duration) * (mark.pts.length - 1)));
    if (target > job.drawn) {
      paintSegments(mark, job.drawn, target);
      job.drawn = target;
      composite();
    }
    if (job.drawn < mark.pts.length) {
      requestAnimationFrame(frame);
    } else {
      markAnims = markAnims.filter((x) => x !== job);
      pulseAt(mark.pts[0].x, mark.pts[0].y, PALETTES[state.palette].colors[mark.ci % 4]);
    }
  };
  requestAnimationFrame(frame);
}

function makeReply(stroke, rng) {
  const pts = stroke.pts;
  let sx = 0;
  let sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / pts.length;
  const my = sy / pts.length;
  const r0 = clamp(Math.hypot(mx, my), 0.08, 0.94);
  const a0 = Math.atan2(my, mx);
  const style = state.brief || 'free';
  const count = rng() < 0.55 ? 2 : 1;
  const marks = [];

  for (let j = 0; j < count; j++) {
    const ci = (stroke.ci + 1 + j + Math.floor(rng() * 2)) % 4;
    const outward = r0 < 0.52;
    const rr = clamp(outward ? r0 + 0.22 + rng() * 0.16 : r0 - 0.22 - rng() * 0.16, 0.14, 0.92);
    const offset = (Math.PI / state.symmetry) * (0.6 + rng() * 0.8);
    const ang = a0 + (j ? -offset : offset) + (rng() - 0.5) * 0.3;
    const span = style === 'calm' ? 0.75 + rng() * 0.75
      : style === 'electric' ? 0.3 + rng() * 0.35
        : 0.45 + rng() * 0.45;
    const steps = 18 + Math.floor(rng() * 12);
    const out = [];

    if (style === 'bloom' && j === 0) {
      const loop = 0.055 + rng() * 0.045;
      const ox = Math.cos(ang) * rr;
      const oy = Math.sin(ang) * rr;
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * TAU;
        const wob = 1 + Math.sin(th * 3) * 0.18;
        out.push({ x: ox + Math.cos(th) * loop * wob, y: oy + Math.sin(th) * loop * wob, w: 0.0062 + rng() * 0.0014 });
      }
    } else {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let a = ang + span * (t - 0.5);
        let rad = rr;
        if (style === 'electric') {
          rad += Math.sin(t * Math.PI * 8) * 0.032;
          a += Math.sin(t * Math.PI * 3) * 0.025;
        } else if (style === 'bloom') {
          rad += Math.sin(t * Math.PI * 2) * 0.035;
        } else {
          rad += Math.sin(t * Math.PI * 2 + j * 1.7) * 0.018;
        }
        out.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, w: style === 'electric' ? 0.0055 : 0.0075 });
      }
    }
    marks.push({ pts: out, ci, source: 'machine', seed: (rng() * 1e9) | 0 });
  }
  return marks;
}

function scheduleReply(stroke) {
  if (!state.machine) return;
  clearTimeout(replyTimer);
  const token = ++state.replyToken;
  setStatus('Machine thinking', 'thinking', !state.completed);

  replyTimer = setTimeout(() => {
    if (token !== state.replyToken || !state.machine) return;
    const rng = mulberry32(((stroke.seed || 1) ^ (state.strokes.length * 2654435761) ^ state.seed) >>> 0);
    const marks = makeReply(stroke, rng);
    marks.forEach((m, i) => addMachineMark(m, i * 140));
    playNote(marks[0].ci, true);
    refresh();
    setTimeout(() => {
      if (token !== state.replyToken) return;
      if (state.completed) setStatus('Complete', 'complete', false);
      else setStatus('Your move');
    }, reduced ? 160 : 880);
  }, reduced ? 120 : 520);
}

let replyTimer = 0;

/* ---------- drawing ---------- */
let lastT = 0;
let smoothSpeed = 0;

function toUnit(e) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const px = ((e.clientX - rect.left) / rect.width) * size;
  const py = ((e.clientY - rect.top) / rect.height) * size;
  return { x: (px - CX) / R, y: (py - CY) / R };
}

function pointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.isPrimary === false) return;
  const p = toUnit(e);
  if (!p) return;
  if (Math.hypot(p.x, p.y) > 1.02) {
    liveEl.textContent = 'Draw inside the circle.';
    return;
  }
  if (state.sound && audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const ci = state.ink % 4;
  state.ink = (state.ink + 1) % 4;
  state.current = {
    pts: [{ x: p.x, y: p.y, w: 0.014 }],
    ci,
    source: 'player',
    seed: (Math.random() * 1e9) | 0
  };
  lastT = e.timeStamp || performance.now();
  smoothSpeed = 0;
  paintDot(state.current);
  composite();
  if (!state.completed && statusPill.dataset.mode !== 'thinking') setStatus('Your move');
  e.preventDefault();
}

function pointerMove(e) {
  if (!state.current || e.isPrimary === false) return;
  const p = toUnit(e);
  if (!p) return;
  const pts = state.current.pts;
  const last = pts[pts.length - 1];
  const dx = p.x - last.x;
  const dy = p.y - last.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.0035) return;
  const now = e.timeStamp || performance.now();
  const dt = Math.max(4, now - lastT);
  const speed = (dist / dt) * 16.7;
  smoothSpeed = smoothSpeed * 0.65 + speed * 0.35;
  const w = clamp(0.0055, 0.024, 0.0062 + 0.013 * Math.exp(-smoothSpeed * 30));
  const steps = dist > 0.05 ? Math.min(5, Math.ceil(dist / 0.02)) : 1;

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    let qx = last.x + dx * t;
    let qy = last.y + dy * t;
    const rr = Math.hypot(qx, qy);
    if (rr > 1.02) {
      if (rr > 1.09) continue;
      qx *= 1.02 / rr;
      qy *= 1.02 / rr;
    }
    pts.push({ x: qx, y: qy, w: w * (0.72 + 0.28 * t) });
    paintSegments(state.current, pts.length - 1, pts.length);
    if (pts.length > 480) break;
  }
  lastT = now;
  composite();
  e.preventDefault();
}

function finishStroke() {
  if (!state.current) return;
  const stroke = state.current;
  state.current = null;
  if (stroke.pts.length < 2) {
    stroke.pts.push({ x: stroke.pts[0].x + 0.002, y: stroke.pts[0].y + 0.002, w: stroke.pts[0].w });
    paintSegments(stroke, 1, 2);
    composite();
  }
  state.strokes.push(stroke);
  if (state.strokes.length > 220) state.strokes.shift();
  shell.classList.add('has-drawn');
  playNote(stroke.ci, false);
  refresh();
  if (state.machine) scheduleReply(stroke);
  else if (!state.completed) setStatus('Your move');
}

function pointerUp(e) {
  if (e && e.pointerId !== undefined) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  finishStroke();
}

/* ---------- sound ---------- */
let audioCtx = null;

async function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { audioCtx = new AC(); } catch (e) { return false; }
  }
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch (e) { /* ignore */ }
  }
  return audioCtx.state === 'running';
}

function playTone(freq, duration, volume) {
  if (!audioCtx || !state.sound) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const gain2 = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2.004;
    gain2.gain.value = 0.16;
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    osc.connect(gain);
    osc2.connect(gain2);
    gain2.connect(gain);
    gain.connect(filter);
    filter.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + duration + 0.05);
    osc2.stop(t + duration + 0.05);
  } catch (e) { /* audio is a bonus, never an error */ }
}

function playNote(ci, machine) {
  if (!state.sound || !audioCtx) return;
  const pal = PALETTES[state.palette];
  const scale = [0, 2, 4, 7, 9];
  const semis = scale[(ci || 0) % 5] + (machine ? 12 : 0);
  const freq = pal.note * Math.pow(2, semis / 12);
  playTone(freq, machine ? 1.7 : 1.25, machine ? 0.028 : 0.04);
}

/* ---------- composition generators ---------- */
function arcPoints(r, a0, span, steps, wobble, width) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + span * t;
    const rad = r + Math.sin(t * Math.PI * 2 + wobble) * 0.018;
    pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, w: width });
  }
  return pts;
}

function composeOpening() {
  const rng = mulberry32(((state.seed * 2654435761) ^ 0x51ed270b) >>> 0);
  const marks = [];
  const specs = [
    { r: 0.36, span: 0.5 + rng() * 0.16, steps: 18, ci: 0, wob: 0.4 },
    { r: 0.36, span: 0.28 + rng() * 0.12, steps: 13, ci: 1, wob: 1.7 },
    { r: 0.7, span: 0.66 + rng() * 0.18, steps: 22, ci: 1, wob: 2.2 },
    { r: 0.7, span: 0.3 + rng() * 0.12, steps: 13, ci: 0, wob: 4.1 },
    { r: 0.52, span: 0.38 + rng() * 0.14, steps: 14, ci: 1, wob: 3.1 },
    { r: 0.52, span: 0.22 + rng() * 0.1, steps: 11, ci: 0, wob: 5.2 }
  ];
  for (const spec of specs) {
    marks.push({
      pts: arcPoints(spec.r, rng() * TAU, spec.span, spec.steps, spec.wob, 0.0088 + rng() * 0.0016),
      ci: spec.ci,
      source: 'machine',
      seed: (rng() * 1e9) | 0
    });
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU;
    const rr = [0.36, 0.52, 0.7, 0.58][i] + (rng() - 0.5) * 0.03;
    marks.push({
      pts: [{ x: Math.cos(a) * rr, y: Math.sin(a) * rr, w: 0.008 + rng() * 0.002 }],
      ci: i % 2,
      source: 'machine',
      seed: (rng() * 1e9) | 0
    });
  }
  state.strokes = marks;
}

function autoMarks() {
  const rng = mulberry32(((state.seed * 2654435761) ^ 0x9a5f3c21) >>> 0);
  const marks = [];
  for (let band = 0; band < 6; band++) {
    const base = 0.12 + band * 0.145;
    const count = 1 + (rng() < 0.6 ? 1 : 0);
    for (let j = 0; j < count; j++) {
      const r = clamp(base + (rng() - 0.5) * 0.03, 0.1, 0.93);
      const a0 = rng() * TAU;
      const span = 0.7 + rng() * 2.1;
      const steps = 18 + Math.floor(rng() * 18);
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = a0 + span * t;
        const rad = r + Math.sin(t * Math.PI * 2 + band + j) * 0.022;
        pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, w: 0.0058 + rng() * 0.0018 });
      }
      marks.push({ pts, ci: (band + j + Math.floor(rng() * 2)) % 4, source: 'machine', seed: (rng() * 1e9) | 0 });
    }
  }
  for (let k = 0; k < 2; k++) {
    const rr = 0.25 + k * 0.38;
    const a = rng() * TAU;
    const loop = 0.05 + rng() * 0.035;
    const ox = Math.cos(a) * rr;
    const oy = Math.sin(a) * rr;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const th = (i / 24) * TAU;
      pts.push({ x: ox + Math.cos(th) * loop, y: oy + Math.sin(th) * loop, w: 0.0065 });
    }
    marks.push({ pts, ci: (k + 2) % 4, source: 'machine', seed: (rng() * 1e9) | 0 });
  }
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    const rr = 0.08 + rng() * 0.84;
    marks.push({
      pts: [{ x: Math.cos(a) * rr, y: Math.sin(a) * rr, w: 0.008 + rng() * 0.003 }],
      ci: i % 4,
      source: 'machine',
      seed: (rng() * 1e9) | 0
    });
  }
  return marks;
}

/* ---------- resets ---------- */
function resetSurface() {
  state.composeToken++;
  state.replyToken++;
  clearTimeout(replyTimer);
  markAnims.forEach((a) => { a.cancelled = true; });
  markAnims = [];
  state.strokes = [];
  state.current = null;
  state.completed = false;
  state.peak = 0;
  state.score = 0;
  shell.classList.remove('complete', 'has-drawn');
  badge.hidden = true;
  clearFx();
}

function updateSeedUI() {
  seedLabel.textContent = `Seed ${String(state.seed).padStart(4, '0')}`;
}

function clearAll() {
  resetSurface();
  redrawArt();
  refresh();
  setStatus('Blank canvas — your move');
}

function newSeed() {
  resetSurface();
  let next = state.seed;
  while (next === state.seed) next = 1000 + Math.floor(Math.random() * 9000);
  state.seed = next;
  updateSeedUI();
  drawBackground();
  composeOpening();
  redrawArt();
  refresh();
  setStatus('New seed — your move');
}

function autoCompose() {
  resetSurface();
  redrawArt();
  const marks = autoMarks();
  const token = state.composeToken;
  let idx = 0;
  const step = reduced ? marks.length : 2;
  setStatus('Machine composing', 'thinking');

  const reveal = () => {
    if (token !== state.composeToken) return;
    const end = Math.min(marks.length, idx + step);
    for (; idx < end; idx++) {
      const mark = marks[idx];
      state.strokes.push(mark);
      paintSegments(mark, 1, mark.pts.length);
    }
    composite();
    if (idx < marks.length) {
      setTimeout(reveal, reduced ? 0 : 75);
    } else {
      refresh();
      if (!state.completed) setStatus('Your move');
      if (state.sound) {
        playNote(0, true);
        setTimeout(() => playNote(2, true), 170);
      }
    }
  };
  reveal();
}

/* ---------- palette / brief / symmetry ---------- */
function applyPaletteCSS() {
  const pal = PALETTES[state.palette];
  document.documentElement.style.setProperty('--mood', pal.colors[0]);
  document.documentElement.style.setProperty('--mood-soft', rgba(pal.colors[0], 0.12));
}

function updatePaletteUI() {
  document.querySelectorAll('.swatch').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.palette === state.palette));
  });
  briefLabel.textContent = state.brief ? `${BRIEFS[state.brief].label} brief` : 'Free play';
}

function updateBriefUI() {
  document.querySelectorAll('.chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.brief === state.brief));
  });
  briefLabel.textContent = state.brief ? `${BRIEFS[state.brief].label} brief` : 'Free play';
}

function setPalette(key) {
  if (!PALETTES[key]) return;
  state.palette = key;
  state.brief = null;
  applyPaletteCSS();
  updatePaletteUI();
  updateBriefUI();
  drawBackground();
  redrawArt();
  refresh();
  liveEl.textContent = `Palette: ${PALETTES[key].name}.`;
}

function setBrief(key) {
  if (!BRIEFS[key]) return;
  if (state.brief === key) {
    state.brief = null;
    updateBriefUI();
    refresh();
    liveEl.textContent = 'Free play.';
    return;
  }
  state.brief = key;
  state.palette = BRIEFS[key].palette;
  applyPaletteCSS();
  updatePaletteUI();
  updateBriefUI();
  drawBackground();
  redrawArt();
  refresh();
  liveEl.textContent = `Brief: ${BRIEFS[key].label}. ${BRIEFS[key].phrase.charAt(0).toUpperCase() + BRIEFS[key].phrase.slice(1)}.`;
}

function setSymmetry(n) {
  state.symmetry = n;
  foldLabel.textContent = `${n}-fold`;
  foldMini.textContent = `${n}-fold`;
  drawBackground();
  redrawArt();
  refresh();
  liveEl.textContent = `${n}-fold mirror.`;
}

function setMachine(on) {
  state.machine = on;
  machineToggle.setAttribute('aria-pressed', String(on));
  machineState.textContent = on ? 'on' : 'off';
  if (!on) {
    state.replyToken++;
    clearTimeout(replyTimer);
    if (state.completed) setStatus('Complete', 'complete', false);
    else setStatus('Your move');
    liveEl.textContent = 'Machine replies off.';
  } else {
    liveEl.textContent = 'Machine replies on.';
  }
}

async function toggleSound() {
  if (state.sound) {
    state.sound = false;
    soundToggle.setAttribute('aria-pressed', 'false');
    soundState.textContent = 'off';
    liveEl.textContent = 'Sound off.';
    return;
  }
  const ok = await initAudio();
  if (!ok) {
    liveEl.textContent = 'Sound unavailable in this browser.';
    return;
  }
  state.sound = true;
  soundToggle.setAttribute('aria-pressed', 'true');
  soundState.textContent = 'on';
  liveEl.textContent = 'Sound on.';
  playTone(392, 1.1, 0.032);
}

/* ---------- save ---------- */
function savePNG() {
  const S = 1600;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cx = S / 2;
  const cy = S / 2;
  const r = S * 0.455;
  paintBackground(g, S, cx, cy, r, state.symmetry, state.seed, state.palette);
  paintStrokesOn(g, cx, cy, r, state.symmetry, state.palette, state.strokes);
  g.save();
  g.fillStyle = 'rgba(243,241,232,.42)';
  g.font = '11px "Inconsolata", monospace';
  g.textAlign = 'right';
  g.fillText(`MIRROR DUET · SEED ${state.seed} · ${state.symmetry}-FOLD`, S - 30, S - 24);
  g.restore();

  const btn = $('#saveBtn');
  const oldLabel = btn.dataset.label || 'Save PNG';
  btn.dataset.label = oldLabel;
  liveEl.textContent = 'Preparing PNG.';
  c.toBlob((blob) => {
    if (!blob) {
      btn.textContent = 'No save';
      liveEl.textContent = 'Could not save the PNG.';
      setTimeout(() => { btn.textContent = oldLabel; }, 1400);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mirror-duet-${state.seed}-${state.symmetry}fold.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    btn.textContent = 'Saved';
    liveEl.textContent = 'Saved PNG.';
    setTimeout(() => { btn.textContent = oldLabel; }, 1400);
  }, 'image/png');
}

/* ---------- wiring ---------- */
document.querySelectorAll('.chip').forEach((b) => {
  b.addEventListener('click', () => setBrief(b.dataset.brief));
});
document.querySelectorAll('.swatch').forEach((b) => {
  b.addEventListener('click', () => setPalette(b.dataset.palette));
});
document.querySelectorAll('input[name="folds"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) setSymmetry(parseInt(input.value, 10));
  });
});
machineToggle.addEventListener('click', () => setMachine(!state.machine));
soundToggle.addEventListener('click', toggleSound);
$('#autoBtn').addEventListener('click', autoCompose);
$('#saveBtn').addEventListener('click', savePNG);
$('#seedBtn').addEventListener('click', newSeed);
$('#clearBtn').addEventListener('click', clearAll);

canvas.addEventListener('pointerdown', pointerDown);
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', pointerUp);
canvas.addEventListener('lostpointercapture', finishStroke);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', scheduleFit);
if ('ResizeObserver' in window) {
  new ResizeObserver(scheduleFit).observe(stage);
}

/* ---------- init ---------- */
function init() {
  updateSeedUI();
  updatePaletteUI();
  updateBriefUI();
  foldLabel.textContent = `${state.symmetry}-fold`;
  foldMini.textContent = `${state.symmetry}-fold`;
  applyPaletteCSS();
  composeOpening();
  requestAnimationFrame(() => {
    fit();
    if (!size) setTimeout(() => { fit(); redrawArt(); refresh(); }, 80);
    else { redrawArt(); refresh(); }
    if (!state.completed) setStatus('Your move', 'idle', false);
    liveEl.textContent = 'Mirror Duet. Draw inside the circle; every mark is reflected.';
  });
}

init();
