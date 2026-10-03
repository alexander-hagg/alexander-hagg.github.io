---
layout: archive
title: "Research"
permalink: /publications/
author_profile: true
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
      <article class="pub-item" data-year="{{ group.name }}" data-tags="{{ post.tags | join: ' ' | slugify }}">
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
      var okTheme = state.theme === 'all' || (item.getAttribute('data-tags') || '').indexOf(state.theme) !== -1;
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
