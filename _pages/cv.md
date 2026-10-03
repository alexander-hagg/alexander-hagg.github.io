---
layout: archive
title: "CV"
permalink: /cv/
author_profile: true
redirect_from:
  - /resume
---

{% include base_path %}

<div class="cv-embed">
  <object data="{{ base_path }}/files/Hagg_Alexander_CV_Academic.pdf" type="application/pdf" aria-label="Alexander Hagg — academic CV (PDF)">
    <p class="cv-embed__fallback">Your browser cannot display embedded PDFs. <a href="{{ base_path }}/files/Hagg_Alexander_CV_Academic.pdf">Download the academic CV (PDF)</a>.</p>
  </object>
</div>

<p class="cv-downloads">
  <a class="btn" href="{{ base_path }}/files/Hagg_Alexander_CV_Academic.pdf">Download academic CV (PDF)</a>
  <a class="btn" href="{{ base_path }}/files/Hagg_Alexander_CV_EN.pdf">Download CV — English (PDF)</a>
  <a class="btn" href="{{ base_path }}/files/Hagg_Alexander_CV_DE.pdf">Download CV — Deutsch (PDF)</a>
</p>

Publications
======
  <ul>{% for post in site.publications %}
    {% include archive-single-cv.html %}
  {% endfor %}</ul>
  
Talks
======
  <ul>{% for post in site.talks %}
    {% include archive-single-talk-cv.html %}
  {% endfor %}</ul>
  
Teaching
======
  <ul>{% for post in site.teaching %}
    {% include archive-single-cv.html %}
  {% endfor %}</ul>
  
