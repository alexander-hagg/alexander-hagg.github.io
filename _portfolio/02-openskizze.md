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
---

<span class="tag-pill">DBU Funded</span>&nbsp;<span class="tag-pill">Urban Climate</span>&nbsp;<span class="tag-pill">Open Source</span>&nbsp;<span class="tag-pill">Quality Diversity</span>&nbsp;<span class="tag-pill">Surrogate Models</span>&nbsp;<span class="tag-pill">UMAP</span>

## Open-source AI for Climate-adapted Urban Design

Climate-adapted building requires knowledge that most planners don't have easy access to: which configurations keep cold air flowing into a neighbourhood? How do building heights interact with cold air corridors? Which density trade-offs actually matter for reducing urban heat?

**OpenSKIZZE** translates findings from climate models into concrete, usable design options — early in the planning process, before expensive expertise is typically called in.

## OpenSKIZZE 2.0 — Interactive QD Explorer {#interactive-demo}

Explore the generative quality-diversity design space directly in your browser — no installation required.

<p class="demo-jump"><a href="/openskizze-2.0.html" target="_blank" rel="noopener" class="btn btn--primary">⛶ Open full window</a></p>

<div class="openskizze-embed" style="margin:1rem 0;">
  <iframe src="/openskizze-2.0.html" title="OpenSKIZZE 2.0 — Interactive QD Explorer" loading="lazy" class="openskizze-embed__frame"></iframe>
</div>

The embedded view above is fully interactive. For presentations or a larger canvas, use the **⛶ Open full window** button to open the standalone version in a new tab.

<div class="blend-visual">
  <img src="/images/openskizze-visual.svg" alt="OpenSKIZZE urban planning tool interface" loading="lazy" decoding="async" />
</div>

---

### What is a quality-diversity archive?

A conventional optimizer keeps only the single best solution it finds. A **quality-diversity (QD) archive** keeps the best solution for *every* cell of a behaviour space — so instead of one answer, you get a diverse, structured collection of good answers.

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
