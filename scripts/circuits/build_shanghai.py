#!/usr/bin/env python3
"""
Build script for GhostLap 2026 — Shanghai International Circuit (2026 Chinese GP).

Uses scripts/circuits/common/osm_pipeline.py and logo_atlas.py to:
  1. Fetch real OpenStreetMap features around Shanghai International Circuit (Jiading District,
     NW Shanghai, EPSG:32651 / UTM 51N) via OSM API v0.6 (© OpenStreetMap contributors, ODbL).
  2. Fit a 2D similarity transform aligning the OSM raceway ways to
     public/data/2026/races/shanghai.json telemetry points and report RMS/Max error in metres.
  3. Extract paddock lake, ponds/canals, car parks, expressways/roads, Jiading industrial &
     residential buildings, and parkland trees.
  4. Generate compact JSONs + 2026 Chinese GP (Heineken) logo WebP atlas + facade WebP atlas
     in public/models/circuits/shanghai/.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from common.osm_pipeline import (
    align_osm_to_telemetry,
    apply_transform,
    build_node_map,
    extract_relation_polygons,
    fetch_osm_tiles,
    parse_building_height,
    way_coords,
)
from common.logo_atlas import build_partner_logo_atlas
from build_albert_park_facades import build_facade_atlas

SHANGHAI_JSON = REPO_ROOT / "public/data/2026/races/shanghai.json"
OUT_DIR = REPO_ROOT / "public/models/circuits/shanghai"
CACHE_DIR = SCRIPT_DIR / ".cache"

# Jiading District, NW Shanghai — 2x2 tile grid around Shanghai International Circuit (31.3389 N, 121.2205 E)
SHANGHAI_TILES = [
    (121.204, 31.326, 121.221, 31.339),
    (121.221, 31.326, 121.238, 31.339),
    (121.204, 31.339, 121.221, 31.352),
    (121.221, 31.339, 121.238, 31.352),
]

UTM_EPSG = "EPSG:32651"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sh = json.loads(SHANGHAI_JSON.read_text(encoding="utf-8"))
    circuit = sh["circuit"]
    tel_pts = np.array([[p[0], p[2]] for p in circuit["points"]], dtype=float)
    perim = float(
        sum(
            math.hypot(tel_pts[(i + 1) % len(tel_pts), 0] - tel_pts[i, 0], tel_pts[(i + 1) % len(tel_pts), 1] - tel_pts[i, 1])
            for i in range(len(tel_pts))
        )
    )
    upm_hint = perim / (circuit["lengthKm"] * 1000.0)
    print(f"[telemetry] Shanghai: {len(tel_pts)} pts, lengthKm={circuit['lengthKm']}, perim={perim:.2f}, upm={upm_hint:.6f}")

    # 1. Fetch OSM data
    osm = fetch_osm_tiles(SHANGHAI_TILES, CACHE_DIR / "shanghai_osm_v06.json")
    nodes = build_node_map(osm, UTM_EPSG)
    ways = {el["id"]: el for el in osm["elements"] if el["type"] == "way"}

    # 2. Extract OSM main GP circuit ways from relation (type=circuit, Shanghai International Circuit)
    circuit_way_ids = set()
    for el in osm["elements"]:
        if el["type"] == "relation":
            tags = el.get("tags", {})
            if tags.get("type") == "circuit" or "shanghai international circuit" in tags.get("name", "").lower():
                for m in el.get("members", []):
                    if m.get("type") == "way":
                        circuit_way_ids.add(m["ref"])

    raceway_pts = []
    target_ways = [ways[wid] for wid in circuit_way_ids if wid in ways]
    if not target_ways:
        target_ways = [w for w in ways.values() if w.get("tags", {}).get("highway") == "raceway"]
    for w in target_ways:
        pts = way_coords(w, nodes)
        if len(pts) >= 2:
            ls = LineString(pts)
            steps = max(2, int(ls.length / 10.0))
            for k in range(steps):
                p = ls.interpolate(k / steps, normalized=True)
                raceway_pts.append((p.x, p.y))

    print(f"[align] Found {len(raceway_pts)} sampled OSM raceway points")
    tf, rms_m, max_m = align_osm_to_telemetry(np.array(raceway_pts), tel_pts, upm_hint)
    print(f"[align] Scale={tf['scale']:.6f} (upm={upm_hint:.6f}), theta={math.degrees(tf['theta']):.2f} deg, flipY={tf['flipY']}")
    print(f"[align] Alignment error: RMS = {rms_m:.2f} m, Max = {max_m:.2f} m")

    def poly_to_render(poly: Polygon, tol_m: float = 4.0) -> list[list[float]] | None:
        simp = poly.simplify(tol_m, preserve_topology=True)
        if simp.is_empty or simp.area < 80.0:
            return None
        coords = list(simp.exterior.coords)[:-1]
        if len(coords) < 3:
            return None
        rc = apply_transform(coords, tf)
        if not any(-160 <= x <= 160 and -160 <= z <= 160 for x, z in rc):
            return None
        return rc

    # 3. Extract water bodies (paddock lake, surrounding ponds, Jiading canals)
    water_polys = []
    islands = []
    for el in osm["elements"]:
        tags = el.get("tags", {})
        is_water = tags.get("natural") == "water" or tags.get("waterway") in ("riverbank", "canal", "dock")
        if not is_water:
            continue
        polys = []
        if el["type"] == "way":
            pts = way_coords(el, nodes)
            if len(pts) >= 4 and pts[0] == pts[-1]:
                p = Polygon(pts)
                if p.is_valid:
                    polys = [p]
        elif el["type"] == "relation":
            polys = extract_relation_polygons(el, ways, nodes)
        for p in polys:
            if p.area < 300.0:
                continue
            rp = poly_to_render(p, tol_m=4.0)
            if rp:
                water_polys.append(rp)
            for hole in p.interiors:
                hp = Polygon(hole)
                if hp.area > 120.0:
                    hrp = poly_to_render(hp, tol_m=3.0)
                    if hrp:
                        islands.append(hrp)

    # Sort largest water bodies first and cap
    water_polys.sort(key=lambda p: Polygon(p).area if len(p) >= 3 else 0, reverse=True)
    water_polys = water_polys[:45]
    print(f"[water] Extracted {len(water_polys)} water bodies (paddock lake, ponds, canals) and {len(islands)} islands")

    water_union = unary_union([Polygon(p) for p in water_polys if len(p) >= 3]) if water_polys else Polygon()

    # 4. Extract car parks / plazas (stored in `ovals` as paved plazas) & green park areas (stored in `golf`)
    carparks = []
    greens = []
    for el in osm["elements"]:
        tags = el.get("tags", {})
        is_park = tags.get("amenity") == "parking"
        is_green = tags.get("leisure") in ("park", "pitch", "garden") or tags.get("landuse") in ("grass", "meadow", "farmland", "recreation_ground")
        if not (is_park or is_green):
            continue
        polys = []
        if el["type"] == "way":
            pts = way_coords(el, nodes)
            if len(pts) >= 4 and pts[0] == pts[-1]:
                p = Polygon(pts)
                if p.is_valid:
                    polys = [p]
        elif el["type"] == "relation":
            polys = extract_relation_polygons(el, ways, nodes)
        for p in polys:
            if p.area < 500.0 or p.area > 800000.0:
                continue
            rp = poly_to_render(p, tol_m=5.0)
            if not rp:
                continue
            if is_park:
                carparks.append(rp)
            else:
                greens.append(rp)

    carparks = carparks[:35]
    greens = greens[:45]
    print(f"[areas] Extracted {len(carparks)} car parks/plazas and {len(greens)} green/farmland areas")

    # 5. Extract roads/expressways & walking paths
    roads = []
    paths = []
    tel_line = LineString(tel_pts)
    for w in ways.values():
        tags = w.get("tags", {})
        hw = tags.get("highway", "")
        if hw in ("", "raceway"):
            continue
        pts = way_coords(w, nodes)
        if len(pts) < 2:
            continue
        ls = LineString(pts).simplify(6.0, preserve_topology=False)
        rpts = apply_transform(list(ls.coords), tf)
        if not any(-160 <= x <= 160 and -160 <= z <= 160 for x, z in rpts):
            continue
        if hw in ("footway", "path", "cycleway", "pedestrian"):
            if len(paths) < 120:
                paths.append(rpts)
        else:
            if len(roads) < 180:
                weight = 1.0 if hw in ("motorway", "trunk", "primary", "secondary") else 0.6
                roads.append({"w": weight, "pts": rpts})

    print(f"[roads] Extracted {len(roads)} roads/expressways and {len(paths)} paths")

    # 6. Extract OSM buildings (Jiading industrial, residential, & circuit support buildings)
    buildings = []
    seen_centers = []
    for w in ways.values():
        tags = w.get("tags", {})
        if "building" not in tags:
            continue
        pts = way_coords(w, nodes)
        if len(pts) < 4 or pts[0] != pts[-1]:
            continue
        poly = Polygon(pts)
        if not poly.is_valid or poly.area < 80.0:
            continue
        mrr = poly.minimum_rotated_rectangle
        coords = list(mrr.exterior.coords)
        if len(coords) < 4:
            continue
        rc = apply_transform(coords[:4], tf)
        cx = sum(p[0] for p in rc) / 4.0
        cz = sum(p[1] for p in rc) / 4.0
        if abs(cx) > 165.0 or abs(cz) > 165.0:
            continue
        pt = Point(cx, cz)
        # Keep clear of active track & pit complex (custom landmarks handle pit/main grandstand/paddock)
        if tel_line.distance(pt) < 7.5:
            continue
        if not water_union.is_empty and water_union.contains(pt):
            continue

        e1x, e1z = rc[1][0] - rc[0][0], rc[1][1] - rc[0][1]
        e2x, e2z = rc[2][0] - rc[1][0], rc[2][1] - rc[1][1]
        bw = math.hypot(e1x, e1z)
        bd = math.hypot(e2x, e2z)
        yaw = math.atan2(e1z, e1x)
        h_m = parse_building_height(tags)
        h_r = round(h_m * tf["scale"] * 1.1, 2)

        if any((cx - sx) ** 2 + (cz - sz) ** 2 < 3.0 for sx, sz in seen_centers):
            continue
        seen_centers.append((cx, cz))

        btype = tags.get("building", "")
        if h_m >= 26.0:
            kind = 2
        elif btype in ("industrial", "warehouse", "commercial", "grandstand", "public"):
            kind = 0
        else:
            kind = 1
        buildings.append([round(cx, 2), round(cz, 2), round(bw, 2), round(bd, 2), h_r, round(yaw, 3), kind])

    buildings.sort(key=lambda b: -b[4])
    buildings = buildings[:320]
    print(f"[buildings] Kept {len(buildings)} OSM Jiading buildings")

    # 7. Extract OSM trees + parkland green belt trees around the circuit
    raw_trees = []
    for el in osm["elements"]:
        if el["type"] == "node" and el.get("tags", {}).get("natural") == "tree":
            if el["id"] in nodes:
                raw_trees.append(nodes[el["id"]])
        elif el["type"] == "way" and el.get("tags", {}).get("natural") == "tree_row":
            pts = way_coords(el, nodes)
            if len(pts) >= 2:
                ls = LineString(pts)
                steps = max(2, int(ls.length / 18.0))
                for k in range(steps + 1):
                    p = ls.interpolate(k / steps, normalized=True)
                    raw_trees.append((p.x, p.y))

    r_trees = apply_transform(raw_trees, tf)
    park_union = unary_union([Polygon(p) for p in carparks if len(p) >= 3]) if carparks else Polygon()
    trees = []
    tree_grid = set()
    rng_np = np.random.default_rng(20260315)
    for x, z in r_trees:
        if abs(x) > 150 or abs(z) > 150:
            continue
        gx, gz = int(x // 3.0), int(z // 3.0)
        if (gx, gz) in tree_grid:
            continue
        pt = Point(x, z)
        if tel_line.distance(pt) < 6.0:
            continue
        if not water_union.is_empty and water_union.contains(pt):
            continue
        if not park_union.is_empty and park_union.contains(pt):
            continue
        tree_grid.add((gx, gz))
        trees.append([x, z, round(float(0.8 + rng_np.random() * 0.6), 2), 0])

    # If OSM has sparse tree nodes in Jiading, supplement gently inside extracted OSM green/park polygons
    if len(trees) < 350 and greens:
        green_polys = [Polygon(p) for p in greens if len(p) >= 3]
        for gp in green_polys:
            minx, minz, maxx, maxz = gp.bounds
            for _ in range(25):
                if len(trees) >= 520:
                    break
                rx = float(rng_np.uniform(minx, maxx))
                rz = float(rng_np.uniform(minz, maxz))
                pt = Point(rx, rz)
                if not gp.contains(pt):
                    continue
                gx, gz = int(rx // 3.2), int(rz // 3.2)
                if (gx, gz) in tree_grid or tel_line.distance(pt) < 6.5:
                    continue
                if not water_union.is_empty and water_union.contains(pt):
                    continue
                tree_grid.add((gx, gz))
                trees.append([round(rx, 2), round(rz, 2), round(float(0.75 + rng_np.random() * 0.65), 2), 0])

    trees = trees[:600]
    print(f"[trees] Kept {len(trees)} parkland/green-belt trees")

    # 8. Build 2026 Chinese GP (Heineken) logo atlas & facade atlas
    atlas_meta = build_partner_logo_atlas(OUT_DIR, CACHE_DIR / "logos")
    build_facade_atlas(OUT_DIR)

    # Print lap fractions so corner placements are verified directly against shanghai.json
    n_pts = len(tel_pts)
    print("u     |    x    |    z    | heading")
    for k in range(0, 100, 5):
        i = int(k / 100 * n_pts) % n_pts
        j = (i + 3) % n_pts
        ang = math.degrees(math.atan2(tel_pts[j, 1] - tel_pts[i, 1], tel_pts[j, 0] - tel_pts[i, 0]))
        print(f"{k/100:5.2f} | {tel_pts[i,0]:7.2f} | {tel_pts[i,1]:7.2f} | {ang:6.1f}")

    # 9. Data-driven 2026 Shanghai grandstands, twin wing bridges, and Heineken Chinese GP trackside ads
    # Main Grandstand A is custom-built in shanghaiBuilders.ts (massive 400m sweeping canopy on left -1 of pit straight)
    grandstands = [
        {"name": "Grandstand H (T1-T2 Snail)", "u0": 0.085, "u1": 0.145, "side": -1, "rows": 7, "roofed": False},
        {"name": "Grandstand J (T2-T3)", "u0": 0.160, "u1": 0.205, "side": -1, "rows": 6, "roofed": False},
        {"name": "Grandstand B (T6 Hairpin)", "u0": 0.345, "u1": 0.388, "side": -1, "rows": 6, "roofed": False},
        {"name": "Grandstand K (T14 Hairpin)", "u0": 0.815, "u1": 0.870, "side": -1, "rows": 8, "roofed": False},
        {"name": "Grandstand L (T16 Final Corner)", "u0": 0.905, "u1": 0.942, "side": -1, "rows": 6, "roofed": False},
    ]

    # Shanghai's iconic twin elevated wing bridges over the pit straight + back straight bridge
    bridges = [
        {"name": "Pit Straight West Wing", "u": 0.032, "brand": "heineken"},
        {"name": "Pit Straight East Wing", "u": 0.968, "brand": "heineken"},
        {"name": "Back Straight Overpass", "u": 0.720, "brand": "pirelli"},
    ]

    ads = [
        # Main straight (Title sponsor Heineken + F1 + TAG Heuer)
        {"u": 0.985, "side": -1, "brand": "heineken", "len": 9.0, "h": 1.3, "kind": "board"},
        {"u": 0.012, "side": -1, "brand": "heineken", "len": 9.0, "h": 1.3, "kind": "board"},
        {"u": 0.055, "side": -1, "brand": "tag_heuer", "len": 8.0, "h": 1.3, "kind": "board"},
        {"u": 0.068, "side": -1, "brand": "brake_100", "len": 1.3, "h": 1.0, "kind": "brake"},
        {"u": 0.076, "side": -1, "brand": "brake_50", "len": 1.3, "h": 1.0, "kind": "brake"},
        # T1-T2-T3 Snail
        {"u": 0.105, "side": -1, "brand": "pirelli", "len": 8.5, "h": 1.3, "kind": "board"},
        {"u": 0.155, "side": 1, "brand": "aramco", "len": 8.0, "h": 1.3, "kind": "board"},
        {"u": 0.220, "side": -1, "brand": "dhl", "len": 8.5, "h": 1.3, "kind": "board"},
        # T4 -> T6 Hairpin
        {"u": 0.290, "side": 1, "brand": "lenovo", "len": 8.5, "h": 1.3, "kind": "board"},
        {"u": 0.335, "side": -1, "brand": "brake_100", "len": 1.3, "h": 1.0, "kind": "brake"},
        {"u": 0.345, "side": -1, "brand": "brake_50", "len": 1.3, "h": 1.0, "kind": "brake"},
        {"u": 0.365, "side": -1, "brand": "heineken", "len": 8.5, "h": 1.3, "kind": "board"},
        # T7-T8 High-G sweep & T9-T10
        {"u": 0.435, "side": -1, "brand": "qatar_airways", "len": 8.5, "h": 1.3, "kind": "board"},
        {"u": 0.490, "side": 1, "brand": "aws", "len": 8.5, "h": 1.3, "kind": "board"},
        {"u": 0.555, "side": -1, "brand": "lvmh", "len": 8.5, "h": 1.3, "kind": "board"},
        # T11-T13 Second snail onto 1.17 km back straight
        {"u": 0.615, "side": -1, "brand": "msc_cruises", "len": 8.5, "h": 1.3, "kind": "board"},
        {"u": 0.680, "side": -1, "brand": "salesforce", "len": 9.0, "h": 1.3, "kind": "board"},
        {"u": 0.745, "side": 1, "brand": "amex", "len": 9.0, "h": 1.3, "kind": "board"},
        {"u": 0.785, "side": -1, "brand": "crypto", "len": 8.5, "h": 1.3, "kind": "board"},
        {"u": 0.805, "side": -1, "brand": "brake_100", "len": 1.3, "h": 1.0, "kind": "brake"},
        {"u": 0.818, "side": -1, "brand": "brake_50", "len": 1.3, "h": 1.0, "kind": "brake"},
        # T14 Hairpin (Grandstand K) -> T16
        {"u": 0.842, "side": -1, "brand": "heineken", "len": 9.0, "h": 1.3, "kind": "board"},
        {"u": 0.885, "side": 1, "brand": "pirelli", "len": 8.5, "h": 1.3, "kind": "board"},
        {"u": 0.925, "side": -1, "brand": "f1_2026", "len": 8.5, "h": 1.3, "kind": "board"},
        # Large painted run-off tarmac decals
        {"u": 0.115, "side": -1, "brand": "heineken", "len": 10.0, "h": 3.4, "kind": "decal"},
        {"u": 0.362, "side": -1, "brand": "aramco", "len": 9.5, "h": 3.2, "kind": "decal"},
        {"u": 0.605, "side": -1, "brand": "pirelli", "len": 9.5, "h": 3.2, "kind": "decal"},
        {"u": 0.840, "side": -1, "brand": "heineken", "len": 10.5, "h": 3.5, "kind": "decal"},
    ]

    env_payload = {
        "meta": {
            "circuit": "shanghai",
            "event2026": "FORMULA 1 HEINEKEN CHINESE GRAND PRIX 2026",
            "attribution": "© OpenStreetMap contributors (ODbL)",
            "alignmentRmsM": round(rms_m, 2),
            "alignmentMaxM": round(max_m, 2),
            "transform": tf,
        },
        "lake": water_polys,
        "islands": islands,
        "bay": [],
        "ovals": carparks,
        "golf": greens,
        "roads": roads,
        "paths": paths,
        "buildings": buildings,
        "trees": trees,
        "grandstands": grandstands,
        "bridges": bridges,
        "atlas": atlas_meta,
        "ads": ads,
    }

    high_json = OUT_DIR / "shanghai_env.json"
    high_json.write_text(json.dumps(env_payload, separators=(",", ":")), encoding="utf-8")

    low_payload = {
        **env_payload,
        "paths": [],
        "roads": roads[:60],
        "buildings": buildings[:110],
        "trees": trees[::3],
        "ads": [a for a in ads if a["kind"] != "brake"],
    }
    low_json = OUT_DIR / "shanghai_env_low.json"
    low_json.write_text(json.dumps(low_payload, separators=(",", ":")), encoding="utf-8")

    total_high = sum((OUT_DIR / f).stat().st_size for f in ("shanghai_env.json", "ads.webp", "facades.webp")) / 1024
    total_low = sum((OUT_DIR / f).stat().st_size for f in ("shanghai_env_low.json", "ads_low.webp", "facades_low.webp")) / 1024
    print(f"[out] shanghai_env.json: {high_json.stat().st_size/1024:.1f} KB | shanghai_env_low.json: {low_json.stat().st_size/1024:.1f} KB")
    print(f"[budget] Shanghai High total: {total_high:.1f} KB (limit 3072 KB) | Low total: {total_low:.1f} KB (limit 600 KB)")


if __name__ == "__main__":
    main()
