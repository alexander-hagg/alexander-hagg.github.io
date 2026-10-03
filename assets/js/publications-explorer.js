/**
 * Publications Explorer
 * =====================
 * A self-contained, dependency-free Canvas2D map of the site's publications.
 *
 * Layout is deterministic and honest: the horizontal axis is the publication
 * year and the vertical axis is the publication's primary theme (its first
 * tag). This is a thematic layout, NOT a computed embedding (no UMAP/t-SNE).
 *
 * Data is generated at build time from the real publication front matter and
 * embedded as JSON in the `#pub-explorer-data` script tag on the page, so the
 * map stays in sync with the collection.
 *
 * Interaction: hover, tap/click, or keyboard (arrow keys to move, Enter to
 * open the selected publication, Escape to clear). Year/theme filters mirror
 * the publication list below. A text readout and a detail panel provide a
 * non-visual alternative, and the selected marker is not conveyed by colour
 * alone.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('pub-explorer-data');
  var canvas = document.getElementById('pub-explorer-canvas');
  if (!dataEl || !canvas) return;

  var pubs;
  try {
    pubs = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }
  if (!Array.isArray(pubs) || !pubs.length) return;

  var ctx = canvas.getContext('2d');
  var DPR = window.devicePixelRatio || 1;

  var yearSel = document.getElementById('pub-explorer-year');
  var themeSel = document.getElementById('pub-explorer-theme');
  var resetBtn = document.getElementById('pub-explorer-reset');
  var readout = document.getElementById('pub-explorer-readout');
  var detail = document.getElementById('pub-explorer-detail');

  // Distinct, colour-blind-friendly-ish palette. Colour is supplementary:
  // theme is also encoded by vertical position and by the axis labels.
  var PALETTE = [
    '#3a7d44', '#2166ac', '#b2182b', '#d9822b', '#6a3d9a',
    '#1b9e77', '#e7298a', '#666666', '#8c6d31', '#2c7fb8',
    '#a6761d', '#1f78b4'
  ];

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // ── Derive axes from the data ──────────────────────────────────────────────
  var years = [];
  pubs.forEach(function (p) {
    if (years.indexOf(p.year) === -1) years.push(p.year);
  });
  years.sort();

  var themes = [];
  pubs.forEach(function (p) {
    var t = (p.tags && p.tags.length) ? p.tags[0] : 'other';
    if (themes.indexOf(t) === -1) themes.push(t);
  });
  themes.sort();

  pubs.forEach(function (p) {
    p._theme = (p.tags && p.tags.length) ? p.tags[0] : 'other';
    p._ti = themes.indexOf(p._theme);
    p._color = PALETTE[p._ti % PALETTE.length];
    p._yearIndex = years.indexOf(p.year);
    p._slugTags = (p.tags || []).map(slug);
  });

  // ── State ──────────────────────────────────────────────────────────────────
  var M = { top: 30, right: 26, bottom: 46, left: 132 };
  var state = { year: 'all', theme: 'all' };
  var hovered = null;
  var selected = null;
  var focused = false;

  function wh() {
    return { W: canvas.width / DPR, H: canvas.height / DPR };
  }

  function isVisible(p) {
    var okYear = state.year === 'all' || p.year === state.year;
    var okTheme = state.theme === 'all' || p._slugTags.indexOf(state.theme) !== -1;
    return okYear && okTheme;
  }

  function visiblePubs() {
    return pubs.filter(isVisible);
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Positions are computed for every publication so the map is stable when
  // filters change; only visible dots are drawn.
  function layout() {
    var W = wh().W, H = wh().H;
    var plotW = W - M.left - M.right;
    var plotH = H - M.top - M.bottom;
    var bandH = plotH / themes.length;

    var groups = {};
    pubs.forEach(function (p) {
      var key = p._ti + '|' + p._yearIndex;
      (groups[key] = groups[key] || []).push(p);
    });

    Object.keys(groups).forEach(function (k) {
      var arr = groups[k];
      arr.forEach(function (p, i) {
        var x = years.length === 1
          ? M.left + plotW / 2
          : M.left + (p._yearIndex / (years.length - 1)) * plotW;
        var baseY = M.top + (p._ti + 0.5) * bandH;
        var spread = arr.length > 1
          ? (i - (arr.length - 1) / 2) * Math.min(bandH * 0.5, 15)
          : 0;
        p._x = x;
        p._y = baseY + spread;
      });
    });
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  function draw() {
    var W = wh().W, H = wh().H;
    var plotW = W - M.left - M.right;
    var plotH = H - M.top - M.bottom;
    var bandH = plotH / themes.length;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // Theme bands + labels
    themes.forEach(function (t, i) {
      var y = M.top + i * bandH;
      if (i % 2 === 0) {
        ctx.fillStyle = '#f7faf7';
        ctx.fillRect(M.left, y, plotW, bandH);
      }
      ctx.strokeStyle = '#e6efe6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M.left, y);
      ctx.lineTo(M.left + plotW, y);
      ctx.stroke();

      ctx.fillStyle = '#444';
      ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var label = t.length > 18 ? t.slice(0, 17) + '…' : t;
      ctx.fillText(label, M.left - 8, y + bandH / 2);
    });

    // Year gridlines + labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    years.forEach(function (yr, i) {
      var x = years.length === 1
        ? M.left + plotW / 2
        : M.left + (i / (years.length - 1)) * plotW;
      ctx.strokeStyle = '#eef2ee';
      ctx.beginPath();
      ctx.moveTo(x, M.top);
      ctx.lineTo(x, M.top + plotH);
      ctx.stroke();
      ctx.fillStyle = '#666';
      ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.fillText(yr, x, M.top + plotH + 8);
    });

    // Axis titles
    ctx.fillStyle = '#3a7d44';
    ctx.font = 'bold 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Year →', M.left + plotW / 2, H - 6);
    ctx.save();
    ctx.translate(14, M.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Theme →', 0, 0);
    ctx.restore();

    // Dots
    var R = 5;
    pubs.forEach(function (p) {
      if (!isVisible(p)) return;
      var isHov = hovered === p;
      var isSel = selected === p;
      ctx.beginPath();
      ctx.arc(p._x, p._y, isSel ? R + 3 : (isHov ? R + 2 : R), 0, Math.PI * 2);
      ctx.fillStyle = p._color;
      ctx.globalAlpha = isSel || isHov ? 1 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Selection is marked with a ring + cross, not colour alone.
      if (isSel) {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p._x, p._y, R + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p._x - 3, p._y);
        ctx.lineTo(p._x + 3, p._y);
        ctx.moveTo(p._x, p._y - 3);
        ctx.lineTo(p._x, p._y + 3);
        ctx.stroke();
      } else if (isHov) {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p._x, p._y, R + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Keyboard focus indicator
    if (focused) {
      ctx.save();
      ctx.strokeStyle = '#3a7d44';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(1, 1, W - 2, H - 2);
      ctx.restore();
    }
  }

  // ── Hit testing ────────────────────────────────────────────────────────────
  function hitTest(mx, my) {
    var best = null, bestD = 14 * 14;
    pubs.forEach(function (p) {
      if (!isVisible(p)) return;
      var d2 = (mx - p._x) * (mx - p._x) + (my - p._y) * (my - p._y);
      if (d2 < bestD) { bestD = d2; best = p; }
    });
    return best;
  }

  // ── Readout / detail ───────────────────────────────────────────────────────
  function updateReadout() {
    var p = hovered || selected;
    if (readout) {
      if (!p) {
        readout.textContent = 'No publication selected. Hover, tap, or use the arrow keys to inspect a publication.';
      } else {
        readout.textContent = p.title + ' — ' + (p.authors || '') +
          ' (' + p.year + '), ' + (p.venue || '') + '.';
      }
    }
    if (detail) {
      if (!p) {
        detail.innerHTML = '';
      } else {
        var tags = (p.tags || []).map(function (t) {
          return '<span class="tag-pill tag-pill--sm">' + escapeHtml(t) + '</span>';
        }).join(' ');
        detail.innerHTML =
          '<p class="demo-detail__title">' + escapeHtml(p.title) + '</p>' +
          '<p class="demo-detail__meta">' + escapeHtml(p.authors || '') + '</p>' +
          '<p class="demo-detail__meta"><i>' + escapeHtml(p.venue || '') + '</i>, ' + escapeHtml(p.year) + '</p>' +
          (tags ? '<p class="demo-detail__tags">' + tags + '</p>' : '') +
          '<p class="demo-detail__link"><a href="' + escapeAttr(p.url) + '">Open publication page →</a></p>';
      }
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '"');
  }

  function selectPub(p) {
    selected = p;
    updateReadout();
    draw();
  }
  function clearSelection() {
    selected = null;
    updateReadout();
    draw();
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────
  function orderedVisible() {
    return visiblePubs().slice().sort(function (a, b) {
      if (a._yearIndex !== b._yearIndex) return a._yearIndex - b._yearIndex;
      return a._ti - b._ti;
    });
  }

  function moveSelection(dir) {
    var list = orderedVisible();
    if (!list.length) return;
    var idx = selected ? list.indexOf(selected) : -1;
    if (idx === -1) idx = dir > 0 ? -1 : list.length;
    idx = Math.max(0, Math.min(list.length - 1, idx + dir));
    selectPub(list[idx]);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
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
    var p = hitTest(xy[0], xy[1]);
    if (p) selectPub(p); else clearSelection();
  });
  canvas.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    var r = canvas.getBoundingClientRect();
    var sx = (canvas.width / DPR) / r.width;
    var sy = (canvas.height / DPR) / r.height;
    var p = hitTest((t.clientX - r.left) * sx, (t.clientY - r.top) * sy);
    if (p) selectPub(p);
  }, { passive: true });

  canvas.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowUp') {
      e.preventDefault(); moveSelection(-1);
    } else if (k === 'ArrowRight' || k === 'ArrowDown') {
      e.preventDefault(); moveSelection(1);
    } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (selected && selected.url) window.open(selected.url, '_self');
    } else if (k === 'Escape') {
      clearSelection();
    }
  });
  canvas.addEventListener('focus', function () { focused = true; draw(); });
  canvas.addEventListener('blur', function () { focused = false; draw(); });

  function applyFilters() {
    state.year = yearSel ? yearSel.value : 'all';
    state.theme = themeSel ? themeSel.value : 'all';
    if (selected && !isVisible(selected)) selected = null;
    if (hovered && !isVisible(hovered)) hovered = null;
    updateReadout();
    draw();
  }
  if (yearSel) yearSel.addEventListener('change', applyFilters);
  if (themeSel) themeSel.addEventListener('change', applyFilters);
  if (resetBtn) resetBtn.addEventListener('click', function () {
    if (yearSel) yearSel.value = 'all';
    if (themeSel) themeSel.value = 'all';
    clearSelection();
    applyFilters();
  });

  // ── Resize ─────────────────────────────────────────────────────────────────
  function resize() {
    var wrap = canvas.parentElement;
    var w = Math.min(760, wrap.getBoundingClientRect().width - 8);
    var h = Math.round(w * (440 / 760));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
    draw();
  }

  layout();
  updateReadout();
  resize();
  window.addEventListener('resize', resize);
})();
