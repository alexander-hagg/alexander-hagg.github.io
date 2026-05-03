---
title: "DoVE — Evolutionary Design of Aerodynamic Vehicle Bodies"
excerpt: "Evolving 3D aerodynamic velomobile bodies using neural indirect encodings and real-world drag analysis via computer vision."
collection: portfolio
permalink: /portfolio/p-dove/
tags: [evolutionary algorithms, aerodynamics, CPPN, computer vision, generative design]
---

<span class="tag-pill">2014–2018</span>&nbsp;<span class="tag-pill">Evolutionary Algorithms</span>&nbsp;<span class="tag-pill">3D Shape Optimisation</span>&nbsp;<span class="tag-pill">Computer Vision</span>

## DoVE — Development of Vehicle Exteriors

**DoVE** explored automated design of 3D aerodynamic objects. Using velomobile bodywork as a testbed, the project developed methods for evolving stable, lightweight, aerodynamically efficient shapes — without relying on expert engineering knowledge.

### Why velomobiles?

The velomobile design community is driven by hobbyists and small companies whose trial-and-error process has produced highly non-intuitive but outstanding shapes (e.g., the Milan velomobile). This suggests a large, unexplored design space that conventional engineering intuition cannot reach — a perfect target for evolutionary exploration.

### Technical approach

- **Neural indirect encodings (CPPNs/HyperNEAT)** — evolved to generate entire 3D geometries holistically, allowing non-local, highly complex shape changes
- Techniques originally developed for evolving large neural networks, repurposed for 3D form generation
- Integration with CFD evaluation for fitness assessment

### DoVE-Tales: Real-World Drag Testing

A second strand extracted aerodynamic models from real-world footage:

- **Tufts** (yarn/wool indicators) attached to aerodynamic base shapes
- Computer vision analysis of tuft position, orientation, and deformation over time
- ML models deriving full quantitative aerodynamic characterisation from tuft behaviour
- Enabling realistic comparison tests and design analysis under actual road conditions

### Partners

Prof. Alexander Asteroth (lead), Prof. Ernst Kruijff — H-BRS / TREE.

[DoVE project page at H-BRS](https://www.h-brs.de/de/dove){: .btn}
