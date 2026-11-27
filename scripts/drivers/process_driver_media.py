#!/usr/bin/env python3
"""
Build the Drivers-page web images from source images you are allowed to use.

Input (gitignored, never committed, never served):
    scripts/drivers/source/<CODE>/portrait.(png|webp)   transparent cut-out of the driver
    scripts/drivers/source/<CODE>/helmet.(png|webp)     transparent cut-out of the helmet
  e.g. scripts/drivers/source/NOR/portrait.png

Output (served by the app):
    public/drivers/<code>/portrait-<h>.webp   head-and-shoulders, 4:5, transparent
    public/drivers/<code>/helmet-<h>.webp     the helmet placed over the head in the SAME frame
    src/components/drivers/media.generated.json  sizes + head position per driver (bundled into the page)

Framing is computed per driver from the portrait's alpha channel (head top, neck, head
width and centre), so every card frames the head identically and the helmet lands on the
head. Fine-tune any driver in scripts/drivers/align_overrides.json:
    { "NOR": { "helmet_scale": 1.5, "helmet_dx": 0.0, "helmet_dy": -0.02, "helmet_rotate": 0, "zoom": 1.0 } }
(dx/dy are fractions of the frame; helmet_scale is helmet width / head width.)

This script does not download anything. Record where every source image came from, and
the permission you have to use it, in public/drivers/SOURCES.md.

Usage: python3 scripts/drivers/process_driver_media.py [--only NOR,PIA] [--sizes 1600,800]
Requires Pillow (pip install pillow).
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('Pillow is required: pip install pillow')

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'scripts' / 'drivers' / 'source'
OUT = ROOT / 'public' / 'drivers'
OVERRIDES = ROOT / 'scripts' / 'drivers' / 'align_overrides.json'

ASPECT = 4 / 5            # frame width / height (matches the card's aspect-[4/5])
HEAD_FRACTION = 0.25      # head height (crown to chin) as a fraction of the frame height
HEAD_TOP_MARGIN = 0.11    # space above the crown, fraction of the frame height
HELMET_SCALE = 1.42       # helmet width / head width (a lid is wider than the skull)
BUDGET = {1600: 250_000, 800: 90_000}  # bytes per image (large / small)


def find(d: Path, stem: str) -> Path | None:
    for ext in ('.png', '.webp', '.avif', '.tif', '.tiff'):
        p = d / f'{stem}{ext}'
        if p.exists():
            return p
    return None


def load_rgba(p: Path) -> Image.Image:
    im = Image.open(p)
    im.load()
    im = im.convert('RGBA')
    lo, hi = im.getchannel('A').getextrema()
    if lo == 255:
        sys.exit(f'{p}: no transparency. Use a transparent cut-out (PNG/WebP with alpha).')
    return im


def row_spans(alpha: Image.Image, thresh: int = 128) -> list[tuple[int, int] | None]:
    """per row: (left, right) of opaque pixels, or None"""
    w, h = alpha.size
    px = alpha.point(lambda v: 255 if v >= thresh else 0).tobytes()
    spans: list[tuple[int, int] | None] = []
    for y in range(h):
        row = px[y * w:(y + 1) * w]
        l = row.find(b'\xff')
        if l < 0:
            spans.append(None)
            continue
        r = row.rfind(b'\xff')
        spans.append((l, r))
    return spans


def head_geometry(im: Image.Image) -> dict:
    """crown y, chin/neck y, head width and centre x from the cut-out silhouette"""
    spans = row_spans(im.getchannel('A'))
    rows = [i for i, s in enumerate(spans) if s]
    if not rows:
        raise ValueError('empty image')
    top = rows[0]
    # opaque pixel count per row, not left..right extent: stray specks far from the body
    # (a loose hair, a cut-out artefact) must not count as width
    w_img, h_img = im.size
    opaque = im.getchannel('A').point(lambda v: 1 if v >= 128 else 0).tobytes()
    widths = [opaque[y * w_img:(y + 1) * w_img].count(1) for y in range(h_img)]
    # smooth widths over a few rows (hair wisps, ear gaps)
    k = max(2, im.height // 400)
    sm = [sum(widths[max(0, y - k):y + k + 1]) / len(widths[max(0, y - k):y + k + 1]) for y in range(len(widths))]
    head_w = 0.0
    y_headmax = top
    shoulders = None
    for y in range(top, im.height):
        w = sm[y]
        grown = y - top > max(0.8 * head_w, 0.04 * im.height)
        # the silhouette has widened clearly past the skull: shoulders / collar begin
        if grown and head_w > 0 and w > head_w * 1.6:
            shoulders = y
            break
        # the skull's width is measured only over the first ~head-width of rows; later rows
        # must not ratchet it up (the collar ramps up gradually)
        if not grown and w > head_w:
            head_w, y_headmax = w, y
    if shoulders is None or head_w < 20:
        raise ValueError('could not find the shoulders; is this a head-and-shoulders or full-body cut-out?')
    # the neck is the narrowest row between the widest part of the skull and the shoulders;
    # the chin sits a little above it
    neck = min(range(y_headmax, shoulders), key=lambda y: sm[y])
    head_h = (neck - top) * 0.93
    head_rows = range(top, top + int(head_h))
    cxs = [(spans[y][0] + spans[y][1]) / 2 for y in head_rows if spans[y]]
    cx = sum(cxs) / len(cxs)
    return {'top': top, 'head_h': head_h, 'head_w': head_w, 'cx': cx}


def bbox_alpha(im: Image.Image) -> tuple[int, int, int, int]:
    box = im.getchannel('A').point(lambda v: 255 if v >= 24 else 0).getbbox()
    if not box:
        raise ValueError('empty helmet image')
    return box


def encode(im: Image.Image, budget: int) -> bytes:
    for q in (86, 82, 78, 74, 70, 66, 62, 58, 54, 50):
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6, alpha_quality=80)
        if buf.tell() <= budget:
            return buf.getvalue()
    return buf.getvalue()


def process(code: str, sizes: list[int], overrides: dict) -> dict | None:
    d = SRC / code
    pp, hp = find(d, 'portrait'), find(d, 'helmet')
    if not pp:
        return None
    ov = overrides.get(code, {})
    portrait = load_rgba(pp)
    g = head_geometry(portrait)

    # frame: head occupies HEAD_FRACTION of the height, crown HEAD_TOP_MARGIN below the top
    F = g['head_h'] / (HEAD_FRACTION * float(ov.get('zoom', 1.0)))
    W = F * ASPECT
    x0 = g['cx'] - W / 2
    y0 = g['top'] - HEAD_TOP_MARGIN * F
    big = max(sizes)
    scale = big / F
    out_w, out_h = round(W * scale), big
    if scale > 3.0:
        raise ValueError(f'head detection looks wrong (would upscale x{scale:.1f}); set "zoom" in align_overrides.json or check the cut-out')
    if scale > 1.0:
        print(f'  {code}: upscaling portrait x{scale:.2f} (source head is small); supply a larger source for best quality')

    def frame(src: Image.Image, sx0: float, sy0: float, s: float) -> Image.Image:
        canvas = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0))
        resized = src.resize((max(1, round(src.width * s)), max(1, round(src.height * s))), Image.LANCZOS)
        # paste (not alpha_composite) accepts offsets outside the canvas: out-of-frame
        # areas are cropped, missing areas stay transparent
        canvas.paste(resized, (round(-sx0 * s), round(-sy0 * s)), resized)
        return canvas

    port_frame = frame(portrait, x0, y0, scale)

    entry: dict = {}
    head_cx = (g['cx'] - x0) / W
    head_cy = (g['top'] + g['head_h'] * 0.52 - y0) / F
    entry['align'] = {'cx': round(head_cx, 4), 'cy': round(head_cy, 4), 'r': round(g['head_h'] / F * 0.62, 4)}

    helm_frame = None
    if hp:
        helmet = load_rgba(hp)
        if ov.get('helmet_rotate'):
            # degrees, counter-clockwise: stand a tilted helmet upright like the face
            helmet = helmet.rotate(float(ov['helmet_rotate']), resample=Image.BICUBIC, expand=True)
        bx0, by0, bx1, by1 = bbox_alpha(helmet)
        helmet = helmet.crop((bx0, by0, bx1, by1))
        target_w = g['head_w'] * float(ov.get('helmet_scale', HELMET_SCALE)) * scale
        hs = target_w / helmet.width
        hw, hh = round(helmet.width * hs), round(helmet.height * hs)
        helmet = helmet.resize((hw, hh), Image.LANCZOS)
        cx_px = head_cx * out_w + float(ov.get('helmet_dx', 0.0)) * out_w
        cy_px = head_cy * out_h + float(ov.get('helmet_dy', -0.01)) * out_h
        helm_frame = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0))
        helm_frame.paste(helmet, (round(cx_px - hw / 2), round(cy_px - hh / 2)), helmet)

    dst = OUT / code.lower()
    dst.mkdir(parents=True, exist_ok=True)
    for kind, img in (('portrait', port_frame), ('helmet', helm_frame)):
        if img is None:
            continue
        written = []
        for h in sorted(sizes, reverse=True):
            im = img if h == big else img.resize((round(out_w * h / big), h), Image.LANCZOS)
            data = encode(im, BUDGET.get(h, 250_000 if h > 1000 else 90_000))
            (dst / f'{kind}-{h}.webp').write_bytes(data)
            written.append(h)
            print(f'  {code} {kind}-{h}.webp {im.width}x{im.height} {len(data) / 1024:.0f} KB')
        entry[kind] = {'w': out_w, 'h': out_h, 'sizes': sorted(written)}
    return entry


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', help='comma-separated driver codes')
    ap.add_argument('--sizes', default='1600,800', help='output heights in px')
    args = ap.parse_args()
    sizes = sorted({int(s) for s in args.sizes.split(',') if s.strip()})
    overrides = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    if not SRC.exists():
        sys.exit(f'No source folder: {SRC.relative_to(ROOT)}/<CODE>/portrait.png (+ helmet.png)')
    codes = sorted(p.name.upper() for p in SRC.iterdir() if p.is_dir())
    if args.only:
        want = {c.strip().upper() for c in args.only.split(',')}
        codes = [c for c in codes if c in want]

    manifest_path = ROOT / 'src' / 'components' / 'drivers' / 'media.generated.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'version': 1, 'drivers': {}}
    for code in codes:
        print(code)
        try:
            entry = process(code, sizes, overrides)
        except ValueError as e:
            print(f'  {code}: skipped ({e})')
            continue
        if entry:
            manifest['drivers'][code] = entry
        else:
            print(f'  {code}: no portrait source, skipped')
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True) + '\n')
    total = sum(p.stat().st_size for p in OUT.glob('*/*-1600.webp'))
    print(f'wrote {manifest_path.relative_to(ROOT)}; large images total {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
