---
layout: archive
title: "Research"
permalink: /publications/
author_profile: true
applet_scripts:
  - /assets/js/publications-explorer.js
---

{% include base_path %}

<p>
Full list also on
<a href="https://scholar.google.com/citations?user=hzKO-s8AAAAJ&hl=en&oi=ao">Google Scholar</a>
and
<a href="https://www.researchgate.net/profile/Alexander-Hagg">ResearchGate</a>.
</p>

{% assign pubs_by_year = site.publications | group_by_exp: "post", "post.date | date: '%Y'" | sort: "name" | reverse %}
{% assign theme_list = site.publications | map: "tags" | join: "," | split: "," | uniq | sort %}

<p class="section-header" id="publication-map">Publication map</p>

<p>
Explore the publications interactively. Each dot is one publication, positioned by
<strong>year</strong> (horizontal axis) and <strong>primary theme</strong> (vertical axis).
<strong>Hover, tap, or use the keyboard</strong> (arrow keys to move, Enter to open, Escape to clear)
to inspect a publication, and use the filters to narrow the map. This is a deterministic
thematic layout — not a computed embedding.
</p>

<div id="pub-explorer" class="applet" data-applet="publications-explorer">
  <div class="demo-header">Publication map · year × theme</div>
  <div class="demo-topbar">
    <div class="demo-ctrl">
      <label for="pub-explorer-year">Year</label>
      <select id="pub-explorer-year">
        <option value="all">All years</option>
        {% for group in pubs_by_year %}
          <option value="{{ group.name }}">{{ group.name }}</option>
        {% endfor %}
      </select>
    </div>
    <div class="demo-ctrl">
      <label for="pub-explorer-theme">Theme</label>
      <select id="pub-explorer-theme">
        <option value="all">All themes</option>
        {% for theme in theme_list %}
          <option value="{{ theme | slugify }}">{{ theme }}</option>
        {% endfor %}
      </select>
    </div>
    <div class="demo-ctrl">
      <button type="button" id="pub-explorer-reset" class="demo-clear">Reset</button>
    </div>
  </div>
  <div class="demo-canvas-wrap">
    <canvas id="pub-explorer-canvas" width="760" height="440"
            role="application"
            tabindex="0"
            aria-label="Publication map: each dot is a publication, positioned by year on the horizontal axis and primary theme on the vertical axis."
            aria-describedby="pub-explorer-desc"></canvas>
    <p id="pub-explorer-desc" class="visually-hidden">An interactive map of the site's publications. The horizontal axis is the publication year and the vertical axis is the publication's primary theme. Each dot is one publication. Hover, tap, or click a dot to inspect it; the selection persists. With the canvas focused, use the arrow keys to move through the publications, Enter to open the selected publication page, and Escape to clear the selection. A text readout and a detail panel below the canvas report the selected publication's title, authors, venue, year, and tags. Year and theme filters narrow the map.</p>
    <p id="pub-explorer-readout" class="demo-readout" role="status" aria-live="polite">No publication selected. Hover, tap, or use the arrow keys to inspect a publication.</p>
    <div id="pub-explorer-detail" class="demo-detail" aria-live="polite"></div>
    <p class="demo-legend">
      <strong>How to read it:</strong> dots further right are more recent; dots higher up belong to a different primary theme (labelled on the left). The selected dot is marked with a black ring and cross, so the selection does not rely on colour alone.
    </p>
  </div>
</div>

{% assign qq = '&' | append: 'quot;' %}
<script type="application/json" id="pub-explorer-data">
[
{% for post in site.publications %}
  {
    "title": {{ post.title | jsonify }},
    "authors": {{ post.citation | split: qq | first | strip | jsonify }},
    "venue": {{ post.venue | jsonify }},
    "year": {{ post.date | date: "%Y" | jsonify }},
    "tags": {{ post.tags | jsonify }},
    "url": {{ post.url | relative_url | jsonify }}
  }{% unless forloop.last %},{% endunless %}
{% endfor %}
]
</script>

<noscript><style>.pub-filter{display:none;}</style></noscript>

<div class="pub-filter" id="pub-filter" role="group" aria-label="Filter publications">
  <div class="pub-filter__row">
    <span class="pub-filter__label">Year</span>
    <button type="button" class="pub-filter__btn is-active" data-filter="year" data-value="all">All</button>
    {% for group in pubs_by_year %}
      <button type="button" class="pub-filter__btn" data-filter="year" data-value="{{ group.name }}">{{ group.name }}</button>
    {% endfor %}
  </div>
  <div class="pub-filter__row">
    <span class="pub-filter__label">Theme</span>
    <button type="button" class="pub-filter__btn is-active" data-filter="theme" data-value="all">All</button>
    {% for theme in theme_list %}
      <button type="button" class="pub-filter__btn" data-filter="theme" data-value="{{ theme | slugify }}">{{ theme }}</button>
    {% endfor %}
  </div>
  <p class="pub-filter__status" id="pub-filter-status" aria-live="polite"></p>
</div>

<div class="pub-list" id="pub-list">
{% for group in pubs_by_year %}
  <section class="pub-year" data-year="{{ group.name }}">
    <h2 class="pub-year__heading">{{ group.name }}</h2>
    {% for post in group.items %}
      <article class="pub-item" data-year="{{ group.name }}" data-tags="|{% for tag in post.tags %}{{ tag | slugify }}|{% endfor %}">
        <h3 class="pub-item__title"><a href="{{ post.url }}">{{ post.title }}</a></h3>
        <p class="pub-item__meta">Published in <i>{{ post.venue }}</i>, {{ post.date | date: "%Y" }}</p>
        {% if post.tags %}
          <p class="pub-item__tags">{% for tag in post.tags %}<span class="tag-pill tag-pill--sm">{{ tag }}</span>{% endfor %}</p>
        {% endif %}
      </article>
    {% endfor %}
  </section>
{% endfor %}
</div>

<script>
(function () {
  var filter = document.getElementById('pub-filter');
  if (!filter) return;
  var items = Array.prototype.slice.call(document.querySelectorAll('.pub-item'));
  var years = Array.prototype.slice.call(document.querySelectorAll('.pub-year'));
  var status = document.getElementById('pub-filter-status');
  var state = { year: 'all', theme: 'all' };

  function apply() {
    var visible = 0;
    items.forEach(function (item) {
      var okYear = state.year === 'all' || item.getAttribute('data-year') === state.year;
      var okTheme = state.theme === 'all' || (item.getAttribute('data-tags') || '').indexOf('|' + state.theme + '|') !== -1;
      var show = okYear && okTheme;
      item.hidden = !show;
      if (show) visible++;
    });
    years.forEach(function (section) {
      var any = section.querySelectorAll('.pub-item:not([hidden])').length > 0;
      section.hidden = !any;
    });
    if (status) {
      status.textContent = visible + ' publication' + (visible === 1 ? '' : 's') + ' shown';
    }
  }

  filter.addEventListener('click', function (e) {
    var btn = e.target.closest('.pub-filter__btn');
    if (!btn) return;
    var kind = btn.getAttribute('data-filter');
    state[kind] = btn.getAttribute('data-value');
    filter.querySelectorAll('.pub-filter__btn[data-filter="' + kind + '"]').forEach(function (b) {
      b.classList.toggle('is-active', b === btn);
    });
    apply();
  });

  apply();
})();
</script>
