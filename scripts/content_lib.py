"""
Shared helpers for migrating the github.io content into the new static site.
Development-time only: the generated HTML is the deliverable.
"""
from __future__ import annotations

import re
import html as html_lib
from pathlib import Path
from urllib.parse import urlsplit

import markdown
import yaml
from bs4 import BeautifulSoup

SITE = Path("/home/alex/Documents/repositories/omp")
SRC = Path("/tmp/hagg-site")
PREFIX = "../"
LIVE = "https://alexander-hagg.github.io"

COLLECTIONS = {
    "portfolio": ("_portfolio", "projects"),
    "publications": ("_publications", "research"),
    "posts": ("_posts", "writing"),
    "teaching": ("_teaching", "teaching"),
    "talks": ("_talks", "talks"),
}


def split_md(path: Path):
    text = Path(path).read_text(encoding="utf-8")
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            data = yaml.safe_load(parts[1]) or {}
            return data, parts[2].lstrip("\n")
    return {}, text


def slug_for(kind: str, fm: dict, path: Path) -> str:
    if kind == "portfolio":
        return str(fm.get("ref") or path.stem.split("-", 1)[-1])
    if kind in ("publications", "talks"):
        return str(fm.get("ref") or path.stem.split("-", 1)[-1])
    if kind == "teaching":
        permalink = str(fm.get("permalink") or "")
        if permalink:
            return permalink.rstrip("/").split("/")[-1]
        return path.stem
    if kind == "posts":
        permalink = str(fm.get("permalink") or "")
        if permalink:
            return permalink.rstrip("/").split("/")[-1]
        return path.stem
    return str(fm.get("ref") or path.stem)


def load_collection(kind: str):
    folder, _ = COLLECTIONS[kind]
    items = []
    for path in sorted((SRC / folder).glob("*.md")):
        fm, body = split_md(path)
        slug = slug_for(kind, fm, path)
        items.append({
            "kind": kind,
            "path": path,
            "fm": fm,
            "body": body,
            "slug": slug,
            "slug_path": f"{COLLECTIONS[kind][1]}/{slug}.html",
        })
    return items


PORTFOLIO = load_collection("portfolio")
PUBLICATIONS = load_collection("publications")
POSTS = load_collection("posts")
TEACHING = load_collection("teaching")
TALKS = load_collection("talks")

ALL_ITEMS = PORTFOLIO + PUBLICATIONS + POSTS + TEACHING + TALKS

LINK_MAP = {}


def _add_link(old: str, new: str):
    if not old:
        return
    for variant in {old, old.rstrip("/"), old.rstrip("/") + "/"}:
        LINK_MAP[variant] = new


for item in ALL_ITEMS:
    link = PREFIX + item["slug_path"]
    permalink = str(item["fm"].get("permalink") or "")
    if permalink:
        _add_link(permalink, link)
    for redirect in item["fm"].get("redirect_from") or []:
        _add_link(str(redirect), link)

for old, new in {
    "/": "index.html",
    "/about/": "index.html",
    "/portfolio/": "projects/index.html",
    "/publications/": "research/index.html",
    "/publication/": "research/index.html",
    "/teaching/": "teaching/index.html",
    "/talks/": "talks/index.html",
    "/year-archive/": "writing/index.html",
    "/posts/": "writing/index.html",
    "/cv/": "cv/index.html",
}.items():
    _add_link(old, PREFIX + new)

SECTION_INDEX = {
    "portfolio": PREFIX + "projects/index.html",
    "publications": PREFIX + "research/index.html",
    "posts": PREFIX + "writing/index.html",
    "teaching": PREFIX + "teaching/index.html",
    "talks": PREFIX + "talks/index.html",
}


def fmt_date(value, style="long"):
    s = str(value or "")
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if not m:
        return s
    year, month, day = (int(x) for x in m.groups())
    months = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"]
    if style == "year":
        return str(year)
    if style == "short":
        return f"{months[month - 1][:3]} {year}"
    return f"{months[month - 1]} {day}, {year}"


def image_url(name: str) -> str:
    name = str(name or "").strip()
    if not name:
        return ""
    if name.startswith("http") or name.startswith(PREFIX) or name.startswith("data:"):
        return name
    return PREFIX + "assets/images/" + name.lstrip("/")


def _rewrite_url(url: str) -> str:
    if not url:
        return url
    url = html_lib.unescape(url.strip())
    if url.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
        return url
    parts = urlsplit(url)
    if parts.scheme in ("http", "https") and parts.netloc not in ("alexander-hagg.github.io", "www.alexander-hagg.github.io"):
        return url
    if parts.netloc in ("alexander-hagg.github.io", "www.alexander-hagg.github.io"):
        url = parts.path + (("?" + parts.query) if parts.query else "") + (("#" + parts.fragment) if parts.fragment else "")
        parts = urlsplit(url)
    elif parts.scheme or parts.netloc:
        return url
    path, query, fragment = parts.path, parts.query, parts.fragment
    suffix = (("?" + query) if query else "") + (("#" + fragment) if fragment else "")

    if path.startswith("/images/"):
        return PREFIX + "assets/images/" + path[len("/images/"):] + suffix
    if path.startswith("/files/"):
        return LIVE + path + suffix
    if path in LINK_MAP:
        return LINK_MAP[path] + suffix
    if path.rstrip("/") in LINK_MAP:
        return LINK_MAP[path.rstrip("/")] + suffix
    if path.startswith("/"):
        # Unknown legacy page: keep it on the live site rather than breaking it.
        return LIVE + path + suffix
    return url


def _rewrite_srcset(value: str) -> str:
    out = []
    for part in value.split(","):
        bits = part.strip().split()
        if not bits:
            continue
        bits[0] = _rewrite_url(bits[0])
        out.append(" ".join(bits))
    return ", ".join(out)


def md_to_html(body: str, *, remove=None, keep_iframes=False) -> str:
    remove = remove or []
    body = re.sub(r"\{%\s*include[^%]*%\}", "", body)
    body = re.sub(r"\{%\s*[^%]*%\}", "", body)
    body = re.sub(r"\{\{[^}]*\}\}", "", body)
    body = re.sub(r"\{:[^}]*\}", "", body)

    converter = markdown.Markdown(
        extensions=["extra", "sane_lists", "toc", "attr_list", "md_in_html", "tables", "fenced_code"],
        output_format="html5",
    )
    raw = converter.convert(body)
    soup = BeautifulSoup(raw, "html.parser")

    for tag in soup.find_all("script"):
        tag.decompose()

    for iframe in soup.find_all("iframe"):
        src = iframe.get("src", "")
        if not keep_iframes:
            if "openskizze-2.0" in src:
                note = soup.new_tag("p")
                note["class"] = "embed-note"
                link = soup.new_tag("a", href=LIVE + "/openskizze-2.0.html")
                link.string = "Open the interactive OpenSKIZZE explorer ↗"
                note.append(link)
                iframe.replace_with(note)
            else:
                iframe.decompose()

    for sel in remove:
        for tag in soup.select(sel):
            tag.decompose()

    for a in soup.find_all("a", href=True):
        a["href"] = _rewrite_url(a["href"])
        if a["href"].startswith("http") and "alexander-hagg.github.io" not in a["href"]:
            a["target"] = "_blank"
            a["rel"] = "noopener"

    for img in soup.find_all("img"):
        if img.get("src"):
            img["src"] = _rewrite_url(img["src"])
        if img.get("srcset"):
            img["srcset"] = _rewrite_srcset(img["srcset"])
        for attr in ("align", "width", "height", "hspace", "vspace", "border"):
            if img.has_attr(attr):
                del img[attr]
        classes = img.get("class", [])
        if "content-image" not in classes:
            img["class"] = classes + ["content-image"]

    for source in soup.find_all("source"):
        if source.get("src"):
            source["src"] = _rewrite_url(source["src"])
        if source.get("srcset"):
            source["srcset"] = _rewrite_srcset(source["srcset"])

    return str(soup)


def esc(value) -> str:
    return html_lib.escape(str(value or ""), quote=True)


def page_head(title: str, description: str, *, extra_head: str = "") -> str:
    full_title = f"{title} — Alexander Hagg" if title and title != "Alexander Hagg" else "Alexander Hagg"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="theme-color" content="#0b0c0a">
<meta property="og:title" content="{esc(full_title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='15' fill='%230b0c0a'/%3E%3Ccircle cx='32' cy='32' r='12' fill='%23c9f26b'/%3E%3C/svg%3E">
<link rel="stylesheet" href="{PREFIX}assets/site.css">
{extra_head}
</head>"""


NAV_ITEMS = [
    ("projects", PREFIX + "projects/index.html", "Projects"),
    ("research", PREFIX + "research/index.html", "Research"),
    ("play", PREFIX + "index.html#playground", "Play"),
    ("writing", PREFIX + "writing/index.html", "Writing"),
    ("teaching", PREFIX + "teaching/index.html", "Teaching"),
    ("talks", PREFIX + "talks/index.html", "Talks"),
    ("cv", PREFIX + "cv/index.html", "CV"),
]


def header(current: str = "") -> str:
    links = []
    for key, href, label in NAV_ITEMS:
        cls = ' class="nav-play"' if key == "play" else ""
        current_attr = ' aria-current="page"' if key == current else ""
        data = f' data-nav="{key}"' if key != "play" else ""
        links.append(f'<a href="{href}"{cls}{data}{current_attr}>{label}</a>')
    nav = "\n      ".join(links)
    return f"""<a class="skip-link" href="#main">Skip to content</a>
<header class="site-head">
  <div class="wrap head-inner">
    <a class="brand" href="{PREFIX}index.html" aria-label="Alexander Hagg — home">
      <span class="brand-mark">AH<span>.</span></span>
      <span class="brand-name">Alexander Hagg</span>
    </a>
    <nav class="main-nav" id="mainNav" aria-label="Primary">
      {nav}
    </nav>
    <div class="head-actions">
      <a class="head-mail" href="mailto:alex@haggdesign.de">Email</a>
      <button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-controls="mainNav">Menu</button>
    </div>
  </div>
</header>"""


def footer() -> str:
    return f"""<footer class="site-foot">
  <div class="wrap foot-grid">
    <div class="foot-brand">
      <a class="brand" href="{PREFIX}index.html" aria-label="Alexander Hagg — home">
        <span class="brand-mark">AH<span>.</span></span>
      </a>
      <p>Researcher in AI &amp; optimization. Co-creative systems for complex, uncertain decisions — from urban climate to molecular design.</p>
      <p class="foot-loc">Bonn, Germany</p>
    </div>
    <div>
      <p class="foot-title">Pages</p>
      <nav class="foot-links" aria-label="Footer">
        <a href="{PREFIX}projects/index.html">Projects</a>
        <a href="{PREFIX}research/index.html">Research</a>
        <a href="{PREFIX}index.html#playground">Playground</a>
        <a href="{PREFIX}writing/index.html">Writing</a>
        <a href="{PREFIX}teaching/index.html">Teaching</a>
        <a href="{PREFIX}talks/index.html">Talks</a>
        <a href="{PREFIX}cv/index.html">CV</a>
      </nav>
    </div>
    <div>
      <p class="foot-title">Elsewhere</p>
      <nav class="foot-links" aria-label="Elsewhere">
        <a href="mailto:alex@haggdesign.de">alex@haggdesign.de</a>
        <a href="https://github.com/alexander-hagg" target="_blank" rel="noopener">GitHub ↗</a>
        <a href="https://www.linkedin.com/in/alexander-hagg-66185b4" target="_blank" rel="noopener">LinkedIn ↗</a>
        <a href="https://scholar.google.com/citations?user=hzKO-s8AAAAJ&amp;hl=en" target="_blank" rel="noopener">Google Scholar ↗</a>
      </nav>
    </div>
  </div>
  <div class="wrap foot-base">
    <span>© 2026 Alexander Hagg <span class="sep">·</span> Bonn, Germany</span>
    <span>Built with vanilla HTML / CSS / JS</span>
    <a href="#top">Back to top ↑</a>
  </div>
</footer>"""


def breadcrumb(items) -> str:
    parts = []
    for i, (label, href) in enumerate(items):
        if i:
            parts.append('<span>/</span>')
        if href:
            parts.append(f'<a href="{href}">{esc(label)}</a>')
        else:
            parts.append(f'<span aria-current="page">{esc(label)}</span>')
    return '<nav class="breadcrumb" aria-label="Breadcrumb">' + "".join(parts) + "</nav>"


def hero(*, eyebrow: str = "", title: str, lede: str = "", meta: str = "", crumbs: str = "", compact: bool = False, extra: str = "") -> str:
    cls = "page-hero page-hero--compact" if compact else "page-hero"
    return f"""<section class="{cls}">
  <div class="wrap">
    {crumbs}
    {f'<p class="section-label">{esc(eyebrow)}</p>' if eyebrow else ''}
    <h1>{title}</h1>
    {f'<p class="lede">{lede}</p>' if lede else ''}
    {meta}
    {extra}
  </div>
</section>"""


def page(*, title: str, description: str, section: str, hero_html: str, content: str,
         reading: bool = False, body_class: str = "", extra_head: str = "") -> str:
    progress = '<div class="read-progress" aria-hidden="true"><span></span></div>' if reading else ""
    return f"""{page_head(title, description, extra_head=extra_head)}
<body data-section="{esc(section)}" class="{esc(body_class)}" id="top">
{progress}
{header(section)}
<main id="main">
{hero_html}
<section class="page-body">
  <div class="wrap">
{content}
  </div>
</section>
</main>
{footer()}
<script src="{PREFIX}assets/site.js" defer></script>
</body>
</html>"""


def write_page(relative_path: str, html: str):
    out = SITE / relative_path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out


def item_link(item) -> str:
    return PREFIX + item["slug_path"]


def related_publications(fm: dict):
    refs = fm.get("related_publications") or []
    return [x for x in PUBLICATIONS if x["slug"] in refs]


def related_talks(fm: dict):
    refs = fm.get("related_talks") or []
    return [x for x in TALKS if x["slug"] in refs]


def related_portfolio(fm: dict):
    refs = fm.get("related_portfolio") or []
    return [x for x in PORTFOLIO if x["slug"] in refs]


if __name__ == "__main__":
    # Quick conversion smoke test (not part of the site build).
    sample = SRC / "_portfolio/02-openskizze.md"
    fm, body = split_md(sample)
    print(fm.get("title"), len(md_to_html(body)))
