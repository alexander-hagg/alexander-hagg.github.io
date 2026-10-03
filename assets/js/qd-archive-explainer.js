/**
 * QD-archive explainer
 * ====================
 * A small, self-contained, dependency-free Canvas2D applet that explains a
 * Quality-Diversity (QD) archive.
 *
 * The grid is a 2D behaviour/feature space. A single-objective search keeps
 * only the single best solution (one cell); a QD archive keeps the best
 * solution found for *every* cell, covering the whole space. Press "Run" to
 * progressively fill the archive and watch coverage grow.
 *
 * Interaction: Run/Pause, Reset, hover/tap/click a cell to inspect it, and
 * keyboard navigation (arrow keys to move, Enter to inspect, Escape to clear).
 * A text readout reports coverage, the best quality, and the inspected cell.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('qd-explainer-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var DPR = window.devicePixelRatio || 1;

  var runBtn = document.getElementById('qd-explainer-run');
  var resetBtn = document.getElementById('qd-explainer-reset');
  var readout = document.getElementById('qd-explainer-readout');

  var COLS = 12, ROWS = 8;
  var TOTAL = COLS * ROWS;

  // ── Deterministic quality landscape ────────────────────────────────────────
  // A smooth function with a global optimum and several local optima, so the
  // "best" cell is meaningful and the archive is visibly diverse.
  function quality(col, row) {
    var x = col / (COLS - 1), y = row / (ROWS - 1);
    var q = 0.5
      + 0.30 * Math.sin(x * Math.PI * 2.1 + 0.4) * Math.cos(y * Math.PI * 1.7)
      + 0.20 * Math.sin((x + y) * Math.PI * 1.3);
    return Math.max(0, Math.min(1, q));
  }

  var cells = [];
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      cells.push({ col: c, row: r, q: quality(c, r), filled: false });
    }
  }

  // Deterministic fill order (seeded shuffle) so "Run" is reproducible.
  function makePRNG(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }
  var order = cells.slice();
  (function shuffle() {
    var rng = makePRNG(20240607);
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = order[i]; order[i] = order[j]; order[j] = t;
    }
  })();

  var fillIndex = 0;
  var running = false;
  var timer = null;
  var hovered = null;
  var selected = null;
  var focused = false;

  function wh() { return { W: canvas.width / DPR, H: canvas.height / DPR }; }

  function bestCell() {
    var best = null;
    cells.forEach(function (cell) {
      if (!cell.filled) return;
      if (!best || cell.q > best.q) best = cell;
    });
    return best;
  }

  function coverage() {
    var n = 0;
    cells.forEach(function (cell) { if (cell.filled) n++; });
    return n;
  }

  // ── Geometry ───────────────────────────────────────────────────────────────
  var M = { top: 30, right: 20, bottom: 40, left: 20 };

  function cellRect(col, row) {
    var W = wh().W, H = wh().H;
    var pw = W - M.left - M.right;
    var ph = H - M.top - M.bottom;
    return {
      x: M.left + col * (pw / COLS),
      y: M.top + (ROWS - 1 - row) * (ph / ROWS),
      w: pw / COLS,
      h: ph / ROWS
    };
  }

  function hitTest(mx, my) {
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var rc = cellRect(cell.col, cell.row);
      if (mx >= rc.x && mx < rc.x + rc.w && my >= rc.y && my < rc.y + rc.h) return cell;
    }
    return null;
  }

  // ── Colour scale (blue = high quality) ─────────────────────────────────────
  function qualityColor(q, alpha) {
    var lo = [222, 235, 247], hi = [33, 102, 172];
    var r = Math.round(lo[0] + (hi[0] - lo[0]) * q);
    var g = Math.round(lo[1] + (hi[1] - lo[1]) * q);
    var b = Math.round(lo[2] + (hi[2] - lo[2]) * q);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha == null ? 1 : alpha) + ')';
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    var W = wh().W, H = wh().H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    var best = bestCell();

    cells.forEach(function (cell) {
      var rc = cellRect(cell.col, cell.row);
      var isHov = hovered === cell;
      var isSel = selected === cell;

      if (cell.filled) {
        ctx.fillStyle = qualityColor(cell.q, 0.9);
      } else {
        ctx.fillStyle = '#f0f0f0';
      }
      ctx.fillRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);

      // Best cell: star marker (not colour alone)
      if (best && cell === best) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.round(rc.h * 0.5) + 'px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', rc.x + rc.w / 2, rc.y + rc.h / 2 + 1);
      }

      if (isSel) {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 3;
        ctx.strokeRect(rc.x + 1.5, rc.y + 1.5, rc.w - 3, rc.h - 3);
      } else if (isHov) {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
      }
    });

    // Axis labels
    ctx.fillStyle = '#666';
    ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Behaviour dimension 1 →', W / 2, H - 8);
    ctx.save();
    ctx.translate(12, M.top + (H - M.top - M.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Behaviour dimension 2 →', 0, 0);
    ctx.restore();

    // Coverage bar
    var cov = coverage();
    var barW = W - M.left - M.right;
    var barY = 12;
    ctx.fillStyle = '#eee';
    ctx.fillRect(M.left, barY, barW, 6);
    ctx.fillStyle = '#3a7d44';
    ctx.fillRect(M.left, barY, barW * (cov / TOTAL), 6);
    ctx.fillStyle = '#3a7d44';
    ctx.font = 'bold 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Archive coverage: ' + cov + ' / ' + TOTAL + ' cells', M.left, barY - 3);

    if (focused) {
      ctx.save();
      ctx.strokeStyle = '#3a7d44';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(1, 1, W - 2, H - 2);
      ctx.restore();
    }
  }

  // ── Readout ────────────────────────────────────────────────────────────────
  function updateReadout() {
    if (!readout) return;
    var cov = coverage();
    var best = bestCell();
    var cell = hovered || selected;
    var parts = [];
    parts.push('Archive coverage ' + cov + ' of ' + TOTAL + ' cells (' +
      Math.round((cov / TOTAL) * 100) + '%).');
    if (best) {
      parts.push('Best solution: quality ' + (best.q * 100).toFixed(0) +
        '% at cell column ' + (best.col + 1) + ', row ' + (best.row + 1) + '.');
    } else {
      parts.push('No solutions yet — press Run to fill the archive.');
    }
    if (cell) {
      parts.push('Inspected cell column ' + (cell.col + 1) + ', row ' + (cell.row + 1) +
        ': quality ' + (cell.q * 100).toFixed(0) + '%, ' +
        (cell.filled ? 'filled' : 'empty') + '.');
    }
    readout.textContent = parts.join(' ');
  }

  // ── Run loop ───────────────────────────────────────────────────────────────
  function step() {
    if (fillIndex >= order.length) {
      stop();
      return;
    }
    order[fillIndex].filled = true;
    fillIndex++;
    updateReadout();
    draw();
    if (fillIndex >= order.length) stop();
  }

  function start() {
    if (running) return;
    if (fillIndex >= order.length) reset();
    running = true;
    if (runBtn) runBtn.textContent = 'Pause';
    timer = window.setInterval(step, 90);
  }

  function stop() {
    running = false;
    if (runBtn) runBtn.textContent = 'Run';
    if (timer) { window.clearInterval(timer); timer = null; }
  }

  function reset() {
    stop();
    cells.forEach(function (cell) { cell.filled = false; });
    fillIndex = 0;
    hovered = null;
    selected = null;
    updateReadout();
    draw();
  }

  if (runBtn) runBtn.addEventListener('click', function () {
    if (running) stop(); else start();
  });
  if (resetBtn) resetBtn.addEventListener('click', reset);

  // ── Pointer events ─────────────────────────────────────────────────────────
  function evXY(e) {
    var r = canvas.getBoundingClientRect();
    var sx = (canvas.width / DPR) / r.width;
    var sy = (canvas.height / DPR) / r.height;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  }

  canvas.addEventListener('mousemove', function (e) {
    var xy = evXY(e);
    hovered = hitTest(xy[0], xy[1]);
    updateReadout();
    draw();
  });
  canvas.addEventListener('mouseleave', function () {
    hovered = null;
    updateReadout();
    draw();
  });
  canvas.addEventListener('click', function (e) {
    var xy = evXY(e);
    var cell = hitTest(xy[0], xy[1]);
    selected = cell;
    updateReadout();
    draw();
  });
  canvas.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    var r = canvas.getBoundingClientRect();
    var sx = (canvas.width / DPR) / r.width;
    var sy = (canvas.height / DPR) / r.height;
    selected = hitTest((t.clientX - r.left) * sx, (t.clientY - r.top) * sy);
    updateReadout();
    draw();
  }, { passive: true });

  // ── Keyboard ───────────────────────────────────────────────────────────────
  function moveSelection(key) {
    var col, row;
    if (selected) { col = selected.col; row = selected.row; }
    else { col = Math.floor(COLS / 2); row = Math.floor(ROWS / 2); }
    if (key === 'ArrowLeft') col = Math.max(0, col - 1);
    if (key === 'ArrowRight') col = Math.min(COLS - 1, col + 1);
    if (key === 'ArrowUp') row = Math.min(ROWS - 1, row + 1);
    if (key === 'ArrowDown') row = Math.max(0, row - 1);
    selected = cells.find(function (c) { return c.col === col && c.row === row; }) || selected;
    updateReadout();
    draw();
  }

  canvas.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      moveSelection(k);
    } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (!selected) moveSelection('ArrowRight');
      else updateReadout();
    } else if (k === 'Escape') {
      selected = null;
      updateReadout();
      draw();
    }
  });
  canvas.addEventListener('focus', function () { focused = true; draw(); });
  canvas.addEventListener('blur', function () { focused = false; draw(); });

  // ── Resize ─────────────────────────────────────────────────────────────────
  function resize() {
    var wrap = canvas.parentElement;
    var w = Math.min(760, wrap.getBoundingClientRect().width - 8);
    var h = Math.round(w * (420 / 760));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }

  updateReadout();
  resize();
  window.addEventListener('resize', resize);
})();
