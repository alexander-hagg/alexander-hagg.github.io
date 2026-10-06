Contributions are welcome! Please add issues and make pull requests. There are no stupid questions. All ideas are welcome. This is a volunteer project. Be excellent to each other.

Fork from master and go from there. This repository is intended to remain a generic, ready-to-fork template that demonstrates the features of academicpages.

If you make a pull request and change code, please make sure there is a closed issue tagged with 'code change' that has some comment linking to either the single commit (if the change was just one commit) or a diff comparing before/after the change (see [issue 21](https://github.com/academicpages/academicpages.github.io/issues/21) for example). This is so that those who have forked this repo and modified it for their purposes can more easily patch bugs and new features.

---

## Interactive applet convention

Interactive demos ("applets") follow a small, consistent pattern so that new
ones are cheap to add and demo JavaScript only loads on the pages that use it.
The publication map (`_pages/publications.md` +
`assets/js/publications-explorer.js`) is a current reference implementation.

### 1. Demo container markup

Wrap the demo in a container element carrying the shared `.applet` class, and
give it an `id` and a `data-applet` name:

```html
<div id="my-demo" class="applet" data-applet="my-demo">
  <div class="demo-header">A short title bar</div>
  <div class="demo-topbar">
    <div class="demo-ctrl">
      <label for="my-demo-view">View</label>
      <select id="my-demo-view">...</select>
    </div>
  </div>
  <div class="demo-canvas-wrap">
    <canvas id="my-demo-canvas" role="img" aria-label="..."></canvas>
    <p class="demo-readout" role="status" aria-live="polite">…</p>
    <p class="demo-legend">…</p>
  </div>
</div>
```

The shared classes (`.demo-header`, `.demo-topbar`, `.demo-ctrl`,
`.demo-value`, `.demo-clear`, `.demo-canvas-wrap`, `.demo-readout`,
`.demo-legend`) are styled once in `_sass/_custom.scss`. Do not add new
per-demo styles inline; extend the shared block instead.

### 2. Per-page script include

Declare the demo's script(s) in the page's front matter; the loader in
`_includes/applet-scripts.html` (included by `_layouts/default.html`) emits the
`<script>` tags, so nothing ships on pages that do not declare them:

```yaml
applet_scripts:
  - /assets/js/my-demo.js
```

### 3. Optional global loader

To load a shared runtime on **every** page, list it under `applet_scripts` in
`_config.yml`. Leave it unset to ship nothing globally.

### 4. Shared CSS

Put applet styles in the "Interactive applets (demo framework)" section of
`_sass/_custom.scss`, keyed off `.applet` and the shared `demo-*` classes.

## Language tagging

The site mixes German and English posts. Tag every post with its language in
the front matter:

```yaml
lang: en   # or: de
```

A small language badge is rendered automatically on post pages and in archives
(`_includes/lang-indicator.html`), so visitors know the language before
clicking. Do not translate content — only tag it.
