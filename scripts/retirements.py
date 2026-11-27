#!/usr/bin/env python3
"""
GhostLap 2026 — where and when a retired car actually stopped.

For every car that did not finish, `find_retirement()` reads the OpenF1 `location`
feed for that driver from just before the end of its last completed lap to a few
minutes later, finds the moment the car stops moving for good (or its last sample on
track before the feed goes quiet), projects that point onto the circuit centre line
and classifies the stop:

  pits     the car came to rest in the pit lane / garage (near the start/finish line,
           well away from the centre line, or it stopped after entering the pits)
  crash    race control named the car in an incident / collision around the stop
           (-90 s .. +15 min); the stop's speed profile is logged in the QA report only
  stopped  it slowed down and parked (anywhere else)
  unknown  no usable location data

Output (RaceBundle.cars[i].retirement, optional):
  {lap, lapFraction, time, onTrack, kind, message?}
  lap          the lap the car was on when it stopped (1-based)
  lapFraction  stop point projected onto circuit.points (arc-length share, 0..1)
  time         race clock seconds (0 = lights out) when the car came to rest
  onTrack      true if it stopped on the asphalt (within the track half-width + 2 m)
  message      race-control text naming the car around the stop (verbatim), if any

Standard library only; `api` is fetch_2026_season.api (cached, throttled).
"""
from __future__ import annotations

import math
import os
import re
from datetime import datetime, timezone

WINDOW_S = 300          # seconds of location data per query
MAX_WINDOWS = 3         # extend while the car is still moving (slow limp back to the pits)
HOLD_S = 20.0           # a stop = staying within REST_DM for this long
REST_DM = 40.0          # 4 m
PIT_ZONE = 0.12         # lap share either side of the line where the pit lane runs
PIT_LATERAL_M = 12.0    # off the centre line by more than this near the line = pit lane
OFF_MAP_M = 80.0        # farther than this from the centre line = the feed's "parked" position, not the car
INCIDENT = re.compile(r"COLLISION|CRASH|CONTACT|INCIDENT|STOPPED|SPUN", re.I)
IGNORE = re.compile(r"TRACK LIMITS|BLUE FLAG|PENALTY SERVED|FALSE START|STARTING PROCEDURE|PRACTICE START|"
                    r"RACE DIRECTORS INSTRUCTIONS|YELLOW FLAG INFRINGEMENT|PIT EXIT|PIT ENTRY|MOVING UNDER BRAKING|"
                    r"LEAVING THE TRACK AND GAINING", re.I)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def _samples(api, sk, dn, a, b):
    pts = api("location", session_key=sk, driver_number=dn, **{"date>": _iso(a), "date<": _iso(b)})
    out = []
    for p in pts:
        if p.get("x") is None or (p["x"] == 0 and p["y"] == 0):
            continue
        out.append((_parse(p["date"]), float(p["x"]), float(p["y"])))
    out.sort()
    return out


def _rest(samples, t_from):
    """(index of the first sample at the final rest point, rest point) or None.

    A rest point is a sample the car stays within REST_DM of for HOLD_S (or until the
    feed ends, if that is at least HOLD_S / 2 later)."""
    n = len(samples)
    j = 0
    for i in range(n):
        t, x, y = samples[i]
        if t < t_from:
            continue
        j = max(j, i)
        ok = True
        while j + 1 < n and samples[j + 1][0] <= t + HOLD_S:
            j += 1
        for k in range(i, j + 1):
            if math.hypot(samples[k][1] - x, samples[k][2] - y) > REST_DM:
                ok = False
                break
        covered = samples[j][0] - t
        if ok and (covered >= HOLD_S - 1.0 or (j == n - 1 and covered >= HOLD_S / 2)):
            return i
    return None


def _speed_kmh(samples, i, back_s):
    """speed around t_i - back_s (km/h; OpenF1 units are dm): the median of the segment
    speeds within ±0.75 s, so a single jump in the feed does not count. 0 when unknown
    (no samples there, or only implausible > 380 km/h segments)."""
    t = samples[i][0] - back_s
    v = []
    for a, b in zip(samples[:i], samples[1 : i + 1]):
        if b[0] < t - 0.75 or a[0] > t + 0.75 or b[0] - a[0] < 0.1:
            continue
        kmh = math.hypot(b[1] - a[1], b[2] - a[2]) / (b[0] - a[0]) / 10 * 3.6
        if kmh <= 380:
            v.append(kmh)
    if not v:
        return 0.0
    v.sort()
    return v[len(v) // 2]


def _project(circuit, x, y):
    """(arc-length lap share, distance from the centre line in metres) of an OpenF1 point."""
    xf = circuit["_xf"]
    X = (x - xf["cx"]) * xf["scale"]
    Z = -(y - xf["cy"]) * xf["scale"]
    pts = circuit["points"]
    n = len(pts)
    cum = xf.get("_cum")
    if cum is None:
        cum = [0.0]
        for k in range(n):
            a, b = pts[k], pts[(k + 1) % n]
            cum.append(cum[-1] + math.hypot(b[0] - a[0], b[2] - a[2]))
        xf["_cum"] = cum
    total = cum[-1] or 1.0
    best = None
    for k in range(n):
        a, b = pts[k], pts[(k + 1) % n]
        ax, az = b[0] - a[0], b[2] - a[2]
        den = ax * ax + az * az
        f = 0.0 if den == 0 else max(0.0, min(1.0, ((X - a[0]) * ax + (Z - a[2]) * az) / den))
        dd = math.hypot(a[0] + ax * f - X, a[2] + az * f - Z)
        if best is None or dd < best[0]:
            best = (dd, (cum[k] + f * (cum[k + 1] - cum[k])) / total, k)
    units_per_m = total / (circuit["lengthKm"] * 1000) if circuit.get("lengthKm") else 0.03
    return best[1] % 1.0, best[0] / units_per_m, best[2]


def _half_width_m(circuit, k):
    w = circuit.get("widths")
    pts = circuit["points"]
    if not w or len(w) != len(pts):
        return 6.0
    n = len(pts)
    total = sum(math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][2] - pts[i][2]) for i in range(n))
    upm = total / (circuit["lengthKm"] * 1000) if circuit.get("lengthKm") else 0.03
    return max(w[k]) / upm


def _message(rc, dn, ts):
    """Race-control text naming the car in an incident around the stop (verbatim)."""
    pat = re.compile(rf"CARS? (?:[\d ,()A-Z]*?[ ,])?{dn} \(|CARS? {dn}\b")
    best = None
    for m in rc:
        msg = m.get("message") or ""
        if not INCIDENT.search(msg) or IGNORE.search(msg) or msg.upper().startswith("FIA STEWARDS"):
            continue
        if not pat.search(msg.upper()):
            continue
        dt = _parse(m["date"]) - ts
        if -90 <= dt <= 900 and (best is None or abs(dt) < abs(best[0])):
            best = (dt, msg)
    return best[1] if best else None


def find_retirement(api, sk, dn, t0, laps, circuit, rc, pit_laps):
    """Retirement record for one car (see module doc), or None without a usable circuit.

    t0: lights-out timestamp; laps: completed lap times (race-clock anchored); pit_laps:
    laps on which the car entered the pit lane."""
    if not circuit or "_xf" not in circuit or t0 is None:
        return None
    n = len(laps)
    ts_end = t0 + sum(laps)  # end of the last completed lap (lights out for n = 0)
    samples = []
    rest_i = None
    a = ts_end - 5
    t_from = ts_end + (2.0 if n == 0 else -2.0)
    on_map = lambda s: _project(circuit, s[1], s[2])[1] <= OFF_MAP_M  # noqa: E731
    vanished = False
    for w in range(MAX_WINDOWS):
        b = a + WINDOW_S
        samples += _samples(api, sk, dn, a, b)
        # the feed jumps to a far-away parking position once the car is in its garage or
        # switched off: everything from there on is not the car on track
        v = next((i for i, s in enumerate(samples) if s[0] >= t_from and not on_map(s)), None)
        if v is not None:
            samples = samples[:v]
            vanished = True
            break
        rest_i = _rest(samples, t_from)
        if rest_i is not None:
            break
        a = b
    if vanished:
        if not samples or samples[-1][0] < t_from:
            # already gone when the lap ended: look back for its last moment on the map
            earlier = [s for s in _samples(api, sk, dn, ts_end - 125, ts_end - 5) if s[0] < (samples[0][0] if samples else ts_end)]
            v = next((i for i in range(len(earlier) - 1, -1, -1) if on_map(earlier[i])), None)
            samples = earlier[: v + 1] if v is not None else []
        if samples:
            # it came to rest where it was last seen (first sample at that spot)
            last = samples[-1]
            rest_i = len(samples) - 1
            while rest_i > 0 and math.hypot(samples[rest_i - 1][1] - last[1], samples[rest_i - 1][2] - last[2]) <= REST_DM:
                rest_i -= 1
    elif rest_i is None and samples and samples[-1][0] > t_from:
        rest_i = len(samples) - 1  # feed ends without a clear stop: last sample on track
    if rest_i is None:
        return {"lap": n + 1, "lapFraction": 0.0, "time": round(sum(laps), 3), "onTrack": False, "kind": "unknown"}
    ts, x, y = samples[rest_i]
    frac, lat_m, k = _project(circuit, x, y)
    if f"{sk}:{dn}" in os.environ.get("RET_DEBUG", ""):
        for s in samples[max(0, rest_i - 40): rest_i + 8]:
            f_, l_, _ = _project(circuit, s[1], s[2])
            print(f"    dbg {sk}:{dn} t={s[0] - ts_end:8.2f} x={s[1]:8.0f} y={s[2]:8.0f} frac={f_:.3f} lat={l_:6.1f}")
    near_line = frac < PIT_ZONE or frac > 1 - PIT_ZONE
    half = _half_width_m(circuit, k)
    on_track = lat_m <= half + 2.0
    msg = _message(rc, dn, ts)
    v2 = _speed_kmh(samples, rest_i, 2.0)
    v0 = max(_speed_kmh(samples, rest_i, 4.0), v2)
    in_pits = (near_line and lat_m > PIT_LATERAL_M) or (n in pit_laps and near_line and not on_track)
    if in_pits:
        kind = "pits"
    elif msg and re.search(r"COLLISION|CRASH|CONTACT|INCIDENT", msg, re.I):
        # only race control's word makes it a crash: a sudden standstill in the feed can
        # also be the transponder freezing, so speed alone never does
        kind = "crash"
    else:
        kind = "stopped"
    # the lap the car was on: it stopped before reaching the line again
    lap = n + 1
    if frac > 1 - PIT_ZONE and ts - ts_end < 0.25 * (sorted(laps)[len(laps) // 2] if laps else 90):
        lap = max(1, n)  # stopped just short of the line it had (nearly) crossed: pit lane before the line
    out = {
        "lap": lap,
        "lapFraction": round(frac, 5),
        "time": round(ts - t0, 3),
        "onTrack": bool(on_track),
        "kind": kind,
    }
    if msg:
        out["message"] = msg
    out["_dbg"] = {"lat_m": round(lat_m, 1), "half_m": round(half, 1), "v2": round(v2), "v4": round(v0),
                   "after_s": round(ts - ts_end, 1)}
    return out
