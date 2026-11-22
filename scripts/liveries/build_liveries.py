#!/usr/bin/env python3
"""Compose team livery sheets into GhostLap's F1Car livery atlas.

Input : 2048x2048 "main" livery sheets (one per team, shared UV layout), e.g.
        <src>/ferrari-0.png
Output: public/liveries/<teamId>.webp     (1024x512, quality 80)
        public/liveries/<teamId>-sm.webp  (512x256)

The atlas layout matches LIVERY_ATLAS in src/components/three/liveries.ts (rects there
are given in a 1024x512 canvas, origin top-left). Each atlas region is filled from one
or more crops of the source sheet (crop rects are in source-sheet pixels, 2048 space).

Requires ImageMagick (`convert`). Stdlib only.

Usage:
  python3 scripts/liveries/build_liveries.py <src-dir> [--out public/liveries] [--preview <dir>]
  python3 scripts/liveries/build_liveries.py <src-dir> --guides <dir>   # draw crop rects on sheets
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

TEAMS = [
    "alpine", "aston-martin", "audi", "cadillac", "ferrari", "haas-f1-team",
    "mclaren", "mercedes", "racing-bulls", "red-bull-racing", "williams",
]

CARBON = "#15181d"

# Atlas regions (1024x512 canvas px) — keep in sync with LIVERY_ATLAS in liveries.ts.
REGIONS = {
    "bodySideR": (0, 0, 508, 112),
    "bodySideL": (516, 0, 508, 112),
    "noseTop": (0, 116, 512, 72),
    "frontWing": (512, 116, 384, 116),
    "halo": (904, 116, 48, 48),
    "underside": (960, 116, 48, 48),
    "sidepodR": (0, 236, 256, 64),
    "sidepodL": (260, 236, 256, 64),
    "sidepodTopR": (0, 304, 256, 72),
    "sidepodTopL": (260, 304, 256, 72),
    "rearWing": (520, 236, 256, 124),
    "rearEndplateR": (780, 236, 116, 148),
    "rearEndplateL": (900, 236, 116, 148),
    "frontEndplateR": (0, 380, 128, 92),
    "frontEndplateL": (132, 380, 128, 92),
}

# Source crops, in 2048-sheet pixels: (x, y, w, h).
# Sheet layout: nose points DOWN along the centre column; engine-cover side panels sit
# top-centre either side of the seam; sidepod panels left/right; rear-wing mainplane
# (curved "V") and endplate strips bottom-right; front wing arch bottom-left.
NOSE = (800, 1080, 450, 940)            # centre column ahead of the cockpit → nose tip
COCKPIT = (820, 660, 410, 420)          # cockpit surround
COVER_L = (690, 10, 330, 660)           # engine-cover side panel, left of seam
COVER_R = (1030, 10, 330, 660)          # engine-cover side panel, right of seam
COVER_TOP = (930, 10, 190, 660)         # spine of the engine cover (both halves at the seam)
POD_L = (370, 470, 300, 720)            # left sidepod panel
POD_R = (1380, 470, 300, 720)           # right sidepod panel
REAR_MAIN = (1360, 1250, 440, 260)      # rear-wing mainplane (curved)
REAR_EP = (1610, 1540, 120, 480)        # rear-wing endplate strip
FRONT_WING = (90, 1560, 780, 420)       # front wing arch
FRONT_EP = (10, 520, 270, 140)          # front endplate panel
HALO = (1720, 40, 40, 220)              # halo bar (averaged to one colour)

# Each region: list of (crop, ops, dest sub-rect as fractions of the region (x, y, w, h)).
# ops are ImageMagick operators applied after the crop (before resizing to the dest).
#  -rotate 90 = clockwise.
SPEC: dict[str, list[tuple[tuple[int, int, int, int], list[str], tuple[float, float, float, float]]]] = {
    # right flank: nose → left. u: z 2.9 (x=0) → -2.1 (x=1); nose ends at z≈0.7 (0.44)
    "bodySideR": [
        ((1025, 1080, 225, 940), ["-rotate", "90"], (0.0, 0.0, 0.44, 1.0)),
        ((1025, 660, 205, 420), ["-rotate", "90"], (0.44, 0.0, 0.16, 1.0)),
        (COVER_R, ["-rotate", "90"], (0.6, 0.0, 0.4, 1.0)),
    ],
    # left flank: tail → left
    "bodySideL": [
        (COVER_L, ["-rotate", "-90"], (0.0, 0.0, 0.4, 1.0)),
        ((820, 660, 205, 420), ["-rotate", "-90"], (0.4, 0.0, 0.16, 1.0)),
        ((800, 1080, 225, 940), ["-rotate", "-90"], (0.56, 0.0, 0.44, 1.0)),
    ],
    # top: nose → left, car's left side at top
    "noseTop": [
        (NOSE, ["-rotate", "90"], (0.0, 0.0, 0.44, 1.0)),
        (COCKPIT, ["-rotate", "90"], (0.44, 0.0, 0.16, 1.0)),
        (COVER_TOP, ["-rotate", "90"], (0.6, 0.0, 0.4, 1.0)),
    ],
    "frontWing": [(FRONT_WING, [], (0, 0, 1, 1))],
    "sidepodR": [(POD_R, ["-rotate", "90"], (0, 0, 1, 1))],
    "sidepodL": [(POD_L, ["-rotate", "-90"], (0, 0, 1, 1))],
    "sidepodTopR": [(POD_R, ["-rotate", "90"], (0, 0, 1, 1))],
    "sidepodTopL": [(POD_L, ["-rotate", "-90"], (0, 0, 1, 1))],
    "rearWing": [(REAR_MAIN, [], (0, 0, 1, 1))],
    "rearEndplateR": [(REAR_EP, ["-rotate", "90"], (0, 0, 1, 1))],
    "rearEndplateL": [(REAR_EP, ["-rotate", "90"], (0, 0, 1, 1))],
    "frontEndplateR": [(FRONT_EP, [], (0, 0, 1, 1))],
    "frontEndplateL": [(FRONT_EP, [], (0, 0, 1, 1))],
    "halo": [(HALO, ["-resize", "1x1!"], (0, 0, 1, 1))],
}

BLEED = 3  # px of edge bleed around every region (mip-mapping / filtering)


def crop_str(c):
    x, y, w, h = c
    return f"{w}x{h}+{x}+{y}"


def compose(src: str, out_png: str) -> None:
    cmd = ["convert", "-size", "1024x512", f"xc:{CARBON}"]
    for region, parts in SPEC.items():
        rx, ry, rw, rh = REGIONS[region]
        for crop, ops, (fx, fy, fw, fh) in parts:
            dx = round(rx + fx * rw) - (BLEED if fx == 0 else 0)
            dy = round(ry + fy * rh) - (BLEED if fy == 0 else 0)
            dw = round(fw * rw) + (BLEED if fx == 0 else 0) + (BLEED if fx + fw >= 0.999 else 0)
            dh = round(fh * rh) + (BLEED if fy == 0 else 0) + (BLEED if fy + fh >= 0.999 else 0)
            cmd += ["(", src, "-crop", crop_str(crop), "+repage", *ops, "-resize", f"{dw}x{dh}!", ")",
                    "-geometry", f"+{max(dx, 0)}+{max(dy, 0)}", "-composite"]
    cmd += ["-alpha", "off", out_png]
    subprocess.run(cmd, check=True)


def guides(src: str, out: str) -> None:
    colours = ["red", "lime", "cyan", "yellow", "magenta", "orange", "white", "dodgerblue"]
    cmd = ["convert", src, "-fill", "none", "-strokewidth", "6"]
    i = 0
    seen = set()
    for parts in SPEC.values():
        for crop, _, _ in parts:
            if crop in seen:
                continue
            seen.add(crop)
            x, y, w, h = crop
            cmd += ["-stroke", colours[i % len(colours)], "-draw", f"rectangle {x},{y} {x + w},{y + h}"]
            i += 1
    cmd += ["-resize", "1024x1024", out]
    subprocess.run(cmd, check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="directory with <teamId>-0.png sheets")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "liveries"))
    ap.add_argument("--preview", help="also write <teamId>.png previews here")
    ap.add_argument("--guides", help="write sheets with crop rects drawn, then exit")
    ap.add_argument("--teams", nargs="*", default=TEAMS)
    a = ap.parse_args()

    if a.guides:
        os.makedirs(a.guides, exist_ok=True)
        for t in a.teams:
            guides(os.path.join(a.src, f"{t}-0.png"), os.path.join(a.guides, f"{t}-guides.png"))
        return 0

    os.makedirs(a.out, exist_ok=True)
    tmp_dir = a.preview or a.out
    os.makedirs(tmp_dir, exist_ok=True)
    for t in a.teams:
        src = os.path.join(a.src, f"{t}-0.png")
        if not os.path.exists(src):
            print(f"skip {t}: {src} missing", file=sys.stderr)
            continue
        png = os.path.join(tmp_dir, f"{t}.png")
        compose(src, png)
        subprocess.run(["convert", png, "-quality", "80", "-define", "webp:method=6", os.path.join(a.out, f"{t}.webp")], check=True)
        subprocess.run(["convert", png, "-resize", "512x256!", "-quality", "80", "-define", "webp:method=6",
                        os.path.join(a.out, f"{t}-sm.webp")], check=True)
        if not a.preview:
            os.remove(png)
        print("wrote", t)
    return 0


if __name__ == "__main__":
    sys.exit(main())
