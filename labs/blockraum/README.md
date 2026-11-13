# Blockraum — Straßenblöcke als 3D-Wolke

42 441 Straßenblöcke des Rheinlands (Bonn, Köln, Rhein-Sieg, Euskirchen, Leverkusen, Düren),
angeordnet nach 22 Morphologie-Merkmalen in drei Dimensionen. Jeder Punkt ist ein Block.
Die 64 Medoide eines k-means über dieselbe Merkmalsmatrix stehen dauerhaft als echte
Gebäudekörper im Raum; kommt die Kamera näher, baut sich die Umgebung aus weiteren
Blockkörpern auf.

Seite: `index.html` (three.js 0.169 per esm.sh, keine Build-Kette).

## Daten

| | |
|---|---|
| Blöcke gesamt (mit Gebäuden) | 42 441 von 68 473 erzeugten Blöcken |
| Gebäude im Gebiet | 1 576 322 (Overture, EPSG:4326 → 3035 projiziert) |
| Repräsentanten | 64 (k-means, k=64, Medoid je Cluster) |
| Stichprobe mit Geometrie | 15 043 Blöcke (64 Repräsentanten + 15 000 stratifiziert), 499 985 Gebäude |
| Ordner gesamt | 9,6 MB |

Stratifiziert heißt: je k-means-Cluster proportional viele Blöcke, damit jede Region der
Einbettung Geometrie hat — nicht nur der dichte Kern.

## Dateien

| Datei | Inhalt | Größe |
|---|---|---|
| `xyz.bin` | float32, 3 Werte je Block (42 441 × 3), Reihenfolge = Index in `meta.json` | 509 KB |
| `rgb.bin` | uint8, 3 Werte je Block, Farbe nach Grundflächenanteil `cov` | 127 KB |
| `meta.json` | `{n, k, cols, repidx, a[], g[], c[], h[], b[]}` — Fläche (m²), Gebäudezahl, Überbauung, mittlere Höhe, Blocknummer | 1,0 MB |
| `geom.bin` | geblockter Binärpuffer mit Umriss + Gebäudekörpern, 15 043 Blöcke | 7,1 MB |
| `geom_index.json` | spaltenweiser Index: `i` (Punktindex), `b` (Blocknummer), `rep` (0/1), `off`, `len`, `ox`, `oz` | 682 KB |
| `preview.jpg` | Screenshot der Startansicht | 61 KB |

### `geom.bin` — Format

Little endian, je Block ein Abschnitt `[off, off+len)`:

```
uint16  n_out                 Stützpunkte des Blockumrisses
uint16  ostep_cm              Schrittweite des Umrisses in cm
int8×2  (x, z) × n_out        Umriss, relativ zum Ursprung (ox, oz) × ostep
uint16  n_bld                 Gebäude im Block
je Gebäude:
  uint8   nv                  Stützpunkte, 3…8
  uint8   h_half              Höhe in 0,5-m-Schritten (0…240 → 0…120 m)
  uint8   bstep_q             Schrittweite dieses Gebäudes: bstep_q × 0,25 m
  int8×2  (x0, z0)            erster Stützpunkt, relativ zu (ox, oz) × ostep
  int8×2  (dx, dz) × (nv-1)   weitere Stützpunkte, relativ zu (x0, z0) × bstep
```

Meter-Koordinaten also `x = ox + x0·ostep + dx·bstep`. Die int8-Kodierung mit block- bzw.
gebäudeweiser Schrittweite hält 500 000 Gebäude unter 10 MB; die Auflösung liegt bei 0,25 m
(Gebäude) und 0,5–5 m (Blockumriss, je nach Blockgröße).

Aufbereitung der Gebäude: Schwerpunkt im Block (`gpd.sjoin` auf Schwerpunkten, ein Join für
alle 1,6 Mio. Gebäude), Douglas-Peucker 0,5 m, auf maximal 8 Stützpunkte ausgedünnt,
Höhe = `height`, sonst `num_floors × 3,2`, sonst 8 m, geklemmt auf 0–120 m, danach auf den
Blockumriss zugeschnitten (ein Gebäude kann mit seinem Schwerpunkt im Block liegen und weit
darüber hinausragen).

## 3D-Einbettung

UMAP 0.6, neue Pipeline, auf derselben Merkmalsmatrix wie `03_umap.py`
(Log-Transformation für schiefe Merkmale, `StandardScaler`, `h_missing`-Flag, `per` nicht
zusätzlich zu `edge_ratio`):

```python
umap.UMAP(n_neighbors=30, min_dist=0.05, n_components=3, metric="euclidean",
          compatibility_layout=False, init="recursive", optimizer="adam",
          repulsion_strength=1.5, random_state=42)
```

Die drei Achsen sind keine Stadtkoordinaten: Nähe bedeutet Ähnlichkeit in Fläche,
Geschossflächenzahl, Überbauung, Höhenverteilung und Umrissform (Seitenverhältnis,
Ausrichtung, Solidität, Konvexität, Fourier-Harmonische fd2…fd5).

## Viewer

- **Wolke:** `THREE.Points`, Farbe nach `cov` (grün < 10 %, gelb 10–25 %, orange 25–45 %,
  rot > 45 %), Punktgröße und Deckkraft folgen dem Kameraabstand.
- **Repräsentanten:** 64 extrudierte Körper, dauerhaft sichtbar, mit Blocknummer als Sprite.
- **Level of Detail:** Körper erscheinen erst, wenn die Kamera näher als 90 % des
  Startabstands ist, und dann gestaffelt — 150 Körper unter 78 %, 400 unter 60 %, 800 unter
  45 %, volle Stufe unter 30 %. Ausgewählt werden die Blöcke im Blickfeld, nächste zuerst.
  Hartes Budget: **1500 Körper gleichzeitig**.
- **Bremse:** Fällt der FPS-Zähler unter 30, sinkt das Budget um 20 % (Untergrenze 150);
  über 50 fps wächst es wieder in 25er-Schritten.
- **Hover:** Raycasting auf Wolke und Körper, Tooltip mit Blocknummer, Fläche, Gebäudezahl,
  Überbauung, mittlerer Höhe.
- Höhen sind in der Darstellung **2-fach überhöht** (die Datei enthält echte Höhen), sonst
  sieht man bei 300-m-Blöcken nur Dächer.

`window.__stats` gibt live `{fps, bodies, buildings, budget, quota, cameraDist, level}` aus —
nützlich, um die Drosselung nachzumessen.

## Reproduktion

Alles liegt in `/home/alex/.hermes/cache/scratch/blocks/`; Interpreter ist
`~/venvs/blocks/bin/python` (duckdb 2.0, geopandas 1.2, umap 0.6, scikit-learn).

```bash
cd /home/alex/.hermes/cache/scratch/blocks
~/venvs/blocks/bin/python 10_umap3d.py   # 3D-UMAP + k-means-Medoide → xyz.bin, rgb3.bin, meta3.json
~/venvs/blocks/bin/python 11_geom.py     # Gebäude je Block → geom.bin, geom_index.json  (~50 s)
~/venvs/blocks/bin/python 12_meta.py     # schlankes meta.json
cp xyz.bin geom.bin geom_index.json meta.json /home/alex/repositories/alexander-hagg.github.io/labs/blockraum/
```

`10_umap3d.py` braucht auf dieser Maschine rund zwei Minuten, `11_geom.py` etwa 50 Sekunden.
Die Rohdaten (`blocks_features.parquet`, `blocks.parquet`, `buildings.parquet`) stammen aus
`02_blocks.py` (Overture-Release 2026-10-21.0).
