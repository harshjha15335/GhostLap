#!/usr/bin/env python3
"""
GhostLap 2026 — per-point track widths for CircuitGeometry.

Real widths come from the TUMFTM racetrack-database (LGPL-3.0,
https://github.com/TUMFTM/racetrack-database): a smoothed OpenStreetMap
centre line with left/right track widths measured from satellite imagery.
That centre line is aligned to our OpenF1 telemetry centre line with a
similarity (Procrustes) fit over every start offset and both directions; the
fit is sanity-checked (residual, scale vs the lap length from the data,
share of points that found a partner) before any width is used. Circuits the
database does not cover, or that fail the checks (layout changes), get a
uniform default width.

Output per circuit: `widths: [[left, right], ...]`, one pair per point, in
render units (the same units as `points`). Left/right are relative to the
racing direction; right = tangent × up in render space.

Usage
  python3 scripts/track_widths.py           # add widths to the existing bundles in place
  python3 scripts/track_widths.py --check   # only print the alignment report

`fetch_2026_season.py` calls attach_widths() for every circuit it builds.
Standard library only. Downloads are cached in scripts/.cache/tumftm/.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import ssl
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache" / "tumftm"
OUT = ROOT / "public" / "data" / "2026"
SEED_OUT = ROOT / "src" / "data" / "seed"
TUMFTM_BASE = "https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/"

# our slug -> TUMFTM file stem
TUMFTM_TRACKS = {
    "melbourne": "Melbourne",
    "shanghai": "Shanghai",
    "suzuka": "Suzuka",
    "montreal": "Montreal",
    "catalunya": "Catalunya",
    "spielberg": "Spielberg",
    "silverstone": "Silverstone",
    "spa-francorchamps": "Spa",
    "hungaroring": "Budapest",
    "zandvoort": "Zandvoort",
    "monza": "Monza",
    "mexico-city": "MexicoCity",
    "interlagos": "SaoPaulo",
    "austin": "Austin",
    "kuala-lumpur": "Sepang",
}

DEFAULT_WIDTH_M = 12.0
MIN_WIDTH_M = 8.0
MAX_WIDTH_M = 25.0
ALIGN_SAMPLES = 400
# acceptance thresholds for a TUMFTM ↔ OpenF1 fit
MAX_RMS_M = 10.0           # residual of the similarity fit after ICP refinement
MAX_SCALE_DEV = 0.08       # fitted metres-per-unit vs lap length from the data
MATCH_DIST_M = 15.0       # a point "matches" if the aligned TUMFTM line is this close
MIN_MATCHED = 0.9          # share of points that must match
# lateral offset of our (racing-line) trace from the TUMFTM centre line is kept,
# but limited to this share of the half-width, after smoothing over SMOOTH_M
MAX_OFFSET_SHARE = 0.45
SMOOTH_M = 120.0


def _ssl_ctx() -> ssl.SSLContext:
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS"):
        p = os.environ.get(var)
        if p and Path(p).exists():
            return ssl.create_default_context(cafile=p)
    return ssl.create_default_context()


def tumftm_track(stem: str, refresh: bool = False):
    """[(x_m, y_m, w_right_m, w_left_m)] from the TUMFTM database (cached)."""
    path = CACHE / f"{stem}.csv"
    if refresh or not path.exists():
        req = urllib.request.Request(TUMFTM_BASE + f"{stem}.csv", headers={"User-Agent": "ghostlap-data-pipeline/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx()) as r:
                txt = r.read().decode()
        except Exception as e:  # network down → caller falls back to the default width
            print(f"  [widths] could not download {stem}.csv: {e}")
            return None
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(txt)
    rows = []
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        vals = [float(v) for v in line.split(",")[:4]]
        rows.append(tuple(vals))
    return rows or None


# --------------------------------------------------------------------------- #
# geometry helpers (2D)
# --------------------------------------------------------------------------- #
def _cum(pts):
    n = len(pts)
    cum = [0.0]
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return cum  # len n+1, cum[n] = closed perimeter


def _resample(pts, vals, m):
    """Closed polyline → m points at equal arc fractions (+ linearly interpolated values)."""
    n = len(pts)
    cum = _cum(pts)
    total = cum[-1]
    out_p, out_v = [], []
    j = 0
    for k in range(m):
        d = total * k / m
        while cum[j + 1] < d:
            j += 1
        seg = cum[j + 1] - cum[j]
        f = (d - cum[j]) / seg if seg else 0.0
        a, b = pts[j], pts[(j + 1) % n]
        out_p.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
        if vals is not None:
            va, vb = vals[j], vals[(j + 1) % n]
            out_v.append(tuple(x + (y - x) * f for x, y in zip(va, vb)))
    return out_p, out_v, total


def _similarity(A, B):
    """Least-squares s, θ, t with s·R(θ)·A + t ≈ B (no reflection). Returns (rms, s, θ, t)."""
    n = len(A)
    ax = sum(p[0] for p in A) / n
    ay = sum(p[1] for p in A) / n
    bx = sum(p[0] for p in B) / n
    by = sum(p[1] for p in B) / n
    sxx = sxy = syx = syy = va = 0.0
    for (x, y), (u, v) in zip(A, B):
        x -= ax
        y -= ay
        u -= bx
        v -= by
        sxx += x * u
        sxy += x * v
        syx += y * u
        syy += y * v
        va += x * x + y * y
    a = sxx + syy
    b = sxy - syx
    th = math.atan2(b, a)
    s = math.hypot(a, b) / va if va else 1.0
    c, sn = math.cos(th), math.sin(th)
    tx = bx - s * (c * ax - sn * ay)
    ty = by - s * (sn * ax + c * ay)
    err = 0.0
    for (x, y), (u, v) in zip(A, B):
        px = s * (c * x - sn * y) + tx
        py = s * (sn * x + c * y) + ty
        err += (px - u) ** 2 + (py - v) ** 2
    return math.sqrt(err / n), s, th, (tx, ty)


def _nearest(line, pts, window):
    """For each of pts (ordered like line, same start), (index into line, distance) of the
    nearest line point within ±window of where its arc fraction says it should be."""
    D, m = len(line), len(pts)
    cum = _cum(pts)
    per = cum[-1] or 1.0
    out = []
    for i, (px, py) in enumerate(pts):
        expect = int(round(cum[i] / per * D)) % D
        best_j, best_d = expect, float("inf")
        for k in range(-window, window + 1):
            jj = (expect + k) % D
            d = math.hypot(line[jj][0] - px, line[jj][1] - py)
            if d < best_d:
                best_d, best_j = d, jj
        out.append((best_j, best_d))
    return out


def _smooth_circular(vals, k):
    n = len(vals)
    if k <= 0:
        return list(vals)
    out = []
    for i in range(n):
        acc = 0.0
        for j in range(-k, k + 1):
            acc += vals[(i + j) % n]
        out.append(acc / (2 * k + 1))
    return out


# --------------------------------------------------------------------------- #
# main entry
# --------------------------------------------------------------------------- #
def _units_per_metre(circuit) -> float:
    """Render units per metre from the data's own lap length (2D perimeter of the points)."""
    pts = [(p[0], p[2]) for p in circuit["points"]]
    per = _cum(pts)[-1]
    km = circuit.get("lengthKm") or 0
    return per / (km * 1000) if km > 0 else 0.1


def _default(circuit, upm):
    w = round(DEFAULT_WIDTH_M / 2 * upm, 3)
    return [[w, w] for _ in circuit["points"]]


def compute_widths(circuit, slug: str, refresh: bool = False):
    """(widths, report) — widths in render units per point, report a dict for the log."""
    upm = _units_per_metre(circuit)
    stem = TUMFTM_TRACKS.get(slug)
    if not stem or len(circuit["points"]) < 50:
        return _default(circuit, upm), {"source": "default", "reason": "not in TUMFTM database"}
    rows = tumftm_track(stem, refresh)
    if not rows:
        return _default(circuit, upm), {"source": "default", "reason": "TUMFTM download failed"}

    # ours: render (x, z) → right-handed plane (x, -z), the OpenF1 x/y orientation
    ours = [(p[0], -p[2]) for p in circuit["points"]]
    tum_pts = [(r[0], r[1]) for r in rows]
    tum_vals = [(r[3], r[2]) for r in rows]  # (left, right)

    M = ALIGN_SAMPLES
    A0, Av0, tum_len = _resample(tum_pts, tum_vals, M)
    B, _, _ = _resample(ours, None, M)

    best = None
    for direction in (1, -1):
        A = A0 if direction == 1 else [A0[0]] + A0[:0:-1]
        Av = Av0 if direction == 1 else [Av0[0]] + Av0[:0:-1]
        for shift in range(0, M, 2):
            As = A[shift:] + A[:shift]
            rms, s, th, t = _similarity(As, B)
            if best is None or rms < best[0]:
                best = (rms, s, th, t, direction, shift, As, Av[shift:] + Av[:shift])
    # refine odd shifts around the best
    rms, s, th, t, direction, shift, _, _ = best
    A = A0 if direction == 1 else [A0[0]] + A0[:0:-1]
    Av = Av0 if direction == 1 else [Av0[0]] + Av0[:0:-1]
    for sh in (shift - 1, shift + 1):
        sh %= M
        As = A[sh:] + A[:sh]
        r2 = _similarity(As, B)
        if r2[0] < best[0]:
            best = (r2[0], r2[1], r2[2], r2[3], direction, sh, As, Av[sh:] + Av[:sh])
    rms, s, th, t, direction, shift, As, Avs = best

    # ICP refinement: the two traces need not share an arc-length parameterisation,
    # so re-pair every point of ours with its nearest aligned TUMFTM point and refit
    dense_p, dense_v, _ = _resample(As, Avs, M * 4)
    D = len(dense_p)
    for _ in range(4):
        c, sn = math.cos(th), math.sin(th)
        aligned = [(s * (c * x - sn * y) + t[0], s * (sn * x + c * y) + t[1]) for x, y in dense_p]
        pairs = _nearest(aligned, B, D // 12)
        rms, s, th, t = _similarity([dense_p[j] for j, _ in pairs], B)

    rms_m = rms / s  # residual in metres
    scale_dev = abs(s / upm - 1)  # fitted units-per-metre vs lap length
    report = {
        "source": "TUMFTM",
        "file": f"{stem}.csv",
        "rms_m": round(rms_m, 1),
        "scale_dev": round(scale_dev, 3),
        "direction": "same" if direction == 1 else "reversed",
        "tum_len_km": round(tum_len / 1000, 3),
    }

    # place the aligned TUMFTM line in our frame (dense) with its left/right widths
    c, sn = math.cos(th), math.sin(th)
    aligned = [(s * (c * x - sn * y) + t[0], s * (sn * x + c * y) + t[1]) for x, y in dense_p]
    # left normal of the aligned line (rotate tangent CCW)
    normals = []
    for i in range(D):
        a, b = aligned[i - 1], aligned[(i + 1) % D]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1.0
        normals.append((-ty / L, tx / L))

    n = len(ours)
    cum_ours = _cum(ours)
    per = cum_ours[-1]
    total_w, offset, matched = [], [], 0
    pairs = _nearest(aligned, ours, D // 12)
    dists = sorted(d / s for _, d in pairs)
    report["near_m"] = [round(dists[len(dists) // 2], 1), round(dists[int(len(dists) * 0.95)], 1), round(dists[-1], 1)]
    for i, (j, best_d) in enumerate(pairs):
        wl, wr = dense_v[j]
        w = min(MAX_WIDTH_M, max(MIN_WIDTH_M, wl + wr))
        if best_d / s <= MATCH_DIST_M:
            matched += 1
            nx, ny = normals[j]
            # signed lateral offset of our trace from the TUMFTM centre (m, + = left)
            e = ((ours[i][0] - aligned[j][0]) * nx + (ours[i][1] - aligned[j][1]) * ny) / s
            # where TUMFTM's centre is off-centre, its own left/right split says so too
            e += (wr - wl) / 2
            total_w.append(w)
            offset.append(e)
        else:
            total_w.append(None)
            offset.append(0.0)
    share = matched / n
    report["matched"] = round(share, 3)

    ok = rms_m <= MAX_RMS_M and scale_dev <= MAX_SCALE_DEV and share >= MIN_MATCHED
    if not ok:
        report["source"] = "default"
        report["reason"] = "alignment failed sanity checks (layout differs?)"
        return _default(circuit, upm), report

    # unmatched points (local layout differences) → interpolate between matched neighbours
    known = [i for i, w in enumerate(total_w) if w is not None]
    for i in range(n):
        if total_w[i] is None:
            prev = max((k for k in known if k < i), default=known[-1] - n)
            nxt = min((k for k in known if k > i), default=known[0] + n)
            f = (i - prev) / (nxt - prev)
            total_w[i] = total_w[prev % n] + (total_w[nxt % n] - total_w[prev % n]) * f

    seg_m = per / s / n
    k = max(1, int(round(SMOOTH_M / seg_m / 2)))
    total_w = _smooth_circular(total_w, max(1, k // 3))
    offset = _smooth_circular(offset, k)
    widths = []
    for w, e in zip(total_w, offset):
        half = w / 2
        e = max(-MAX_OFFSET_SHARE * half, min(MAX_OFFSET_SHARE * half, e))
        # our point sits e metres left of the track's middle
        left = half - e
        right = half + e
        widths.append([round(left * upm, 3), round(right * upm, 3)])
    ws = [a + b for a, b in widths]
    report["width_m"] = [round(min(ws) / upm, 1), round(sum(ws) / len(ws) / upm, 1), round(max(ws) / upm, 1)]
    return widths, report


def attach_widths(circuit, slug: str, refresh: bool = False, quiet: bool = False):
    """Set circuit["widths"] in place (keys ordered so widths follows points). Returns the report."""
    widths, report = compute_widths(circuit, slug, refresh)
    items = [(k, v) for k, v in circuit.items() if k != "widths"]
    circuit.clear()
    for k, v in items:
        circuit[k] = v
        if k == "elevationRangeM":
            circuit["widths"] = widths
    if "widths" not in circuit:
        circuit["widths"] = widths
    if not quiet:
        extra = (
            f"rms {report['rms_m']} m · near p50/p95/max {report['near_m']} m · scale Δ {report['scale_dev']:.1%} · matched {report['matched']:.0%} · {report['direction']}"
            if "rms_m" in report
            else report.get("reason", "")
        )
        w = f" · width {report['width_m'][0]}–{report['width_m'][2]} m" if "width_m" in report else ""
        print(f"  [widths] {slug:<18} {report['source']:<8} {extra}{w}" + (f" ({report['reason']})" if report["source"] == "default" and "rms_m" in report else ""))
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="report only, do not write")
    ap.add_argument("--refresh", action="store_true", help="re-download the TUMFTM files")
    args = ap.parse_args()
    files = sorted((OUT / "races").glob("*.json"))
    if not files:
        print("no bundles in public/data/2026/races — run fetch_2026_season.py first")
        return 1
    for f in files:
        bundle = json.loads(f.read_text())
        slug = bundle["summary"]["slug"]
        attach_widths(bundle["circuit"], slug, args.refresh)
        if args.check:
            continue
        txt = json.dumps(bundle, separators=(",", ":"))
        f.write_text(txt)
        seed = SEED_OUT / f.name
        if seed.exists():
            seed.write_text(txt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
