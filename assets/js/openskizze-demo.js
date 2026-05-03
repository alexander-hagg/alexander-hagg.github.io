/**
 * OpenSKIZZE Interactive Demo
 * Three panels:
 *   LEFT  – QD Archive heatmap (each cell = tiny isometric city thumbnail)
 *   CENTRE – Enlarged isometric voxel preview of hovered design
 *   RIGHT  – UMAP scatter of predicted airflow fields
 *
 * Emphasises: solution diversity (every cell looks different) +
 *             optimality (blue = good cold airflow corridors).
 */

(function () {
  'use strict';

  // ── Palette ────────────────────────────────────────────────────────────────
  const COL = {
    bgPanel:    '#fafafa',
    building:   '#c8d8e0',   // base building face (light)
    buildingTop:'#e8f2f5',   // top face (lighter)
    buildingSide:'#9ab0bb',  // dark face
    green:      '#7ec87e',   // green space
    greenDark:  '#5aaa5a',
    road:       '#e8e8e8',
    roadLine:   '#d0d0d0',
    airGood:    [33,  102, 172],  // blue  – strong cold airflow
    airPoor:    [244, 162,  97],  // orange– blocked
    infeasible: '#e0e0e0',
    infeasBld:  '#b8b8b8',
    label:      '#555',
    accent:     '#3a7d44',
  };

  // ── Score colour (t=0 orange, t=1 blue) ────────────────────────────────────
  function scoreRGB(t) {
    const a = COL.airPoor, b = COL.airGood;
    return [
      Math.round(a[0] + (b[0]-a[0])*t),
      Math.round(a[1] + (b[1]-a[1])*t),
      Math.round(a[2] + (b[2]-a[2])*t),
    ];
  }
  function scoreColor(t) { const [r,g,b]=scoreRGB(t); return `rgb(${r},${g},${b})`; }
  function scoreColorA(t,a) { const [r,g,b]=scoreRGB(t); return `rgba(${r},${g},${b},${a})`; }

  // ── Seeded RNG ─────────────────────────────────────────────────────────────
  function makePRNG(seed) {
    let s = seed >>> 0 || 1;
    return function() {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  // ── Archive data ───────────────────────────────────────────────────────────
  const COLS = 10, ROWS = 8;
  const PLOT = 5; // parcels per side in the mini-city grid
  const rng0 = makePRNG(42);

  const archive = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const greenPct = Math.round((col / (COLS-1)) * 70 + 10);      // 10–80%
      const density  = parseFloat(((row / (ROWS-1)) * 0.65 + 0.1).toFixed(2)); // 0.1–0.75
      const height   = Math.round(density * 12 + 2);                // 2–14 floors

      const rawScore = (greenPct/100)*0.55 + (1-density)*0.45
                     - (density>0.5 ? (density-0.5)*0.4 : 0)
                     + (rng0()-0.5)*0.08;
      const score = Math.min(1, Math.max(0, rawScore));

      const distC = Math.hypot((col/(COLS-1))-0.5, (row/(ROWS-1))-0.5);
      const uncertainty = Math.min(1, 0.15 + distC*0.6 + rng0()*0.15);

      // Generate a reproducible building layout for this cell
      // GRID_N × GRID_N plot grid; each parcel is 'building', 'green', or 'road'
      const layout = genLayout(col, row, greenPct, density, height);

      archive.push({ col, row, greenPct, density, height, score, uncertainty, layout });
    }
  }

  // Assign UMAP coordinates
  const rng1 = makePRNG(99);
  archive.forEach(cell => {
    const gt = (cell.greenPct-10)/70, dt = (cell.density-0.1)/0.65;
    const wA = gt*(1-dt), wC = (1-gt)*dt, wB = 1-Math.abs(wA-wC);
    const sum = wA + wB*0.6 + wC;
    const tA=wA/sum, tB=(wB*0.6)/sum, tC=wC/sum;
    const cx = [0.75,0.48,0.22], cy = [0.22,0.52,0.78];
    cell.ux = Math.min(0.93,Math.max(0.07, tA*cx[0]+tB*cx[1]+tC*cx[2] + (rng1()-0.5)*0.11));
    cell.uy = Math.min(0.93,Math.max(0.07, tA*cy[0]+tB*cy[1]+tC*cy[2] + (rng1()-0.5)*0.11));
  });

  // ── Layout generation ───────────────────────────────────────────────────────
  // Returns a flat array of parcel descriptors for a small N×N city grid.

  function genLayout(col, row, greenPct, density, maxH) {
    const r = makePRNG(col * 31 + row * 97 + 7);
    const parcels = [];
    // Place roads at every other parcel boundary; rest are buildable or green
    for (let py = 0; py < PLOT; py++) {
      for (let px = 0; px < PLOT; px++) {
        const isRoadX = px === Math.floor(PLOT/2);
        const isRoadY = py === Math.floor(PLOT/2);
        let kind, floors = 0;
        if (isRoadX || isRoadY) {
          kind = 'road';
        } else {
          // Probability of green space driven by greenPct
          const pGreen = greenPct / 120;
          // Probability of building driven by density
          const pBld = density * 0.9;
          const roll = r();
          if (roll < pGreen) {
            kind = 'green';
          } else if (roll < pGreen + pBld) {
            kind = 'building';
            // Height varies: some tall, some short, driven by density
            const hScale = density * 0.8 + 0.2;
            floors = Math.max(1, Math.round(hScale * maxH * (0.5 + r()*0.5)));
          } else {
            kind = 'empty';
          }
        }
        parcels.push({ px, py, kind, floors });
      }
    }
    return parcels;
  }

  // ── Isometric renderer ──────────────────────────────────────────────────────
  // Draws a PLOT×PLOT city in isometric projection into a bounding box.
  // Computes tile size from BOTH horizontal (bw) and vertical (bh) constraints
  // so that tall buildings never clip out of the top of the cell.
  function drawIso(ctx2, parcels, bw, bh, ox, oy, feasible, score) {
    const maxFloors = parcels.reduce((m, p) => Math.max(m, p.floors || 0), 0);

    // tw constrained by width: fit PLOT+1 tiles across bw
    const twByW = bw / (PLOT + 1);
    // tw constrained by height:
    //   vertical space = buildings above ground (maxFloors * th*0.55)
    //                  + ground footprint (PLOT * th)
    //   with th = tw*0.5:
    //   bh >= tw*(maxFloors*0.275 + PLOT*0.5)  → tw <= bh/(…)
    const twByH = bh / (maxFloors * 0.275 + PLOT * 0.5 + 0.5); // 0.5 = small margin
    const tw = Math.min(twByW, twByH);
    const th = tw * 0.5;
    const floorH = th * 0.55;

    // Push ground down far enough for the tallest building to fit above it
    const bldOverhead = maxFloors * floorH;
    const groundH = PLOT * th;
    // Vertically centre the whole scene in bh
    const usedH = bldOverhead + groundH;
    const yShift = oy + Math.max(0, (bh - usedH) / 2) + bldOverhead;

    const sorted = parcels.slice().sort((a, b) => (a.px + a.py) - (b.px + b.py));

    sorted.forEach(({ px, py, kind, floors }) => {
      // Isometric screen position using computed tw/th and vertical shift
      const ix = ox + (px - py) * tw * 0.5 + bw * 0.5 - tw * 0.25;
      const iy = yShift + (px + py) * th * 0.5;

      if (kind === 'road') {
        drawIsoGround(ctx2, ix, iy, tw, th, COL.road, COL.roadLine, feasible);
      } else if (kind === 'green') {
        drawIsoGround(ctx2, ix, iy, tw, th, feasible ? COL.green : '#b0c8b0', feasible ? COL.greenDark : '#90a890', feasible);
      } else if (kind === 'building' && floors > 0) {
        const bldColor  = feasible ? COL.building   : COL.infeasBld;
        const topColor  = feasible ? scoreColorA(score, 0.25) : '#d8d8d8';
        const sideColor = feasible ? COL.buildingSide: '#a8a8a8';
        drawIsoBox(ctx2, ix, iy, tw, th, floors * floorH, bldColor, topColor, sideColor);
      } else {
        // empty parcel — just ground
        drawIsoGround(ctx2, ix, iy, tw, th, '#f0f0f0', '#e0e0e0', feasible);
      }
    });
  }

  function isoPath(ctx2, points) {
    ctx2.beginPath();
    ctx2.moveTo(points[0][0], points[0][1]);
    for (let i=1;i<points.length;i++) ctx2.lineTo(points[i][0],points[i][1]);
    ctx2.closePath();
  }

  function drawIsoGround(ctx2, ix, iy, tw, th, fill, stroke, feasible) {
    isoPath(ctx2, [
      [ix, iy],
      [ix + tw*0.5, iy + th*0.5],
      [ix, iy + th],
      [ix - tw*0.5, iy + th*0.5],
    ]);
    ctx2.fillStyle = fill;
    ctx2.fill();
    ctx2.strokeStyle = stroke;
    ctx2.lineWidth = 0.3;
    ctx2.stroke();
  }

  function drawIsoBox(ctx2, ix, iy, tw, th, bh, face, top, side) {
    // Top face
    isoPath(ctx2, [
      [ix, iy - bh],
      [ix + tw*0.5, iy + th*0.5 - bh],
      [ix, iy + th - bh],
      [ix - tw*0.5, iy + th*0.5 - bh],
    ]);
    ctx2.fillStyle = top; ctx2.fill();
    ctx2.strokeStyle = 'rgba(0,0,0,0.08)'; ctx2.lineWidth = 0.3; ctx2.stroke();

    // Left face
    isoPath(ctx2, [
      [ix - tw*0.5, iy + th*0.5 - bh],
      [ix, iy + th - bh],
      [ix, iy + th],
      [ix - tw*0.5, iy + th*0.5],
    ]);
    ctx2.fillStyle = side; ctx2.fill(); ctx2.stroke();

    // Right face
    isoPath(ctx2, [
      [ix + tw*0.5, iy + th*0.5 - bh],
      [ix, iy + th - bh],
      [ix, iy + th],
      [ix + tw*0.5, iy + th*0.5],
    ]);
    ctx2.fillStyle = face; ctx2.fill(); ctx2.stroke();
  }

  // ── Canvas & DOM ───────────────────────────────────────────────────────────
  const canvas = document.getElementById('qd-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const ctrlHeight  = document.getElementById('ctrl-height');
  const ctrlGreen   = document.getElementById('ctrl-green');
  const ctrlDensity = document.getElementById('ctrl-density');
  const ctrlView    = document.getElementById('ctrl-view');
  const valHeight   = document.getElementById('val-height');
  const valGreen    = document.getElementById('val-green');
  const valDensity  = document.getElementById('val-density');

  let maxHeight  = 6, minGreen = 30, maxDensity = 0.5;
  let viewMode   = 'score';
  let hovered    = null;
  const DPR      = window.devicePixelRatio || 1;

  function isFeasible(cell) {
    return cell.height <= maxHeight && cell.greenPct >= minGreen && cell.density <= maxDensity;
  }

  // ── Layout constants (computed each draw from current canvas size) ──────────
  // Panel fractions of total width: archive | preview | umap
  const F = [0.40, 0.34, 0.26];
  const GAP = 8;
  const PAD  = { top: 26, right: 6,  bottom: 38, left: 42 };
  const UPAD = { top: 26, right: 10, bottom: 38, left: 18 };

  function panelX(idx, W) {
    let x = 0;
    for (let i=0;i<idx;i++) x += Math.round(W*F[i]) + GAP;
    return x;
  }
  function panelW(idx, W) { return Math.round(W*F[idx]); }

  // ── Cell geometry (archive panel) ──────────────────────────────────────────
  function cellRect(col, row) {
    const { W, H } = wh();
    const pw = panelW(0,W) - PAD.left - PAD.right;
    const ph = H - PAD.top - PAD.bottom;
    return {
      x: PAD.left + col*(pw/COLS),
      y: PAD.top  + (ROWS-1-row)*(ph/ROWS),
      w: pw/COLS,
      h: ph/ROWS,
    };
  }

  function wh() {
    return { W: canvas.width/DPR, H: canvas.height/DPR };
  }

  // ── Hit testing ────────────────────────────────────────────────────────────
  function hitTest(mx, my) {
    const { W } = wh();
    const aW = panelW(0,W);
    const uox = panelX(2,W);

    if (mx < aW) {
      // Archive panel
      for (const cell of archive) {
        const { x, y, w, h } = cellRect(cell.col, cell.row);
        if (mx>=x && mx<x+w && my>=y && my<y+h) return cell;
      }
    } else if (mx >= uox) {
      // UMAP panel
      const { H } = wh();
      const upw = panelW(2,W) - UPAD.left - UPAD.right;
      const uph = H - UPAD.top - UPAD.bottom;
      let best=null, bestD=18*18;
      for (const cell of archive) {
        const px = uox+UPAD.left + cell.ux*upw;
        const py = UPAD.top + cell.uy*uph;
        const d2=(mx-px)**2+(my-py)**2;
        if(d2<bestD){bestD=d2;best=cell;}
      }
      return best;
    }
    return null;
  }

  // ── Main draw ──────────────────────────────────────────────────────────────
  function draw() {
    const { W, H } = wh();
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);

    drawArchive(W, H);
    drawPreview(W, H);
    drawUMAP(W, H);
  }

  // ── Panel 1: QD Archive ────────────────────────────────────────────────────
  function drawArchive(W, H) {
    const pw = panelW(0,W);
    const fs = Math.round(H*0.032);

    ctx.fillStyle = COL.accent;
    ctx.font = `bold ${fs}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Design Archive', PAD.left + (pw-PAD.left-PAD.right)/2, 17);

    archive.forEach(cell => {
      const { x, y, w, h } = cellRect(cell.col, cell.row);
      const feasible = isFeasible(cell);
      const isHov = hovered && hovered.col===cell.col && hovered.row===cell.row;

      // Background tint by score (or infeasible grey)
      ctx.fillStyle = feasible ? scoreColorA(cell.score, 0.18) : '#f2f2f2';
      ctx.fillRect(x, y, w, h);

      // Draw tiny isometric city inside each cell (with small inset)
      const inset = 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x+inset, y+inset, w-inset*2, h-inset*2);
      ctx.clip();
      drawIso(ctx, cell.layout, w-inset*2, h-inset*2, x+inset, y+inset, feasible, cell.score);
      ctx.restore();

      // Score bar on left edge
      if (feasible) {
        ctx.fillStyle = scoreColor(cell.score);
        ctx.fillRect(x, y, 3, h);
      }

      // Hover highlight
      if (isHov) {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(x+1, y+1, w-2, h-2);
      }
    });

    drawArchiveAxes(pw, H);
  }

  function drawArchiveAxes(pw, H) {
    ctx.fillStyle = COL.label;
    const fs = Math.round(H*0.027);
    ctx.font = `${fs}px -apple-system,sans-serif`;

    ctx.textAlign='center';
    ctx.fillText('← green space % →', PAD.left+(pw-PAD.left-PAD.right)/2, H-6);

    ctx.save();
    ctx.translate(12, PAD.top+(H-PAD.top-PAD.bottom)/2);
    ctx.rotate(-Math.PI/2);
    ctx.fillText('← density →', 0, 0);
    ctx.restore();

    const plotW = pw-PAD.left-PAD.right;
    const plotH = H-PAD.top-PAD.bottom;
    ctx.textAlign='center';
    [0,0.5,1].forEach(t=>{
      ctx.fillText(Math.round(10+t*70)+'%', PAD.left+t*plotW, H-PAD.bottom+13);
    });
    ctx.textAlign='right';
    [0,0.5,1].forEach(t=>{
      ctx.fillText((0.1+t*0.65).toFixed(1), PAD.left-3, PAD.top+(1-t)*plotH+4);
    });

    // Constraint lines
    const gt = (minGreen-10)/70, dt = (maxDensity-0.1)/0.65;
    ctx.save();
    ctx.strokeStyle='rgba(244,162,97,0.8)'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(PAD.left+gt*plotW, PAD.top); ctx.lineTo(PAD.left+gt*plotW, H-PAD.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top+(1-dt)*plotH); ctx.lineTo(pw-PAD.right, PAD.top+(1-dt)*plotH); ctx.stroke();
    ctx.restore();
  }

  // ── Panel 2: Design Preview ────────────────────────────────────────────────
  function drawPreview(W, H) {
    const ox = panelX(1,W);
    const pw = panelW(1,W);
    const fs = Math.round(H*0.032);

    // Panel background
    ctx.fillStyle = '#f7faf8';
    ctx.fillRect(ox, 0, pw, H);

    if (!hovered) {
      // Idle state: show a collage of 4 diverse designs
      ctx.fillStyle = COL.accent;
      ctx.font = `bold ${fs}px -apple-system,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Design preview', ox+pw/2, 17);

      ctx.fillStyle = '#aaa';
      ctx.font = `${Math.round(fs*0.85)}px -apple-system,sans-serif`;
      ctx.fillText('hover a cell →', ox+pw/2, H/2);

      // Draw 4 example thumbnails from corners of the archive
      const samples = [
        archive[0],                          // low green, low density
        archive[COLS-1],                     // high green, low density
        archive[(ROWS-1)*COLS],              // low green, high density
        archive[ROWS*COLS-1],                // high green, high density
      ];
      const tw2 = pw/2 - 8, th2 = (H-60)/2 - 6;
      samples.forEach((cell, i) => {
        const bx = ox + (i%2)*(tw2+6) + 4;
        const by = 28 + Math.floor(i/2)*(th2+6);
        ctx.save();
        ctx.beginPath(); ctx.rect(bx, by, tw2, th2); ctx.clip();
        drawIso(ctx, cell.layout, tw2, th2, bx, by, true, cell.score);
        ctx.restore();
        // Score bar top
        ctx.fillStyle = scoreColor(cell.score);
        ctx.fillRect(bx, by, tw2, 3);
        // Mini label
        ctx.fillStyle='#888'; ctx.font=`${Math.round(H*0.024)}px -apple-system,sans-serif`;
        ctx.textAlign='center';
        ctx.fillText(`green ${cell.greenPct}% · GRZ ${cell.density}`, bx+tw2/2, by+th2+12);
      });
      return;
    }

    const cell = hovered;
    const feasible = isFeasible(cell);

    // Title
    ctx.fillStyle = feasible ? COL.accent : '#888';
    ctx.font = `bold ${fs}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(feasible ? 'Selected design' : 'Infeasible design', ox+pw/2, 17);

    // Large isometric view
    const vizH = Math.round(H * 0.58);
    const vizY = 24;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox+4, vizY, pw-8, vizH); ctx.clip();
    drawIso(ctx, cell.layout, pw-8, vizH, ox+4, vizY, feasible, cell.score);
    ctx.restore();

    // Score bar under viz
    if (feasible) {
      const bary = vizY + vizH + 2;
      const barW = pw - 20;
      ctx.fillStyle = '#eee'; ctx.fillRect(ox+10, bary, barW, 5);
      ctx.fillStyle = scoreColor(cell.score); ctx.fillRect(ox+10, bary, barW*cell.score, 5);
    }

    // Stats block
    const statY = vizY + vizH + 16;
    const lh = Math.round(H*0.044);
    const stats = [
      ['Green space',  `${cell.greenPct}%`],
      ['Density (GRZ)',`${cell.density}`],
      ['Max height',   `${cell.height} floors`],
      ['Airflow score',`${(cell.score*100).toFixed(0)}%`],
      ['Status',       feasible ? '✓ feasible' : '✗ out of bounds'],
    ];
    ctx.font = `${Math.round(H*0.028)}px -apple-system,sans-serif`;
    stats.forEach(([label,val],i)=>{
      const ly = statY + i*lh;
      ctx.fillStyle='#888'; ctx.textAlign='left';  ctx.fillText(label+':', ox+10, ly);
      ctx.fillStyle = (label==='Status') ? (feasible?COL.accent:'#c0392b')
                    : (label==='Airflow score') ? scoreColor(cell.score)
                    : '#1a1a1a';
      ctx.textAlign='right'; ctx.fillText(val, ox+pw-8, ly);
    });
  }

  // ── Panel 3: UMAP ──────────────────────────────────────────────────────────
  function drawUMAP(W, H) {
    const ox  = panelX(2,W);
    const pw  = panelW(2,W);
    const upw = pw - UPAD.left - UPAD.right;
    const uph = H  - UPAD.top  - UPAD.bottom;
    const fs  = Math.round(H*0.032);

    ctx.fillStyle = '#2166ac';
    ctx.font = `bold ${fs}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Airflow UMAP', ox+UPAD.left+upw/2, 17);

    // Cluster halos
    [[0.75,0.22,'rgba(33,102,172,0.07)'],[0.48,0.52,'rgba(180,180,180,0.08)'],[0.20,0.78,'rgba(244,162,97,0.08)']].forEach(([ux,uy,col])=>{
      const hx = ox+UPAD.left+ux*upw, hy=UPAD.top+uy*uph;
      const g = ctx.createRadialGradient(hx,hy,0,hx,hy,40);
      g.addColorStop(0,col); g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(hx,hy,40,0,Math.PI*2); ctx.fill();
    });

    const R = Math.max(3, Math.round(H*0.016));
    archive.forEach(cell => {
      const feasible = isFeasible(cell);
      const isHov = hovered && hovered.col===cell.col && hovered.row===cell.row;
      const px = ox+UPAD.left + cell.ux*upw;
      const py = UPAD.top + cell.uy*uph;

      ctx.beginPath();
      ctx.arc(px, py, isHov ? R+4 : R, 0, Math.PI*2);
      ctx.fillStyle = feasible ? scoreColor(cell.score) : '#ddd';
      ctx.fill();
      ctx.strokeStyle = isHov ? '#1a1a1a' : 'rgba(0,0,0,0.1)';
      ctx.lineWidth = isHov ? 2 : 0.5;
      ctx.stroke();
    });

    // Axis labels
    ctx.fillStyle='#aaa'; ctx.font=`${Math.round(H*0.025)}px -apple-system,sans-serif`;
    ctx.textAlign='center';
    ctx.fillText('UMAP 1', ox+UPAD.left+upw/2, H-5);
    ctx.save();
    ctx.translate(ox+8, UPAD.top+uph/2); ctx.rotate(-Math.PI/2);
    ctx.fillText('UMAP 2',0,0); ctx.restore();

    // Colour scale legend strip
    const stripY = H - UPAD.bottom + 18, stripX = ox+UPAD.left, stripW = upw, stripH = 5;
    const grad = ctx.createLinearGradient(stripX,0,stripX+stripW,0);
    grad.addColorStop(0, scoreColor(0)); grad.addColorStop(1, scoreColor(1));
    ctx.fillStyle=grad; ctx.fillRect(stripX, stripY, stripW, stripH);
    ctx.fillStyle='#888'; ctx.font=`${Math.round(H*0.024)}px -apple-system,sans-serif`;
    ctx.textAlign='left';  ctx.fillText('blocked',stripX, stripY+stripH+9);
    ctx.textAlign='right'; ctx.fillText('cold air',stripX+stripW, stripY+stripH+9);
  }

  // ── Resize ─────────────────────────────────────────────────────────────────
  function resize() {
    const wrap = canvas.parentElement;
    const w = Math.min(760, wrap.getBoundingClientRect().width - 8);
    const h = Math.round(w * (340 / 760));
    canvas.style.width  = w+'px';
    canvas.style.height = h+'px';
    canvas.width  = Math.round(w*DPR);
    canvas.height = Math.round(h*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    draw();
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function onMove(mx, my) { hovered=hitTest(mx,my); draw(); }

  function evXY(e) {
    const r=canvas.getBoundingClientRect();
    const sx=(canvas.width/DPR)/r.width, sy=(canvas.height/DPR)/r.height;
    return [(e.clientX-r.left)*sx, (e.clientY-r.top)*sy];
  }

  canvas.addEventListener('mousemove', e=>{ const [x,y]=evXY(e); onMove(x,y); });
  canvas.addEventListener('mouseleave',()=>{ hovered=null; draw(); });
  canvas.addEventListener('touchmove', e=>{
    e.preventDefault();
    const r=canvas.getBoundingClientRect();
    const sx=(canvas.width/DPR)/r.width, sy=(canvas.height/DPR)/r.height;
    onMove((e.touches[0].clientX-r.left)*sx,(e.touches[0].clientY-r.top)*sy);
  },{ passive:false });

  function updateControls() {
    maxHeight  = parseInt(ctrlHeight.value,10);
    minGreen   = parseInt(ctrlGreen.value,10);
    maxDensity = parseFloat(ctrlDensity.value);
    viewMode   = ctrlView ? ctrlView.value : 'score';
    if(valHeight)  valHeight.textContent  = maxHeight;
    if(valGreen)   valGreen.textContent   = minGreen;
    if(valDensity) valDensity.textContent = maxDensity.toFixed(2);
    draw();
  }

  [ctrlHeight,ctrlGreen,ctrlDensity].forEach(el=>el&&el.addEventListener('input',updateControls));
  ctrlView&&ctrlView.addEventListener('change',updateControls);

  updateControls();
  resize();
  window.addEventListener('resize',resize);

})();
