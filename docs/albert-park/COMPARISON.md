# Albert Park (Melbourne) 2026 — Verification & Comparison

## 1. OSM-to-Telemetry Alignment Overview

![Albert Park 2026 OSM Alignment Overview](screenshots/osm_alignment_overview.png)

- **Alignment Fit** (`scripts/circuits/build_albert_park.py` aligning 31 OSM Albert Park Circuit ways / 589 sampled points to `public/data/2026/races/melbourne.json`):
  - **Scale**: `0.115318` render units / metre (telemetry `upm = 0.112723`)
  - **Rotation**: `0.06°` (true north along `-Z`, `northVec = [0.001, -1.0]`, `flipY = -1.0`)
  - **RMS Error**: **6.63 m** · **Max Error**: **17.74 m** (reflecting racing-line vs road-centreline offset across the 14 m track width and pit-lane geometry)
- **Key Landmarks Verified on Alignment Map**:
  - **Albert Park Lake & 3 Islands**: Fills the circuit infield cleanly without intersecting the racing asphalt or verges.
  - **Lakeside Stadium & Sports Ovals**: Positioned inside T3–T5 and along Aughtie Drive / south-east parklands.
  - **Albert Park Golf Course**: Fairways & greens along the east side of Lakeside Drive (T7–T10).
  - **St Kilda Road & Melbourne CBD Towers**: Rise to the north (`-Z`) and north-east (`+X, -Z`).
  - **Port Phillip Bay**: Coastal water edge visible to the south-west (`-X, +Z`).

## 2. 2026 Sponsor Texture Atlas

![2026 Australian Grand Prix Sponsor Atlas](../../public/models/circuits/melbourne/ads.webp)

- Single WebP texture atlas (`2048×1024`, **81.0 KB** high; `1024×512`, **35.8 KB** low) driving all trackside boards, start/finish gantry header, 3 footbridges, braking distance boards (`100` / `50`), and painted run-off decals in **1 draw call**.
- Reflects the **Formula 1 Qatar Airways Australian Grand Prix 2026** title sponsorship and 2026 F1 Global/Official Partners (no pre-2025 Rolex branding).

## 3. Hard Performance Budget Verification

Verified by `src/components/track/tracks/melbourne/melbourneBuilders.test.ts` (`npm test`):

| Metric | `quality="high"` (Inspector) | High Budget | `quality="low"` (Replay / Mobile) | Low Budget | Status |
| --- | --- | --- | --- | --- | --- |
| **Total Asset Download** | **150.2 KB** (`albert_park_env.json` 69.2 KB + `ads.webp` 81.0 KB) | ≤ 3,072 KB | **66.2 KB** (`albert_park_env_low.json` 30.4 KB + `ads_low.webp` 35.8 KB) | ≤ 600 KB | PASS |
| **Triangles (Full Env)** | **236,426** | ≤ 800,000 | **95,102** | ≤ 250,000 | PASS |
| **Draw Calls (Full Env)** | **14** | ≤ 400 | **14** | ≤ 150 | PASS |
| **Lazy JS Chunk** | `MelbourneEnvironment` **7.48 KB** gzip | Lazy-loaded | `MelbourneEnvironment` **7.48 KB** gzip | Lazy-loaded | PASS |

## 4. Known Simplifications vs. Real-Life Albert Park
- **Buildings & Skyline**: Real OSM footprints and heights are extruded as clean architectural massing blocks rather than individually textured landmark meshes (Lakeside Stadium roof arches, MSAC facade, Eureka Tower / Australia 108 spires).
- **2026 Sponsor Art**: Rendered in crisp bold typography matching official 2026 brand colour palettes rather than third-party copyrighted bitmap logos; temporary event-only activations without exact barrier coordinates (e.g., 20 m Doritos Tower in Trackside Green) are omitted rather than guessed.
- **Headless WebGL Screenshots**: Headless SwiftShader Chromium in the cloud build container did not exit cleanly after WebGL frame capture; verify `/circuits` (Melbourne) and `/replay/melbourne` locally at `1440×900` and `390×844` via `npm run dev` to inspect live camera angles (T1, T3, T6, T9–10, T11–12, T13, pit straight, and aerial overview).
