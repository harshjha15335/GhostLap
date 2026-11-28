#!/usr/bin/env python3
"""Fit a third-party circuit model onto GhostLap's telemetry racing line.

Input: the model's asphalt samples (export-road.mjs) and public/data/2026/races/<slug>.json.
Output: align.json, which build-circuit.mjs bakes into the model:

  p_ours.xz = s * R(theta) * F * (p_model.xz - c_model) + c_ours      (F = optional mirror on x)
  p_ours.y  = ya * p_model.y + yb          (ya = s: true vertical scale)
  then a smooth warp: each vertex moves by a distance-weighted blend of the residuals
  measured at the racing-line control points, so the model's road lands under the cars.

Steps: coarse grid search (rotation x mirror, scale from spread) scored by symmetric
nearest-neighbour distance, ICP refinement (Umeyama similarity), elevation fit on the
road under each racing-line point, residuals smoothed along the lap.

usage: python3 -I align.py <road.json> <race.json> <out.json>
Requires numpy + scipy.
"""
import json
import sys

import numpy as np
from scipy.spatial import cKDTree


def similarity(src, dst):
    """Umeyama: s, R, t minimising |s R src + t - dst| (2D, no reflection)."""
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    cov = b.T @ a / len(src)
    u, d, vt = np.linalg.svd(cov)
    sgn = np.sign(np.linalg.det(u @ vt))
    S = np.diag([1, sgn])
    R = u @ S @ vt
    s = np.trace(np.diag(d) @ S) / (a ** 2).sum(1).mean()
    return s, R, md - s * R @ ms


def rot(th):
    c, s = np.cos(th), np.sin(th)
    return np.array([[c, -s], [s, c]])


def main():
    road_path, race_path, out_path = sys.argv[1:4]
    road = np.array(json.load(open(road_path)), dtype=float)
    race = json.load(open(race_path))
    geo = race.get('circuit') or race.get('geometry')
    line = np.array(geo['points'], dtype=float)

    # resample the racing line to ~1200 evenly spaced control points
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([line, line[:1]])[:, [0, 2]], axis=0), axis=1))]
    total = seg[-1]
    ts = np.linspace(0, total, 1200, endpoint=False)
    loop = np.vstack([line, line[:1]])
    ctrl = np.stack([np.interp(ts, seg, loop[:, k]) for k in range(3)], 1)

    q = ctrl[:, [0, 2]]
    P0 = road[:, [0, 2]]
    cm, co = P0.mean(0), q.mean(0)
    s0 = np.sqrt(((q - co) ** 2).sum(1).mean() / ((P0 - cm) ** 2).sum(1).mean())
    tree_q = cKDTree(q)

    best = None
    for mirror in (False, True):
        F = np.diag([-1.0, 1.0]) if mirror else np.eye(2)
        base = (P0 - cm) @ F.T
        for deg in range(0, 360, 2):
            for sf in (0.85, 0.92, 1.0, 1.08, 1.17):
                Rm = rot(np.radians(deg))
                pts = sf * s0 * base @ Rm.T + co
                d1 = cKDTree(pts).query(q)[0].mean()       # every line point has road nearby
                d2 = tree_q.query(pts[::7])[0]               # most road lies near the line
                score = d1 + np.median(d2)
                if best is None or score < best[0]:
                    best = (score, mirror, deg, sf)
    _, mirror, deg, sf = best
    F = np.diag([-1.0, 1.0]) if mirror else np.eye(2)
    base = (P0 - cm) @ F.T
    s, R, t = sf * s0, rot(np.radians(deg)), co.copy()

    # ICP: line point -> nearest transformed road sample; refit similarity on those pairs
    for _ in range(40):
        pts = s * base @ R.T + t
        d, j = cKDTree(pts).query(q)
        keep = d < np.percentile(d, 90)
        ds, dR, dt = similarity(pts[j[keep]], q[keep])
        s, R, t = ds * s, dR @ R, ds * dR @ t + dt
    pts = s * base @ R.T + t
    tree_p = cKDTree(pts)
    d_nn = tree_p.query(q)[0]

    # road centre + height under each control point (road samples within a radius)
    radius = max(np.percentile(d_nn, 75) * 2.5, 1.2)
    centre = np.zeros_like(q)
    ymod = np.zeros(len(q))
    for i, nb in enumerate(tree_p.query_ball_point(q, radius)):
        if not nb:
            nb = [tree_p.query(q[i])[1]]
        centre[i] = pts[nb].mean(0)
        ymod[i] = np.median(road[nb, 1])
    # Heights: keep the model's own vertical scale (= the horizontal scale s) so buildings are
    # not stretched; GhostLap's exaggerated relief is matched by the warp's dy instead.
    ya = s
    yb = float(np.median(ctrl[:, 1] - s * ymod))
    res = np.c_[q[:, 0] - centre[:, 0], ctrl[:, 1] - (ya * ymod + yb), q[:, 1] - centre[:, 1]]

    # control points with no road sample close by (gaps in the model's surface layer) get
    # residuals interpolated along the lap from their valid neighbours
    valid = d_nn < max(1.0, np.percentile(d_nn, 50) * 4)
    if valid.sum() >= 3 and not valid.all():
        idx = np.arange(len(q))
        vi = idx[valid]
        for c in range(3):
            res[~valid, c] = np.interp(idx[~valid], np.r_[vi - len(q), vi, vi + len(q)], np.tile(res[valid, c], 3))

    # smooth residuals along the lap (circular moving average)
    k = 9
    pad = np.vstack([res[-k:], res, res[:k]])
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    res = np.stack([np.convolve(pad[:, c], ker, mode='valid') for c in range(3)], 1)

    out = {
        'mirrorX': bool(mirror),
        'scale': float(s),
        'R': R.tolist(),
        'cModel': cm.tolist(),
        't': t.tolist(),
        'ya': float(ya),
        'yb': float(yb),
        # warp controls in GhostLap units: [x, z, dx, dy, dz]
        'controls': [[round(float(a), 4) for a in (q[i, 0], q[i, 1], *res[i])] for i in range(0, len(q), 2)],
        'warpRadius': float(radius * 3),
        'fit': {
            'meanLineToRoad': float(d_nn.mean()),
            'p95LineToRoad': float(np.percentile(d_nn, 95)),
            'meanResidualXZ': float(np.linalg.norm(res[:, [0, 2]], axis=1).mean()),
            'maxResidualXZ': float(np.linalg.norm(res[:, [0, 2]], axis=1).max()),
            'meanResidualY': float(np.abs(res[:, 1]).mean()),
            'maxResidualY': float(np.abs(res[:, 1]).max()),
            'gapControls': int((~valid).sum()),
            'rotationDeg': float(np.degrees(np.arctan2(R[1, 0], R[0, 0]))),
        },
    }
    json.dump(out, open(out_path, 'w'))
    print(json.dumps(out['fit'], indent=1), 'mirror', mirror, 'scale', round(s, 3), 'ya', round(ya, 3))


if __name__ == '__main__':
    main()
