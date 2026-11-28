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
| [TUMFTM/racetrack-database](https://github.com/TUMFTM/racetrack-database) | Real per-point track widths (centre lines from OpenStreetMap, widths from satellite imagery), aligned to the OpenF1 layouts by `scripts/track_widths.py` | LGPL-3.0 |
| [Boxlane / F1TrackViewer](https://github.com/makakashan/F1TrackViewer) | Inspiration for the 3D circuit layout approach (corner/kerb/run-off rules, diorama look); no code or assets copied verbatim | MIT |
| [flag-icons](https://github.com/lipis/flag-icons) (npm `flag-icons`) | Country flag SVGs used as the letter fill of race names on the Circuits page; bundled locally at build time, never hotlinked | MIT |

Track widths: TUMFTM racetrack-database (LGPL-3.0) · Layout approach inspired by Boxlane/F1TrackViewer (MIT).
Terrain, trees, buildings, grandstands and run-off in the 3D views are procedural and do not depict the real surroundings.
