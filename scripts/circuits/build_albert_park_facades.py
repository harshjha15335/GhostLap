#!/usr/bin/env python3
"""
Generates a shared architectural building facade texture atlas for Melbourne (Albert Park):
  - public/models/circuits/melbourne/facades.webp     (1024x1024, high)
  - public/models/circuits/melbourne/facades_low.webp (512x512, low)

4 vertical facade columns (each 256px wide x 1024px tall = 8 floors of 128px each,
so V repeats cleanly at ~3.4m per floor with RepeatWrapping on V):
  Col 0 (u: 0.00..0.25): Melbourne CBD tinted blue-glass curtain wall
  Col 1 (u: 0.25..0.50): St Kilda Road silver/teal modern office tower
  Col 2 (u: 0.50..0.75): Albert Park / St Kilda warm render & apartment balconies
  Col 3 (u: 0.75..1.00): Middle Park / Melbourne heritage brick & venue facade
"""

import random
from pathlib import Path
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "public/models/circuits/melbourne"


def build_facade_atlas(out_dir: Path = OUT_DIR) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    W, H = 1024, 1024
    col_w = W // 4  # 256px per facade style
    floors = 8
    floor_h = H // floors  # 128px per floor (~3.4m real height)

    img = Image.new("RGB", (W, H), "#cbd5e1")
    draw = ImageDraw.Draw(img)
    rng = random.Random(2026)

    # --- Column 0: Melbourne CBD Blue-Glass Curtain Wall ---
    x0 = 0
    draw.rectangle([x0, 0, x0 + col_w, H], fill="#4c6f91")
    for f in range(floors):
        y0 = f * floor_h
        # Spandrel band
        draw.rectangle([x0, y0, x0 + col_w, y0 + 26], fill="#2f4b66")
        draw.rectangle([x0, y0 + 26, x0 + col_w, y0 + 30], fill="#93b4d1")
        # 4 glass curtain bays per floor
        bay_w = col_w // 4
        for b in range(4):
            bx = x0 + b * bay_w
            tone = rng.choice(["#6f99be", "#7ba6cb", "#5e87ad", "#8bb3d4", "#557ba1"])
            draw.rectangle([bx + 4, y0 + 32, bx + bay_w - 4, y0 + floor_h - 6], fill=tone)
            # Subtle sky reflection diagonal highlight
            draw.polygon(
                [(bx + 6, y0 + 34), (bx + bay_w - 14, y0 + 34), (bx + 6, y0 + 78)],
                fill="#a8cbe6",
            )
            # Mullion frame
            draw.rectangle([bx, y0, bx + 3, y0 + floor_h], fill="#25384c")

    # --- Column 1: St Kilda Road Silver/Teal Office Tower ---
    x0 = col_w
    draw.rectangle([x0, 0, x0 + col_w, H], fill="#cfd6de")
    for f in range(floors):
        y0 = f * floor_h
        # Precast architectural concrete slab
        draw.rectangle([x0, y0, x0 + col_w, y0 + 38], fill="#d9dfe6")
        draw.rectangle([x0, y0 + 36, x0 + col_w, y0 + 42], fill="#9aa5b1")
        # Ribbon window strip
        draw.rectangle([x0 + 4, y0 + 44, x0 + col_w - 4, y0 + floor_h - 10], fill="#45657d")
        bay_w = col_w // 4
        for b in range(4):
            bx = x0 + b * bay_w
            tint = rng.choice(["#5d839e", "#6f96b0", "#4f728c", "#7fa3ba"])
            draw.rectangle([bx + 6, y0 + 46, bx + bay_w - 6, y0 + floor_h - 12], fill=tint)
            draw.rectangle([bx + bay_w - 4, y0 + 42, bx + bay_w, y0 + floor_h - 8], fill="#b8c2cc")

    # --- Column 2: Albert Park / St Kilda Cream Render Apartments & Balconies ---
    x0 = col_w * 2
    draw.rectangle([x0, 0, x0 + col_w, H], fill="#e6dfd3")
    for f in range(floors):
        y0 = f * floor_h
        # Floor slab line
        draw.rectangle([x0, y0, x0 + col_w, y0 + 12], fill="#cfc6b8")
        # 2 wide apartment balcony bays per floor
        bay_w = col_w // 2
        for b in range(2):
            bx = x0 + b * bay_w
            # Recessed window / sliding glass door
            draw.rectangle([bx + 16, y0 + 22, bx + bay_w - 16, y0 + floor_h - 16], fill="#38495c")
            draw.rectangle([bx + 20, y0 + 26, bx + bay_w // 2 - 2, y0 + floor_h - 20], fill="#5a7691")
            draw.rectangle([bx + bay_w // 2 + 2, y0 + 26, bx + bay_w - 20, y0 + floor_h - 20], fill="#4d6882")
            # Glass balcony balustrade
            draw.rectangle([bx + 12, y0 + floor_h - 46, bx + bay_w - 12, y0 + floor_h - 12], fill="#b7c8d6")
            draw.rectangle([bx + 12, y0 + floor_h - 48, bx + bay_w - 12, y0 + floor_h - 43], fill="#64748b")

    # --- Column 3: Middle Park Heritage Brick & Terraces ---
    x0 = col_w * 3
    draw.rectangle([x0, 0, x0 + col_w, H], fill="#b9785d")
    # Subtle brick course horizontal mortar lines
    for y in range(0, H, 16):
        draw.line([(x0, y), (x0 + col_w, y)], fill="#a5684e", width=1)
    for f in range(floors):
        y0 = f * floor_h
        # Sandstone stringcourse
        draw.rectangle([x0, y0, x0 + col_w, y0 + 10], fill="#ddd1bc")
        bay_w = col_w // 3
        for b in range(3):
            bx = x0 + b * bay_w
            # Window frame + sill + lintel
            draw.rectangle([bx + 14, y0 + 26, bx + bay_w - 14, y0 + 34], fill="#e6dcc8")
            draw.rectangle([bx + 16, y0 + 34, bx + bay_w - 16, y0 + floor_h - 22], fill="#2b3847")
            draw.rectangle([bx + 20, y0 + 38, bx + bay_w - 20, y0 + floor_h - 26], fill="#4c647d")
            # Sash crossbar
            draw.rectangle([bx + 18, y0 + 70, bx + bay_w - 18, y0 + 75], fill="#e5e7eb")
            draw.rectangle([bx + 14, y0 + floor_h - 22, bx + bay_w - 14, y0 + floor_h - 15], fill="#ddd1bc")

    high_path = out_dir / "facades.webp"
    low_path = out_dir / "facades_low.webp"
    img.save(high_path, format="WEBP", quality=86, method=6)
    img.resize((512, 512), Image.Resampling.LANCZOS).save(low_path, format="WEBP", quality=80, method=6)
    print(f"[facades] Wrote {high_path.name} ({high_path.stat().st_size/1024:.1f} KB) & {low_path.name} ({low_path.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    build_facade_atlas()
