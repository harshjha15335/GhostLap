#!/usr/bin/env python3
"""
Build script for GhostLap 2026 — Albert Park (Melbourne, Australian GP) 3D environment.

Fetches real OpenStreetMap features around Albert Park Lake, St Kilda Road, and the
Melbourne CBD skyline via the official OpenStreetMap API v0.6
(© OpenStreetMap contributors, ODbL), projects lat/lon to local metres
(EPSG:32755 / UTM 55S), fits a 2D similarity transform (translation + rotation + scale)
aligning the OSM Albert Park circuit ways directly to public/data/2026/races/melbourne.json
telemetry points, simplifies geometry with Douglas-Peucker, and writes compact JSON +
2026 sponsor WebP texture atlases into public/models/circuits/melbourne/.

Usage:
  python3 scripts/circuits/build_albert_park.py
"""

import json
import math
import os
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import polygonize, unary_union

REPO_ROOT = Path(__file__).resolve().parents[2]
MELBOURNE_JSON = REPO_ROOT / "public/data/2026/races/melbourne.json"
OUT_DIR = REPO_ROOT / "public/models/circuits/melbourne"
CACHE_DIR = REPO_ROOT / "scripts/circuits/.cache"

USER_AGENT = "Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)"
OSM_API_URL = "https://api.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}"

# Small tiles (each ~0.014 x 0.013 deg, well under OSM 0.6 API node limits)
PARK_TILES = [
    (144.954, -37.860, 144.968, -37.847),
    (144.968, -37.860, 144.982, -37.847),
    (144.954, -37.847, 144.968, -37.834),
    (144.968, -37.847, 144.982, -37.834),
]

# Northern tiles for St Kilda Rd / Southbank / Melbourne CBD skyline towers
SKYLINE_TILES = [
    (144.956, -37.834, 144.974, -37.824),
    (144.956, -37.824, 144.974, -37.814),
]

TRANSFORMER = Transformer.from_crs("EPSG:4326", "EPSG:32755", always_xy=True)


def fetch_osm_tiles(tiles: list[tuple[float, float, float, float]], cache_name: str) -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / cache_name
    if cache_path.exists():
        print(f"[cache] Loading {cache_path.name}")
        return json.loads(cache_path.read_text(encoding="utf-8"))

    merged: dict[tuple[str, int], dict] = {}
    for idx, (w, s, e, n) in enumerate(tiles):
        url = OSM_API_URL.format(w=w, s=s, e=e, n=n)
        print(f"[osm] Fetching tile {idx + 1}/{len(tiles)}: bbox=({w},{s},{e},{n})")
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            chunk = json.loads(resp.read().decode("utf-8"))
        for el in chunk.get("elements", []):
            merged[(el["type"], el["id"])] = el
        if idx < len(tiles) - 1:
            time.sleep(0.4)

    result = {"elements": list(merged.values())}
    cache_path.write_text(json.dumps(result), encoding="utf-8")
    print(f"[osm] Saved {len(result['elements'])} merged elements to {cache_path.name}")
    return result


def build_node_map(osm: dict) -> dict[int, tuple[float, float]]:
    """Project all OSM nodes to UTM 55S local metres (east, north)."""
    nodes = {}
    for el in osm.get("elements", []):
        if el["type"] == "node":
            x, y = TRANSFORMER.transform(el["lon"], el["lat"])
            nodes[el["id"]] = (x, y)
    return nodes


def way_coords(way: dict, nodes: dict[int, tuple[float, float]]) -> list[tuple[float, float]]:
    return [nodes[nid] for nid in way.get("nodes", []) if nid in nodes]


def extract_relation_polygons(rel: dict, ways_by_id: dict, nodes: dict) -> list[Polygon]:
    outer_lines = []
    inner_lines = []
    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        w = ways_by_id.get(m["ref"])
        if not w:
            continue
        pts = way_coords(w, nodes)
        if len(pts) < 2:
            continue
        if m.get("role") == "inner":
            inner_lines.append(LineString(pts))
        else:
            outer_lines.append(LineString(pts))

    outers = list(polygonize(outer_lines))
    inners = list(polygonize(inner_lines))
    if not outers:
        return []
    merged_outer = unary_union(outers)
    if inners:
        merged_inner = unary_union(inners)
        merged_outer = merged_outer.difference(merged_inner)
    if isinstance(merged_outer, Polygon):
        return [merged_outer]
    if isinstance(merged_outer, MultiPolygon):
        return list(merged_outer.geoms)
    return []


def align_osm_to_telemetry(
    osm_circuit_pts: np.ndarray,
    tel_pts: np.ndarray,
    upm_hint: float,
) -> tuple[dict, float, float]:
    """
    Fit a 2D similarity transform mapping UTM (east, north) -> render (x, z)
    so that OSM circuit points overlap GhostLap's melbourne.json telemetry points.
    Tests both handedness (+1 and -1 mirror on north/z).
    """
    tel_tree = cKDTree(tel_pts)
    osm_c = osm_circuit_pts.mean(axis=0)
    tel_c = tel_pts.mean(axis=0)

    best = None
    for flip_y in (-1.0, 1.0):
        for init_deg in range(0, 360, 15):
            rad = math.radians(init_deg)
            s0 = upm_hint

            def residuals(params):
                sc, th, tx, tz = params
                ct, st = math.cos(th), math.sin(th)
                dx = osm_circuit_pts[:, 0] - osm_c[0]
                dy = (osm_circuit_pts[:, 1] - osm_c[1]) * flip_y
                rx = sc * (ct * dx - st * dy) + tx
                rz = sc * (st * dx + ct * dy) + tz
                dists, _ = tel_tree.query(np.column_stack([rx, rz]))
                return dists

            r0 = residuals([s0, rad, tel_c[0], tel_c[1]])
            if best is not None and np.mean(r0) > best[0] * 3.5:
                continue

            res = least_squares(
                residuals,
                x0=[s0, rad, tel_c[0], tel_c[1]],
                bounds=([upm_hint * 0.85, -math.pi * 2, -200, -200], [upm_hint * 1.15, math.pi * 2, 200, 200]),
                max_nfev=150,
            )
            rms = float(np.sqrt(np.mean(res.fun ** 2)))
            if best is None or rms < best[0]:
                best = (rms, flip_y, res.x, res.fun)

    rms_units, flip_y, params, errs = best
    sc, th, tx, tz = [float(v) for v in params]
    rms_m = rms_units / sc
    max_m = float(np.max(errs)) / sc

    ct, st = math.cos(th), math.sin(th)
    dx = osm_circuit_pts[:, 0] - osm_c[0]
    dy = (osm_circuit_pts[:, 1] - osm_c[1]) * flip_y
    mapped_osm = np.column_stack([sc * (ct * dx - st * dy) + tx, sc * (st * dx + ct * dy) + tz])
    osm_tree = cKDTree(mapped_osm)
    tel_to_osm, _ = osm_tree.query(tel_pts)
    tel_rms_m = float(np.sqrt(np.mean(tel_to_osm ** 2))) / sc

    transform = {
        "originE": float(osm_c[0]),
        "originN": float(osm_c[1]),
        "flipY": float(flip_y),
        "scale": sc,
        "theta": th,
        "tx": tx,
        "tz": tz,
        "northVec": [round(float(-st * flip_y), 4), round(float(ct * flip_y), 4)],
    }
    return transform, max(rms_m, tel_rms_m), max_m


def apply_transform(pts: list[tuple[float, float]], tf: dict) -> list[list[float]]:
    ox, oy = tf["originE"], tf["originN"]
    flip = tf["flipY"]
    sc = tf["scale"]
    ct, st = math.cos(tf["theta"]), math.sin(tf["theta"])
    tx, tz = tf["tx"], tf["tz"]
    out = []
    for e, n in pts:
        dx = e - ox
        dy = (n - oy) * flip
        x = sc * (ct * dx - st * dy) + tx
        z = sc * (st * dx + ct * dy) + tz
        out.append([round(x, 2), round(z, 2)])
    return out


def parse_height(tags: dict) -> float:
    h = tags.get("height") or tags.get("building:height")
    if h:
        try:
            clean = str(h).lower().replace("m", "").strip().split()[0]
            val = float(clean)
            if 2.0 <= val <= 350.0:
                return val
        except ValueError:
            pass
    lvl = tags.get("building:levels")
    if lvl:
        try:
            val = float(str(lvl).split(";")[0].strip()) * 3.4
            if 2.5 <= val <= 350.0:
                return val
        except ValueError:
            pass
    btype = tags.get("building", "yes")
    if btype in ("stadium", "sports_hall", "grandstand"):
        return 14.0
    if btype in ("apartments", "commercial", "office", "hotel"):
        return 16.0
    if btype in ("house", "residential", "terrace", "detached"):
        return 6.5
    return 8.0


def build_2026_ads_atlas(out_dir: Path) -> list[dict]:
    """
    Generate ONE crisp texture atlas for all 2026 Australian Grand Prix trackside branding:
      - public/models/circuits/melbourne/ads.webp      (2048x1024, high)
      - public/models/circuits/melbourne/ads_low.webp  (1024x512, low)
    """
    W, H = 2048, 1024
    cols, rows = 4, 4  # 16 cells of 512x256
    cw, ch = W // cols, H // rows

    brands = [
        ("qatar_airways", "QATAR AIRWAYS", "AUSTRALIAN GRAND PRIX 2026", "#5C0632", "#FFFFFF", "#D4AF37"),
        ("f1_2026", "FORMULA 1", "MELBOURNE 2026", "#E10600", "#FFFFFF", "#15151E"),
        ("pirelli", "PIRELLI", "OFFICIAL TYRE SUPPLIER", "#FFD100", "#D5001C", "#15151E"),
        ("aramco", "aramco", "GLOBAL PARTNER", "#FFFFFF", "#0066B3", "#00A651"),
        ("dhl", "DHL", "OFFICIAL LOGISTICS", "#FFCC00", "#D40511", "#D40511"),
        ("heineken", "Heineken 0.0", "WHEN YOU DRIVE NEVER DRINK", "#006A34", "#FFFFFF", "#E10600"),
        ("lenovo", "Lenovo", "GLOBAL PARTNER", "#E2231A", "#FFFFFF", "#1A1A1A"),
        ("lvmh", "LVMH", "GLOBAL PARTNER", "#141824", "#F2E9D8", "#C8A96A"),
        ("tag_heuer", "TAG HEUER", "OFFICIAL TIMEKEEPER", "#0F1115", "#FFFFFF", "#008751"),
        ("msc_cruises", "MSC CRUISES", "GLOBAL PARTNER", "#00205B", "#FFFFFF", "#3EA4E6"),
        ("aws", "aws", "POWERED BY AWS", "#232F3E", "#FFFFFF", "#FF9900"),
        ("salesforce", "salesforce", "GLOBAL PARTNER", "#00A1E0", "#FFFFFF", "#032D60"),
        ("amex", "AMERICAN EXPRESS", "OFFICIAL PARTNER", "#006FCF", "#FFFFFF", "#8CC6FF"),
        ("crypto", "crypto.com", "OFFICIAL PARTNER", "#0B1426", "#FFFFFF", "#1199FA"),
        ("brake_100", "100", "METRES", "#FFFFFF", "#111111", "#E10600"),
        ("brake_50", "50", "METRES", "#FFFFFF", "#111111", "#E10600"),
    ]

    img = Image.new("RGB", (W, H), "#15151E")
    draw = ImageDraw.Draw(img)

    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    font_file = next((p for p in font_paths if os.path.exists(p)), None)
    f_big = ImageFont.truetype(font_file, 64) if font_file else ImageFont.load_default()
    f_med = ImageFont.truetype(font_file, 44) if font_file else ImageFont.load_default()
    f_sub = ImageFont.truetype(font_file, 22) if font_file else ImageFont.load_default()
    f_num = ImageFont.truetype(font_file, 120) if font_file else ImageFont.load_default()

    atlas_meta = []
    for idx, (key, title, sub, bg, fg, accent) in enumerate(brands):
        r, c = divmod(idx, cols)
        x0, y0 = c * cw, r * ch
        x1, y1 = x0 + cw, y0 + ch

        draw.rectangle([x0, y0, x1, y1], fill=bg)
        draw.rectangle([x0, y0, x1, y0 + 16], fill=accent)
        draw.rectangle([x0, y1 - 16, x1, y1], fill=accent)
        draw.rectangle([x0 + 2, y0 + 2, x1 - 3, y1 - 3], outline="#222222", width=2)

        if key.startswith("brake_"):
            bbox = draw.textbbox((0, 0), title, font=f_num)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text((x0 + (cw - tw) / 2, y0 + (ch - th) / 2 - 14), title, fill=fg, font=f_num)
        else:
            font_use = f_big if len(title) <= 10 else f_med
            bbox = draw.textbbox((0, 0), title, font=font_use)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text((x0 + (cw - tw) / 2, y0 + ch * 0.34 - th / 2), title, fill=fg, font=font_use)

            sb = draw.textbbox((0, 0), sub, font=f_sub)
            stw, sth = sb[2] - sb[0], sb[3] - sb[1]
            draw.text((x0 + (cw - stw) / 2, y0 + ch * 0.72 - sth / 2), sub, fill=accent if accent != bg else fg, font=f_sub)

        pad_u = 4 / W
        pad_v = 4 / H
        u0 = round(x0 / W + pad_u, 5)
        u1 = round(x1 / W - pad_u, 5)
        v1 = round(1.0 - (y0 / H + pad_v), 5)
        v0 = round(1.0 - (y1 / H - pad_v), 5)
        atlas_meta.append({"id": key, "label": title, "uv": [u0, v0, u1, v1]})

    high_path = out_dir / "ads.webp"
    low_path = out_dir / "ads_low.webp"
    img.save(high_path, format="WEBP", quality=85, method=6)
    img.resize((1024, 512), Image.Resampling.LANCZOS).save(low_path, format="WEBP", quality=80, method=6)
    print(f"[atlas] Wrote {high_path.name} ({high_path.stat().st_size / 1024:.1f} KB) and {low_path.name} ({low_path.stat().st_size / 1024:.1f} KB)")
    return atlas_meta


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    melb = json.loads(MELBOURNE_JSON.read_text(encoding="utf-8"))
    circuit = melb["circuit"]
    tel_pts = np.array([[p[0], p[2]] for p in circuit["points"]], dtype=float)
    perim = float(
        sum(
            math.hypot(tel_pts[(i + 1) % len(tel_pts), 0] - tel_pts[i, 0], tel_pts[(i + 1) % len(tel_pts), 1] - tel_pts[i, 1])
            for i in range(len(tel_pts))
        )
    )
    upm_hint = perim / (circuit["lengthKm"] * 1000.0)
    print(f"[telemetry] {len(tel_pts)} pts, lengthKm={circuit['lengthKm']}, perim={perim:.2f}, upm={upm_hint:.6f}")

    # 1. Fetch OSM data via official OSM API v0.6
    park_osm = fetch_osm_tiles(PARK_TILES, "albert_park_osm_v06.json")
    sky_osm = fetch_osm_tiles(SKYLINE_TILES, "melbourne_skyline_osm_v06.json")

    park_nodes = build_node_map(park_osm)
    sky_nodes = build_node_map(sky_osm)
    park_ways = {el["id"]: el for el in park_osm["elements"] if el["type"] == "way"}

    # 2. Extract OSM Albert Park circuit ways for alignment
    # Check relation for Albert Park Circuit first, then Lakeside/Aughtie/Ross Gregory Drive
    circuit_way_ids = set()
    for el in park_osm["elements"]:
        if el["type"] == "relation":
            name = el.get("tags", {}).get("name", "").lower()
            if "albert park" in name and ("circuit" in name or "grand prix" in name or el.get("tags", {}).get("sport") == "motor"):
                for m in el.get("members", []):
                    if m.get("type") == "way":
                        circuit_way_ids.add(m["ref"])

    raceway_pts = []
    if circuit_way_ids:
        for wid in circuit_way_ids:
            w = park_ways.get(wid)
            if not w:
                continue
            pts = way_coords(w, park_nodes)
            if len(pts) >= 2:
                ls = LineString(pts)
                steps = max(2, int(ls.length / 10.0))
                for k in range(steps):
                    p = ls.interpolate(k / steps, normalized=True)
                    raceway_pts.append((p.x, p.y))

    if len(raceway_pts) < 120:
        raceway_pts = []
        for w in park_ways.values():
            tags = w.get("tags", {})
            name = tags.get("name", "").lower()
            if tags.get("highway") == "raceway" or name in ("lakeside drive", "aughtie drive", "ross gregory drive"):
                pts = way_coords(w, park_nodes)
                if len(pts) >= 2:
                    ls = LineString(pts)
                    steps = max(2, int(ls.length / 10.0))
                    for k in range(steps):
                        p = ls.interpolate(k / steps, normalized=True)
                        raceway_pts.append((p.x, p.y))

    print(f"[align] Found {len(raceway_pts)} sampled OSM circuit points (rel ways={len(circuit_way_ids)})")
    tf, rms_m, max_m = align_osm_to_telemetry(np.array(raceway_pts), tel_pts, upm_hint)
    print(f"[align] Scale={tf['scale']:.6f} (upm={upm_hint:.6f}), theta={math.degrees(tf['theta']):.2f} deg, flipY={tf['flipY']}")
    print(f"[align] Alignment error: RMS = {rms_m:.2f} m, Max = {max_m:.2f} m")

    def poly_to_render(poly: Polygon, tol_m: float = 4.0) -> list[list[float]] | None:
        simp = poly.simplify(tol_m, preserve_topology=True)
        if simp.is_empty or simp.area < 40.0:
            return None
        coords = list(simp.exterior.coords)[:-1]
        if len(coords) < 3:
            return None
        return apply_transform(coords, tf)

    # 3. Extract Albert Park Lake (+ islands)
    lake_polys = []
    lake_islands = []
    for el in park_osm["elements"]:
        tags = el.get("tags", {})
        if tags.get("natural") != "water":
            continue
        name = tags.get("name", "").lower()
        if el["type"] == "relation":
            polys = extract_relation_polygons(el, park_ways, park_nodes)
            for p in polys:
                if p.area > 50000 or "albert park" in name:
                    ext = poly_to_render(p, tol_m=5.0)
                    if ext:
                        lake_polys.append(ext)
                    for hole in p.interiors:
                        hp = Polygon(hole)
                        if hp.area > 150:
                            hext = poly_to_render(hp, tol_m=3.0)
                            if hext:
                                lake_islands.append(hext)
        elif el["type"] == "way":
            pts = way_coords(el, park_nodes)
            if len(pts) >= 4 and pts[0] == pts[-1]:
                p = Polygon(pts)
                if p.is_valid and p.area > 40000:
                    ext = poly_to_render(p, tol_m=5.0)
                    if ext:
                        lake_polys.append(ext)

    print(f"[lake] Extracted {len(lake_polys)} lake polygon(s) and {len(lake_islands)} island(s)")

    lake_render_union = unary_union([Polygon(p) for p in lake_polys if len(p) >= 3]) if lake_polys else Polygon()
    island_render_union = unary_union([Polygon(p) for p in lake_islands if len(p) >= 3]) if lake_islands else Polygon()
    water_mask = lake_render_union.difference(island_render_union) if not lake_render_union.is_empty else Polygon()

    # 4. Extract sports ovals & golf course areas
    ovals = []
    golf = []
    for el in park_osm["elements"]:
        tags = el.get("tags", {})
        leisure = tags.get("leisure", "")
        golf_tag = tags.get("golf", "")
        if leisure not in ("pitch", "golf_course", "track") and golf_tag not in ("fairway", "green"):
            continue
        polys = []
        if el["type"] == "way":
            pts = way_coords(el, park_nodes)
            if len(pts) >= 4 and pts[0] == pts[-1]:
                p = Polygon(pts)
                if p.is_valid:
                    polys = [p]
        elif el["type"] == "relation":
            polys = extract_relation_polygons(el, park_ways, park_nodes)
        for p in polys:
            if p.area < 400 or p.area > 600000:
                continue
            rp = poly_to_render(p, tol_m=4.0)
            if not rp:
                continue
            if leisure == "golf_course" or golf_tag in ("fairway", "green"):
                golf.append(rp)
            else:
                ovals.append(rp)

    print(f"[park] Extracted {len(ovals)} sports ovals/pitches and {len(golf)} golf course shapes")

    # 5. Extract roads & walking paths
    roads = []
    paths = []
    tel_line = LineString(tel_pts)
    for w in park_ways.values():
        tags = w.get("tags", {})
        hw = tags.get("highway", "")
        if hw in ("", "raceway"):
            continue
        pts = way_coords(w, park_nodes)
        if len(pts) < 2:
            continue
        ls = LineString(pts).simplify(6.0, preserve_topology=False)
        rpts = apply_transform(list(ls.coords), tf)
        if not any(-145 <= x <= 145 and -145 <= z <= 145 for x, z in rpts):
            continue
        if hw in ("footway", "path", "cycleway"):
            if len(paths) < 160:
                paths.append(rpts)
        else:
            if len(roads) < 180:
                roads.append({"w": 1.0 if hw in ("primary", "secondary") else 0.6, "pts": rpts})

    print(f"[roads] Extracted {len(roads)} roads and {len(paths)} park paths")

    # 6. Extract buildings (park landmarks + surrounding blocks + St Kilda Rd / CBD skyline towers)
    buildings = []
    seen_centers = []

    def add_building(poly: Polygon, tags: dict, is_skyline: bool):
        if not poly.is_valid or poly.area < 60.0:
            return
        mrr = poly.minimum_rotated_rectangle
        coords = list(mrr.exterior.coords)
        if len(coords) < 4:
            return
        rc = apply_transform(coords[:4], tf)
        cx = sum(p[0] for p in rc) / 4.0
        cz = sum(p[1] for p in rc) / 4.0

        max_ext = 340.0 if is_skyline else 142.0
        if abs(cx) > max_ext or abs(cz) > max_ext:
            return

        pt = Point(cx, cz)
        if tel_line.distance(pt) < 5.5:
            return
        if not water_mask.is_empty and water_mask.contains(pt):
            return

        e1x, e1z = rc[1][0] - rc[0][0], rc[1][1] - rc[0][1]
        e2x, e2z = rc[2][0] - rc[1][0], rc[2][1] - rc[1][1]
        w = math.hypot(e1x, e1z)
        d = math.hypot(e2x, e2z)
        yaw = math.atan2(e1z, e1x)
        h_m = parse_height(tags)
        if is_skyline and h_m < 24.0:
            return
        h_r = round(h_m * tf["scale"] * 1.15, 2)

        for sx, sz in seen_centers:
            if (cx - sx) ** 2 + (cz - sz) ** 2 < 2.5:
                return
        seen_centers.append((cx, cz))

        name = tags.get("name", "").lower()
        btype = tags.get("building", "")
        if is_skyline or h_m >= 28.0:
            kind = 2
        elif any(k in name for k in ("stadium", "aquatic", "msac", "club", "boatshed", "pavilion", "pit")) or btype in ("stadium", "sports_hall"):
            kind = 0
        else:
            kind = 1
        buildings.append([round(cx, 2), round(cz, 2), round(w, 2), round(d, 2), h_r, round(yaw, 3), kind])

    for w in park_ways.values():
        tags = w.get("tags", {})
        if "building" not in tags:
            continue
        pts = way_coords(w, park_nodes)
        if len(pts) >= 4 and pts[0] == pts[-1]:
            add_building(Polygon(pts), tags, is_skyline=False)

    for el in sky_osm["elements"]:
        if el["type"] != "way":
            continue
        tags = el.get("tags", {})
        if "building" not in tags:
            continue
        pts = way_coords(el, sky_nodes)
        if len(pts) >= 4 and pts[0] == pts[-1]:
            add_building(Polygon(pts), tags, is_skyline=True)

    buildings.sort(key=lambda b: (0 if b[6] == 0 else (1 if b[6] == 2 else 2), -b[4]))
    park_b = [b for b in buildings if b[6] in (0, 1)][:320]
    sky_b = [b for b in buildings if b[6] == 2][:160]
    buildings = park_b + sky_b
    print(f"[buildings] Kept {len(park_b)} park/suburb buildings and {len(sky_b)} CBD/St Kilda Rd towers")

    # 7. Extract real OSM trees (open parkland gum trees & lakeside palms)
    raw_trees = []
    for el in park_osm["elements"]:
        if el["type"] == "node" and el.get("tags", {}).get("natural") == "tree":
            if el["id"] in park_nodes:
                raw_trees.append(park_nodes[el["id"]])
        elif el["type"] == "way" and el.get("tags", {}).get("natural") == "tree_row":
            pts = way_coords(el, park_nodes)
            if len(pts) >= 2:
                ls = LineString(pts)
                steps = max(2, int(ls.length / 18.0))
                for k in range(steps + 1):
                    p = ls.interpolate(k / steps, normalized=True)
                    raw_trees.append((p.x, p.y))

    r_trees = apply_transform(raw_trees, tf)
    oval_union = unary_union([Polygon(p) for p in ovals if len(p) >= 3]) if ovals else Polygon()
    trees = []
    tree_grid = set()
    rng_np = np.random.default_rng(2026)
    for x, z in r_trees:
        if abs(x) > 135 or abs(z) > 135:
            continue
        gx, gz = int(x // 2.8), int(z // 2.8)
        if (gx, gz) in tree_grid:
            continue
        pt = Point(x, z)
        if tel_line.distance(pt) < 4.8:
            continue
        if not water_mask.is_empty and water_mask.contains(pt):
            continue
        if not oval_union.is_empty and oval_union.contains(pt):
            continue
        tree_grid.add((gx, gz))
        is_palm = 1 if (not lake_render_union.is_empty and lake_render_union.distance(pt) < 6.0 and rng_np.random() < 0.25) else 0
        scale = round(float(0.8 + rng_np.random() * 0.65), 2)
        trees.append([x, z, scale, is_palm])

    if len(trees) > 850:
        idx = rng_np.choice(len(trees), size=850, replace=False)
        trees = [trees[i] for i in sorted(idx)]
    print(f"[trees] Kept {len(trees)} OSM parkland trees")

    # 8. Port Phillip Bay water hint polygon to the south-west
    bay_utm = [
        TRANSFORMER.transform(144.940, -37.848),
        TRANSFORMER.transform(144.956, -37.855),
        TRANSFORMER.transform(144.972, -37.864),
        TRANSFORMER.transform(144.958, -37.878),
        TRANSFORMER.transform(144.930, -37.868),
    ]
    bay_poly = apply_transform(bay_utm, tf)

    # 9. Build 2026 sponsor atlas WebP (high & low)
    from build_albert_park_logos import build_logo_atlas
    atlas_meta = build_logo_atlas(OUT_DIR)

    # 10. Data-driven 2026 Albert Park grandstands, bridges, and trackside advertising placements
    grandstands = [
        {"name": "Piastri / Fangio", "u0": 0.965, "u1": 0.045, "side": -1, "rows": 7, "roofed": True},
        {"name": "Moss", "u0": 0.050, "u1": 0.072, "side": -1, "rows": 5, "roofed": False},
        {"name": "Jones", "u0": 0.076, "u1": 0.102, "side": -1, "rows": 6, "roofed": True},
        {"name": "Brabham", "u0": 0.072, "u1": 0.108, "side": 1, "rows": 6, "roofed": True},
        {"name": "Hill", "u0": 0.212, "u1": 0.242, "side": -1, "rows": 5, "roofed": False},
        {"name": "Stewart", "u0": 0.305, "u1": 0.332, "side": 1, "rows": 5, "roofed": False},
        {"name": "Button / Clark", "u0": 0.435, "u1": 0.475, "side": -1, "rows": 5, "roofed": False},
        {"name": "Waite", "u0": 0.578, "u1": 0.618, "side": -1, "rows": 6, "roofed": False},
        {"name": "Lauda", "u0": 0.775, "u1": 0.808, "side": -1, "rows": 5, "roofed": False},
        {"name": "Prost / Senna", "u0": 0.918, "u1": 0.955, "side": -1, "rows": 6, "roofed": True},
    ]

    bridges = [
        {"name": "Pit Straight Footbridge", "u": 0.945, "brand": "qatar_airways"},
        {"name": "Lakeside Drive Bridge", "u": 0.505, "brand": "pirelli"},
        {"name": "Turn 12-13 Overpass", "u": 0.835, "brand": "aramco"},
    ]

    ads = [
        {"u": 0.985, "side": -1, "brand": "qatar_airways", "len": 7.5, "h": 1.15, "kind": "board"},
        {"u": 0.005, "side": -1, "brand": "qatar_airways", "len": 7.5, "h": 1.15, "kind": "board"},
        {"u": 0.025, "side": -1, "brand": "tag_heuer", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.048, "side": -1, "brand": "pirelli", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.062, "side": -1, "brand": "brake_100", "len": 1.1, "h": 0.9, "kind": "brake"},
        {"u": 0.072, "side": -1, "brand": "brake_50", "len": 1.1, "h": 0.9, "kind": "brake"},
        {"u": 0.088, "side": -1, "brand": "qatar_airways", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.105, "side": 1, "brand": "aramco", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.155, "side": -1, "brand": "dhl", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.185, "side": 1, "brand": "heineken", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.200, "side": -1, "brand": "brake_100", "len": 1.1, "h": 0.9, "kind": "brake"},
        {"u": 0.210, "side": -1, "brand": "brake_50", "len": 1.1, "h": 0.9, "kind": "brake"},
        {"u": 0.228, "side": -1, "brand": "pirelli", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.285, "side": 1, "brand": "lenovo", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.345, "side": -1, "brand": "aws", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.382, "side": -1, "brand": "lvmh", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.455, "side": -1, "brand": "msc_cruises", "len": 7.5, "h": 1.15, "kind": "board"},
        {"u": 0.535, "side": -1, "brand": "amex", "len": 7.5, "h": 1.15, "kind": "board"},
        {"u": 0.562, "side": -1, "brand": "brake_100", "len": 1.1, "h": 0.9, "kind": "brake"},
        {"u": 0.592, "side": -1, "brand": "qatar_airways", "len": 7.5, "h": 1.15, "kind": "board"},
        {"u": 0.625, "side": 1, "brand": "salesforce", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.680, "side": -1, "brand": "crypto", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.715, "side": -1, "brand": "brake_100", "len": 1.1, "h": 0.9, "kind": "brake"},
        {"u": 0.725, "side": -1, "brand": "brake_50", "len": 1.1, "h": 0.9, "kind": "brake"},
        {"u": 0.742, "side": -1, "brand": "aramco", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.792, "side": -1, "brand": "heineken", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.855, "side": -1, "brand": "dhl", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.885, "side": 1, "brand": "pirelli", "len": 6.5, "h": 1.15, "kind": "board"},
        {"u": 0.930, "side": -1, "brand": "f1_2026", "len": 7.0, "h": 1.15, "kind": "board"},
        {"u": 0.085, "side": -1, "brand": "qatar_airways", "len": 8.0, "h": 2.6, "kind": "decal"},
        {"u": 0.222, "side": -1, "brand": "aramco", "len": 7.5, "h": 2.4, "kind": "decal"},
        {"u": 0.595, "side": -1, "brand": "pirelli", "len": 8.0, "h": 2.6, "kind": "decal"},
        {"u": 0.785, "side": -1, "brand": "qatar_airways", "len": 7.5, "h": 2.4, "kind": "decal"},
    ]

    env_payload = {
        "meta": {
            "circuit": "melbourne",
            "event2026": "FORMULA 1 QATAR AIRWAYS AUSTRALIAN GRAND PRIX 2026",
            "attribution": "© OpenStreetMap contributors (ODbL)",
            "alignmentRmsM": round(rms_m, 2),
            "alignmentMaxM": round(max_m, 2),
            "transform": tf,
        },
        "lake": lake_polys,
        "islands": lake_islands,
        "bay": bay_poly,
        "ovals": ovals,
        "golf": golf,
        "roads": roads,
        "paths": paths,
        "buildings": buildings,
        "trees": trees,
        "grandstands": grandstands,
        "bridges": bridges,
        "atlas": atlas_meta,
        "ads": ads,
    }

    high_json = OUT_DIR / "albert_park_env.json"
    high_json.write_text(json.dumps(env_payload, separators=(",", ":")), encoding="utf-8")

    low_payload = {
        **env_payload,
        "paths": [],
        "roads": roads[:60],
        "buildings": [b for b in buildings if b[6] in (0, 2)][:110],
        "trees": trees[::3],
        "ads": [a for a in ads if a["kind"] != "brake"],
    }
    low_json = OUT_DIR / "albert_park_env_low.json"
    low_json.write_text(json.dumps(low_payload, separators=(",", ":")), encoding="utf-8")

    print(f"[out] {high_json.name}: {high_json.stat().st_size / 1024:.1f} KB")
    print(f"[out] {low_json.name}: {low_json.stat().st_size / 1024:.1f} KB")
    total_high = sum((OUT_DIR / f).stat().st_size for f in ("albert_park_env.json", "ads.webp")) / 1024
    total_low = sum((OUT_DIR / f).stat().st_size for f in ("albert_park_env_low.json", "ads_low.webp")) / 1024
    print(f"[budget] High total download: {total_high:.1f} KB (limit 3072 KB)")
    print(f"[budget] Low  total download: {total_low:.1f} KB (limit 600 KB)")


if __name__ == "__main__":
    main()
