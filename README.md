# GhostLap

_Project description — TODO._

## AI agent workflow

This repo is set up for a multi-agent workflow. Claude Code runs as the Firstmate
supervisor and Gemini CLI runs the workers. See [docs/AGENT_SETUP.md](docs/AGENT_SETUP.md).

Quick launch (after setup):

```bash
./scripts/ghostlap-tmux.sh
```

Agent rules live in [AGENTS.md](AGENTS.md). `CLAUDE.md` and `GEMINI.md` import it.

## Data sources and credits

| Source | Used for | Licence |
| --- | --- | --- |
| [OpenF1](https://openf1.org) | Season, race and lap data; circuit layouts from location telemetry | see openf1.org |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Albert Park (Melbourne) lake, islands, parkland roads/paths, sports ovals, golf course, buildings, St Kilda Rd & Melbourne CBD skyline, and trees aligned by `scripts/circuits/build_albert_park.py`; Shanghai International Circuit paddock lake, ponds/canals, plazas, roads, buildings, and trees aligned by `scripts/circuits/build_shanghai.py` | ODbL 1.0 (`© OpenStreetMap contributors`) |
| [TUMFTM/racetrack-database](https://github.com/TUMFTM/racetrack-database) | Real per-point track widths (centre lines from OpenStreetMap, widths from satellite imagery), aligned to the OpenF1 layouts by `scripts/track_widths.py` | LGPL-3.0 |
| [Boxlane / F1TrackViewer](https://github.com/makakashan/F1TrackViewer) | Inspiration for the 3D circuit layout approach (corner/kerb/run-off rules, diorama look); no code or assets copied verbatim | MIT |
| [flag-icons](https://github.com/lipis/flag-icons) (npm `flag-icons`) | Country flag SVGs used as the letter fill of race names on the Circuits page; bundled locally at build time, never hotlinked | MIT |
| Sketchfab visual references ([amogusstrikesback2](https://sketchfab.com/3d-models/melbourne-circuit-747e7406b356449a83bbeb612264f4da), [Dave Love — Melbourne](https://sketchfab.com/3d-models/albert-park-circuit-melbourne-2018-layout-98baf7817404430f9caaa5cee7a1c7a7), [Dave Love — Shanghai](https://sketchfab.com/3d-models/shanghai-international-circuit-2018-layout-4d3365f4de6442a5ae56e8807c518c4f)) | Visual proportion references for Melbourne pit complex & lakeside massing (original heavy meshes not shipped; see `public/models/CREDITS.md`) | CC-BY 4.0 |

Track widths: TUMFTM racetrack-database (LGPL-3.0) · Layout approach inspired by Boxlane/F1TrackViewer (MIT) · Melbourne surroundings: © OpenStreetMap contributors (ODbL).
Other circuits' terrain, trees, buildings, grandstands and run-off in the 3D views remain procedural.
