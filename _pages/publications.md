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

<p class="section-header">Publications</p>

{% for post in site.publications reversed %}
  {% include archive-single.html %}
{% endfor %}


