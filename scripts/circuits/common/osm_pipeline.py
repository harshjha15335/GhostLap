"""
Shared OpenStreetMap extraction, projection, telemetry alignment, and simplification
pipeline for GhostLap 2026 custom circuits.
"""

import json
import math
import time
import urllib.request
from pathlib import Path

import numpy as np
from pyproj import Transformer
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union

USER_AGENT = "Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)"
OSM_API_URL = "https://api.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}"


def fetch_osm_tiles(
    tiles: list[tuple[float, float, float, float]],
    cache_path: Path,
) -> dict:
    """Fetch and merge OSM API v0.6 JSON tiles with local caching."""
    cache_path.parent.mkdir(parents=True, exist_ok=True)
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
            time.sleep(0.35)

    result = {"elements": list(merged.values())}
    cache_path.write_text(json.dumps(result), encoding="utf-8")
    print(f"[osm] Saved {len(result['elements'])} merged elements to {cache_path.name}")
    return result


def build_node_map(osm: dict, epsg_utm: str) -> dict[int, tuple[float, float]]:
    """Project all OSM nodes from WGS84 to local UTM metres."""
    transformer = Transformer.from_crs("EPSG:4326", epsg_utm, always_xy=True)
    nodes: dict[int, tuple[float, float]] = {}
    for el in osm.get("elements", []):
        if el["type"] == "node":
            x, y = transformer.transform(el["lon"], el["lat"])
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
        merged_outer = merged_outer.difference(unary_union(inners))
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
    so OSM circuit points overlap GhostLap telemetry points.
    Returns (transform_dict, rms_error_m, max_error_m).
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
                bounds=([upm_hint * 0.80, -math.pi * 2, -200, -200], [upm_hint * 1.20, math.pi * 2, 200, 200]),
                max_nfev=160,
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


def parse_building_height(tags: dict) -> float:
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
    if btype in ("industrial", "warehouse", "manufacture"):
        return 11.0
    if btype in ("apartments", "commercial", "office", "hotel"):
        return 18.0
    if btype in ("house", "residential", "terrace", "detached"):
        return 7.0
    return 9.0
