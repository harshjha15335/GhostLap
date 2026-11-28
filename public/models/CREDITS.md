# 3D Model and Asset Credits

## 3D Car Design References
- **Model**: "2026 Mercedes W17"
- **Author**: Dave Love / Tyler_Dave (https://sketchfab.com/Tyler_Dave)
- **Source**: https://sketchfab.com/3d-models/2026-mercedes-w17-b806f1e70aa343219e7158169549b97b
- **License**: Creative Commons Attribution (CC-BY 4.0) (http://creativecommons.org/licenses/by/4.0/)
- **Usage**: The car model shown on every page. Decimated into three LODs (`w17-high/mid/low.glb`,
  built by `scripts/models/build-w17.mjs`), split into sub-assemblies for the exploded view, and
  re-skinned with each team's livery (other teams' liveries are GhostLap modifications, not the
  author's work). Modified from the original.

- **Model**: "F1 2026 concept (polygon model)"
- **Author**: Qvist_designs (https://sketchfab.com/Qvist_designs)
- **Source**: https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42
- **License**: Creative Commons Attribution (CC-BY 4.0) (http://creativecommons.org/licenses/by/4.0/)
- **Usage**: Reference proportions, aerodynamic sub-assemblies, and regulation contours for GhostLap 2026's procedural 3D model.

## Safety Car
- **Model**: "sedan-sports" from the **Car Kit** (v3.1)
- **Author**: Kenney (https://www.kenney.nl) — https://kenney.nl/assets/car-kit
- **License**: Creative Commons Zero (CC0 1.0) (http://creativecommons.org/publicdomain/zero/1.0/) — attribution not required, given with thanks
- **Usage**: `safety-car/safety-car.glb` (~22 KB, 1 primitive), the Race Lab safety car. Built by
  `scripts/models/build-safety-car.mjs`: palette texture baked to vertex colours, red body
  swatches repainted silver, meshes joined, meshopt-compressed. The light bar and "SAFETY CAR"
  lettering are added at runtime; no manufacturer or sponsor marks. (The real 2026 FIA safety
  cars are Mercedes-AMG road cars; GhostLap shows one generic coupé.)

## Albert Park (Melbourne) 2026 Circuit Environment
- **Map & Surroundings Data**: OpenStreetMap contributors (https://www.openstreetmap.org/copyright)
- **License**: Open Database License (ODbL 1.0) — "© OpenStreetMap contributors"
- **Usage**: Albert Park Lake & island outlines, sports ovals, Albert Park Golf Course, park roads/paths, Lakeside Stadium/MSAC/park buildings, St Kilda Road & Melbourne CBD skyline footprints/heights, boatsheds/jetties, and parkland tree locations extracted via `scripts/circuits/build_albert_park.py`.

- **3D Visual Reference**: "melbourne circuit"
- **Author**: amogusstrikesback2 (https://sketchfab.com/amogusstrikesback2)
- **Source**: https://sketchfab.com/3d-models/melbourne-circuit-747e7406b356449a83bbeb612264f4da
- **License**: Creative Commons Attribution (CC-BY 4.0) (http://creativecommons.org/licenses/by/4.0/)
- **Usage**: Visual reference for pit building, grandstand proportions, and lakeside massing (original mesh not shipped).

- **3D Visual Reference**: "Albert Park Circuit Melbourne 2018 layout"
- **Author**: Dave Love SketchFab (https://sketchfab.com/Tyler_Dave)
- **Source**: https://sketchfab.com/3d-models/albert-park-circuit-melbourne-2018-layout-98baf7817404430f9caaa5cee7a1c7a7
- **License**: Creative Commons Attribution (CC-BY 4.0) (http://creativecommons.org/licenses/by/4.0/)
- **Usage**: Visual reference for lakeside proportions only (pre-2021 layout and legacy signage not copied; original mesh not shipped).

### 2026 Trackside Partner Logo Atlas (`public/models/circuits/melbourne/ads.webp` & `ads_low.webp`)
Rasterised via `scripts/circuits/build_albert_park_logos.py` from official SVG files on Wikimedia Commons (trademarks belong to their respective owners; used for historical/editorial motorsport depiction of the 2026 Australian Grand Prix):

| Brand | Source (Wikimedia Commons) | Licence / Note |
| --- | --- | --- |
| **Qatar Airways** | https://commons.wikimedia.org/wiki/File:Qatar_Airways_logo.svg | Public domain (below threshold of originality) / trademark |
| **Formula 1** | https://commons.wikimedia.org/wiki/File:F1.svg | Public domain (below threshold of originality) / trademark |
| **Pirelli** | https://commons.wikimedia.org/wiki/File:Pirelli_-_logo_full_(Italy,_1997).svg | Public domain (below threshold of originality) / trademark |
| **Saudi Aramco** | https://commons.wikimedia.org/wiki/File:Saudi_aramco_logo.svg | Public domain (below threshold of originality) / trademark |
| **DHL** | https://commons.wikimedia.org/wiki/File:DHL_Logo.svg | Public domain (below threshold of originality) / trademark |
| **Heineken** | https://commons.wikimedia.org/wiki/File:Heineken_logo.svg | Public domain (below threshold of originality) / trademark |
| **Lenovo** | https://commons.wikimedia.org/wiki/File:Lenovo_logo_2015.svg | Public domain (below threshold of originality) / trademark |
| **LVMH** | https://commons.wikimedia.org/wiki/File:LVMH_logo.svg | Public domain (below threshold of originality) / trademark |
| **TAG Heuer** | https://commons.wikimedia.org/wiki/File:TAG_Heuer_Logo.svg | Public domain (below threshold of originality) / trademark |
| **MSC Cruises** | https://commons.wikimedia.org/wiki/File:MSC_Cruises_de_logo.svg | Public domain (below threshold of originality) / trademark |
| **Amazon Web Services (AWS)** | https://commons.wikimedia.org/wiki/File:Amazon_Web_Services_Logo.svg | Apache License 2.0 / trademark |
| **Salesforce** | https://commons.wikimedia.org/wiki/File:Salesforce.com_logo.svg | Public domain (below threshold of originality) / trademark |
| **American Express** | https://commons.wikimedia.org/wiki/File:American_Express_logo_(2018).svg | Public domain (below threshold of originality) / trademark |
| **Crypto.com** | Text fallback (no verified official SVG on Wikimedia Commons) | Rendered in plain bold sans-serif typography |


## Shanghai International Circuit (2026 Chinese GP) Environment
- **Map & Surroundings Data**: OpenStreetMap contributors (https://www.openstreetmap.org/copyright)
- **License**: Open Database License (ODbL 1.0) — "© OpenStreetMap contributors"
- **Usage**: Paddock lake, ponds/canals, car parks/plazas, Jiading roads/expressways, buildings, and green-belt trees extracted via `scripts/circuits/build_shanghai.py`.

- **3D Visual Reference**: "Shanghai International Circuit 2018 layout"
- **Author**: Dave Love SketchFab (https://sketchfab.com/Tyler_Dave)
- **Source**: https://sketchfab.com/3d-models/shanghai-international-circuit-2018-layout-4d3365f4de6442a5ae56e8807c518c4f
- **License**: Creative Commons Attribution (CC-BY 4.0) (http://creativecommons.org/licenses/by/4.0/)
- **Usage**: Visual reference for Main Grandstand A canopy, twin wing bridges, and paddock pavilion proportions (original 1.37M-face mesh not shipped).

- **2026 Trackside Partner Logo Atlas**: `public/models/circuits/shanghai/ads.webp` & `ads_low.webp` — uses the same 13 verified Wikimedia Commons SVG logos + Crypto.com text fallback documented above.

## 3D Circuit Style Reference
- **Project**: F1TrackViewer / Boxlane
- **Author**: Makakashan (https://github.com/makakashan)
- **Source**: https://github.com/makakashan/F1TrackViewer · https://boxlane.pages.dev
- **License**: MIT License
- **Usage**: Diorama terrain block, racing line ribbon extrusion, kerb ramp profiles, and track environment generation techniques.

## Racetrack Geometry and Widths
- **Database**: TUMFTM racetrack-database
- **Author**: Institute of Automotive Technology, Technical University of Munich
- **Source**: https://github.com/TUMFTM/racetrack-database
- **License**: LGPL-3.0

## Team Liveries
- **Sources**: See `public/liveries/SOURCES.md` for individual team livery sheet attributions.

## Race & Telemetry Data
- **Source**: OpenF1 (https://openf1.org)
