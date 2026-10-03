---
title: 'Spiegelmaschine'
date: 2022-06-08
ref: spiegelmaschine-post
lang: en
permalink: /posts/2022/06/spiegelmaschine/
related_portfolio:
  - spiegelmaschine
redirect_from:
  - /posts/2022/08/spiegelmaschine/
tags:
  - generative art
  - artificial intelligence
  - interaction
applet_scripts:
  - /assets/js/spiegelmaschine-toy.js
---

<img align="left" src="/images/sm01.png" width="600" height="341" loading="lazy" decoding="async"
     srcset="/images/sm01-480w.png 480w, /images/sm01-960w.png 960w, /images/sm01.png 1216w"
     sizes="(max-width: 640px) 100vw, 600px"
     alt="A generated abstract painting from the Spiegelmaschine, trained on works by Steffen Terk">

The Spiegelmaschine project aims to provide an interactive model between painter and machine. The Spiegelmaschine is trained on 1000 paintings by [Steffen Terk](http://steffenterk.com/). 

An interface provides the ability to generate large numbers of random paintings that look like Steffen went into overdrive. 

The Spiegelmaschine even has its own [Twitter account](https://twitter.com/spiegelmaschine), so be sure to follow the machine, if you are interested.


<img align="left" src="/images/sm05.png" width="300" height="297" loading="lazy" decoding="async"
     srcset="/images/sm05-480w.png 480w, /images/sm05.png 680w"
     sizes="(max-width: 640px) 100vw, 300px"
     alt="Generated painting from the Spiegelmaschine series">
<img align="right" src="/images/sm06.jpeg" width="300" height="300" loading="lazy" decoding="async"
     srcset="/images/sm06-480w.jpeg 480w, /images/sm06.jpeg 680w"
     sizes="(max-width: 640px) 100vw, 300px"
     alt="Generated painting from the Spiegelmaschine series">
<img align="left" src="/images/sm07.jpeg" width="300" height="225" loading="lazy" decoding="async"
     srcset="/images/sm07-480w.jpeg 480w, /images/sm07.jpeg 680w"
     sizes="(max-width: 640px) 100vw, 300px"
     alt="Generated painting from the Spiegelmaschine series">
<img align="right" src="/images/sm08.jpeg" width="300" height="300" loading="lazy" decoding="async"
     srcset="/images/sm08-480w.jpeg 480w, /images/sm08.jpeg 512w"
     sizes="(max-width: 640px) 100vw, 300px"
     alt="Generated painting from the Spiegelmaschine series">
<img align="left" src="/images/sm09.jpeg" width="300" height="300" loading="lazy" decoding="async"
     srcset="/images/sm09-480w.jpeg 480w, /images/sm09.jpeg 512w"
     sizes="(max-width: 640px) 100vw, 300px"
     alt="Generated painting from the Spiegelmaschine series">
<img align="right" src="/images/sm10.jpeg" width="300" height="300" loading="lazy" decoding="async"
     srcset="/images/sm10-480w.jpeg 480w, /images/sm10.jpeg 680w"
     sizes="(max-width: 640px) 100vw, 300px"
     alt="Generated painting from the Spiegelmaschine series">
<img align="left" src="/images/sm11.png" width="300" height="320" loading="lazy" decoding="async"
     srcset="/images/sm11-480w.png 480w, /images/sm11.png 502w"
     sizes="(max-width: 640px) 100vw, 300px"
     alt="Generated painting from the Spiegelmaschine series">

<div class="clear-both" aria-hidden="true"></div>

## Try the Spiegelmaschine

The images above are static, but the *idea* behind the Spiegelmaschine is interactive: a machine that mirrors and multiplies an artist's visual language. The toy below is a small, self-contained homage — a seeded kaleidoscope. Change the **symmetry order**, **complexity**, **seed**, and **palette**, or press **Regenerate** for a new composition. The same seed always produces the same image.

<div id="spiegelmaschine-toy" class="applet" data-applet="spiegelmaschine-toy">
  <div class="demo-header">Spiegelmaschine · seeded kaleidoscope</div>
  <div class="demo-topbar">
    <div class="demo-ctrl">
      <label for="spiegel-symmetry">Symmetry &nbsp;<span class="demo-value" id="spiegel-val-symmetry">6</span>×</label>
      <input type="range" id="spiegel-symmetry" min="2" max="12" value="6" step="1">
    </div>
    <div class="demo-ctrl">
      <label for="spiegel-complexity">Complexity &nbsp;<span class="demo-value" id="spiegel-val-complexity">24</span></label>
      <input type="range" id="spiegel-complexity" min="5" max="60" value="24" step="1">
    </div>
    <div class="demo-ctrl">
      <label for="spiegel-seed">Seed</label>
      <input type="number" id="spiegel-seed" value="12345" min="1" max="999999" step="1">
    </div>
    <div class="demo-ctrl">
      <label for="spiegel-palette">Palette</label>
      <select id="spiegel-palette">
        <option value="terracotta">Terracotta</option>
        <option value="midnight">Midnight</option>
        <option value="garden">Garden</option>
        <option value="sunset">Sunset</option>
        <option value="mono">Mono</option>
      </select>
    </div>
    <div class="demo-ctrl">
      <button type="button" id="spiegel-regenerate" class="demo-clear">Regenerate</button>
    </div>
    <div class="demo-ctrl">
      <button type="button" id="spiegel-reset" class="demo-clear">Reset</button>
    </div>
  </div>
  <div class="demo-canvas-wrap">
    <canvas id="spiegel-canvas" width="760" height="460"
            role="img"
            aria-label="A generated mirror-symmetric kaleidoscope composition."
            aria-describedby="spiegel-readout"></canvas>
    <p id="spiegel-readout" class="demo-readout" role="status" aria-live="polite">Kaleidoscope with 6-fold mirror symmetry, 24 shapes, palette “Terracotta”, seed 12345.</p>
    <p class="demo-legend">
      <strong>How to use it:</strong> adjust the controls to change the composition; <strong>Regenerate</strong> picks a new random seed and <strong>Reset</strong> restores the defaults. The composition is deterministic — the same seed and settings always produce the same image.
    </p>
  </div>
</div>
