(() => {
  'use strict';

  const INITIAL_SEED = 20220614;
  const VARIANTS_PER_FAMILY = 10;
  const SIMILAR_THRESHOLD = 0.62;
  const SIMILAR_LIMIT = 18;
  const TAU = Math.PI * 2;
  const FEATURE_KEYS = ['symmetry', 'angularity', 'roundness', 'density', 'rotation', 'balance'];

  const clamp01 = value => Math.max(0, Math.min(1, value));
  const pad2 = value => String(value).padStart(2, '0');
  const f1 = value => Math.round(value * 10) / 10;
  const featureValue = (rng, base, spread) => clamp01(base + (rng() * 2 - 1) * spread);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function nextSeed(seed) {
    const value = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
    return value === 0 ? 1 : value;
  }

  /* ---------------- svg helpers ---------------- */

  function svgWrap(inner) {
    return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }

  function miniGlyph(inner) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }

  const point = (radius, angle) => [50 + Math.cos(angle) * radius, 50 + Math.sin(angle) * radius];

  function pointsAttr(points) {
    return points.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');
  }

  function smoothClosedPath(points) {
    const n = points.length;
    let d = `M ${f1(points[0][0])} ${f1(points[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${f1(c1x)} ${f1(c1y)}, ${f1(c2x)} ${f1(c2y)}, ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return `${d} Z`;
  }

  function smoothOpenPath(points) {
    const n = points.length;
    let d = `M ${f1(points[0][0])} ${f1(points[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(n - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${f1(c1x)} ${f1(c1y)}, ${f1(c2x)} ${f1(c2y)}, ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return d;
  }

  /* ---------------- six shape families ---------------- */

  function radialForm(rng) {
    const spokes = 7 + Math.floor(rng() * 7);
    const rings = 1 + Math.floor(rng() * 3);
    const offset = rng() * TAU;
    const inner = 8 + rng() * 7;
    const outer = 33 + rng() * 9;
    const dot = 1.2 + rng() * 1.8;

    let mark = `<circle cx="50" cy="50" r="${f1(inner * 0.42)}" fill="currentColor" fill-opacity=".16" stroke="none"/>`;
    for (let ring = 1; ring <= rings; ring++) {
      const radius = inner + (outer - inner) * (ring / rings);
      mark += `<circle cx="50" cy="50" r="${f1(radius)}"/>`;
    }
    for (let i = 0; i < spokes; i++) {
      const angle = offset + (i / spokes) * TAU;
      const from = point(inner * 0.55, angle);
      const to = point(outer, angle);
      mark += `<line x1="${f1(from[0])}" y1="${f1(from[1])}" x2="${f1(to[0])}" y2="${f1(to[1])}"/>`;
      if (i % 2 === 0) {
        mark += `<circle cx="${f1(to[0])}" cy="${f1(to[1])}" r="${f1(dot)}" fill="currentColor" fill-opacity=".26"/>`;
      }
    }

    return {
      svg: svgWrap(mark),
      features: {
        symmetry: featureValue(rng, spokes % 2 === 0 ? 0.97 : 0.9, 0.012),
        angularity: featureValue(rng, 0.1 + (rings - 1) * 0.025, 0.02),
        roundness: featureValue(rng, 0.94, 0.018),
        density: featureValue(rng, 0.38 + spokes / 22 + rings * 0.05, 0.025),
        rotation: featureValue(rng, 0.06 + (offset / TAU) * 0.1, 0.02),
        balance: featureValue(rng, 0.97, 0.012)
      }
    };
  }

  function facetedForm(rng) {
    const sides = 5 + Math.floor(rng() * 4);
    const offset = rng() * TAU;
    const jag = 0.15 + rng() * 0.22;
    const outer = [];
    for (let i = 0; i < sides; i++) {
      const angle = offset + (i / sides) * TAU;
      const radius = 33 + (i % 2 === 0 ? jag * 15 : -jag * 9) + (rng() - 0.5) * 2;
      outer.push(point(radius, angle));
    }
    const inner = outer.map(([x, y]) => [50 + (x - 50) * 0.52, 50 + (y - 50) * 0.52]);

    let mark = `<polygon points="${pointsAttr(outer)}" fill="currentColor" fill-opacity=".055"/>`;
    mark += `<polygon points="${pointsAttr(inner)}" stroke-opacity=".72"/>`;
    for (let i = 0; i < sides; i += 2) {
      const from = outer[i];
      const to = inner[(i + 1) % sides];
      mark += `<line x1="${f1(from[0])}" y1="${f1(from[1])}" x2="${f1(to[0])}" y2="${f1(to[1])}" stroke-opacity=".7"/>`;
    }

    return {
      svg: svgWrap(mark),
      features: {
        symmetry: featureValue(rng, (sides === 6 ? 0.78 : 0.7) - jag * 0.35, 0.025),
        angularity: featureValue(rng, 0.96, 0.016),
        roundness: featureValue(rng, 0.07, 0.02),
        density: featureValue(rng, 0.45 + sides * 0.025 + jag * 0.3, 0.025),
        rotation: featureValue(rng, 0.46 + (offset / TAU) * 0.18, 0.03),
        balance: featureValue(rng, 0.86 - jag * 0.25, 0.02)
      }
    };
  }

  function organicForm(rng) {
    const lobes = 3 + Math.floor(rng() * 5);
    const amplitude = 5 + rng() * 9;
    const wave = rng() * TAU;
    const count = Math.max(12, lobes * 2);
    const outer = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU;
      const radius = 30 + Math.sin(angle * lobes + wave) * amplitude + (rng() - 0.5) * 2.4;
      outer.push(point(radius, angle));
    }
    const inner = outer.map(([x, y]) => [50 + (x - 50) * 0.56, 50 + (y - 50) * 0.56]);

    let mark = `<path d="${smoothClosedPath(outer)}" fill="currentColor" fill-opacity=".05"/>`;
    mark += `<path d="${smoothClosedPath(inner)}" stroke-opacity=".55"/>`;

    return {
      svg: svgWrap(mark),
      features: {
        symmetry: featureValue(rng, lobes % 2 === 0 ? 0.42 : 0.35, 0.02),
        angularity: featureValue(rng, 0.055, 0.015),
        roundness: featureValue(rng, 0.96, 0.014),
        density: featureValue(rng, 0.38 + amplitude * 0.012, 0.02),
        rotation: featureValue(rng, 0.2 + (wave / TAU) * 0.12, 0.025),
        balance: featureValue(rng, 0.62, 0.025)
      }
    };
  }

  function modularForm(rng, variant) {
    const n = variant % 4 === 0 ? 3 : 4;
    const gap = 2.4;
    const cell = (72 - gap * (n - 1)) / n;
    const origin = (100 - (cell * n + gap * (n - 1))) / 2;
    const occupied = [];
    let count = 0;

    for (let row = 0; row < n; row++) {
      occupied[row] = [];
      for (let col = 0; col < n; col++) {
        const on = rng() < 0.54;
        occupied[row][col] = on;
        if (on) count++;
      }
    }
    for (let row = 0; row < n && count < n + 1; row++) {
      for (let col = 0; col < n && count < n + 1; col++) {
        if (!occupied[row][col]) {
          occupied[row][col] = true;
          count++;
        }
      }
    }

    let mark = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!occupied[row][col]) continue;
        const x = origin + col * (cell + gap);
        const y = origin + row * (cell + gap);
        const opacity = (row + col) % 3 === 0 ? '.13' : '.045';
        mark += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(cell)}" height="${f1(cell)}" fill="currentColor" fill-opacity="${opacity}"/>`;
        if ((row + col) % 2 === 0) {
          mark += `<line x1="${f1(x + cell * 0.26)}" y1="${f1(y + cell * 0.74)}" x2="${f1(x + cell * 0.74)}" y2="${f1(y + cell * 0.26)}" stroke-opacity=".55"/>`;
        }
      }
    }

    let mirrored = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (occupied[row][col] === occupied[row][n - 1 - col]) mirrored++;
      }
    }
    const symmetry = 0.72 + 0.24 * (mirrored / (n * n));
    const density = count / (n * n);

    let sumX = 0;
    let sumY = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!occupied[row][col]) continue;
        sumX += origin + col * (cell + gap) + cell / 2;
        sumY += origin + row * (cell + gap) + cell / 2;
      }
    }
    const balance = clamp01(1 - Math.hypot(sumX / count - 50, sumY / count - 50) / 52);

    return {
      svg: svgWrap(mark),
      features: {
        symmetry: featureValue(rng, symmetry, 0.015),
        angularity: featureValue(rng, 0.9, 0.02),
        roundness: featureValue(rng, 0.08, 0.02),
        density: featureValue(rng, density, 0.02),
        rotation: featureValue(rng, 0.06, 0.02),
        balance: featureValue(rng, balance, 0.02)
      }
    };
  }

  function spiralForm(rng, variant) {
    const turns = 2.1 + rng() * 1.7;
    const start = rng() * TAU;
    const direction = variant % 3 === 0 ? -1 : 1;
    const twoArms = variant % 4 === 0;
    const steps = 96;

    const spiralPath = shift => {
      let d = '';
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = start + shift + direction * t * turns * TAU;
        const radius = 5 + t * 34;
        const x = 50 + Math.cos(angle) * radius;
        const y = 50 + Math.sin(angle) * radius;
        d += `${i === 0 ? 'M' : 'L'} ${f1(x)} ${f1(y)} `;
      }
      return d.trim();
    };

    let mark = `<path d="${spiralPath(0)}"/>`;
    if (twoArms) {
      mark += `<path d="${spiralPath(Math.PI)}" stroke-opacity=".68"/>`;
    }
    mark += `<circle cx="50" cy="50" r="2" fill="currentColor" fill-opacity=".4" stroke="none"/>`;
    const tipAngle = start + direction * turns * TAU * 0.78;
    const tip = point(5 + 0.78 * 34, tipAngle);
    mark += `<circle cx="${f1(tip[0])}" cy="${f1(tip[1])}" r="2.4" fill="currentColor" fill-opacity=".3"/>`;

    return {
      svg: svgWrap(mark),
      features: {
        symmetry: featureValue(rng, twoArms ? 0.58 : 0.21, 0.02),
        angularity: featureValue(rng, 0.3, 0.025),
        roundness: featureValue(rng, 0.81, 0.02),
        density: featureValue(rng, 0.36 + turns * 0.045, 0.02),
        rotation: featureValue(rng, 0.94, 0.015),
        balance: featureValue(rng, 0.34, 0.025)
      }
    };
  }

  function gesturalForm(rng) {
    const count = 4 + Math.floor(rng() * 3);
    const stroke = [];
    for (let i = 0; i < count; i++) {
      const x = 15 + (68 * i) / (count - 1);
      const y = 22 + rng() * 56;
      stroke.push([x, y]);
    }
    const accentX = 42 + rng() * 18;
    const accentY = 10 + rng() * 12;
    const accentEndX = accentX + 12 + rng() * 14;
    const accentEndY = 80 + rng() * 8;

    let mark = `<path d="${smoothOpenPath(stroke)}"/>`;
    mark += `<path d="M ${f1(accentX)} ${f1(accentY)} C ${f1(accentX + 20)} ${f1(accentY + 18)}, ${f1(accentEndX - 22)} ${f1(accentEndY - 14)}, ${f1(accentEndX)} ${f1(accentEndY)}" stroke-opacity=".5"/>`;
    const dot = stroke[Math.floor(stroke.length / 2)];
    mark += `<circle cx="${f1(dot[0])}" cy="${f1(dot[1])}" r="2.4" fill="currentColor" fill-opacity=".34" stroke="none"/>`;

    return {
      svg: svgWrap(mark),
      features: {
        symmetry: featureValue(rng, 0.12, 0.03),
        angularity: featureValue(rng, 0.24, 0.04),
        roundness: featureValue(rng, 0.64, 0.035),
        density: featureValue(rng, 0.31, 0.03),
        rotation: featureValue(rng, 0.88, 0.035),
        balance: featureValue(rng, 0.34, 0.035)
      }
    };
  }

  const FAMILIES = [
    {
      id: 'radial',
      name: 'Radial',
      short: 'RAD',
      glyph: miniGlyph('<circle cx="12" cy="12" r="3.1"/><circle cx="12" cy="12" r="8.1"/><path d="M12 1.8v2.8M12 19.4v2.8M1.8 12h2.8M19.4 12h2.8M4.8 4.8l2 2M17.2 17.2l2 2M19.2 4.8l-2 2M6.8 17.2l-2 2"/>')
    },
    {
      id: 'faceted',
      name: 'Faceted',
      short: 'FAC',
      glyph: miniGlyph('<path d="M12 2.6l8.4 5.5-2.6 9.4H6.2L3.6 8.1z"/><path d="M12 2.6v14.9M3.6 8.1h16.8"/><path d="M6.2 17.5l5.8-9.4 5.8 9.4"/>')
    },
    {
      id: 'organic',
      name: 'Organic',
      short: 'ORG',
      glyph: miniGlyph('<path d="M12 2.8c4 0 7.3 2.7 6.8 5.8-.4 2.6 1.3 5-1 7.4-2.2 2.3-5.1 1.1-7.6 2-2.7.9-5.6-1.4-5.8-4.4-.2-2.7 1.2-4 2.2-5.9C7.7 5.4 9.5 2.8 12 2.8z"/>')
    },
    {
      id: 'modular',
      name: 'Modular',
      short: 'MOD',
      glyph: miniGlyph('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>')
    },
    {
      id: 'spiral',
      name: 'Spiral',
      short: 'SPI',
      glyph: miniGlyph('<path d="M12 12a2.1 2.1 0 0 1 2.1 2.1 4.2 4.2 0 0 1-4.2 4.2 6.4 6.4 0 0 1-6.4-6.4A8.6 8.6 0 0 1 12 3.4a9.2 9.2 0 0 1 9.2 9.2"/>')
    },
    {
      id: 'gestural',
      name: 'Gestural',
      short: 'GES',
      glyph: miniGlyph('<path d="M2.8 16.2c4-9.4 6.2 5 10.1-4.1 2.5-5.9 5 3.1 8.3-4.8"/><circle cx="12.9" cy="12.1" r="1.7" fill="currentColor" stroke="none"/>')
    }
  ];

  const GENERATORS = {
    radial: radialForm,
    faceted: facetedForm,
    organic: organicForm,
    modular: modularForm,
    spiral: spiralForm,
    gestural: gesturalForm
  };

  /* ---------------- model ---------------- */

  function similarity(a, b) {
    let sum = 0;
    for (const key of FEATURE_KEYS) {
      const delta = a[key] - b[key];
      sum += delta * delta;
    }
    return clamp01(1 - Math.sqrt(sum / FEATURE_KEYS.length));
  }

  function aggregateFamilies() {
    return FAMILIES.map(family => {
      let total = 0;
      let weight = 0;
      for (const shape of state.shapes) {
        if (shape.family !== family.id) continue;
        const shapeWeight = shape.selected ? 3 : 1;
        total += shape.score * shapeWeight;
        weight += shapeWeight;
      }
      return {
        id: family.id,
        name: family.name,
        glyph: family.glyph,
        score: Math.round((total / weight) * 100)
      };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  /* ---------------- dom + state ---------------- */

  const canvas = document.getElementById('model');
  const dom = {
    archCards: document.getElementById('archCards'),
    archEmpty: document.getElementById('archEmpty'),
    archMeta: document.getElementById('archMeta'),
    shapeField: document.getElementById('shapeField'),
    shapeGrid: document.getElementById('shapeGrid'),
    seedLabel: document.getElementById('seedLabel'),
    selectedCount: document.getElementById('selectedCount'),
    similarCount: document.getElementById('similarCount'),
    topFamily: document.getElementById('topFamily'),
    modelChip: document.getElementById('modelChip'),
    resetBtn: document.getElementById('resetBtn'),
    newBtn: document.getElementById('newBtn'),
    status: document.getElementById('status')
  };
  const ctx = canvas.getContext('2d');

  const state = {
    seed: INITIAL_SEED,
    shapes: [],
    index: new Map(),
    selected: new Set()
  };

  function buildShapes(seed, statusMessage = 'New set generated. Click any form to begin.') {
    const rng = mulberry32(seed);
    const fragment = document.createDocumentFragment();
    state.seed = seed;
    state.shapes = [];
    state.index = new Map();
    state.selected.clear();

    for (const family of FAMILIES) {
      for (let variant = 1; variant <= VARIANTS_PER_FAMILY; variant++) {
        const form = GENERATORS[family.id](rng, variant - 1);
        const shape = {
          id: `${family.id}-${variant}`,
          family: family.id,
          familyName: family.name,
          variant,
          features: form.features,
          score: 0,
          selected: false,
          similar: false,
          el: null
        };

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shape';
        button.dataset.id = shape.id;
        button.dataset.family = shape.family;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', `${family.name} form ${variant} of ${VARIANTS_PER_FAMILY}`);
        button.innerHTML = `<span class="shape-glyph">${form.svg}</span><span class="shape-tag" aria-hidden="true">${family.short} ${pad2(variant)}</span>`;
        shape.el = button;

        state.shapes.push(shape);
        state.index.set(shape.id, shape);
        fragment.appendChild(button);
      }
    }

    dom.shapeGrid.replaceChildren(fragment);
    dom.seedLabel.textContent = `SEED ${seed.toString(36).toUpperCase()}`;
    clearModel(statusMessage);
  }

  function setReadouts(top) {
    const selected = state.selected.size;
    const similar = state.shapes.reduce((total, shape) => total + (shape.similar ? 1 : 0), 0);
    dom.selectedCount.innerHTML = `${selected}<span>/${state.shapes.length}</span>`;
    dom.similarCount.textContent = String(similar);
    dom.modelChip.textContent = selected ? 'LIVE' : 'IDLE';
    dom.modelChip.classList.toggle('is-live', selected > 0);
    dom.topFamily.textContent = selected && top ? top[0].name : '—';
    return similar;
  }

  function renderArchetypes(top) {
    if (!top || !top.length) {
      dom.archCards.hidden = true;
      dom.archCards.replaceChildren();
      dom.archEmpty.hidden = false;
      dom.archMeta.textContent = 'AWAITING INPUT';
      return;
    }

    dom.archEmpty.hidden = true;
    dom.archCards.hidden = false;
    dom.archMeta.textContent = `${state.selected.size} SELECTED`;
    dom.archCards.innerHTML = top.slice(0, 3).map((family, index) => `
      <article class="arch-card" data-family="${family.id}">
        <span class="arch-rank" aria-hidden="true">${pad2(index + 1)}</span>
        <span class="arch-glyph" aria-hidden="true">${family.glyph}</span>
        <div class="arch-info">
          <div class="arch-line">
            <span class="arch-name">${family.name}</span>
            <span class="arch-score mono">${family.score}<span>/100</span></span>
          </div>
          <div class="arch-meter" aria-hidden="true"><i style="width:${family.score}%"></i></div>
        </div>
      </article>`).join('');
  }

  function clearModel(message) {
    state.selected.clear();
    for (const shape of state.shapes) {
      shape.selected = false;
      shape.score = 0;
      shape.similar = false;
      shape.el.classList.remove('is-selected', 'is-similar');
      shape.el.setAttribute('aria-pressed', 'false');
    }
    renderArchetypes([]);
    setReadouts(null);
    if (message) dom.status.textContent = message;
    drawField();
  }

  function updateModel(action) {
    const selectedShapes = state.shapes.filter(shape => shape.selected);

    if (!selectedShapes.length) {
      for (const shape of state.shapes) {
        shape.score = 0;
        shape.similar = false;
        shape.el.classList.remove('is-selected', 'is-similar');
        shape.el.setAttribute('aria-pressed', 'false');
      }
      renderArchetypes([]);
      setReadouts(null);
      if (action) dom.status.textContent = `${action}. No forms selected.`;
      drawField();
      return;
    }

    for (const shape of state.shapes) {
      if (shape.selected) {
        shape.score = 1;
        continue;
      }
      let best = 0;
      for (const chosen of selectedShapes) {
        const score = similarity(shape.features, chosen.features);
        if (score > best) best = score;
      }
      shape.score = best;
    }

    const near = state.shapes
      .filter(shape => !shape.selected && shape.score >= SIMILAR_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, SIMILAR_LIMIT);
    const nearIds = new Set(near.map(shape => shape.id));

    for (const shape of state.shapes) {
      shape.similar = nearIds.has(shape.id);
      shape.el.classList.toggle('is-selected', shape.selected);
      shape.el.classList.toggle('is-similar', shape.similar);
      shape.el.setAttribute('aria-pressed', shape.selected ? 'true' : 'false');
    }

    const top = aggregateFamilies();
    renderArchetypes(top);
    const similar = setReadouts(top);
    if (action) {
      dom.status.textContent = `${action}. ${similar} similar form${similar === 1 ? '' : 's'} · top family ${top[0].name} (${top[0].score}).`;
    }
    drawField();
  }

  function toggleShape(id) {
    const shape = state.index.get(id);
    if (!shape) return;
    shape.selected = !shape.selected;
    if (shape.selected) state.selected.add(shape.id);
    else state.selected.delete(shape.id);
    const action = `${shape.selected ? 'Selected' : 'Deselected'} ${shape.familyName} ${pad2(shape.variant)}`;
    updateModel(action);
  }

  /* ---------------- model field ---------------- */

  function drawField() {
    const rect = dom.shapeField.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const active = state.shapes.filter(shape => shape.selected || shape.similar);
    if (!active.length) return;

    const anchor = active.find(shape => shape.selected) || active[0];
    const base = Math.max(42, anchor.el.getBoundingClientRect().width || 88);
    const offsetX = dom.shapeField.clientLeft;
    const offsetY = dom.shapeField.clientTop;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const paint = shape => {
      const buttonRect = shape.el.getBoundingClientRect();
      const x = buttonRect.left - rect.left - offsetX + buttonRect.width / 2;
      const y = buttonRect.top - rect.top - offsetY + buttonRect.height / 2;
      const selected = shape.selected;
      const rgb = selected ? '201,242,107' : '143,216,232';
      const alpha = selected ? 0.18 : 0.05 + shape.score * 0.07;
      const radius = selected ? base * 1.35 : base * (0.75 + shape.score * 0.45);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
      gradient.addColorStop(0.55, `rgba(${rgb},${alpha * 0.4})`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    };

    for (const shape of active) {
      if (!shape.selected) paint(shape);
    }
    for (const shape of active) {
      if (shape.selected) paint(shape);
    }

    ctx.restore();
  }

  /* ---------------- wiring ---------------- */

  buildShapes(INITIAL_SEED, 'Click any form to begin.');

  dom.shapeGrid.addEventListener('click', event => {
    const button = event.target.closest('.shape');
    if (!button || !dom.shapeGrid.contains(button)) return;
    toggleShape(button.dataset.id);
  });

  dom.resetBtn.addEventListener('click', () => {
    clearModel('Selection cleared. Click any form to begin.');
  });

  dom.newBtn.addEventListener('click', () => {
    buildShapes(nextSeed(state.seed));
  });

  let resizeFrame = 0;
  const scheduleDraw = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(drawField);
  };

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(dom.shapeField);
  }
  window.addEventListener('resize', scheduleDraw);
  requestAnimationFrame(drawField);
})();
