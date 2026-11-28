#!/usr/bin/env python3
"""
Builds the 2026 Australian Grand Prix trackside sponsor texture atlas from verified
official Wikimedia Commons SVG renders (downloaded at 640px width via the Commons API).

Outputs:
  - public/models/circuits/melbourne/ads.webp      (2048x1024, high)
  - public/models/circuits/melbourne/ads_low.webp  (1024x512, low)
"""

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "public/models/circuits/melbourne"
CACHE_DIR = REPO_ROOT / "scripts/circuits/.cache/logos"
UA = "Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

# Verified official Wikimedia Commons SVG sources for 2026 F1 Australian GP partners.
# Crypto.com has no verified official SVG on Wikimedia Commons and remains a clean text board.
LOGO_SOURCES: dict[str, list[str]] = {
    "qatar_airways": ["File:Qatar Airways logo.svg"],
    "f1_2026": ["File:F1.svg"],
    "pirelli": ["File:Pirelli - logo full (Italy, 1997).svg"],
    "aramco": ["File:Saudi aramco logo.svg"],
    "dhl": ["File:DHL Logo.svg"],
    "heineken": ["File:Heineken logo.svg"],
    "lenovo": ["File:Lenovo logo 2015.svg"],
    "lvmh": ["File:LVMH logo.svg"],
    "tag_heuer": ["File:TAG Heuer Logo.svg"],
    "msc_cruises": ["File:MSC Cruises de logo.svg"],
    "aws": ["File:Amazon Web Services Logo.svg"],
    "salesforce": ["File:Salesforce.com logo.svg"],
    "amex": ["File:American Express logo (2018).svg"],
}

# (id, label, bg_hex, trim_hex, text_fg_hex_if_fallback)
CELL_SPECS = [
    ("qatar_airways", "QATAR AIRWAYS", "#FFFFFF", "#5C0632", "#5C0632"),
    ("f1_2026", "FORMULA 1", "#FFFFFF", "#E10600", "#E10600"),
    ("pirelli", "PIRELLI", "#FFED00", "#D5001C", "#D5001C"),
    ("aramco", "aramco", "#FFFFFF", "#00A651", "#0066B3"),
    ("dhl", "DHL", "#FFCC00", "#D40511", "#D40511"),
    ("heineken", "Heineken", "#FFFFFF", "#006A34", "#006A34"),
    ("lenovo", "Lenovo", "#FFFFFF", "#E2231A", "#E2231A"),
    ("lvmh", "LVMH", "#FFFFFF", "#141824", "#141824"),
    ("tag_heuer", "TAG HEUER", "#FFFFFF", "#008751", "#111111"),
    ("msc_cruises", "MSC CRUISES", "#FFFFFF", "#00205B", "#00205B"),
    ("aws", "AWS", "#FFFFFF", "#FF9900", "#232F3E"),
    ("salesforce", "Salesforce", "#FFFFFF", "#00A1E0", "#00A1E0"),
    ("amex", "AMERICAN EXPRESS", "#006FCF", "#FFFFFF", "#FFFFFF"),
    ("crypto", "crypto.com", "#0B1426", "#1199FA", "#FFFFFF"),
    ("brake_100", "100", "#FFFFFF", "#E10600", "#111111"),
    ("brake_50", "50", "#FFFFFF", "#E10600", "#111111"),
]


def fetch_logo_manifest() -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = CACHE_DIR / "manifest.json"
    if manifest_path.exists():
        return json.loads(manifest_path.read_text(encoding="utf-8"))

    verified = {}
    for key, titles in LOGO_SOURCES.items():
        for title in titles:
            url = COMMONS_API + "?" + urllib.parse.urlencode(
                {
                    "format": "json",
                    "action": "query",
                    "titles": title,
                    "prop": "imageinfo",
                    "iiprop": "url|extmetadata|mime|size",
                    "iiurlwidth": "640",
                }
            )
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                info = json.loads(r.read().decode("utf-8"))
            page = next(iter(info.get("query", {}).get("pages", {}).values()))
            ii = (page.get("imageinfo") or [None])[0]
            if ii and ii.get("thumburl"):
                out_png = CACHE_DIR / f"{key}.png"
                if not out_png.exists():
                    req2 = urllib.request.Request(ii["thumburl"], headers={"User-Agent": UA})
                    with urllib.request.urlopen(req2, timeout=25) as resp:
                        out_png.write_bytes(resp.read())
                    time.sleep(0.2)
                lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "Public domain / trademark")
                verified[key] = {
                    "title": page["title"],
                    "pageUrl": ii["descriptionurl"],
                    "license": lic,
                    "file": str(out_png),
                }
                break
    manifest_path.write_text(json.dumps(verified, indent=2), encoding="utf-8")
    return verified


def build_logo_atlas(out_dir: Path = OUT_DIR) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = fetch_logo_manifest()

    W, H = 2048, 1024
    cols, rows = 4, 4
    cw, ch = W // cols, H // rows  # 512 x 256 per cell

    atlas = Image.new("RGBA", (W, H), (21, 21, 30, 255))
    draw = ImageDraw.Draw(atlas)

    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    font_file = next((p for p in font_paths if os.path.exists(p)), None)
    f_brand = ImageFont.truetype(font_file, 64) if font_file else ImageFont.load_default()
    f_sub = ImageFont.truetype(font_file, 22) if font_file else ImageFont.load_default()
    f_num = ImageFont.truetype(font_file, 128) if font_file else ImageFont.load_default()

    atlas_meta = []
    for idx, (key, label, bg, trim, fg) in enumerate(CELL_SPECS):
        r, c = divmod(idx, cols)
        x0, y0 = c * cw, r * ch
        x1, y1 = x0 + cw, y0 + ch

        # Cell background + subtle top/bottom trim bars (keeps boards crisp at distance)
        draw.rectangle([x0, y0, x1, y1], fill=bg)
        draw.rectangle([x0, y0, x1, y0 + 10], fill=trim)
        draw.rectangle([x0, y1 - 10, x1, y1], fill=trim)
        draw.rectangle([x0 + 1, y0 + 1, x1 - 2, y1 - 2], outline="#1f2937", width=2)

        info = manifest.get(key)
        logo_path = Path(info["file"]) if info else None

        if logo_path and logo_path.exists():
            logo = Image.open(logo_path).convert("RGBA")
            # Trim transparent padding around SVG render so aspect ratio & scale are crisp
            alpha_bbox = logo.getbbox()
            if alpha_bbox:
                logo = logo.crop(alpha_bbox)
            max_w = cw - 68
            max_h = ch - 58
            scale = min(max_w / max(1, logo.width), max_h / max(1, logo.height))
            nw = max(1, int(round(logo.width * scale)))
            nh = max(1, int(round(logo.height * scale)))
            logo_resized = logo.resize((nw, nh), Image.Resampling.LANCZOS)
            px = x0 + (cw - nw) // 2
            py = y0 + (ch - nh) // 2
            atlas.alpha_composite(logo_resized, (px, py))
        elif key.startswith("brake_"):
            bbox = draw.textbbox((0, 0), label, font=f_num)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text((x0 + (cw - tw) / 2, y0 + (ch - th) / 2 - 14), label, fill=fg, font=f_num)
        else:
            # Clean text fallback (Crypto.com — no verified official SVG on Wikimedia Commons)
            bbox = draw.textbbox((0, 0), label, font=f_brand)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text((x0 + (cw - tw) / 2, y0 + ch * 0.38 - th / 2), label, fill=fg, font=f_brand)
            sb = draw.textbbox((0, 0), "OFFICIAL PARTNER", font=f_sub)
            stw, sth = sb[2] - sb[0], sb[3] - sb[1]
            draw.text((x0 + (cw - stw) / 2, y0 + ch * 0.72 - sth / 2), "OFFICIAL PARTNER", fill=trim, font=f_sub)

        pad_u = 4 / W
        pad_v = 4 / H
        u0 = round(x0 / W + pad_u, 5)
        u1 = round(x1 / W - pad_u, 5)
        v1 = round(1.0 - (y0 / H + pad_v), 5)
        v0 = round(1.0 - (y1 / H - pad_v), 5)
        atlas_meta.append({"id": key, "label": label, "uv": [u0, v0, u1, v1]})

    rgb = atlas.convert("RGB")
    high_path = out_dir / "ads.webp"
    low_path = out_dir / "ads_low.webp"
    rgb.save(high_path, format="WEBP", quality=88, method=6)
    rgb.resize((1024, 512), Image.Resampling.LANCZOS).save(low_path, format="WEBP", quality=82, method=6)
    print(f"[logos] Wrote {high_path.name} ({high_path.stat().st_size/1024:.1f} KB) & {low_path.name} ({low_path.stat().st_size/1024:.1f} KB)")
    return atlas_meta


if __name__ == "__main__":
    build_logo_atlas()
