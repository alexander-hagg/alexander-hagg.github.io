# Blockatlas — Viewer und Datensatz

Der Ordner enthält die Lab-Seite `index.html` (Canvas2D-Viewer, keine Bibliotheken)
und die Daten, die sie lädt. Die Seite läuft über eine Karte im Playground der
Startseite (`data-src="labs/blocks/index.html"`) und ist auch direkt aufrufbar.

Die Daten sind eine UMAP-Projektion von Straßenblöcken über 22 morphologische
Merkmale. Jeder Punkt ist ein Block; die Lage im Bild kodiert Ähnlichkeit, nicht
die Lage in der Stadt.

## Vier Dateien, die der Viewer erwartet

| Datei | Inhalt | Format |
| --- | --- | --- |
| `meta.json` | Anzahl und Merkmalsnamen | JSON-Objekt: `{"n": 42441, "cols": ["area", "n_bld", …]}` |
| `xy.bin` | Koordinaten der Projektion | `n × 2` `float32` (little endian), verschränkt `x, y, x, y, …` |
| `rgb.bin` | Farbe je Punkt | `n × 3` `uint8`, `r, g, b, r, g, b, …` |
| `points.json` | Attribute für den Tooltip | JSON-Array mit `n` Objekten, gleiche Reihenfolge wie `xy.bin` |

`preview.jpg` (1280 × 800) ist kein Eingabedatum, sondern das Vorschaubild der Karte
auf der Startseite.

### Reihenfolge ist die einzige Verbindung

Die vier Dateien kennen keine Schlüssel: Punkt *i* in `xy.bin` gehört zu Farbe *i*
in `rgb.bin` und zu Objekt *i* in `points.json`. Reihenfolge und `n` müssen exakt
zusammenpassen, sonst zeigt der Tooltip Daten des falschen Blocks.

### Eintrag in `points.json`

```json
{"a": 20682, "n": 32, "cov": 0.241, "h": 6.7, "c": "#c9a227"}
```

| Feld | Bedeutung |
| --- | --- |
| `a` | Blockfläche in m² (gerundet) |
| `n` | Anzahl Gebäude im Block |
| `cov` | Grundflächenanteil 0…1 (kann durch überlappende Gebäude am Blockrand über 1 liegen) |
| `h` | mittlere Gebäudehöhe in m oder `null`, wenn für den Block keine Höhenangabe existiert |
| `c` | Farbe als Hex-String — vom Viewer nicht gelesen (Farbe kommt aus `rgb.bin`), bleibt für andere Werkzeuge erhalten |

Der Viewer nutzt `a`, `n`, `cov` und `h`. Fehlt ein Feld, zeigt der Tooltip „undefined";
zusätzliche Felder sind erlaubt und werden ignoriert.

## Datensatz austauschen

Ein anderer Datensatz — ganz NRW, später Zensus — hat dieselbe Struktur. Eingesetzt
wird er, indem die vier Dateien ersetzt werden, ohne Code anzupassen:

1. **Erzeugen** (siehe unten) — Ergebnisse liegen in `~/.hermes/cache/scratch/blocks/`.
2. **Reihenfolge prüfen:** `xy.bin` muss mindestens `2 × n × 4` Byte groß sein, `rgb.bin`
   mindestens `3 × n` Byte, `points.json` mindestens `n` Einträge haben (`n` aus `meta.json`).
   Der Viewer bricht mit einer lesbaren Meldung ab, wenn das nicht stimmt.
3. **Kopieren:**

   ```bash
   DST=~/repositories/alexander-hagg.github.io/labs/blocks
   cp xy.bin rgb.bin meta.json "$DST/"
   python slim.py            # schreibt points.json direkt nach $DST
   python mkpreview_dark.py  # schreibt preview.jpg (1280×800) direkt nach $DST
   ```

4. **Texte angleichen:** Anzahl, Region und Stichjahr stehen an vier Stellen im
   Klartext — `figcaption` und Fußzeile in `labs/blocks/index.html`, dazu Titel und
   `aria-label` der Karte in `index.html`. Die Zahl in der Kopfzeile des Viewers
   („42.441 Blöcke · 22 Merkmale · 4 Dichteklassen") wird dagegen aus `meta.json`
   und `rgb.bin` berechnet und ist immer aktuell.

Der Startausschnitt wird aus den Daten bestimmt (kürzestes Intervall mit 96 % der
Punkte), Ausreißer liegen außerhalb und sind per Zoom erreichbar — auch dafür ist
keine Anpassung nötig.

**Was mitskaliert und was nicht:** Legende und Vorschaukarte gehen von den vier
Dichteklassen aus, die `03_umap.py` vergibt (`cov < 0,10 / 0,25 / 0,45 / darüber`).
Ändert man dort die Farb- oder Klassengrenzen, müssen Legende in `index.html` und
`mkpreview_dark.py` mitgezogen werden.

## Daten neu erzeugen

Venv: `~/venvs/blocks` (numpy, pandas, geopandas, duckdb, scikit-learn, umap-learn,
matplotlib). Skripte: `~/.hermes/cache/scratch/blocks/`.

```bash
source ~/venvs/blocks/bin/activate
cd ~/.hermes/cache/scratch/blocks

python 02_blocks.py   # Overture-Gebäude + Straßen → Blöcke → blocks_features.parquet
python 03_umap.py     # UMAP 0.6 → xy.bin, rgb.bin, meta.json, points.json, umap_preview.png
python slim.py        # points.json auf die Felder des Viewers kürzen, ins Repo schreiben
```

| Schritt | Eingabe | Ausgabe |
| --- | --- | --- |
| `02_blocks.py` | Overture Maps, Release `2026-10-21.0` (S3, Themes `buildings`, `transportation`) | `blocks.parquet`, `blocks_features.parquet`, `buildings.parquet`, `roads.parquet` (Cache) |
| `03_umap.py` | `blocks_features.parquet` | `umap.npz`, `xy.bin`, `rgb.bin`, `meta.json`, `points.json`, `umap_preview.png` |
| `slim.py` | `points.json` (Rohform) | `points.json` für den Viewer (nur `a, n, cov, h, c`) |
| `mkpreview_dark.py` | `xy.bin`, `rgb.bin`, `points.json`, `meta.json` | `preview.jpg`, 1280 × 800, dunkler Hintergrund |

Region und Stichjahr stehen oben in `02_blocks.py`:

```python
REL = "2026-10-21.0"
LON0, LON1, LAT0, LAT1 = 6.60, 7.50, 50.40, 51.10   # Rheinland; für NRW z. B. 5.85 – 9.50 / 50.30 – 52.55
TILE = 0.10      # Kachelgröße in Grad, darüber wird getegelt
MIN_AREA = 400.0 # m², darunter Restflächen
```

Für einen neuen Zuschnitt **die Cache-Dateien löschen** (`blocks.parquet`,
`blocks_features.parquet`, `buildings.parquet`, `roads.parquet`): `02_blocks.py`
springt sonst auf den vorhandenen Zwischenstand und rechnet die alten Kacheln weiter.
Für NRW wächst die Zahl der Blöcke auf ein Vielfaches; `points.json` ist der
Flaschenhals (aktuell 2,1 MB bei 42.441 Blöcken), `xy.bin` und `rgb.bin` bleiben klein
(8 bzw. 3 Byte je Block).

## Lokal ansehen

`fetch` funktioniert nicht über `file://`. Im Repo-Wurzelverzeichnis:

```bash
python3 -m http.server 8765
# http://127.0.0.1:8765/labs/blocks/index.html
```

Bedienung: ziehen = verschieben, Mausrad oder `+` / `−` = zoomen, Doppelklick oder
↻ = zurücksetzen, Zeigen oder Tippen = Tooltip, zwei Finger = zoomen.

## Quellen und Lizenzen

Die Geometrie stammt aus Overture Maps (Release `2026-10-21.0`), offene Daten unter
CDLA-Permissive-2.0; die aus OpenStreetMap abgeleiteten Teile stehen unter ODbL 1.0
(© OpenStreetMap-Mitwirkende). Geobasisdaten der Vermessungsverwaltungen, soweit im
Release enthalten, unter DL-DE-BY-2.0 (© Geobasis NRW). Dieselbe Nennung steht im
Fuß der Lab-Seite und sollte bei einem Datensatzwechsel mitgeprüft werden.
