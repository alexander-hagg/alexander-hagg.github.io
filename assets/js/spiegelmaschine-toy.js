/**
 * Spiegelmaschine — generative-art toy
 * ====================================
 * A self-contained, dependency-free Canvas2D kaleidoscope inspired by the
 * Spiegelmaschine project (a GAN trained on paintings by Steffen Terk).
 *
 * The composition is fully deterministic from a seed: the same seed and
 * parameters always produce the same image. Shapes are generated inside one
 * wedge of the circle and then tiled around the centre with alternating
 * mirroring, producing a mirror-symmetric ("Spiegel") mandala.
 *
 * Controls: symmetry order, complexity, seed, palette, regenerate, reset.
 * A text readout describes the current composition for non-visual access.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('spiegel-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var DPR = window.devicePixelRatio || 1;

  var symCtrl = document.getElementById('spiegel-symmetry');
  var cplxCtrl = document.getElementById('spiegel-complexity');
  var seedCtrl = document.getElementById('spiegel-seed');
  var palCtrl = document.getElementById('spiegel-palette');
  var regenBtn = document.getElementById('spiegel-regenerate');
  var resetBtn = document.getElementById('spiegel-reset');
  var readout = document.getElementById('spiegel-readout');
  var valSym = document.getElementById('spiegel-val-symmetry');
  var valCplx = document.getElementById('spiegel-val-complexity');

  var PALETTES = {
    terracotta: { name: 'Terracotta', colors: ['#c1440e', '#e07a5f', '#f2cc8f', '#3d405b', '#81b29a'] },
    midnight:   { name: 'Midnight',   colors: ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#6fffe9'] },
    garden:     { name: 'Garden',     colors: ['#2d6a4f', '#40916c', '#74c69d', '#d8f3dc', '#b7e4c7'] },
    sunset:     { name: 'Sunset',     colors: ['#ff6b6b', '#feca57', '#ff9f43', '#ee5253', '#5f27cd'] },
    mono:       { name: 'Mono',       colors: ['#111111', '#444444', '#777777', '#aaaaaa', '#dddddd'] }
  };

  var DEFAULTS = { symmetry: 6, complexity: 24, seed: 12345, palette: 'terracotta' };

  // ── Seeded RNG (xorshift32) ────────────────────────────────────────────────
  function makePRNG(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  function wh() {
    return { W: canvas.width / DPR, H: canvas.height / DPR };
  }

  function currentParams() {
    return {
      symmetry: parseInt(symCtrl.value, 10),
      complexity: parseInt(cplxCtrl.value, 10),
      seed: parseInt(seedCtrl.value, 10) || 1,
      palette: palCtrl.value
    };
  }

  // ── Shape generation (deterministic) ───────────────────────────────────────
  function buildShapes(params, R) {
    var rng = makePRNG(params.seed);
    var pal = PALETTES[params.palette] || PALETTES.terracotta;
    var wedge = (2 * Math.PI) / params.symmetry;
    var shapes = [];
    for (var i = 0; i < params.complexity; i++) {
      var roll = rng();
      shapes.push({
        kind: roll < 0.5 ? 'circle' : (roll < 0.8 ? 'line' : 'tri'),
        a: rng() * wedge,
        r: (0.12 + rng() * 0.88) * R,
        size: (0.03 + rng() * 0.13) * R,
        color: pal.colors[Math.floor(rng() * pal.colors.length)],
        alpha: 0.3 + rng() * 0.6,
        rot: rng() * Math.PI
      });
    }
    return shapes;
  }

  function drawShape(s) {
    var x = Math.cos(s.a) * s.r;
    var y = Math.sin(s.a) * s.r;
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = s.color;
    ctx.strokeStyle = s.color;
    if (s.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.kind === 'line') {
      ctx.lineWidth = Math.max(1, s.size * 0.35);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(s.rot) * s.size * 2.2, y + Math.sin(s.rot) * s.size * 2.2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y - s.size);
      ctx.lineTo(x + s.size, y + s.size);
      ctx.lineTo(x - s.size, y + s.size);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    var W = wh().W, H = wh().H;
    var params = currentParams();
    var R = Math.min(W, H) / 2 - 12;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f7f4ef';
    ctx.fillRect(0, 0, W, H);

    var shapes = buildShapes(params, R);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    for (var k = 0; k < params.symmetry; k++) {
      ctx.save();
      ctx.rotate(k * (2 * Math.PI) / params.symmetry);
      if (k % 2 === 1) ctx.scale(-1, 1);
      for (var i = 0; i < shapes.length; i++) drawShape(shapes[i]);
      ctx.restore();
    }
    ctx.restore();

    // Centre marker
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    if (valSym) valSym.textContent = params.symmetry;
    if (valCplx) valCplx.textContent = params.complexity;
    if (readout) {
      var palName = (PALETTES[params.palette] || PALETTES.terracotta).name;
      readout.textContent =
        'Kaleidoscope with ' + params.symmetry + '-fold mirror symmetry, ' +
        params.complexity + ' shapes, palette “' + palName + '”, seed ' + params.seed + '.';
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  [symCtrl, cplxCtrl, seedCtrl, palCtrl].forEach(function (el) {
    if (el) el.addEventListener('input', draw);
    if (el) el.addEventListener('change', draw);
  });

  if (regenBtn) regenBtn.addEventListener('click', function () {
    seedCtrl.value = Math.floor(Math.random() * 1000000) + 1;
    draw();
  });

  if (resetBtn) resetBtn.addEventListener('click', function () {
    symCtrl.value = DEFAULTS.symmetry;
    cplxCtrl.value = DEFAULTS.complexity;
    seedCtrl.value = DEFAULTS.seed;
    palCtrl.value = DEFAULTS.palette;
    draw();
  });

  // ── Resize ─────────────────────────────────────────────────────────────────
  function resize() {
    var wrap = canvas.parentElement;
    var w = Math.min(760, wrap.getBoundingClientRect().width - 8);
    var h = Math.round(w * (460 / 760));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }

  resize();
  window.addEventListener('resize', resize);
})();
