/* Cold Air — a miniature OpenSKIZZE site planner.
   Deterministic grid model + canvas map. No dependencies. */
(() => {
  'use strict';

  const W = 14, H = 10;
  const BUDGET = 90;
  const COST = { building: 6, tree: 2, water: 3 };
  const HOMES_PER_FLOOR = 3;
  const TARGET = { homes: 90, comfort: 65, corridor: 65 };
  const BLOCK = [0.82, 0.74, 0.64];       // wind left after 1, 2, 3 floors
  const COOL = { tree: 0.20, water: 0.28 };
  const COOL_DECAY = 0.62;
  const COOL_CAP = 0.55;
  const MIX = 0.78;
  const EAST_THRESHOLD = 0.6;

  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#plan');
  const ctx = canvas.getContext('2d');
  const stage = $('#mapStage');
  const statusEl = $('#status');
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceQuery.matches;

  const els = {
    siteId: $('#siteId'), siteId2: $('#siteId2'),
    readout: $('#readout'),
    homes: $('#homes'), comfort: $('#comfort'), corridor: $('#corridor'),
    remaining: $('#remaining'), spentLabel: $('#spentLabel'),
    budgetBar: $('#budgetBar'), budgetLine: $('.budget-line'),
    homesBar: $('#homesBar'), comfortBar: $('#comfortBar'), corridorBar: $('#corridorBar'),
    goalHomes: $('#goalHomes'), goalComfort: $('#goalComfort'), goalCorridor: $('#goalCorridor'),
    starsLabel: $('#starsLabel'), certNote: $('#certNote'),
    stamp: $('#stamp'), stampStars: $('#stampStars'), stampMeta: $('#stampMeta'),
    autoBtn: $('#autoBtn'), newBtn: $('#newBtn'), resetBtn: $('#resetBtn'),
  };

  // ——— seeded utilities ————————————————————————————————
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, '0');
  const emptyGrid = () => Array.from({ length: H }, () => Array(W).fill(null));

  // ——— state ——————————————————————————————————————————
  const state = {
    cells: emptyGrid(),
    site: 7,
    tool: 'building',
    height: 3,
    wind: true,
    heat: true,
    metrics: null,
    field: null,
    wasWin: false,
    hover: null,
    cursor: { x: 0, y: 0, on: false },
    particles: [],
    time: 0,
    heatCanvas: null,
  };
  let view = null;
  let dirty = true;
  let statusTimer = 0;
  let blockTimer = 0;
  let drag = null;

  const prand = mulberry32(0x51ed270b);

  // ——— site generation ——————————————————————————————————
  function generateTerrain(seed) {
    const g = emptyGrid();
    const rand = mulberry32((seed * 2654435761) >>> 0);

    // a small pond near the cold-air inlet
    const px = 1 + Math.floor(rand() * 3);
    const py = 2 + Math.floor(rand() * 6);
    const shape = rand() < 0.5
      ? [[0, 0], [1, 0], [1, 1]]
      : [[0, 0], [1, 0], [0, 1]];
    for (const [dx, dy] of shape) {
      g[py + dy][px + dx] = { type: 'water', floors: 0, paid: 0, seeded: true };
    }

    // three existing trees further into the block
    let trees = 0, guard = 0;
    while (trees < 3 && guard++ < 120) {
      const x = 2 + Math.floor(rand() * 6);
      const y = 1 + Math.floor(rand() * 8);
      if (g[y][x]) continue;
      g[y][x] = { type: 'tree', floors: 0, paid: 0, seeded: true };
      trees++;
    }
    return g;
  }

  function updateSiteLabels() {
    const s = pad2(state.site);
    els.siteId.textContent = s;
    els.siteId2.textContent = `SITE ${s}`;
  }

  function currentSpent() {
    let spent = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = state.cells[y][x];
        if (c) spent += c.paid || 0;
      }
    }
    return spent;
  }

  // ——— simulation ————————————————————————————————————————
  function rebuildHeatImage(heat) {
    if (!state.heatCanvas) {
      state.heatCanvas = document.createElement('canvas');
      state.heatCanvas.width = W;
      state.heatCanvas.height = H;
    }
    const hc = state.heatCanvas;
    const hctx = hc.getContext('2d');
    const img = hctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = heat[y][x];
        const i = (y * W + x) * 4;
        img.data[i] = 230;
        img.data[i + 1] = Math.round(150 + 38 * (1 - v));
        img.data[i + 2] = Math.round(82 + 14 * (1 - v));
        img.data[i + 3] = Math.round(clamp(v, 0, 1) * 212);
      }
    }
    hctx.putImageData(img, 0, 0);
  }

  function simulate() {
    const air = Array.from({ length: H }, () => Array(W).fill(0));
    const air2 = Array.from({ length: H }, () => Array(W).fill(0));
    const cool = Array.from({ length: H }, () => Array(W).fill(0));
    const heat = Array.from({ length: H }, () => Array(W).fill(0));
    const buildings = [];
    let homes = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = state.cells[y][x];
        if (!c) continue;
        if (c.type === 'building') {
          homes += c.floors * HOMES_PER_FLOOR;
          buildings.push({ x, y, floors: c.floors });
        }
      }
    }

    // west-to-east advection through each row
    for (let y = 0; y < H; y++) {
      let flow = 1;
      for (let x = 0; x < W; x++) {
        air[y][x] = flow;
        const c = state.cells[y][x];
        if (!c) continue;
        if (c.type === 'building') flow *= BLOCK[c.floors - 1];
        else if (c.type === 'tree') flow *= 0.985;
      }
    }

    // lateral mixing so a single wall does not create a hard row seam
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, n = 0;
        if (y > 0) { sum += air[y - 1][x]; n++; }
        if (y < H - 1) { sum += air[y + 1][x]; n++; }
        air2[y][x] = MIX * air[y][x] + (n ? ((1 - MIX) * sum) / n : air[y][x]);
      }
    }

    // cooling plumes drift east and spread one row either side
    function addCool(cx, cy, base) {
      for (let dx = 0; dx <= 4; dx++) {
        const fall = Math.pow(COOL_DECAY, dx);
        for (let dy = -1; dy <= 1; dy++) {
          const xx = cx + dx, yy = cy + dy;
          if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
          cool[yy][xx] += base * fall * (dy === 0 ? 1 : 0.45);
        }
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = state.cells[y][x];
        if (!c) continue;
        if (c.type === 'tree') addCool(x, y, COOL.tree);
        else if (c.type === 'water') addCool(x, y, COOL.water);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) cool[y][x] = Math.min(COOL_CAP, cool[y][x]);
    }

    // comfort: every home's cool-air score
    let scoreSum = 0;
    for (const b of buildings) {
      const c = state.cells[b.y][b.x];
      const score = 0.75 * air2[b.y][b.x] + 0.9 * cool[b.y][b.x] - 0.06 * (c.floors - 1);
      scoreSum += clamp(score, 0, 1);
    }
    const comfort = buildings.length ? Math.round((scoreSum / buildings.length) * 100) : 0;

    // corridor: how much of the east edge still gets 60% of the inlet air
    let east = 0;
    for (let y = 0; y < H; y++) if (air2[y][W - 1] >= EAST_THRESHOLD) east++;
    const corridor = Math.round((east / H) * 100);

    // heat field: still air plus the warmth buildings hold and shed east
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        heat[y][x] = clamp(1 - (0.75 * air2[y][x] + cool[y][x]), 0, 1);
      }
    }
    for (const b of buildings) {
      heat[b.y][b.x] = clamp(heat[b.y][b.x] + 0.10 * b.floors, 0, 1);
      for (let d = 1; d <= 3; d++) {
        const xx = b.x + d;
        if (xx >= W) break;
        heat[b.y][xx] = clamp(heat[b.y][xx] + [0.17, 0.09, 0.04][d - 1] * (0.65 + 0.12 * b.floors), 0, 1);
      }
    }

    const spent = currentSpent();
    const remaining = BUDGET - spent;
    const win = homes >= TARGET.homes && comfort >= TARGET.comfort;
    const stars = win ? 2 + (corridor >= TARGET.corridor ? 1 : 0) : 0;

    state.field = { air2, buildings };
    state.metrics = {
      homes, comfort, corridor, spent, remaining, win, stars,
      metHomes: homes >= TARGET.homes,
      metComfort: comfort >= TARGET.comfort,
      metCorridor: corridor >= TARGET.corridor,
    };
    rebuildHeatImage(heat);
    dirty = true;
    return state.metrics;
  }

  // ——— status + UI ——————————————————————————————————————
  function setStatus(text, immediate = false) {
    window.clearTimeout(statusTimer);
    if (immediate) {
      statusEl.textContent = text;
    } else {
      statusTimer = window.setTimeout(() => { statusEl.textContent = text; }, 110);
    }
  }

  function flashBlocked(text) {
    setStatus(text, true);
    stage.classList.remove('blocked');
    void stage.offsetWidth;
    stage.classList.add('blocked');
    window.clearTimeout(blockTimer);
    blockTimer = window.setTimeout(() => stage.classList.remove('blocked'), 520);
  }

  function summary() {
    const m = state.metrics;
    return `${m.homes} homes · ${m.comfort}% comfort · ${m.remaining} cr left${m.win ? ' · certified' : ''}`;
  }

  function cellLabel(x, y) {
    return `E${pad2(x)} N${pad2(y)}`;
  }

  function setBar(el, percent, now, max, text) {
    el.style.setProperty('--p', `${clamp(percent, 0, 100)}%`);
    el.setAttribute('aria-valuenow', String(now));
    el.setAttribute('aria-valuemax', String(max));
    el.setAttribute('aria-valuetext', text);
  }

  function updateUI() {
    const m = state.metrics;
    const wonNow = m.win && !state.wasWin;
    const lostNow = !m.win && state.wasWin;
    state.wasWin = m.win;

    els.homes.textContent = String(m.homes);
    els.comfort.textContent = String(m.comfort);
    els.corridor.textContent = String(m.corridor);
    els.remaining.textContent = String(Math.max(0, m.remaining));
    els.spentLabel.textContent = `${m.spent} / ${BUDGET}`;
    els.budgetBar.setAttribute('aria-valuenow', String(m.spent));
    els.budgetBar.querySelector('i').style.width = `${clamp((m.spent / BUDGET) * 100, 0, 100)}%`;
    els.budgetBar.classList.toggle('exhausted', m.remaining <= 0);
    els.budgetLine.classList.toggle('empty', m.remaining <= 0);

    setBar(els.homesBar, m.homes, Math.min(m.homes, TARGET.homes), TARGET.homes,
      `${m.homes} homes; target ${TARGET.homes}`);
    setBar(els.comfortBar, m.comfort, m.comfort, 100,
      `${m.comfort}% comfort; target ${TARGET.comfort}%`);
    setBar(els.corridorBar, m.corridor, m.corridor, 100,
      `${m.corridor}% corridor health; bonus target ${TARGET.corridor}%`);

    els.goalHomes.classList.toggle('met', m.metHomes);
    els.goalComfort.classList.toggle('met', m.metComfort);
    els.goalCorridor.classList.toggle('met', m.win && m.metCorridor);
    els.goalHomes.querySelector('em').textContent = m.metHomes ? 'met' : 'open';
    els.goalComfort.querySelector('em').textContent = m.metComfort ? 'met' : 'open';
    els.goalCorridor.querySelector('em').textContent = m.win && m.metCorridor ? 'bonus met' : 'bonus';
    els.starsLabel.textContent = `${m.stars} / 3`;

    if (m.win) {
      els.certNote.textContent = m.stars === 3
        ? 'Certified with three stars. The corridor still breathes.'
        : 'Certified with two stars. The corridor bonus is still open.';
    } else if (!m.metHomes && !m.metComfort) {
      els.certNote.textContent = 'Meet homes and comfort to certify the block.';
    } else if (!m.metHomes) {
      els.certNote.textContent = 'Homes are short of 90. Stack floors or add another building.';
    } else {
      els.certNote.textContent = 'Comfort is below 65%. Open the airflow or add cooling.';
    }

    els.stamp.hidden = !m.win;
    if (m.win) {
      els.stampMeta.textContent = `${m.homes} homes · ${m.comfort}% comfort`;
      const stars = els.stampStars.querySelectorAll('.star');
      stars.forEach((s, i) => s.classList.toggle('off', i >= m.stars));
    }
    document.body.classList.toggle('is-certified', m.win);

    if (wonNow) {
      setStatus(`Block certified — ${m.homes} homes, ${m.comfort}% comfort, ${m.stars} stars. Keep editing if you like.`, true);
    } else if (lostNow) {
      setStatus(`Certification withdrawn — ${m.comfort}% comfort. Open the airflow or add cooling.`, true);
    }
    return { won: wonNow, lost: lostNow };
  }

  // ——— actions ——————————————————————————————————————————
  function setTool(tool, announce = true) {
    state.tool = tool;
    document.querySelectorAll('.tool').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    dirty = true;
    if (announce) {
      const text = tool === 'erase'
        ? 'Erase tool — clicking a cell refunds its cost.'
        : `${tool[0].toUpperCase() + tool.slice(1)} tool — ${COST[tool]} credits.`;
      setStatus(text);
    }
  }

  function setHeight(h, announce = true) {
    state.height = clamp(h, 1, 3);
    document.querySelectorAll('[data-height]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.height) === state.height));
    });
    dirty = true;
    if (announce) setStatus(`${state.height}-floor buildings selected.`);
  }

  function applyTool(x, y) {
    const c = state.cells[y][x];
    const tool = state.tool;

    if (tool === 'erase') {
      if (!c) {
        setStatus(`Nothing to erase at ${cellLabel(x, y)}.`);
        return false;
      }
      const refund = c.paid || 0;
      const was = c.type === 'building' ? `${c.floors}-floor building` : c.type;
      state.cells[y][x] = null;
      simulate();
      const tr = updateUI();
      if (!tr.won && !tr.lost) {
        setStatus(`Erased ${was} at ${cellLabel(x, y)}${refund ? ` — ${refund} credits refunded` : ''}. ${summary()}`);
      }
      return true;
    }

    if (c) {
      if (tool === 'building' && c.type === 'building') return false;
      flashBlocked(`${cellLabel(x, y)} is occupied — erase it first.`);
      return false;
    }

    const cost = COST[tool];
    if (currentSpent() + cost > BUDGET) {
      flashBlocked(`Not enough credits — ${tool} costs ${cost}, ${BUDGET - currentSpent()} remain.`);
      return false;
    }

    state.cells[y][x] = {
      type: tool,
      floors: tool === 'building' ? state.height : 0,
      paid: cost,
    };
    simulate();
    const tr = updateUI();
    if (!tr.won && !tr.lost) {
      const what = tool === 'building' ? `${state.height}-floor building` : tool;
      setStatus(`Placed ${what} at ${cellLabel(x, y)}. ${summary()}`);
    }
    return true;
  }

  function cycleFloors(x, y) {
    const c = state.cells[y][x];
    if (!c || c.type !== 'building') return false;
    c.floors = (c.floors % 3) + 1;
    simulate();
    const tr = updateUI();
    if (!tr.won && !tr.lost) {
      setStatus(`${cellLabel(x, y)} now has ${c.floors} floor${c.floors > 1 ? 's' : ''}. ${summary()}`);
    }
    return true;
  }

  function applyAtCursor() {
    const { x, y } = state.cursor;
    const c = state.cells[y][x];
    if (state.tool === 'building' && c && c.type === 'building') {
      cycleFloors(x, y);
    } else {
      applyTool(x, y);
    }
    updateReadout(state.cursor);
  }

  const STARTER_BUILDINGS = [
    [2, 2, 3], [6, 2, 3], [10, 2, 3],
    [2, 4, 3], [6, 4, 3], [10, 4, 3],
    [2, 6, 3], [6, 6, 3], [10, 6, 3],
    [2, 8, 3],
  ];
  const STARTER_WATER = [[2, 3], [2, 5], [6, 3], [6, 5], [2, 7], [10, 3]];

  function autoPlan() {
    state.cells = emptyGrid();
    for (const [x, y, floors] of STARTER_BUILDINGS) {
      state.cells[y][x] = { type: 'building', floors, paid: COST.building };
    }
    for (const [x, y] of STARTER_WATER) {
      state.cells[y][x] = { type: 'water', floors: 0, paid: COST.water };
    }
    state.wasWin = false;
    simulate();
    updateUI();
    setStatus(`Starter plan loaded — ${state.metrics.homes} homes, ${state.metrics.comfort}% comfort, ${state.metrics.remaining} credits spare. Four water cells should certify it.`, true);
  }

  function newSite() {
    state.site += 1;
    state.cells = generateTerrain(state.site);
    state.wasWin = false;
    updateSiteLabels();
    simulate();
    updateUI();
    setStatus(`Site ${pad2(state.site)} reseeded — a pond and three existing trees. ${BUDGET} credits.`, true);
  }

  function resetBuild() {
    state.cells = emptyGrid();
    state.wasWin = false;
    simulate();
    updateUI();
    setStatus(`Build cleared. ${BUDGET} credits, empty grid.`, true);
  }

  // ——— canvas layout ————————————————————————————————————
  function computeLayout() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const mobile = w < 560;
    const pad = mobile ? 14 : 34;
    const top = mobile ? 46 : 54;
    const bottom = mobile ? 22 : 26;
    const cell = Math.max(8, Math.min((w - pad * 2) / W, (h - top - bottom) / H));
    const bw = cell * W, bh = cell * H;
    const bx = (w - bw) / 2;
    const by = top + Math.max(0, (h - top - bottom - bh) / 2);
    return { w, h, cell, bw, bh, bx, by, mobile };
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(r.width * dpr);
    const ch = Math.round(r.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = computeLayout();
    dirty = true;
  }

  function pointerCell(e) {
    if (!view) return null;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const x = Math.floor((px - view.bx) / view.cell);
    const y = Math.floor((py - view.by) / view.cell);
    if (x < 0 || x >= W || y < 0 || y >= H) return null;
    return { x, y };
  }

  function updateReadout(cell) {
    if (!cell) {
      els.readout.textContent = 'E — · N —';
      return;
    }
    const c = state.cells[cell.y][cell.x];
    let desc = 'EMPTY';
    if (c) {
      desc = c.type === 'building' ? `BUILDING · ${c.floors}F` : c.type.toUpperCase();
      if (c.seeded) desc += ' · EXISTING';
    }
    els.readout.textContent = `${cellLabel(cell.x, cell.y)} · ${desc}`;
  }

  // ——— wind field ————————————————————————————————————————
  function windAt(x, y) {
    const f = state.field;
    if (!f) return { vx: 1.6, vy: 0 };
    const ix = clamp(Math.floor(x), 0, W - 1);
    const iy = clamp(Math.floor(y), 0, H - 1);
    let vx = 1.05 + 1.35 * f.air2[iy][ix];
    let vy = 0;
    for (const b of f.buildings) {
      const dx = x - (b.x + 0.5);
      const dy = y - (b.y + 0.5);
      if (dx > -0.9 && dx < 3.4 && Math.abs(dy) < 2.4) {
        const lat = 1 - Math.abs(dy) / 2.4;
        const along = 1 - Math.max(0, dx) / 3.4;
        const dir = dy >= 0 ? 1 : -1;
        vy += dir * 0.7 * lat * along;
      }
    }
    return { vx: Math.max(0.45, vx), vy: clamp(vy, -1.6, 1.6) };
  }

  function respawnParticle(p) {
    p.x = -0.18 - prand() * 0.35;
    p.y = prand() * H;
    p.age = 0;
    p.max = 4 + prand() * 7;
    p.hue = prand();
  }

  function makeParticles() {
    const n = window.innerWidth < 520 ? 105 : 210;
    state.particles = Array.from({ length: n }, () => {
      const p = { x: 0, y: 0, age: 0, max: 5, hue: 0 };
      respawnParticle(p);
      p.x = prand() * W;
      p.age = prand() * p.max;
      return p;
    });
  }

  function updateParticles(dt) {
    for (const p of state.particles) {
      const v = windAt(p.x, p.y);
      p.x += v.vx * dt;
      p.y += v.vy * dt;
      p.age += dt;
      if (p.x > W + 0.2 || p.y < -0.4 || p.y > H + 0.4 || p.age > p.max) {
        respawnParticle(p);
      }
    }
  }

  // ——— drawing ——————————————————————————————————————————
  function drawBackdrop(w, h) {
    const bg = ctx.createRadialGradient(w * 0.55, h * 0.42, 20, w * 0.55, h * 0.42, Math.max(w, h) * 0.8);
    bg.addColorStop(0, '#0e110c');
    bg.addColorStop(0.65, '#0b0d0a');
    bg.addColorStop(1, '#080907');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // faint survey contours
    ctx.save();
    ctx.strokeStyle = 'rgba(143,216,210,.035)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.52, w * (0.16 + i * 0.085), h * (0.12 + i * 0.075), -0.22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoard(v) {
    const { cell, bw, bh, bx, by, mobile } = v;

    // soft cast shadow under the map table
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#0c0e0a';
    ctx.fillRect(bx, by, bw, bh);
    ctx.restore();

    // survey boundary
    ctx.save();
    ctx.strokeStyle = 'rgba(201,242,107,.17)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.strokeRect(bx - 7.5, by - 7.5, bw + 15, bh + 15);
    ctx.restore();

    // fine grid
    ctx.save();
    for (let x = 0; x <= W; x++) {
      ctx.strokeStyle = x % 5 === 0 ? 'rgba(243,241,232,.105)' : 'rgba(243,241,232,.055)';
      ctx.beginPath();
      ctx.moveTo(Math.round(bx + x * cell) + 0.5, by);
      ctx.lineTo(Math.round(bx + x * cell) + 0.5, by + bh);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y++) {
      ctx.strokeStyle = y % 5 === 0 ? 'rgba(243,241,232,.105)' : 'rgba(243,241,232,.055)';
      ctx.beginPath();
      ctx.moveTo(bx, Math.round(by + y * cell) + 0.5);
      ctx.lineTo(bx + bw, Math.round(by + y * cell) + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // border + corner ticks
    ctx.strokeStyle = 'rgba(243,241,232,.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.save();
    ctx.strokeStyle = 'rgba(201,242,107,.5)';
    const tick = Math.min(10, cell * 0.3);
    [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]
      .forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * tick, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * tick);
        ctx.stroke();
      });
    ctx.restore();

    // coordinate ticks and labels
    ctx.save();
    ctx.fillStyle = 'rgba(143,147,134,.6)';
    ctx.font = '8px Inconsolata, monospace';
    ctx.textBaseline = 'middle';
    for (let x = 0; x <= W; x++) {
      const xx = bx + x * cell;
      ctx.strokeStyle = 'rgba(243,241,232,.22)';
      ctx.beginPath();
      ctx.moveTo(xx + 0.5, by - 3);
      ctx.lineTo(xx + 0.5, by);
      ctx.stroke();
    }
    ctx.textAlign = 'right';
    for (let y = 0; y <= H; y++) {
      const yy = by + y * cell;
      ctx.strokeStyle = 'rgba(243,241,232,.22)';
      ctx.beginPath();
      ctx.moveTo(bx - 3, yy + 0.5);
      ctx.lineTo(bx, yy + 0.5);
      ctx.stroke();
      if (!mobile && y < H && y % 2 === 0) ctx.fillText(`N${pad2(y)}`, bx - 7, yy + cell / 2);
    }
    ctx.restore();

    // cold-air inlet chevrons
    ctx.save();
    ctx.strokeStyle = 'rgba(143,216,210,.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const yy = by + bh * (0.28 + i * 0.22);
      ctx.beginPath();
      ctx.moveTo(bx - 13, yy - 3);
      ctx.lineTo(bx - 9, yy);
      ctx.lineTo(bx - 13, yy + 3);
      ctx.stroke();
    }
    if (!mobile) {
      ctx.translate(bx - 23, by + bh / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(143,216,210,.55)';
      ctx.font = '7px Inconsolata, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('C O L D   A I R   I N L E T', 0, 0);
    }
    ctx.restore();
  }

  function drawHeat(v) {
    if (!state.heatCanvas) return;
    const { cell, bw, bh, bx, by } = v;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.62;
    ctx.drawImage(state.heatCanvas, bx, by, bw, bh);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawWater(v) {
    const { cell, bx, by } = v;
    const t = reduced ? 0 : state.time;

    // merge contiguous cells in a single base pass
    ctx.save();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (state.cells[y][x]?.type !== 'water') continue;
        const px = bx + x * cell, py = by + y * cell;
        const g = ctx.createLinearGradient(px, py, px + cell, py + cell);
        g.addColorStop(0, '#1d4d5a');
        g.addColorStop(0.55, '#173e49');
        g.addColorStop(1, '#12343e');
        ctx.fillStyle = g;
        ctx.fillRect(px, py, cell, cell);
      }
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (state.cells[y][x]?.type !== 'water') continue;
        const px = bx + x * cell, py = by + y * cell;
        const phase = t * 1.25 + (x * 1.7 + y * 2.3);
        ctx.strokeStyle = 'rgba(143,216,210,.30)';
        ctx.lineWidth = 1;
        for (let k = 0; k < 2; k++) {
          const yy = py + cell * (0.36 + k * 0.27);
          const amp = cell * 0.045;
          ctx.beginPath();
          ctx.moveTo(px + cell * 0.16, yy + Math.sin(phase + k) * amp);
          ctx.quadraticCurveTo(
            px + cell * 0.36, yy - amp * 1.8 + Math.sin(phase + k + 1.2) * amp,
            px + cell * 0.52, yy + Math.sin(phase + k + 2.4) * amp
          );
          ctx.quadraticCurveTo(
            px + cell * 0.72, yy + amp * 1.8 + Math.sin(phase + k + 3.1) * amp,
            px + cell * 0.84, yy + Math.sin(phase + k + 4.3) * amp
          );
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(143,216,210,.42)';
        ctx.beginPath();
        ctx.arc(px + cell * 0.27, py + cell * 0.23, Math.max(1, cell * 0.022), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(143,216,210,.13)';
        ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
      }
    }
    ctx.restore();
  }

  function drawWind(v) {
    const { cell, bx, by } = v;
    if (reduced) {
      drawStreamlines(v, 0.34);
      return;
    }
    drawStreamlines(v, 0.13);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of state.particles) {
      if (p.y < -0.2 || p.y > H + 0.2 || p.x < -0.5 || p.x > W + 0.2) continue;
      const f = windAt(p.x, p.y);
      const mag = Math.hypot(f.vx, f.vy) || 1;
      const len = 0.15 + 0.17 * Math.min(1, f.vx / 2.6);
      const x0 = p.x - (f.vx / mag) * len;
      const y0 = p.y - (f.vy / mag) * len;
      ctx.strokeStyle = p.hue > 0.88 ? 'rgba(201,242,107,.38)' : 'rgba(143,216,210,.46)';
      ctx.lineWidth = p.hue > 0.94 ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(bx + x0 * cell, by + y0 * cell);
      ctx.lineTo(bx + p.x * cell, by + p.y * cell);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStreamlines(v, alpha = 0.24) {
    const { cell, bx, by } = v;
    ctx.save();
    ctx.strokeStyle = `rgba(143,216,210,${alpha})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 13; i++) {
      let x = 0.15;
      let y = 0.45 + (i * (H - 0.9)) / 12;
      ctx.beginPath();
      ctx.moveTo(bx + x * cell, by + y * cell);
      let ok = true;
      for (let s = 0; s < 90; s++) {
        const f = windAt(x, y);
        x += 0.16;
        y += (f.vy / f.vx) * 0.16;
        if (x > W || y < 0.05 || y > H - 0.05) break;
        const ix = Math.floor(x), iy = Math.floor(y);
        if (ix >= 0 && ix < W && iy >= 0 && iy < H && state.cells[iy][ix]?.type === 'building') {
          ok = false;
          break;
        }
        ctx.lineTo(bx + x * cell, by + y * cell);
      }
      ctx.stroke();
      if (ok && x > W - 0.4) {
        ctx.fillStyle = 'rgba(143,216,210,.28)';
        ctx.beginPath();
        ctx.arc(bx + Math.min(x, W) * cell, by + y * cell, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function treeHash(x, y) {
    return ((x * 37 + y * 91 + 13) % 100) / 100;
  }

  function drawTree(v, x, y) {
    const { cell, bx, by } = v;
    const cx = bx + (x + 0.5) * cell;
    const cy = by + (y + 0.5) * cell;
    const h = treeHash(x, y);
    const r = cell * (0.30 + h * 0.05);
    const sway = reduced ? 0 : Math.sin(state.time * 0.85 + h * 9) * cell * 0.018;

    ctx.save();
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath();
    ctx.ellipse(cx + cell * 0.06, cy + cell * 0.22, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // trunk
    ctx.strokeStyle = 'rgba(76,72,53,.95)';
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.beginPath();
    ctx.moveTo(cx, cy + cell * 0.27);
    ctx.lineTo(cx, cy + cell * 0.02);
    ctx.stroke();

    // canopy
    const g = ctx.createRadialGradient(cx - r * 0.3 + sway, cy - r * 0.42, r * 0.08, cx + sway, cy, r * 1.2);
    g.addColorStop(0, 'rgba(206,246,132,.98)');
    g.addColorStop(0.5, 'rgba(138,203,94,.94)');
    g.addColorStop(1, 'rgba(65,108,60,.06)');
    ctx.fillStyle = g;
    const blobs = [
      [cx + sway - r * 0.18, cy - r * 0.06, r * 0.64],
      [cx + sway + r * 0.22, cy + r * 0.05, r * 0.55],
      [cx + sway + r * 0.01, cy - r * 0.28, r * 0.54],
    ];
    for (const [bx0, by0, br] of blobs) {
      ctx.beginPath();
      ctx.arc(bx0, by0, br, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(224,250,168,.55)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.22 + sway, cy - r * 0.38, Math.max(1, r * 0.12), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function buildingGeom(v, x, y, floors) {
    const { cell, bx, by } = v;
    const pad = Math.max(2, cell * 0.075);
    const x0 = bx + x * cell + pad;
    const y0 = by + y * cell + pad;
    const x1 = bx + (x + 1) * cell - pad;
    const y1 = by + (y + 1) * cell - pad;
    const h = Math.min(7 + floors * 5, cell * (0.30 + floors * 0.08));
    const ox = h * 0.32;
    return { x0, y0, x1, y1, h, ox };
  }

  function drawBuilding(v, x, y, floors, ghost = false) {
    const { x0, y0, x1, y1, h, ox } = buildingGeom(v, x, y, floors);
    const w = x1 - x0;
    const hh = y1 - y0;
    const tone = 0.89 + 0.03 * ((x * 7 + y * 11) % 3);

    ctx.save();
    if (ghost) {
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(201,242,107,.9)';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(201,242,107,.08)';
      ctx.beginPath();
      ctx.moveTo(x0 + ox, y1 - h);
      ctx.lineTo(x1 + ox, y1 - h);
      ctx.lineTo(x1 + ox, y0 - h);
      ctx.lineTo(x0 + ox, y0 - h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + ox, y0 - h);
      ctx.lineTo(x1 + ox, y0 - h);
      ctx.lineTo(x1 + ox, y1 - h);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }

    // shadow at the base
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath();
    ctx.ellipse((x0 + x1) / 2 + ox * 0.35, y1 + 2, w * 0.55, Math.max(1.5, hh * 0.13), 0, 0, Math.PI * 2);
    ctx.fill();

    // east face
    const side = ctx.createLinearGradient(x1, y0 - h, x1 + ox, y1);
    side.addColorStop(0, 'rgba(104,100,88,.98)');
    side.addColorStop(1, 'rgba(67,64,55,.98)');
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.moveTo(x1 + ox, y0 - h);
    ctx.lineTo(x1 + ox, y1 - h);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(9,10,8,.55)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // south face
    const front = ctx.createLinearGradient(x0, y1 - h, x0, y1);
    front.addColorStop(0, `rgba(${Math.round(151 * tone)},${Math.round(145 * tone)},${Math.round(129 * tone)},1)`);
    front.addColorStop(1, 'rgba(103,99,87,1)');
    ctx.fillStyle = front;
    ctx.beginPath();
    ctx.moveTo(x0 + ox, y1 - h);
    ctx.lineTo(x1 + ox, y1 - h);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(9,10,8,.55)';
    ctx.stroke();

    // top face
    const top = ctx.createLinearGradient(x0 + ox, y0 - h, x1 + ox, y1 - h);
    top.addColorStop(0, `rgba(${Math.round(219 * tone)},${Math.round(211 * tone)},${Math.round(191 * tone)},1)`);
    top.addColorStop(1, `rgba(${Math.round(190 * tone)},${Math.round(182 * tone)},${Math.round(163 * tone)},1)`);
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(x0 + ox, y0 - h);
    ctx.lineTo(x1 + ox, y0 - h);
    ctx.lineTo(x1 + ox, y1 - h);
    ctx.lineTo(x0 + ox, y1 - h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(9,10,8,.5)';
    ctx.stroke();

    // roof inset
    const inset = Math.max(1, w * 0.08);
    ctx.strokeStyle = 'rgba(9,10,8,.18)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x0 + ox + inset, y0 - h + inset, w - inset * 2, hh - inset * 2);
    ctx.beginPath();
    ctx.moveTo(x0 + ox + w * 0.36, y0 - h + inset);
    ctx.lineTo(x0 + ox + w * 0.36, y1 - h - inset);
    ctx.stroke();

    // rooftop access box and a small solar array
    const rw = w * 0.18, rh = hh * 0.16;
    ctx.fillStyle = 'rgba(67,65,56,.72)';
    ctx.fillRect(x0 + ox + w * 0.17, y0 - h + hh * 0.2, rw, rh);
    ctx.strokeStyle = 'rgba(230,162,94,.2)';
    ctx.strokeRect(x0 + ox + w * 0.17, y0 - h + hh * 0.2, rw, rh);
    if (floors >= 2) {
      ctx.strokeStyle = 'rgba(50,61,62,.38)';
      for (let k = 0; k < 3; k++) {
        const yy = y0 - h + inset + hh * (0.55 + k * 0.12);
        ctx.beginPath();
        ctx.moveTo(x0 + ox + w * 0.58, yy);
        ctx.lineTo(x0 + ox + w * 0.84, yy);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(50,61,62,.22)';
      ctx.beginPath();
      ctx.moveTo(x0 + ox + w * 0.71, y0 - h + inset + hh * 0.5);
      ctx.lineTo(x0 + ox + w * 0.71, y0 - h + inset + hh * 0.86);
      ctx.stroke();
    }

    // floor slabs and lit windows on the south face
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 + ox, y1 - h);
    ctx.lineTo(x1 + ox, y1 - h);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = 'rgba(18,19,15,.28)';
    ctx.lineWidth = 0.8;
    for (let k = 1; k < floors; k++) {
      const yy = y1 - (h * k) / floors;
      const shift = (ox * k) / floors;
      ctx.beginPath();
      ctx.moveTo(x0 + shift, yy);
      ctx.lineTo(x1 + shift, yy);
      ctx.stroke();
    }
    const cols = 3;
    for (let k = 0; k < floors; k++) {
      const yy = y1 - (h * (k + 0.5)) / floors;
      const shift = (ox * (k + 0.5)) / floors;
      for (let c = 0; c < cols; c++) {
        const lit = ((x * 13 + y * 7 + k * 5 + c * 3) % 5) < 2;
        ctx.fillStyle = lit ? 'rgba(230,162,94,.82)' : 'rgba(24,25,20,.44)';
        ctx.fillRect(x0 + shift + w * (0.22 + c * 0.24), yy - 1.4, Math.max(1.4, w * 0.055), Math.max(2, hh * 0.16));
      }
    }
    ctx.restore();

    // outline footprint for crispness
    ctx.strokeStyle = 'rgba(9,10,8,.35)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x0, y0, w, hh);
    ctx.restore();
  }

  function drawCells(v) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (state.cells[y][x]?.type === 'tree') drawTree(v, x, y);
      }
      for (let x = 0; x < W; x++) {
        const c = state.cells[y][x];
        if (c?.type === 'building') drawBuilding(v, x, y, c.floors);
      }
    }
  }

  function drawHover(v) {
    const cellPos = state.hover || (state.cursor.on ? state.cursor : null);
    if (!cellPos) return;
    const { cell, bx, by } = v;
    const x = cellPos.x, y = cellPos.y;
    const c = state.cells[y][x];
    const px = bx + x * cell, py = by + y * cell;

    ctx.save();
    if (state.tool === 'erase') {
      ctx.strokeStyle = 'rgba(230,162,94,.85)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
      if (c) {
        ctx.beginPath();
        ctx.moveTo(px + cell * 0.36, py + cell * 0.36);
        ctx.lineTo(px + cell * 0.64, py + cell * 0.64);
        ctx.moveTo(px + cell * 0.64, py + cell * 0.36);
        ctx.lineTo(px + cell * 0.36, py + cell * 0.64);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = 'rgba(201,242,107,.8)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
      if (!c) {
        if (state.tool === 'building') {
          drawBuilding(v, x, y, state.height, true);
        } else if (state.tool === 'tree') {
          ctx.fillStyle = 'rgba(201,242,107,.10)';
          ctx.beginPath();
          ctx.arc(px + cell / 2, py + cell / 2, cell * 0.32, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(201,242,107,.65)';
          ctx.stroke();
        } else if (state.tool === 'water') {
          ctx.fillStyle = 'rgba(143,216,210,.12)';
          ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
        }
      }
    }
    ctx.restore();

    // the keyboard cursor gets a second, solid ring
    if (state.cursor.on) {
      ctx.strokeStyle = 'rgba(201,242,107,.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(px + 0.75, py + 0.75, cell - 1.5, cell - 1.5);
    }
  }

  function drawFurniture(v) {
    const { w, h, cell } = v;
    ctx.save();
    ctx.font = '7.5px Inconsolata, monospace';
    ctx.textBaseline = 'middle';

    // scale bar, bottom-right
    const bars = cell > 32 ? 4 : 3;
    const len = cell * bars;
    const x0 = w - 16 - len;
    const y0 = h - 14;
    ctx.strokeStyle = 'rgba(243,241,232,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.moveTo(x0, y0 - 3);
    ctx.lineTo(x0, y0 + 3);
    ctx.moveTo(x0 + len / 2, y0 - 3);
    ctx.lineTo(x0 + len / 2, y0 + 3);
    ctx.moveTo(x0 + len, y0 - 3);
    ctx.lineTo(x0 + len, y0 + 3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(143,147,134,.8)';
    ctx.textAlign = 'left';
    ctx.fillText('0', x0 - 1, y0 - 8);
    ctx.textAlign = 'right';
    ctx.fillText(`${bars * 12} m`, x0 + len + 1, y0 - 8);

    // north arrow, above the scale bar
    const nx = w - 21;
    const ny = h - 42;
    ctx.strokeStyle = 'rgba(243,241,232,.5)';
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(nx, ny - 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(201,242,107,.8)';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 23);
    ctx.lineTo(nx - 3.5, ny - 16);
    ctx.lineTo(nx + 3.5, ny - 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(143,147,134,.85)';
    ctx.textAlign = 'center';
    ctx.fillText('N', nx, h - 69);

    ctx.restore();
  }

  function draw() {
    if (!view) return;
    const v = view;
    ctx.clearRect(0, 0, v.w, v.h);
    drawBackdrop(v.w, v.h);
    drawBoard(v);
    if (state.heat) drawHeat(v);
    drawWater(v);
    if (state.wind) drawWind(v);
    drawCells(v);
    drawHover(v);
    drawFurniture(v);
  }

  // ——— animation loop ————————————————————————————————————
  let lastT = 0;
  let lastDraw = 0;
  function frame(t) {
    if (!lastT) lastT = t;
    const dt = Math.min(0.06, (t - lastT) / 1000);
    lastT = t;
    state.time += dt;

    if (state.wind && !reduced) updateParticles(dt);
    if (!reduced && t - lastDraw > 32) dirty = true;
    if (dirty) {
      draw();
      dirty = false;
      lastDraw = t;
    }
    requestAnimationFrame(frame);
  }

  // ——— pointer input ————————————————————————————————————
  function onPointerDown(e) {
    if (!e.isPrimary) return;
    const c = pointerCell(e);
    if (!c) return;
    canvas.focus({ preventScroll: true });
    state.hover = c;
    state.cursor = { x: c.x, y: c.y, on: true };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    drag = { start: c, last: c, moved: false, cycle: false };
    const existing = state.cells[c.y][c.x];
    if (state.tool === 'building' && existing && existing.type === 'building') {
      drag.cycle = true;
      updateReadout(c);
      e.preventDefault();
      return;
    }
    applyTool(c.x, c.y);
    updateReadout(c);
    e.preventDefault();
  }

  function onPointerMove(e) {
    const c = pointerCell(e);
    state.hover = c;
    updateReadout(c || (state.cursor.on ? state.cursor : null));
    dirty = true;
    if (!drag || !c) return;
    if (c.x !== drag.start.x || c.y !== drag.start.y) drag.moved = true;
    if (drag.cycle) {
      if (drag.moved) drag.cycle = false;
      else { e.preventDefault(); return; }
    }
    if (c.x !== drag.last.x || c.y !== drag.last.y) {
      applyTool(c.x, c.y);
      drag.last = c;
    }
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (drag.cycle && !drag.moved) cycleFloors(drag.start.x, drag.start.y);
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    e.preventDefault();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => {
    if (!drag) {
      state.hover = null;
      updateReadout(state.cursor.on ? state.cursor : null);
      dirty = true;
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ——— keyboard input ——————————————————————————————————
  canvas.addEventListener('focus', () => {
    state.cursor.on = true;
    updateReadout(state.hover || state.cursor);
    dirty = true;
  });
  canvas.addEventListener('blur', () => {
    state.cursor.on = false;
    dirty = true;
  });
  canvas.addEventListener('keydown', (e) => {
    const k = e.key;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[k]) {
      e.preventDefault();
      state.cursor.on = true;
      state.cursor.x = clamp(state.cursor.x + moves[k][0], 0, W - 1);
      state.cursor.y = clamp(state.cursor.y + moves[k][1], 0, H - 1);
      state.hover = null;
      updateReadout(state.cursor);
      dirty = true;
      return;
    }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      state.cursor.on = true;
      applyAtCursor();
      return;
    }
    if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault();
      const previous = state.tool;
      state.tool = 'erase';
      applyTool(state.cursor.x, state.cursor.y);
      state.tool = previous;
      setTool(previous, false);
      updateReadout(state.cursor);
      return;
    }
    if (k >= '1' && k <= '3') {
      e.preventDefault();
      setHeight(Number(k));
      setTool('building', false);
      setStatus(`${state.height}-floor buildings selected.`);
      return;
    }
    const shortcut = { b: 'building', t: 'tree', w: 'water', e: 'erase' }[k.toLowerCase()];
    if (shortcut) {
      e.preventDefault();
      setTool(shortcut);
    }
  });

  // ——— buttons ——————————————————————————————————————————
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
  document.querySelectorAll('[data-height]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setHeight(Number(btn.dataset.height), false);
      setTool('building', false);
      setStatus(`${state.height}-floor buildings selected.`);
    });
  });
  document.querySelectorAll('[data-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      state[layer] = !state[layer];
      btn.setAttribute('aria-pressed', String(state[layer]));
      dirty = true;
      setStatus(`${layer === 'wind' ? 'Wind' : 'Heat'} layer ${state[layer] ? 'on' : 'off'}.`);
    });
  });
  els.autoBtn.addEventListener('click', autoPlan);
  els.newBtn.addEventListener('click', newSite);
  els.resetBtn.addEventListener('click', resetBuild);

  // ——— reduced motion ——————————————————————————————————
  const onMotionChange = () => {
    reduced = reduceQuery.matches;
    dirty = true;
  };
  if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onMotionChange);
  else if (reduceQuery.addListener) reduceQuery.addListener(onMotionChange);

  // ——— init —————————————————————————————————————————————
  function init() {
    state.cells = generateTerrain(state.site);
    updateSiteLabels();
    setTool('building', false);
    setHeight(3, false);
    resize();
    simulate();
    updateUI();
    makeParticles();
    setStatus(`Site ${pad2(state.site)} loaded. Drag to paint; meet both targets to certify.`, true);
    new ResizeObserver(resize).observe(stage);
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }

  init();
})();
