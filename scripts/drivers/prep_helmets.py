#!/usr/bin/env python3
"""
Turn helmet photos into transparent cut-outs for process_driver_media.py.

Reads scripts/drivers/helmet_sources.json:
  { "VER": { "file": "<CODE>/<photo filename>", "url": "<where it came from>", "page": "<page it is shown on>",
             "crop": [x0, y0, x1, y1], "erase": [[x0, y0, x1, y1], ...], "erase_cut": [[[x, y], ...]],
             "cutout": false, "status": "clean" | "partial", "note": "..." } }
Photos are looked up in --raw (default scripts/drivers/source/_raw/, gitignored), one folder per driver.
"cutout": true means the source already has a transparent background (no rembg pass).

For each entry: crop to the helmet, remove the background with rembg (U^2-Net salient-object
matting; `pip install "rembg[cpu]"`), optionally erase rectangles (hands / fingers that overlap
the crop), keep the largest connected blob, and write scripts/drivers/source/<CODE>/helmet.png.
Pixels of the helmet itself are never edited, repainted or generated.

Better image later? Drop it (any background) at scripts/drivers/source/_incoming/<CODE>.png|jpg|webp
and run `python3 scripts/drivers/process_driver_media.py --incoming` (see README.md), which
calls ingest_incoming() below and rebuilds that driver's web images.

Usage: python3 scripts/drivers/prep_helmets.py [--only VER,ALB] [--raw DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

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


INCOMING = SRC / '_incoming'
INCOMING_EXT = ('.png', '.jpg', '.jpeg', '.webp')
_session = None


def _rembg():
    """the rembg session, created on first use (model download on the very first run)"""
    global _session
    try:
        from rembg import new_session, remove
    except ImportError:
        sys.exit('rembg is required: pip install "rembg[cpu]"')
    if _session is None:
        _session = new_session('isnet-general-use')
    return _session, remove


def has_cutout_alpha(im: Image.Image) -> bool:
    """true when the image already is a transparent cut-out (a real share of clear pixels)"""
    if 'A' not in im.getbands():
        return False
    a = im.getchannel('A')
    hist = a.histogram()
    clear = sum(hist[:16])
    return clear > 0.02 * a.width * a.height


def cut_out(im: Image.Image, crop: tuple[int, int, int, int] | None = None) -> Image.Image:
    """crop, remove the background (unless the image already has one cut away), keep the
    largest blob and trim to it. Helmet pixels are never edited."""
    if has_cutout_alpha(im):
        cut = im.convert('RGBA')
        if crop:
            cut = cut.crop(crop)
    else:
        rgb = im.convert('RGB')
        if crop:
            rgb = rgb.crop(crop)
        session, remove = _rembg()
        cut = remove(rgb, session=session, post_process_mask=True).convert('RGBA')
    alpha = largest_blob(cut.getchannel('A'))
    cut.putalpha(alpha)
    box = alpha.point(lambda v: 255 if v > 24 else 0).getbbox()
    return cut.crop(box) if box else cut


def ingest_incoming(want: set[str] | None = None) -> list[str]:
    """
    Drop-in replacements: scripts/drivers/source/_incoming/<CODE>.(png|jpg|jpeg|webp), a
    straight-on front view of the helmet, background or not. Each one becomes
    scripts/drivers/source/<CODE>/helmet.png (the previous cut-out is kept as
    helmet.prev.png) and the photo moves to _incoming/_done/. Returns the codes ingested.
    """
    if not INCOMING.exists():
        return []
    done = INCOMING / '_done'
    codes: list[str] = []
    for p in sorted(INCOMING.iterdir()):
        if not p.is_file() or p.suffix.lower() not in INCOMING_EXT:
            continue
        code = p.stem.upper()
        if len(code) != 3 or not code.isalpha():
            print(f'  {p.name}: skipped (name it <CODE>{p.suffix}, e.g. NOR{p.suffix})')
            continue
        if want and code not in want:
            continue
        im = Image.open(p)
        im.load()
        im = ImageOps.exif_transpose(im)  # phone photos: honour the camera's orientation tag
        cut = cut_out(im)
        dst = SRC / code / 'helmet.png'
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            dst.replace(dst.with_name('helmet.prev.png'))
        cut.save(dst)
        done.mkdir(exist_ok=True)
        stamp = time.strftime('%Y%m%d-%H%M%S')
        p.replace(done / f'{code}-{stamp}{p.suffix.lower()}')
        print(f'  {code}: {p.name} -> {dst.relative_to(ROOT)} ({cut.width}x{cut.height}); photo moved to _incoming/_done/')
        codes.append(code)
    return codes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--raw', default=str(SRC / '_raw'))
    a = ap.parse_args()
    entries = json.loads(SOURCES.read_text())
    want = {c.strip().upper() for c in a.only.split(',')} if a.only else None
    for code, e in entries.items():
        if code.startswith('_') or (want and code not in want) or not e.get('file'):
            continue
        src = Image.open(Path(a.raw) / e['file'])
        crop = tuple(e['crop']) if e.get('crop') else None
        if e.get('cutout'):
            # the source is already a transparent cut-out (e.g. an official render): keep its alpha
            cut = src.convert('RGBA')
            if crop:
                cut = cut.crop(crop)
        else:
            session, remove = _rembg()
            im = src.convert('RGB')
            if crop:
                im = im.crop(crop)
            cut = remove(im, session=session, post_process_mask=True).convert('RGBA')
        alpha = cut.getchannel('A')
        if e.get('erase'):
            d = ImageDraw.Draw(alpha)
            ox, oy = (crop[0], crop[1]) if crop else (0, 0)
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
