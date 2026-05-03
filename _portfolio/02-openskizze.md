---
title: "OpenSKIZZE"
excerpt: "An open-source AI assistant for climate-adapted urban planning — surrogate-assisted quality diversity optimization generates thousands of diverse design families, evaluated for cold airflow impact without costly CFD simulation."
collection: portfolio
permalink: /portfolio/openskizze/
tags: [AI, urban planning, climate, open source, quality diversity, surrogate model, UMAP, machine learning]
---

<span class="tag-pill">DBU Funded</span>&nbsp;<span class="tag-pill">Urban Climate</span>&nbsp;<span class="tag-pill">Open Source</span>&nbsp;<span class="tag-pill">Quality Diversity</span>&nbsp;<span class="tag-pill">Surrogate Models</span>&nbsp;<span class="tag-pill">UMAP</span>

## Open-source AI for Climate-adapted Urban Design

Climate-adapted building requires knowledge that most planners don't have easy access to: which configurations keep cold air flowing into a neighbourhood? How do building heights interact with cold air corridors? Which density trade-offs actually matter for reducing urban heat?

**OpenSKIZZE** translates findings from climate models into concrete, usable design options — early in the planning process, before expensive expertise is typically called in.

<div class="blend-visual">
  <img src="/images/openskizze-visual.svg" alt="OpenSKIZZE urban planning tool interface" />
</div>

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

### Interactive demo

The widget below illustrates the two core outputs: the **QD archive** (left — each cell is one design archetype, coloured by surrogate-predicted cold airflow score) and the **UMAP embedding** (right — how designs cluster by predicted airflow behaviour). Hover over either view to link them.

<div id="openskizze-demo">
  <div class="demo-header">Surrogate-assisted QD · Archive &amp; Airflow UMAP</div>
  <div class="demo-topbar">
    <div class="demo-ctrl">
      <label>View</label>
      <select id="ctrl-view">
        <option value="score">Cold airflow score</option>
        <option value="uncertainty">Surrogate uncertainty</option>
      </select>
    </div>
    <div class="demo-ctrl">
      <label>Max height &nbsp;<span class="demo-value" id="val-height">6</span> fl.</label>
      <input type="range" id="ctrl-height" min="2" max="10" value="6" step="1">
    </div>
    <div class="demo-ctrl">
      <label>Min green &nbsp;<span class="demo-value" id="val-green">30</span>%</label>
      <input type="range" id="ctrl-green" min="10" max="60" value="30" step="5">
    </div>
    <div class="demo-ctrl">
      <label>Max density &nbsp;<span class="demo-value" id="val-density">0.50</span></label>
      <input type="range" id="ctrl-density" min="0.2" max="0.8" value="0.5" step="0.05">
    </div>
  </div>
  <div class="demo-canvas-wrap">
    <canvas id="qd-canvas" width="760" height="340"></canvas>
    <p class="demo-legend">
      <strong>Left:</strong> QD archive — each cell is a distinct design archetype shown as an isometric city. Colour bar = cold airflow score.<br>
      <strong>Centre:</strong> Hover any cell to see the full design preview with stats.<br>
      <strong>Right:</strong> UMAP — clusters of designs with similar predicted airflow behaviour.
      <span style="color:#2166ac;font-weight:700;">■</span> Strong cold airflow &nbsp;
      <span style="color:#f4a261;font-weight:700;">■</span> Blocked / weak
    </p>
  </div>
</div>

<script src="/assets/js/openskizze-demo.js"></script>

---

### Workflow

1. **Define scope** — select the planning area on an interactive map; parcel data auto-loads from NRW geodata portal
2. **Set goals** — define structural constraints (max height, min spacing) and optimization targets (GRZ, GFZ, green space %)
3. **Optimize** — surrogate-assisted QD fills the archive; surrogate uncertainty drives targeted resampling
4. **Explore** — the UMAP reveals which design families produce similar cold airflow patterns; parallel coordinate plots surface trade-offs
5. **Cluster** — similar designs grouped into archetypes (best, most representative, consensus map per type)
6. **Compare** — side-by-side 3D visualization with wind flow fields; export PDF report

### Evaluation site

OpenSKIZZE is being validated on real construction projects in **Bonn-Dransdorf** — on the site of the old city nursery, which sits in a cold air inflow corridor adjacent to an Urban Heat Island. Partners: [**Montag Stiftung Urbane Räume gAG**](https://www.montag-stiftungen.de/montag-stiftung-urbane-raeume/initialkapital-projekte/projekte-in-untersuchung/zukunftsort-dransdorfer-berg) and [**Neue Stadtgärtnerei e.V.**](https://neue-stadtgaertnerei.org/)

### Funding & partners

Funded by the [**Deutsche Bundesstiftung Umwelt (DBU)**](https://www.dbu.de/en/). In collaboration with [Dirk Reith](https://www.h-brs.de/en/emt/dirk-reith) at [TREE](https://www.h-brs.de/en/tree), [H-BRS](https://www.h-brs.de/en).

[OpenSKIZZE project page at H-BRS](https://www.h-brs.de/en/openskizze){: .btn}

### Open science commitment

OpenSKIZZE is developed fully in the open — open-source code, open training data, and open model weights. We believe that publicly funded climate tools must be publicly accessible, reproducible, and extensible by the communities they are meant to serve.

