#!/usr/bin/env python3
"""
Add official-orientation 2D track maps to the season data.

For every calendar entry, writes into season.json (public + embedded seed):
  races[i].mapRotationDeg  rotation (degrees, clockwise on screen) that turns our top-down
                           x/z layout into the orientation used on official F1 track maps
  races[i].outline         ~160 [x, y] points in that orientation, fitted into a 0..100 box,
                           start/finish first (screen coordinates: x right, y down)

Inputs
  scripts/map_orientation_2026.json   per-circuit rotation (fitted against the official 2026
                                      calendar poster) and, for circuits without telemetry
                                      (cancelled / not yet raced), a layout from the
                                      bacinger/f1-circuits GeoJSON (MIT) as 'geo' points
  public/data/2026/races/<slug>.json  telemetry layouts (circuit.points: x, y=elev, z)

Run after fetch_2026_season.py (it calls this automatically).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE = ROOT / "scripts" / "map_orientation_2026.json"
SEASONS = [ROOT / "public" / "data" / "2026" / "season.json", ROOT / "src" / "data" / "seed" / "season.json"]
RACES = ROOT / "public" / "data" / "2026" / "races"
N_OUT = 160


def resample(pts: list[tuple[float, float]], n: int) -> list[tuple[float, float]]:
    ring = pts + [pts[0]]
    d = [0.0]
    for a, b in zip(ring, ring[1:]):
        d.append(d[-1] + math.dist(a, b))
    total = d[-1] or 1.0
    out, j = [], 0
    for i in range(n):
        t = total * i / n
        while d[j + 1] < t:
            j += 1
        seg = d[j + 1] - d[j] or 1.0
        f = (t - d[j]) / seg
        a, b = ring[j], ring[j + 1]
        out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    return out


def outline_for(pts: list[tuple[float, float]], deg: float) -> list[list[float]]:
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    rot = [(x * ca - y * sa, x * sa + y * ca) for x, y in resample(pts, N_OUT)]
    xs, ys = [p[0] for p in rot], [p[1] for p in rot]
    mnx, mny = min(xs), min(ys)
    s = max(max(xs) - mnx, max(ys) - mny) or 1.0
    ox = (100 - (max(xs) - mnx) / s * 100) / 2
    oy = (100 - (max(ys) - mny) / s * 100) / 2
    return [[round((x - mnx) / s * 100 + ox, 1), round((y - mny) / s * 100 + oy, 1)] for x, y in rot]


def main() -> None:
    table = json.loads(TABLE.read_text())
    for season_path in SEASONS:
        if not season_path.exists():
            continue
        season = json.loads(season_path.read_text())
        done = 0
        for race in season["races"]:
            entry = table.get(race["slug"])
            if not entry:
                race.pop("outline", None)
                race.pop("mapRotationDeg", None)
                continue
            bundle = RACES / f"{race['slug']}.json"
            if bundle.exists():
                pts = [(p[0], p[2]) for p in json.loads(bundle.read_text())["circuit"]["points"]]
            elif entry.get("geo"):
                pts = [tuple(p) for p in entry["geo"]]
            else:
                continue
            race["mapRotationDeg"] = entry["rotateDeg"]
            race["outline"] = outline_for(pts, entry["rotateDeg"])
            done += 1
        season_path.write_text(json.dumps(season, separators=(",", ":")))
        print(f"{season_path.relative_to(ROOT)}: {done}/{len(season['races'])} maps")


if __name__ == "__main__":
    main()
