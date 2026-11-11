import re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import content_lib as c
from bs4 import BeautifulSoup, NavigableString, Tag

fm, body = c.split_md(c.SRC / "_pages/cv.md")
# The generated publication/talk/teaching dumps at the end are replaced by links
# to their full new section pages.
body = re.split(r"\nPublications\s*\n=+", body)[0]
html_body = c.md_to_html(body, remove=["p.cv-downloads"])
soup = BeautifulSoup(html_body, "html.parser")

for p in soup.select("p.cv-downloads"):
    p.decompose()

# The hero already carries the summary; the source intro is redundant.
intro = soup.select_one(".cv-intro")
if intro:
    intro.decompose()

for tag in soup.find_all(style=True):
    del tag["style"]

# Section ids and jump navigation.
sections = []
for h2 in soup.find_all("h2"):
    text = h2.get_text(" ", strip=True)
    if not text:
        continue
    sid = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    h2["id"] = sid
    sections.append((sid, text))

# Remove any empty paragraphs left behind by Liquid.
for p in soup.find_all("p"):
    if not p.get_text(strip=True) and not p.find("img") and not p.find("iframe"):
        p.decompose()

explore = BeautifulSoup("""
<div class="cv-section" id="explore">
  <h2>Explore</h2>
  <p>The detailed archives behind this summary:</p>
  <div class="related-links">
    <a href="../research/index.html">All publications →</a>
    <a href="../projects/index.html">Case studies →</a>
    <a href="../teaching/index.html">Teaching &amp; supervision →</a>
    <a href="../talks/index.html">Talks &amp; presentations →</a>
    <a href="../index.html#playground">Playable prototypes →</a>
  </div>
</div>
""", "html.parser")
soup.append(explore)

jump = "".join(f'<a href="#{sid}">{text}</a>' for sid, text in sections)
content = f'''
<style>
.cv-layout{{display:grid;grid-template-columns:190px minmax(0,1fr);gap:clamp(32px,5vw,64px);align-items:start}}
.cv-nav{{position:sticky;top:96px;border-top:1px solid var(--line);padding-top:14px}}
.cv-nav p{{font-family:var(--mono);font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}}
.cv-nav a{{display:block;padding:5px 0;font-size:.82rem;line-height:1.35;color:var(--muted);transition:color .2s}}
.cv-nav a:hover{{color:var(--accent)}}
.cv-main .cv-section{{max-width:920px}}
.cv-main .cv-section:first-child{{margin-top:0}}
.cv-main a{{color:var(--accent);text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(201,242,107,.3)}}
.cv-main a:hover{{text-decoration-color:var(--accent)}}
.cv-main .cv-section > p{{color:var(--muted);font-size:.92rem;line-height:1.7;margin-bottom:14px}}
.cv-main .chip{{cursor:default}}
.cv-main .cv-section h2{{scroll-margin-top:96px}}
.cv-main .cv-section:last-child{{margin-bottom:0}}
@media(max-width:900px){{.cv-layout{{grid-template-columns:minmax(0,1fr)}}.cv-nav{{position:static;display:flex;flex-wrap:wrap;gap:4px 14px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:12px 0;margin-bottom:30px}}.cv-nav p{{width:100%;margin-bottom:4px}}.cv-nav a{{font-size:.8rem;padding:2px 0}}}}
</style>
<div class="cv-layout">
  <nav class="cv-nav" aria-label="CV sections">
    <p>On this page</p>
    {jump}
  </nav>
  <div class="cv-main">
    {str(soup)}
  </div>
</div>'''

hero = c.hero(
    eyebrow="Curriculum vitae",
    title="CV",
    lede="Dutch researcher in AI &amp; optimization with international experience in research, teaching and research management. Education, experience, skills, grants, supervision, service and languages — plus the path through them.",
    crumbs=c.breadcrumb([("Home", "../index.html"), ("CV", None)]),
    meta='<div class="hero-meta"><span>Bonn, Germany</span><span class="dot"></span><span>Dutch · German · English</span><span class="dot"></span><span>AI &amp; optimization</span></div>',
    extra='<div class="btn-row"><a class="btn btn--solid" href="mailto:alex@haggdesign.de">Email me</a><a class="btn" href="../projects/index.html">See the projects</a><a class="btn" href="../research/index.html">Research</a></div>'
)
html = c.page(
    title="CV",
    description="Curriculum vitae of Dr. Alexander Hagg — education, research experience, skills, grants, supervision, service and languages.",
    section="cv",
    hero_html=hero,
    content=content,
)
c.write_page("cv/index.html", html)
print("cv/index.html", len(html), "sections", sections)
