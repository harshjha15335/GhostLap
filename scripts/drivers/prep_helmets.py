#!/usr/bin/env python3
"""
Turn helmet photos into transparent cut-outs for process_driver_media.py.

Reads scripts/drivers/helmet_sources.json:
  { "VER": { "file": "<photo filename>", "url": "<where it came from>", "crop": [x0, y0, x1, y1],
             "erase": [[x0, y0, x1, y1], ...], "erase_cut": [[[x, y], ...]], "status": "clean" | "partial", "note": "..." } }
Photos are looked up in --raw (default scripts/drivers/source/_raw/, gitignored).

For each entry: crop to the helmet, remove the background with rembg (U^2-Net salient-object
matting; `pip install "rembg[cpu]"`), optionally erase rectangles (hands / fingers that overlap
the crop), keep the largest connected blob, and write scripts/drivers/source/<CODE>/helmet.png.
Pixels of the helmet itself are never edited, repainted or generated.

Better image later? Drop a transparent cut-out at scripts/drivers/source/<CODE>/helmet.png
and rerun process_driver_media.py; this script is only for photos with backgrounds.

Usage: python3 scripts/drivers/prep_helmets.py [--only VER,ALB] [--raw DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'scripts' / 'drivers' / 'source'
SOURCES = ROOT / 'scripts' / 'drivers' / 'helmet_sources.json'


def largest_blob(alpha: Image.Image) -> Image.Image:
    """zero every opaque region except the largest 8-connected one (stray background bits)"""
    small = alpha.copy()
    small.thumbnail((400, 400))
    w, h = small.size
    px = small.load()
    seen = [[False] * w for _ in range(h)]
    best: list[tuple[int, int]] = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or px[sx, sy] < 128:
                continue
            stack, comp = [(sx, sy)], []
            seen[sy][sx] = True
            while stack:
                x, y = stack.pop()
                comp.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny] >= 128:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    keep = Image.new('L', (w, h), 0)
    kp = keep.load()
    for x, y in best:
        kp[x, y] = 255
    keep = keep.filter(ImageFilter.MaxFilter(5)).resize(alpha.size, Image.BILINEAR)
    return Image.composite(alpha, Image.new('L', alpha.size, 0), keep.point(lambda v: 255 if v > 64 else 0))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--raw', default=str(SRC / '_raw'))
    a = ap.parse_args()
    try:
        from rembg import new_session, remove
    except ImportError:
        sys.exit('rembg is required: pip install "rembg[cpu]"')
    session = new_session('isnet-general-use')
    entries = json.loads(SOURCES.read_text())
    want = {c.strip().upper() for c in a.only.split(',')} if a.only else None
    for code, e in entries.items():
        if code.startswith('_') or (want and code not in want) or not e.get('file'):
            continue
        im = Image.open(Path(a.raw) / e['file']).convert('RGB')
        if e.get('crop'):
            im = im.crop(tuple(e['crop']))
        cut = remove(im, session=session, post_process_mask=True).convert('RGBA')
        alpha = cut.getchannel('A')
        if e.get('erase'):
            d = ImageDraw.Draw(alpha)
            ox, oy = (e['crop'][0], e['crop'][1]) if e.get('crop') else (0, 0)
            for x0, y0, x1, y1 in e['erase']:
                d.rectangle((x0 - ox, y0 - oy, x1 - ox, y1 - oy), fill=0)
        alpha = largest_blob(alpha)
        cut.putalpha(alpha)
        box = alpha.point(lambda v: 255 if v > 24 else 0).getbbox()
        if box:
            cut = cut.crop(box)
        # erase_cut: polygons in the trimmed cut-out's own pixel space (hands in front of the shell)
        if e.get('erase_cut'):
            a2 = cut.getchannel('A')
            d2 = ImageDraw.Draw(a2)
            for poly in e['erase_cut']:
                d2.polygon([tuple(pt) for pt in poly], fill=0)
            cut.putalpha(a2)
        dst = SRC / code / 'helmet.png'
        dst.parent.mkdir(parents=True, exist_ok=True)
        cut.save(dst)
        print(f'{code}: {cut.size[0]}x{cut.size[1]} -> {dst.relative_to(ROOT)}  ({e.get("status")})')


if __name__ == '__main__':
    main()
