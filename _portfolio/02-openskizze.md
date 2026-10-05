---
title: "OpenSKIZZE"
excerpt: "An open-source AI assistant for climate-adapted urban planning — surrogate-assisted quality diversity optimization generates thousands of diverse design families, evaluated for cold airflow impact without costly CFD simulation."
collection: portfolio
permalink: /portfolio/openskizze/
tags: [AI, urban planning, climate, open source, quality diversity, surrogate model, UMAP, machine learning]
ref: openskizze
header:
  teaser: openskizze-visual.svg
related_publications:
  - designing-air-flow
  - efficient-qd-3d-buildings
  - full-domain-analysis
related_talks:
  - kluger-transfer-tandem
applet_scripts:
  - /assets/js/openskizze-demo.js
  - /assets/js/qd-archive-explainer.js
---

<span class="tag-pill">DBU Funded</span>&nbsp;<span class="tag-pill">Urban Climate</span>&nbsp;<span class="tag-pill">Open Source</span>&nbsp;<span class="tag-pill">Quality Diversity</span>&nbsp;<span class="tag-pill">Surrogate Models</span>&nbsp;<span class="tag-pill">UMAP</span>

## Open-source AI for Climate-adapted Urban Design

Climate-adapted building requires knowledge that most planners don't have easy access to: which configurations keep cold air flowing into a neighbourhood? How do building heights interact with cold air corridors? Which density trade-offs actually matter for reducing urban heat?

**OpenSKIZZE** translates findings from climate models into concrete, usable design options — early in the planning process, before expensive expertise is typically called in.

## OpenSKIZZE 2.0 — Interactive QD Explorer

Explore the generative quality-diversity design space directly in your browser — no installation required.

<p class="demo-jump"><a href="/openskizze-2.0.html" target="_blank" rel="noopener" class="btn btn--primary">⛶ Open full window</a></p>

<div class="openskizze-embed" style="margin:1rem 0;">
  <iframe src="/openskizze-2.0.html" title="OpenSKIZZE 2.0 — Interactive QD Explorer" loading="lazy" style="width:100%; aspect-ratio:16/9; border:0; border-radius:12px; background:#0f172a;"></iframe>
</div>

The embedded view above is fully interactive. For presentations or a larger canvas, use the **⛶ Open full window** button to open the standalone version in a new tab.

<div class="blend-visual">
  <img src="/images/openskizze-visual.svg" alt="OpenSKIZZE urban planning tool interface" loading="lazy" decoding="async" />
</div>

<p class="demo-jump"><a href="#interactive-demo" class="btn btn--primary">Jump to the interactive demo ↓</a></p>

---

### Interactive demo

The widget below illustrates the two core outputs: the **QD archive** (left — each cell is one design archetype, coloured by the selected view) and the **UMAP embedding** (right — how designs cluster by predicted behaviour). **Hover, tap/click, or use the keyboard** (arrow keys to move the selected cell, Enter/Space to inspect, Escape to clear) to link the archive, preview, and UMAP. Use the **View** selector to switch the colour scale between the surrogate-predicted **cold airflow score** and the **surrogate uncertainty**.

<div id="openskizze-demo" class="applet" data-applet="openskizze">
  <div class="demo-header">Surrogate-assisted QD · Archive & Airflow UMAP</div>
  <div class="demo-topbar">
    <div class="demo-ctrl">
      <label for="ctrl-view">View</label>
      <select id="ctrl-view">
        <option value="score">Cold airflow score</option>
        <option value="uncertainty">Surrogate uncertainty</option>
      </select>
    </div>
    <div class="demo-ctrl">
      <label for="ctrl-height">Max height &nbsp;<span class="demo-value" id="val-height">6</span> fl.</label>
      <input type="range" id="ctrl-height" min="2" max="10" value="6" step="1">
    </div>
    <div class="demo-ctrl">
      <label for="ctrl-green">Min green &nbsp;<span class="demo-value" id="val-green">30</span>%</label>
      <input type="range" id="ctrl-green" min="10" max="60" value="30" step="5">
    </div>
    <div class="demo-ctrl">
      <label for="ctrl-density">Max density &nbsp;<span class="demo-value" id="val-density">0.50</span></label>
      <input type="range" id="ctrl-density" min="0.2" max="0.8" value="0.5" step="0.05">
    </div>
    <div class="demo-ctrl">
      <button type="button" id="demo-clear" class="demo-clear">Clear selection</button>
    </div>
  </div>
  <div class="demo-canvas-wrap">
    <canvas id="qd-canvas" width="760" height="340"
            role="application"
            tabindex="0"
            aria-label="Interactive OpenSKIZZE demo: a quality-diversity design archive, a design preview, and a UMAP embedding of predicted airflow."
            aria-describedby="demo-desc"></canvas>
    <p id="demo-desc" class="visually-hidden">This interactive demo has three linked panels. The left panel is a quality-diversity archive: a grid of design archetypes, each drawn as a small isometric city, where the horizontal axis is green-space percentage and the vertical axis is building density. The centre panel shows an enlarged preview of the currently selected design with its statistics. The right panel is a UMAP scatter plot in which each dot is a design, positioned so that designs with similar predicted airflow cluster together. Hover, tap, or click a cell in the archive or a dot in the UMAP to select a design; the selection persists and links all three panels. With the canvas focused, use the arrow keys to move the selected archive cell, Enter or Space to inspect it, and Escape to clear the selection. A text readout below the canvas reports the selected design's green space, density, height, airflow score, uncertainty, and feasibility.</p>
    <p id="demo-readout" class="demo-readout" role="status" aria-live="polite">No design selected. Hover, tap, or use the arrow keys to select a design.</p>
    <p class="demo-legend">
      <strong>Left:</strong> QD archive — each cell is a distinct design archetype shown as an isometric city. The colour bar encodes the selected view (cold airflow score or surrogate uncertainty); the selected cell is also marked with a black border and corner square.<br>
      <strong>Centre:</strong> Hover, tap, or select any cell to see the full design preview with stats.<br>
      <strong>Right:</strong> UMAP — clusters of designs with similar predicted behaviour.<br>
      <span class="demo-legend__swatch" style="color:#2166ac;">■</span> Strong cold airflow &nbsp;
      <span class="demo-legend__swatch" style="color:#f4a261;">■</span> Blocked / weak &nbsp;
      <span class="demo-legend__swatch" style="color:#1a9850;">■</span> Confident &nbsp;
      <span class="demo-legend__swatch" style="color:#d73027;">■</span> Uncertain
    </p>
  </div>
</div>

---

### What is a quality-diversity archive?

A conventional optimizer keeps only the single best solution it finds. A **quality-diversity (QD) archive** keeps the best solution for *every* cell of a behaviour space — so instead of one answer, you get a diverse, structured collection of good answers. Press **Run** below to fill the archive and watch coverage grow; hover, tap, or use the keyboard to inspect a cell.

<div id="qd-explainer" class="applet" data-applet="qd-archive-explainer">
  <div class="demo-header">QD archive · single best vs. diverse archive</div>
  <div class="demo-topbar">
    <div class="demo-ctrl">
      <button type="button" id="qd-explainer-run" class="demo-clear">Run</button>
    </div>
    <div class="demo-ctrl">
      <button type="button" id="qd-explainer-reset" class="demo-clear">Reset</button>
    </div>
  </div>
  <div class="demo-canvas-wrap">
    <canvas id="qd-explainer-canvas" width="760" height="420"
            role="application"
            tabindex="0"
            aria-label="Quality-diversity archive explainer: a grid of behaviour-space cells that fill as solutions are added."
            aria-describedby="qd-explainer-desc"></canvas>
    <p id="qd-explainer-desc" class="visually-hidden">A grid representing a two-dimensional behaviour space. Pressing Run progressively fills each cell with the best solution found for that region, and a coverage bar shows how much of the space is covered. The single best solution across the whole archive is marked with a star. Hover, tap, or click a cell to inspect its quality and whether it is filled; with the canvas focused, use the arrow keys to move the inspected cell, Enter to inspect, and Escape to clear. A text readout reports coverage, the best quality, and the inspected cell.</p>
    <p id="qd-explainer-readout" class="demo-readout" role="status" aria-live="polite">Archive coverage 0 of 96 cells (0%). No solutions yet — press Run to fill the archive.</p>
    <p class="demo-legend">
      <strong>How to read it:</strong> each cell is a region of behaviour space; darker blue means higher quality. A single-objective search would keep only the starred cell; a QD archive keeps the best solution in every filled cell, so the whole space is covered. The starred best cell is marked with a symbol, not colour alone.
    </p>
  </div>
</div>

---

### How it works: surrogate-assisted quality diversity

The core of OpenSKIZZE is a **surrogate-assisted quality diversity (QD) optimization** loop:

1. A QD algorithm (MAP-Elites) maintains an archive of diverse building layouts, each occupying a unique position in a behavioural feature space (e.g., density × green space ratio).
2. For each candidate layout, a **surrogate model** predicts the cold airflow impact without running a full CFD simulation — reducing compute by **three orders of magnitude**. We use two surrogate architectures:
   - **Gaussian Process regressors (SVGP)** — sparse variational GPs that provide calibrated uncertainty estimates, which guide the QD algorithm toward under-explored regions of design space
   - **U-Net prediction models** — convolutional encoder-decoders trained on CFD outputs to predict full 2D airflow fields from building footprint rasters
3. **Conditional generative AI** (conditional diffusion and flow-matching models) is used to generate plausible layout variants conditioned on target airflow properties, seeding the QD archive with high-quality initial solutions.
4. To make the high-dimensional airflow fields interpretable, a **UMAP model** projects them into 2D — revealing clusters of layouts that produce similar airflow behaviour, even when their building footprints look very different.

The result: planners receive a structured vocabulary of design archetypes, each backed by a predicted cold airflow map and uncertainty estimate, ready for expert review and comparison.

---

### Workflow

1. **Define scope** — select the planning area on an interactive map; parcel data auto-loads from NRW geodata portal
2. **Set goals** — define structural constraints (max height, min spacing) and optimization targets (GRZ, GFZ, green space %)
3. **Optimize** — surrogate-assisted QD fills the archive; surrogate uncertainty drives targeted resampling
4. **Explore** — the UMAP reveals which design families produce similar cold airflow patterns; parallel coordinate plots surface trade-offs
5. **Cluster** — similar designs grouped into archetypes (best, most representative, consensus map per type)
6. **Compare** — side-by-side 3D visualization with wind flow fields; export PDF report
7. **Export** — exporting into usable documentation and urban planning formats

### Evaluation site

OpenSKIZZE is being validated on real construction projects in **Bonn-Dransdorf** — on the site of the old city nursery, which sits in a cold air inflow corridor adjacent to an Urban Heat Island. Partners: [**Montag Stiftung Urbane Räume gAG**](https://www.montag-stiftungen.de/montag-stiftung-urbane-raeume/initialkapital-projekte/projekte-in-untersuchung/zukunftsort-dransdorfer-berg) and [**Neue Stadtgärtnerei e.V.**](https://neue-stadtgaertnerei.org/)

### Funding & partners

Funded by the [**Deutsche Bundesstiftung Umwelt (DBU)**](https://www.dbu.de/en/). In collaboration with [Dirk Reith](https://www.h-brs.de/en/emt/dirk-reith) at [TREE](https://www.h-brs.de/en/tree), [H-BRS](https://www.h-brs.de/en).

[OpenSKIZZE project page at H-BRS](https://www.h-brs.de/en/openskizze){: .btn}

### Open science commitment

OpenSKIZZE is developed fully in the open — open-source code, open training data, and open model weights. We believe that publicly funded climate tools must be publicly accessible, reproducible, and extensible by the communities they are meant to serve.
