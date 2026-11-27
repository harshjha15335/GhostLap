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
