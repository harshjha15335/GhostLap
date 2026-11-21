#!/usr/bin/env python3
"""
GhostLap 2026 — offline data pipeline.

Pulls the 2026 Formula 1 season from the public OpenF1 API (https://openf1.org),
normalises it, and writes small static JSON bundles so the browser never calls
api.openf1.org at runtime.

Outputs
  public/data/2026/season.json          SeasonData (see src/types/index.ts)
  public/data/2026/races/<slug>.json    RaceBundle for every completed race
  src/data/seed/season.json             copy of season.json (embedded fallback)
  src/data/seed/<slug>.json             RaceBundle for the seed races

Usage
  python3 scripts/fetch_2026_season.py            # use cache where present
  python3 scripts/fetch_2026_season.py --refresh  # ignore cache

Standard library only. Raw API responses are cached in scripts/.cache/ (gitignored).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
OUT = ROOT / "public" / "data" / "2026"
SEED_OUT = ROOT / "src" / "data" / "seed"
UPGRADES_FILE = ROOT / "scripts" / "upgrades_2026.json"
PU_FILE = ROOT / "scripts" / "pu_allocation_2026.json"
API = "https://api.openf1.org/v1"
YEAR = 2026
SEED_SLUGS = ["melbourne", "silverstone", "monza"]
COMPOUNDS = {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"}
CIRCUIT_POINTS = 400
ELEVATION_EXAGGERATION = 2.5
FUEL_SECONDS_PER_LAP = 0.03

REFRESH = False
_last_call = 0.0


# --------------------------------------------------------------------------- #
# HTTP + cache
# --------------------------------------------------------------------------- #
def _ssl_ctx() -> ssl.SSLContext:
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS"):
        p = os.environ.get(var)
        if p and Path(p).exists():
            return ssl.create_default_context(cafile=p)
    return ssl.create_default_context()


SSL_CTX = _ssl_ctx()


def api(endpoint: str, **params) -> list:
    """GET an OpenF1 endpoint, cached on disk. Returns [] for 'No results found'."""
    global _last_call
    query = urllib.parse.urlencode(params, safe="<>=")
    key = re.sub(r"[^A-Za-z0-9_.=-]+", "_", f"{endpoint}__{query}")[:180]
    path = CACHE / f"{key}.json"
    if path.exists() and not REFRESH:
        return json.loads(path.read_text())

    url = f"{API}/{endpoint}?{query}" if query else f"{API}/{endpoint}"
    for attempt in range(6):
        wait = 0.4 - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ghostlap-data-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=90, context=SSL_CTX) as r:
                data = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                data = []
                break
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError(f"OpenF1 request failed repeatedly: {url}")

    if isinstance(data, dict):  # {"detail": "No results found."}
        data = []
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def kebab(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def slug_for(circuit_short_name: str) -> str:
    s = kebab(circuit_short_name)
    return {"yas-marina-circuit": "yas-marina"}.get(s, s)


def parse_ts(s: str | None) -> float | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def median(xs, default=None):
    xs = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return statistics.median(xs) if xs else default


def r3(x):
    return None if x is None else round(float(x), 3)


def to_pos(v):
    """OpenF1 positions are usually ints but can be strings or 'NC'."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def hexcol(c: str | None) -> str:
    c = (c or "888888").strip().lstrip("#")
    return f"#{c.upper()}" if re.fullmatch(r"[0-9A-Fa-f]{6}", c) else "#888888"


# --------------------------------------------------------------------------- #
# circuit geometry
# --------------------------------------------------------------------------- #
CIRCUIT_MAX_CANDIDATES = 14
CIRCUIT_MIN_UNIQUE = 220      # distinct location samples for a "good" lap trace
CIRCUIT_MAX_JUMP = 650        # OpenF1 units (~dm) between consecutive samples


def _trace_quality(pts):
    """(unique samples, largest jump between consecutive distinct samples)."""
    raw = sorted(((p["x"], p["y"], parse_ts(p["date"])) for p in pts), key=lambda r: r[2])
    uniq = [raw[0]] if raw else []
    for r in raw[1:]:
        if math.dist(r[:2], uniq[-1][:2]) > 1e-6:
            uniq.append(r)
    jump = max((math.dist(a[:2], b[:2]) for a, b in zip(uniq, uniq[1:])), default=1e9)
    if len(uniq) > 1:
        jump = max(jump, math.dist(uniq[-1][:2], uniq[0][:2]))  # closing segment
    return len(uniq), jump


def build_circuit(session_key: int, laps_by_driver: dict, slug: str, name: str, totalLaps: int):
    """Extract one clean green-flag lap of location data and resample to a closed loop.

    Tries the fastest clean laps in turn and keeps the densest trace without
    gaps (sparse traces cut corners and under-measure the lap)."""
    candidates = []
    for dn, laps in laps_by_driver.items():
        for lp in laps:
            if (
                lp.get("lap_duration")
                and lp.get("date_start")
                and not lp.get("is_pit_out_lap")
                and 3 <= lp["lap_number"] <= max(3, totalLaps - 2)
                and lp.get("duration_sector_1")
                and lp.get("duration_sector_2")
            ):
                candidates.append((lp["lap_duration"], dn, lp))
    candidates.sort(key=lambda c: c[0])
    # skip implausibly fast laps (timing glitches): nothing quicker than 98.5% of the 3rd fastest
    if len(candidates) > 3:
        ref = candidates[2][0]
        candidates = [c for c in candidates if c[0] >= 0.985 * ref]

    best = None
    for _, dn, lp in candidates[:CIRCUIT_MAX_CANDIDATES]:
        t0 = parse_ts(lp["date_start"])
        t1 = t0 + lp["lap_duration"]
        lo = datetime.fromtimestamp(t0 - 0.5, timezone.utc).isoformat()
        hi = datetime.fromtimestamp(t1 + 0.5, timezone.utc).isoformat()
        pts = api("location", session_key=session_key, driver_number=dn, **{"date>": lo, "date<": hi})
        pts = [p for p in pts if p.get("x") is not None and not (p["x"] == 0 and p["y"] == 0)]
        if len(pts) < 80:
            continue
        uniq, jump = _trace_quality(pts)
        score = uniq - (0 if jump <= CIRCUIT_MAX_JUMP else 1000)
        if best is None or score > best[0]:
            best = (score, pts, t0, lp)
        if uniq >= CIRCUIT_MIN_UNIQUE and jump <= CIRCUIT_MAX_JUMP:
            break
    if best is None:
        return None
    score, pts, t0, lp = best
    circuit = _resample(pts, t0, lp, slug, name)
    circuit["_quality"] = score
    return circuit


def _resample(pts, t0, lap, slug, name):
    raw = [(p["x"], p["y"], p.get("z") or 0, parse_ts(p["date"])) for p in pts]
    raw.sort(key=lambda r: r[3])
    # dedupe stationary samples
    clean = [raw[0]]
    for r in raw[1:]:
        if math.dist(r[:2], clean[-1][:2]) > 1e-6:
            clean.append(r)
    raw = clean
    # cumulative arc length (OpenF1 units are ~decimetres)
    cum = [0.0]
    for a, b in zip(raw, raw[1:]):
        cum.append(cum[-1] + math.dist(a[:3], b[:3]))
    closing = math.dist(raw[-1][:3], raw[0][:3])
    total = cum[-1] + closing
    length_km = total / 10 / 1000

    def at(d):
        d %= total
        if d >= cum[-1]:  # closing segment
            f = (d - cum[-1]) / closing if closing else 0
            a, b = raw[-1], raw[0]
        else:
            lo, hi = 0, len(cum) - 1
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if cum[mid] <= d:
                    lo = mid
                else:
                    hi = mid
            seg = cum[hi] - cum[lo]
            f = (d - cum[lo]) / seg if seg else 0
            a, b = raw[lo], raw[hi]
        return tuple(a[i] + (b[i] - a[i]) * f for i in range(3))

    samples = [at(total * i / CIRCUIT_POINTS) for i in range(CIRCUIT_POINTS)]
    # light smoothing (circular moving average)
    k = 2
    smooth = []
    n = len(samples)
    for i in range(n):
        acc = [0.0, 0.0, 0.0]
        for j in range(-k, k + 1):
            s = samples[(i + j) % n]
            for c in range(3):
                acc[c] += s[c]
        smooth.append([v / (2 * k + 1) for v in acc])

    xs = [p[0] for p in smooth]
    ys = [p[1] for p in smooth]
    zs = [p[2] for p in smooth]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys)) or 1
    scale = 200 / span  # fits in [-100, 100]
    zmin = min(zs)
    elev_range_m = (max(zs) - zmin) / 10
    points = [
        [r3((x - cx) * scale), r3((z - zmin) * scale * ELEVATION_EXAGGERATION), r3(-(y - cy) * scale)]
        for x, y, z in smooth
    ]

    # sector split fractions: where was the car at t0+s1 and t0+s1+s2?
    def frac_at_time(t):
        best = min(range(len(raw)), key=lambda i: abs(raw[i][3] - t))
        return cum[best] / total

    s1 = frac_at_time(t0 + lap["duration_sector_1"])
    s2 = frac_at_time(t0 + lap["duration_sector_1"] + lap["duration_sector_2"])
    if not (0.05 < s1 < s2 < 0.95):
        s1, s2 = 1 / 3, 2 / 3

    return {
        "slug": slug,
        "name": name,
        "lengthKm": round(length_km, 3),
        "points": points,
        "sectorSplits": [round(s1, 4), round(s2, 4)],
        "elevationRangeM": round(elev_range_m, 1),
    }


def fallback_circuit(slug, name):
    """Simple oval if location data is unavailable."""
    pts = []
    for i in range(CIRCUIT_POINTS):
        a = 2 * math.pi * i / CIRCUIT_POINTS
        pts.append([r3(90 * math.cos(a)), 0.0, r3(55 * math.sin(a))])
    return {"slug": slug, "name": name, "lengthKm": 5.0, "points": pts, "sectorSplits": [1 / 3, 2 / 3], "elevationRangeM": 0}


# --------------------------------------------------------------------------- #
# race processing
# --------------------------------------------------------------------------- #
SC_DEPLOY = re.compile(r"^SAFETY CAR DEPLOYED")
SC_IN = re.compile(r"SAFETY CAR IN THIS LAP")
VSC_DEPLOY = re.compile(r"^VSC DEPLOYED|VIRTUAL SAFETY CAR DEPLOYED")
VSC_END = re.compile(r"VSC ENDING|VIRTUAL SAFETY CAR ENDING")
# "RED FLAG INFRINGEMENT" (a steward note) must not open a red-flag window
RED = re.compile(r"RED FLAG\s*[-–]\s*RACE SUSPENDED|RACE SUSPENDED")
RESTART = re.compile(r"STANDING START|ROLLING START|RACE WILL RESTART|RESTART")
RESUME_ANNOUNCE = re.compile(r"RACE WILL RESUME")
PEN = re.compile(r"FIA STEWARDS:.*?(\d+) SECOND TIME PENALTY FOR CAR (\d+)")
DT = re.compile(r"FIA STEWARDS:.*?DRIVE[- ]THROUGH PENALTY FOR CAR (\d+)")
SG = re.compile(r"FIA STEWARDS:.*?(?:(\d+) SECOND )?STOP[- ]AND[- ]GO PENALTY FOR CAR (\d+)")
SERVED = re.compile(r"FIA STEWARDS:\s*PENALTY SERVED")
GRID = re.compile(r"FIA STEWARDS:.*?(\d+) PLACE GRID PENALTY FOR CAR (\d+)")
WARN = re.compile(r"(BLACK AND WHITE FLAG|WARNING).*?CAR (\d+)")
REPR = re.compile(r"FIA STEWARDS:.*?REPRIMAND.*?CAR (\d+)")
INVEST = re.compile(r"FIA STEWARDS:.*?INCIDENT INVOLVING CARS? ([\d ,AND]+?) .*?(WILL BE INVESTIGATED|UNDER INVESTIGATION)")
CRASH = re.compile(r"CRASH|COLLISION|STOPPED ON TRACK|CAR \d+ .*STOPPED|SPUN|CONTACT", re.I)
CAR_NUM = re.compile(r"CARS? (\d+)")


def track_status_windows(rc, total_laps):
    """SC / VSC / RED windows (inclusive leader laps) from race-control messages.

    - a red flag closes any open SC/VSC on the suspension lap; the RED window runs
      until the restart (standing/rolling start) so it covers the suspended lap
    - an SC deployment closes an open VSC (VSC → SC escalation)
    - steward notes such as "RED FLAG INFRINGEMENT" are ignored
    """
    windows = []
    open_sc = open_vsc = open_red = None
    resume_lap = None
    for m in sorted(rc, key=lambda m: m["date"]):
        msg, lap = m["message"].upper(), m.get("lap_number") or 1
        lap = min(max(1, lap), total_laps)
        if msg.startswith("FIA STEWARDS") or "INCIDENT" in msg:
            continue
        is_red = bool(RED.search(msg)) or (m.get("flag") == "RED" and m.get("scope") in (None, "Track"))
        if is_red:
            if open_red is None:
                open_red = lap
                resume_lap = None
            if open_sc is not None:
                windows.append({"type": "SC", "startLap": open_sc, "endLap": lap})
                open_sc = None
            if open_vsc is not None:
                windows.append({"type": "VSC", "startLap": open_vsc, "endLap": lap})
                open_vsc = None
        elif open_red is not None and RESUME_ANNOUNCE.search(msg):
            resume_lap = lap
        elif open_red is not None and RESTART.search(msg):
            windows.append({"type": "RED", "startLap": open_red, "endLap": max(open_red, lap)})
            open_red = None
        elif SC_DEPLOY.search(msg):
            if open_vsc is not None:
                windows.append({"type": "VSC", "startLap": open_vsc, "endLap": max(open_vsc, lap - 1)})
                open_vsc = None
            if open_sc is None:
                open_sc = lap
        elif SC_IN.search(msg):
            if open_sc is not None:
                windows.append({"type": "SC", "startLap": open_sc, "endLap": lap})
                open_sc = None
        elif VSC_DEPLOY.search(msg):
            if open_vsc is None and open_sc is None:
                open_vsc = lap
        elif VSC_END.search(msg):
            if open_vsc is not None:
                windows.append({"type": "VSC", "startLap": open_vsc, "endLap": lap})
                open_vsc = None
    if open_sc is not None:
        windows.append({"type": "SC", "startLap": open_sc, "endLap": total_laps})
    if open_vsc is not None:
        windows.append({"type": "VSC", "startLap": open_vsc, "endLap": open_vsc})
    if open_red is not None:
        windows.append({"type": "RED", "startLap": open_red, "endLap": max(open_red, resume_lap or open_red)})
    # merge overlapping SC windows (re-deploys)
    windows.sort(key=lambda w: (w["type"], w["startLap"]))
    merged = []
    for w in windows:
        if merged and merged[-1]["type"] == w["type"] and w["startLap"] <= merged[-1]["endLap"] + 1:
            merged[-1]["endLap"] = max(merged[-1]["endLap"], w["endLap"])
        else:
            merged.append(dict(w))
    return sorted(merged, key=lambda w: w["startLap"])


def parse_penalties(rc, round_no, slug):
    out = []
    for m in rc:
        msg = m["message"].upper()
        if "PENALTY SERVED" in msg or "NO FURTHER ACTION" in msg:
            continue
        lap = m.get("lap_number")
        if (g := PEN.search(msg)):
            out.append(dict(category="TIME", seconds=int(g.group(1)), driverNumber=int(g.group(2))))
        elif (g := DT.search(msg)):
            out.append(dict(category="DRIVE_THROUGH", seconds=None, driverNumber=int(g.group(1))))
        elif (g := SG.search(msg)):
            out.append(dict(category="STOP_GO", seconds=int(g.group(1)) if g.group(1) else None, driverNumber=int(g.group(2))))
        elif (g := GRID.search(msg)):
            out.append(dict(category="GRID", seconds=None, driverNumber=int(g.group(2))))
        elif (g := REPR.search(msg)):
            out.append(dict(category="REPRIMAND", seconds=None, driverNumber=int(g.group(1))))
        elif "BLACK AND WHITE" in msg and (g := CAR_NUM.search(msg)):
            out.append(dict(category="WARNING", seconds=None, driverNumber=int(g.group(1))))
        elif msg.startswith("FIA STEWARDS") and "INVESTIGAT" in msg:
            g = CAR_NUM.search(msg)
            out.append(dict(category="INVESTIGATION", seconds=None, driverNumber=int(g.group(1)) if g else None))
        else:
            continue
        out[-1].update(round=round_no, slug=slug, lap=lap, message=m["message"])
    return out


def penalty_service(rc, penalties, total_laps):
    """Match 'PENALTY SERVED' notes to awarded TIME / DRIVE_THROUGH / STOP_GO penalties.

    Returns the RaceBundle.penalties list:
      {driverNumber, lap, category, seconds, servedLap}
    servedLap is null when the penalty was not served on track (applied to the
    race time after the flag). Notes issued after the chequered flag count as
    post-race application, not on-track service."""
    flag_ts = None
    for m in rc:
        if m.get("flag") == "CHEQUERED" and m.get("date"):
            ts = parse_ts(m["date"])
            flag_ts = ts if flag_ts is None else min(flag_ts, ts)
    served_notes = []
    for m in sorted(rc, key=lambda m: m["date"]):
        msg = m["message"].upper()
        if not SERVED.search(msg):
            continue
        body = msg.split("PENALTY SERVED", 1)[1]
        g = CAR_NUM.search(body)
        if not g:
            continue
        cat = "DRIVE_THROUGH" if re.search(r"DRIVE[- ]THROUGH", body) else "STOP_GO" if re.search(r"STOP[- ]AND[- ]GO", body) else "TIME"
        secs = re.search(r"(\d+) SECOND", body)
        after_flag = flag_ts is not None and m.get("date") and parse_ts(m["date"]) > flag_ts
        served_notes.append({"dn": int(g.group(1)), "cat": cat, "secs": int(secs.group(1)) if secs else None,
                             "lap": m.get("lap_number"), "post": after_flag, "used": False})
    out = []
    for p in penalties:
        if p["category"] not in ("TIME", "DRIVE_THROUGH", "STOP_GO") or p["driverNumber"] is None:
            continue
        served = None
        for n in served_notes:
            if n["used"] or n["dn"] != p["driverNumber"] or n["cat"] != p["category"]:
                continue
            if p["category"] == "TIME" and n["secs"] is not None and n["secs"] != p["seconds"]:
                continue
            n["used"] = True
            served = None if n["post"] else n["lap"]
            break
        out.append({"driverNumber": p["driverNumber"], "lap": p["lap"] or 1, "category": p["category"],
                    "seconds": p["seconds"], "servedLap": min(served, total_laps) if served else None})
    return out


ANCHOR_TOLERANCE = 1.5   # s of drift between lap-duration chain and race clock before re-anchoring
REPAIR_WINDOW = 6         # max laps merged when repairing an implausible lap


def lap_times_pass1(raw_laps, n_laps, lap1=None, t0=None):
    """Lap times for laps 1..n from OpenF1 (may contain None).

    lap_duration is preferred; missing laps come from the date_start chain.
    Lap 1 is the race-clock value (lights out → start of lap 2) when known.
    The cumulative time is re-anchored to the race clock (lap date_start − T0)
    wherever the duration chain drifts by more than ANCHOR_TOLERANCE seconds,
    so every car's cumulative time stays consistent with the timing feed."""
    by_n = {lp["lap_number"]: lp for lp in raw_laps}
    starts = [parse_ts(by_n[i]["date_start"]) if by_n.get(i) and by_n[i].get("date_start") else None
              for i in range(1, n_laps + 1)]
    times = []
    for i in range(n_laps):
        lp = by_n.get(i + 1)
        t = lp.get("lap_duration") if lp else None
        if t is not None and t <= 0:
            t = None
        if t is None and i + 1 < n_laps and starts[i] and starts[i + 1]:
            t = starts[i + 1] - starts[i]
        times.append(t)
    if n_laps and lap1 and lap1 > 0:
        times[0] = lap1
    anchored = 0
    if t0 is not None:
        cum = 0.0
        for i in range(n_laps):
            clock_end = (starts[i + 1] - t0) if i + 1 < n_laps and starts[i + 1] else None
            if clock_end is not None and clock_end > cum:
                if times[i] is None:
                    times[i] = clock_end - cum
                elif abs(cum + times[i] - clock_end) > ANCHOR_TOLERANCE:
                    times[i] = clock_end - cum
                    anchored += 1
            if times[i] is None:
                break
            cum += times[i]
    return times, anchored


def repair_laps(times, field_med, floor):
    """Fill missing laps and fix implausibly short ones without changing the
    cumulative time: merge the bad lap with neighbours until the window looks
    plausible vs the field's median lap profile, then redistribute the window's
    total time in proportion to that profile."""
    n = len(times)
    times = list(times)
    for i in range(n):
        if times[i] is None:
            times[i] = field_med[i]
    repaired = 0
    for i in range(n):
        if times[i] >= floor:
            continue
        lo = hi = i
        toggle = True
        while hi - lo + 1 < REPAIR_WINDOW:
            tot = sum(times[lo:hi + 1])
            ref = sum(field_med[lo:hi + 1])
            if tot >= 0.95 * ref and min(tot * field_med[j] / ref for j in range(lo, hi + 1)) >= floor:
                break
            if (toggle and lo > 0) or hi == n - 1:
                lo -= 1
            else:
                hi += 1
            toggle = not toggle
            if lo < 0:
                lo = 0
                if hi == n - 1:
                    break
        tot = sum(times[lo:hi + 1])
        ref = sum(field_med[lo:hi + 1]) or 1
        for j in range(lo, hi + 1):
            times[j] = tot * field_med[j] / ref
        repaired += 1
    return times, repaired


def sectors_for(raw_laps, times):
    by_n = {lp["lap_number"]: lp for lp in raw_laps}
    n_laps = len(times)
    ratios = []
    for lp in raw_laps:
        s = [lp.get("duration_sector_1"), lp.get("duration_sector_2"), lp.get("duration_sector_3")]
        if all(s) and lp.get("lap_duration"):
            ratios.append([x / lp["lap_duration"] for x in s])
    r = [median([q[k] for q in ratios], 1 / 3) for k in range(3)] if ratios else [1 / 3] * 3
    rs = sum(r)
    r = [x / rs for x in r]
    sectors = []
    for i in range(n_laps):
        lp = by_n.get(i + 1)
        s = [lp.get(f"duration_sector_{k}") for k in (1, 2, 3)] if lp else [None] * 3
        if all(s) and abs(sum(s) - times[i]) < 2.0:
            sectors.append([r3(x) for x in s])
        else:
            sectors.append([r3(times[i] * r[k]) for k in range(3)])
    return sectors


def norm_compound(c):
    c = (c or "").upper()
    return c if c in COMPOUNDS else None


def reconcile_strategy(raw_laps, n, times, stints_raw, pits_raw, neutral_laps, red_laps, med_lane, nominal_loss, field_ref):
    """Consistent pit stops + stints for one car.

    OpenF1's /pit, /stints and the laps' is_pit_out_lap flags occasionally
    disagree (missing or phantom pit records, stints off by a lap). Evidence,
    strongest first: out-lap flag on lap L+1 → in-lap L; a /pit record backed by
    lost time (or inside a neutralised window); a stint boundary backed by lost
    time or a compound change. Stints are rebuilt from the tyre-change stops.
    Returns (stints, pits, notes)."""
    notes = []
    # time lost vs a non-pitting reference (30th percentile of the field on that
    # lap), relative to this car's usual offset — robust under SC/VSC too
    offs = [times[i] - field_ref[i] for i in range(1, n) if (i + 1) not in red_laps]
    offset = median(offs, 0.0)

    def loss_at(L):
        if L < 1 or L > n:
            return 0.0
        js = [L - 1] if L == n else [L - 1, L]
        return sum(times[j] - field_ref[j] - offset for j in js)

    threshold = max(5.0, 0.3 * nominal_loss)

    flags = sorted({lp["lap_number"] - 1 for lp in raw_laps
                    if lp.get("is_pit_out_lap") and 2 <= lp["lap_number"] <= n})
    recs = sorted([p for p in pits_raw if (p.get("lane_duration") or p.get("pit_duration")) and 1 <= p["lap_number"] <= n],
                  key=lambda p: p["lap_number"])
    used = [False] * len(recs)

    def lane_of(p):
        return p.get("lane_duration") or p.get("pit_duration")

    def estimate(L):
        return {"lap": L, "laneSeconds": r3(max(10.0, med_lane + max(-5.0, min(30.0, loss_at(L) - nominal_loss)))),
                "stopSeconds": None, "_est": True}

    pits = {}
    for L in flags:
        best = None
        for k, p in enumerate(recs):
            if not used[k] and abs(p["lap_number"] - L) <= 1:
                if best is None or abs(p["lap_number"] - L) < abs(recs[best]["lap_number"] - L):
                    best = k
        if best is not None:
            used[best] = True
            p = recs[best]
            pits[L] = {"lap": L, "laneSeconds": r3(lane_of(p)), "stopSeconds": r3(p.get("stop_duration"))}
            if p["lap_number"] != L:
                notes.append(f"pit record lap {p['lap_number']}→{L} (out-lap flag)")
        else:
            pits[L] = estimate(L)
            notes.append(f"pit lap {L} from out-lap flag (lane estimated)")
    for k, p in enumerate(recs):
        if used[k]:
            continue
        L = p["lap_number"]
        if L in pits:
            continue
        if L in red_laps or loss_at(L) > (0.5 * threshold if L in neutral_laps else threshold):
            pits[L] = {"lap": L, "laneSeconds": r3(lane_of(p)), "stopSeconds": r3(p.get("stop_duration"))}
        else:
            notes.append(f"dropped phantom pit record lap {L} (no time lost)")

    # stints (OpenF1), trimmed to laps actually completed
    st = []
    for s in sorted(stints_raw, key=lambda s: s["stint_number"]):
        comp = norm_compound(s.get("compound"))
        ls = s.get("lap_start") or 1
        if ls > n:
            continue
        le = min(s.get("lap_end") or n, n)
        if st and comp is None:
            comp = st[-1]["compound"]
        st.append({"compound": comp or "MEDIUM", "lapStart": ls, "lapEnd": max(ls, le), "age": s.get("tyre_age_at_start") or 0})
    if not st and n:
        st = [{"compound": "MEDIUM", "lapStart": 1, "lapEnd": n, "age": 0}]
        notes.append("no stint data (compound unknown → MEDIUM)")
    # OpenF1 artifact: a one-lap opening stint with no stop behind it
    # — usually the first stint's end lap is missing: if a stop sits inside the
    # second stint (away from its end), the opening stint really ran until then
    if len(st) > 1 and st[0]["lapEnd"] <= 1 and not any(L <= 2 for L in pits):
        inner = [L for L in sorted(pits) if 2 < L < st[1]["lapEnd"] - 2]
        if inner:
            notes.append(f"opening stint ({st[0]['compound']}) extended to the stop on lap {inner[0]}")
            st[0] = {**st[0], "lapEnd": inner[0]}
            st[1] = {**st[1], "lapStart": inner[0] + 1}
        else:
            notes.append(f"dropped one-lap opening stint ({st[0]['compound']}) without a stop")
            st = st[1:]
            st[0] = {**st[0], "lapStart": 1}

    # match stint boundaries to stops
    boundaries = [(s["lapEnd"], idx + 1) for idx, s in enumerate(st[:-1])]
    changes = {}  # pit lap -> index of the stint that starts after it
    for b, nxt in boundaries:
        if b >= n:
            continue
        cand = [L for L in pits if abs(L - b) <= 2 and L not in changes]
        if cand:
            changes[min(cand, key=lambda L: (abs(L - b), L))] = nxt
            continue
        compound_change = st[nxt]["compound"] != st[nxt - 1]["compound"]
        if (b >= 2 and loss_at(b) > threshold) or b in red_laps or compound_change:
            pits[b] = estimate(b)
            changes[b] = nxt
            notes.append(f"pit lap {b} from stint boundary (lane estimated)")
        else:
            notes.append(f"merged stint boundary lap {b} (no stop evidence)")
    # recorded stops with a stationary time are tyre changes even when /stints
    # misses the boundary: the new set's compound is unknown → same compound, new set
    for L in sorted(pits):
        p = pits[L]
        if L not in changes and (p.get("stopSeconds") or 0) >= 1.5 and L < n:
            k = max([i for i, s in enumerate(st) if s["lapStart"] <= L] or [0])
            st.append({"compound": st[k]["compound"], "lapStart": L + 1, "lapEnd": n, "age": 0})
            changes[L] = len(st) - 1
            notes.append(f"pit lap {L} has a stationary time but no stint boundary (compound assumed unchanged)")
    # rebuild stints from tyre-change stops
    stints = []
    cur = st[0] if st else None
    start = 1
    for L in sorted(changes):
        if L >= n or cur is None:
            break
        stints.append({"compound": cur["compound"], "lapStart": start, "lapEnd": L, "tyreAgeAtStart": cur["age"]})
        cur = st[changes[L]]
        start = L + 1
    if cur is not None and n >= start:
        stints.append({"compound": cur["compound"], "lapStart": start, "lapEnd": n, "tyreAgeAtStart": cur["age"]})
    pit_list = [pits[L] for L in sorted(pits)]
    for p in pit_list:
        p["_tyres"] = p["lap"] in changes
    return stints, pit_list, notes


def process_race(meeting, race_sess, quali_sess, round_no, slug, drivers_meta):
    sk = race_sess["session_key"]
    results = api("session_result", session_key=sk)
    if not results:
        return None
    for r in results:
        r["position"] = to_pos(r.get("position"))
    drivers = api("drivers", session_key=sk)
    for d in drivers:
        drivers_meta[d["driver_number"]] = d  # latest appearance wins (calendar order)
    laps_all = api("laps", session_key=sk)
    stints_all = api("stints", session_key=sk)
    pits_all = api("pit", session_key=sk)
    rc = api("race_control", session_key=sk)
    overtakes = api("overtakes", session_key=sk)
    quali_results = api("session_result", session_key=quali_sess["session_key"]) if quali_sess else []
    quali_laps = api("laps", session_key=quali_sess["session_key"]) if quali_sess else []

    laps_by_driver: dict[int, list] = {}
    for lp in laps_all:
        laps_by_driver.setdefault(lp["driver_number"], []).append(lp)

    classified = [r for r in results if r.get("position")]
    winner = min(classified, key=lambda r: r["position"]) if classified else None
    total_laps = int(winner["number_of_laps"]) if winner else max((r.get("number_of_laps") or 0) for r in results)

    # lap 1 for the winner from total race duration
    winner_lap1 = None
    if winner and winner.get("duration"):
        wl = {lp["lap_number"]: lp.get("lap_duration") for lp in laps_by_driver.get(winner["driver_number"], [])}
        rest = [wl.get(i) for i in range(2, total_laps + 1)]
        if all(rest):
            winner_lap1 = winner["duration"] - sum(rest)
    # T0 = when the winner started lap 2 minus their lap 1 time
    t0 = None
    if winner and winner_lap1:
        w2 = next((lp for lp in laps_by_driver.get(winner["driver_number"], []) if lp["lap_number"] == 2), None)
        if w2 and w2.get("date_start"):
            t0 = parse_ts(w2["date_start"]) - winner_lap1

    if t0 is None:  # fall back to the earliest lap-1 start in the timing feed
        starts = [parse_ts(lp["date_start"]) for lp in laps_all if lp["lap_number"] == 1 and lp.get("date_start")]
        t0 = min(starts) if starts else None

    quali_pos = {r["driver_number"]: to_pos(r.get("position")) for r in quali_results if to_pos(r.get("position"))}
    quali_top3 = [dn for dn, _ in sorted(quali_pos.items(), key=lambda kv: kv[1])[:3]]

    windows = track_status_windows(rc, total_laps)
    sc_laps = {l for w in windows if w["type"] in ("SC", "VSC", "RED") for l in range(w["startLap"], w["endLap"] + 1)}
    red_laps = {l for w in windows if w["type"] == "RED" for l in range(w["startLap"], w["endLap"] + 1)}

    # ---- pass 1: raw lap times per car (race-clock anchored) ----
    pass1 = {}
    qa = {"anchored": 0, "repaired": 0, "strategy": []}
    for r in results:
        dn = r["driver_number"]
        n = int(r.get("number_of_laps") or 0)
        raw = laps_by_driver.get(dn, [])
        lap1 = None
        if n >= 2 and t0:
            l2 = next((lp for lp in raw if lp["lap_number"] == 2 and lp.get("date_start")), None)
            if l2:
                lap1 = parse_ts(l2["date_start"]) - t0
        if dn == (winner or {}).get("driver_number") and winner_lap1:
            lap1 = winner_lap1
        times, anchored = lap_times_pass1(raw, n, lap1, t0)
        qa["anchored"] += anchored
        pass1[dn] = times

    # field median lap profile + plausibility floor (98.5 % of the 3rd fastest timed lap)
    field_med = []
    for i in range(total_laps + 5):
        vals = [t[i] for t in pass1.values() if i < len(t) and t[i] is not None]
        field_med.append(median(vals, field_med[-1] if field_med else 95.0))
    timed = sorted(lp["lap_duration"] for lp in laps_all if lp.get("lap_duration") and lp["lap_number"] > 1)
    floor = 0.985 * (timed[2] if len(timed) > 2 else (timed[0] if timed else 60.0))

    def pct30(vals):
        vals = sorted(vals)
        return vals[int(0.3 * (len(vals) - 1))] if vals else None

    field_ref = []
    for i in range(total_laps + 5):
        vals = [t[i] for t in pass1.values() if i < len(t) and t[i] is not None]
        field_ref.append(pct30(vals) or field_med[i])
    lanes = [p.get("lane_duration") or p.get("pit_duration") for p in pits_all]
    lanes = [x for x in lanes if x and x < 60]
    med_lane = median(lanes, 23.0)
    nominal_loss = med_lane - 2.0

    cars = []
    for r in results:
        dn = r["driver_number"]
        n = int(r.get("number_of_laps") or 0)
        raw = laps_by_driver.get(dn, [])
        times, repaired = repair_laps(pass1[dn], field_med, floor) if n else ([], 0)
        qa["repaired"] += repaired
        sectors = sectors_for(raw, times) if n else []
        stints, pits, notes = reconcile_strategy(
            raw, n, times, [s for s in stints_all if s["driver_number"] == dn],
            [p for p in pits_all if p["driver_number"] == dn], sc_laps, red_laps, med_lane, nominal_loss,
            field_ref) if n else ([], [], [])
        qa["strategy"] += [f"#{dn}: {x}" for x in notes]
        status = "DSQ" if r.get("dsq") else "DNS" if r.get("dns") else "DNF" if r.get("dnf") else "FINISHED"
        cars.append({
            "driverNumber": dn,
            "laps": [r3(t) for t in times],
            "sectors": sectors,
            "stints": stints,
            "pits": pits,
            "gridPosition": quali_pos.get(dn),
            "finishPosition": r.get("position"),
            "status": status,
            "dnfLap": n if status == "DNF" else None,
            "points": r.get("points") or 0,
            "raceTime": r3(r.get("duration")) if isinstance(r.get("duration"), (int, float)) else None,
        })
    cars.sort(key=lambda c: (c["finishPosition"] is None, c["finishPosition"] or 99, -len(c["laps"])))

    # pit loss: (in-lap + out-lap) - 2 * driver's clean median, green flag only,
    # tyre-change stops only (no drive-throughs, no red-flag changes)
    losses = []
    for c in cars:
        clean = median([t for i, t in enumerate(c["laps"], 1) if i > 1 and i not in sc_laps])
        for p in c["pits"]:
            L = p["lap"]
            if not p.get("_tyres") or p.get("_est"):
                continue
            if L in sc_laps or L + 1 in sc_laps or L < 2 or L + 1 > len(c["laps"]) or not clean:
                continue
            loss = c["laps"][L - 1] + c["laps"][L] - 2 * clean
            if 10 < loss < 45:
                losses.append(loss)
    pit_loss = median(losses, nominal_loss)

    green_med = median([t for c in cars for i, t in enumerate(c["laps"], 1) if i > 1 and i not in sc_laps], 95.0)
    sc_lap_times = [c["laps"][l - 1] for c in cars for l in sc_laps - red_laps
                    if 1 < l <= len(c["laps"]) and c["laps"][l - 1] < 2.5 * green_med]
    sc_lap = median(sc_lap_times, green_med * 1.4)

    # ---- events ----
    events = []
    lap_starts = {c["driverNumber"]: [] for c in cars}
    for dn, raw in laps_by_driver.items():
        lap_starts[dn] = sorted((parse_ts(lp["date_start"]), lp["lap_number"]) for lp in raw if lp.get("date_start"))

    def lap_at(dn, ts):
        ls = lap_starts.get(dn) or []
        lap = 1
        for t, n in ls:
            if t <= ts:
                lap = n
            else:
                break
        return lap

    pit_laps = {(c["driverNumber"], p["lap"]) for c in cars for p in c["pits"]}
    for c in cars:
        for p in c["pits"]:
            if p["lap"] in red_laps and p["laneSeconds"] > 60:
                msg = "Tyre change under red flag"
            else:
                kind = "Pit stop" if p.get("_tyres") else "Pit lane visit (no tyre change)"
                msg = (f"{kind} · {p['laneSeconds']:.1f}s in lane" + (" (est.)" if p.get("_est") else "")
                       + (f" · {p['stopSeconds']:.1f}s stationary" if p.get("stopSeconds") else ""))
            events.append({"lap": p["lap"], "type": "PIT", "driverNumber": c["driverNumber"], "message": msg})
        if c["status"] == "DNF":
            events.append({"lap": max(1, c["dnfLap"] or 1), "type": "DNF", "driverNumber": c["driverNumber"], "message": "Retired from the race"})
    overtake_count = 0
    for o in overtakes:
        a, b = o["overtaking_driver_number"], o["overtaken_driver_number"]
        ts = parse_ts(o["date"])
        lap = lap_at(a, ts)
        pit_related = any((d, l) in pit_laps for d in (a, b) for l in (lap - 1, lap))
        # red-flag restarts re-sort the field (resumption order / grid): not on-track passes
        restart_noise = any(w["type"] == "RED" and w["startLap"] <= lap <= w["endLap"] + 2 for w in windows)
        if lap <= 1 or pit_related or lap in sc_laps or restart_noise:
            continue
        overtake_count += 1
        events.append({"lap": lap, "type": "OVERTAKE", "driverNumber": a, "otherDriverNumber": b,
                       "message": f"On-track pass for P{o.get('position')}"})
    for w in windows:
        label = {"SC": "Safety Car deployed", "VSC": "Virtual Safety Car", "RED": "Red flag — race suspended"}[w["type"]]
        events.append({"lap": w["startLap"], "type": w["type"], "message": f"{label} (laps {w['startLap']}–{w['endLap']})"})
    penalties = parse_penalties(rc, round_no, slug)
    for p in penalties:
        if p["category"] in ("TIME", "DRIVE_THROUGH", "STOP_GO"):
            events.append({"lap": p["lap"] or 1, "type": "PENALTY", "driverNumber": p["driverNumber"], "message": p["message"]})
    incidents = []
    for m in rc:
        msg = m["message"]
        if CRASH.search(msg) and not msg.upper().startswith("FIA STEWARDS: PENALTY SERVED"):
            g = CAR_NUM.search(msg.upper())
            dn = int(g.group(1)) if g else None
            events.append({"lap": m.get("lap_number") or 1, "type": "CRASH", **({"driverNumber": dn} if dn else {}), "message": msg})
            incidents.append({"round": round_no, "slug": slug, "lap": m.get("lap_number"), "driverNumber": dn, "type": "CRASH", "message": msg})
    for w in windows:
        incidents.append({"round": round_no, "slug": slug, "lap": w["startLap"], "driverNumber": None, "type": w["type"],
                          "message": f"{w['type']} laps {w['startLap']}–{w['endLap']}"})
    for c in cars:
        if c["status"] == "DNF":
            incidents.append({"round": round_no, "slug": slug, "lap": c["dnfLap"], "driverNumber": c["driverNumber"], "type": "DNF", "message": "Retired"})

    # fastest lap
    fl = None
    for c in cars:
        for i, t in enumerate(c["laps"], 1):
            if i > 1 and (fl is None or t < fl[1]):
                raw_ok = any(lp["lap_number"] == i and lp.get("lap_duration") and abs(lp["lap_duration"] - t) < 0.05
                             for lp in laps_by_driver.get(c["driverNumber"], []))
                if raw_ok:
                    fl = (c["driverNumber"], t, i)
    if fl:
        events.append({"lap": fl[2], "type": "FASTEST_LAP", "driverNumber": fl[0], "message": f"Fastest lap {fmt_lap(fl[1])}"})
    events.sort(key=lambda e: (e["lap"], e["type"]))

    circuit = build_circuit(sk, laps_by_driver, slug, race_sess["circuit_short_name"], total_laps)
    if (circuit is None or circuit["_quality"] < CIRCUIT_MIN_UNIQUE // 2) and quali_sess and quali_laps:
        # some race sessions have no location feed (e.g. Monaco 2026): use a qualifying lap instead
        q_by_driver: dict[int, list] = {}
        for lp in quali_laps:
            q_by_driver.setdefault(lp["driver_number"], []).append(lp)
        max_q = max((lp["lap_number"] for lp in quali_laps), default=0)
        q_circuit = build_circuit(quali_sess["session_key"], q_by_driver, slug, race_sess["circuit_short_name"], max_q + 2)
        if q_circuit and (circuit is None or q_circuit["_quality"] > circuit["_quality"]):
            qa["strategy"].append("circuit geometry from qualifying (race location feed missing or too sparse)")
            circuit = q_circuit
    if circuit:
        circuit.pop("_quality", None)
    if circuit is None:
        qa["strategy"].append("WARNING: no location data — fallback oval geometry")
        circuit = fallback_circuit(slug, race_sess["circuit_short_name"])

    podium = [c["driverNumber"] for c in cars if c["finishPosition"] in (1, 2, 3)]
    second = next((r for r in results if r.get("position") == 2), None)
    gap = second.get("gap_to_leader") if second and isinstance(second.get("gap_to_leader"), (int, float)) else None

    summary_extra = {
        "totalLaps": total_laps,
        "podium": podium,
        "pole": quali_top3[0] if quali_top3 else None,
        "qualifyingTop3": quali_top3,
        "winnerGapSeconds": r3(gap),
        "safetyCars": sum(1 for w in windows if w["type"] == "SC"),
        "virtualSafetyCars": sum(1 for w in windows if w["type"] == "VSC"),
        "redFlags": sum(1 for w in windows if w["type"] == "RED"),
        "dnfCount": sum(1 for c in cars if c["status"] == "DNF"),
        "overtakeCount": overtake_count,
        "fastestLap": {"driverNumber": fl[0], "time": fl[1]} if fl else None,
        "hasBundle": True,
    }
    bundle = {
        "circuit": circuit,
        "totalLaps": total_laps,
        "cars": cars,
        "trackStatus": windows,
        "events": events,
        "pitLossSeconds": r3(pit_loss),
        "safetyCarLapSeconds": r3(sc_lap),
        # optional extension (engine reads it if present): awarded time / drive-through /
        # stop-go penalties and the lap they were served on (null = added after the flag)
        "penalties": penalty_service(rc, penalties, total_laps),
    }
    for c in cars:
        for p in c["pits"]:
            p.pop("_tyres", None)
            p.pop("_est", None)
    bundle["_qa"] = qa

    # pace (% gap to fastest)
    quali_best = {}
    for lp in quali_laps:
        if lp.get("lap_duration") and not lp.get("is_pit_out_lap"):
            dn = lp["driver_number"]
            quali_best[dn] = min(quali_best.get(dn, 1e9), lp["lap_duration"])
    race_pace, race_fc = {}, {}
    for c in cars:
        pit_set = {p["lap"] for p in c["pits"]} | {p["lap"] + 1 for p in c["pits"]}
        clean = [(i, t) for i, t in enumerate(c["laps"], 1) if i > 1 and i not in sc_laps and i not in pit_set]
        if len(clean) >= 5:
            race_pace[c["driverNumber"]] = median([t for _, t in clean])
            race_fc[c["driverNumber"]] = median([t - FUEL_SECONDS_PER_LAP * (total_laps - i) for i, t in clean])

    def pct(d):
        if not d:
            return {}
        best = min(d.values())
        return {k: round((v - best) / best * 100, 3) for k, v in d.items()}

    pace = {"qualifying": pct(quali_best), "race": pct(race_pace), "raceFuelCorrected": pct(race_fc)}
    return summary_extra, bundle, penalties, incidents, pace, results


def fmt_lap(t):
    m = int(t // 60)
    return f"{m}:{t - 60 * m:06.3f}"


# --------------------------------------------------------------------------- #
# season assembly
# --------------------------------------------------------------------------- #
def detect_upgrades(team_pace, races, teams):
    """Flag rounds where a team's race pace gap improved by >= 0.25 percentage points
    (mean of up to 3 rounds after vs 3 before), at most 3 per team."""
    out = []
    completed_idx = [i for i, r in enumerate(races) if r["status"] == "completed"]
    for t in teams:
        series = team_pace[t["id"]]["raceFuelCorrected"]
        cands = []
        for pos in range(2, len(completed_idx) - 1):
            i = completed_idx[pos]
            before = [series[j] for j in completed_idx[max(0, pos - 3):pos] if series[j] is not None]
            after = [series[j] for j in completed_idx[pos:pos + 3] if series[j] is not None]
            if len(before) >= 2 and len(after) >= 2:
                b, a = statistics.mean(before), statistics.mean(after)
                if b - a >= 0.25:
                    cands.append((a - b, i, b, a))
        cands.sort()
        chosen = []
        for d, i, b, a in cands:
            if all(abs(i - j) >= 3 for _, j, _, _ in chosen):
                chosen.append((d, i, b, a))
            if len(chosen) == 3:
                break
        for d, i, b, a in sorted(chosen, key=lambda c: c[1]):
            out.append({"teamId": t["id"], "round": races[i]["round"], "title": "Performance step detected",
                        "area": "UNKNOWN", "source": "detected", "paceBefore": round(b, 3), "paceAfter": round(a, 3), "paceDelta": round(a - b, 3)})
    if UPGRADES_FILE.exists():
        for u in json.loads(UPGRADES_FILE.read_text()):
            u.setdefault("source", "editorial")
            for k in ("paceBefore", "paceAfter", "paceDelta"):
                u.setdefault(k, None)
            out.append(u)
    return out


def validate_bundle(b):
    """Sanity checks over a finished RaceBundle; returns human-readable warnings."""
    out = []
    qa = b.get("_qa") or {}
    if qa.get("anchored") or qa.get("repaired"):
        out.append(f"lap times: {qa.get('anchored', 0)} re-anchored to race clock, {qa.get('repaired', 0)} implausible laps repaired")
    for note in qa.get("strategy", []):
        out.append(note)
    T = b["totalLaps"]
    cars = b["cars"]
    winner = next((c for c in cars if c["finishPosition"] == 1), None)
    win_time = sum(winner["laps"]) if winner else None
    classified = sorted([c for c in cars if c["finishPosition"]], key=lambda c: c["finishPosition"])
    prev = None
    for c in cars:
        dn, laps = c["driverNumber"], c["laps"]
        if c["status"] == "FINISHED" and c["raceTime"]:
            d = c["raceTime"] - sum(laps)
            if d < -1.0 or d > 61:
                out.append(f"#{dn} race time {c['raceTime']:.1f} vs lap sum {sum(laps):.1f} (Δ {d:+.1f}s)")
        if len(c["stints"]) and (c["stints"][0]["lapStart"] != 1 or c["stints"][-1]["lapEnd"] != len(laps)):
            out.append(f"#{dn} stints do not cover laps 1..{len(laps)}")
        if c["status"] == "FINISHED" and len(laps) < T and win_time and sum(laps) < win_time - 3:
            out.append(f"#{dn} classified {T - len(laps)} lap(s) down but crossed the line before the winner finished")
    for a, bb in zip(classified, classified[1:]):
        if len(a["laps"]) == len(bb["laps"]):
            ta = a["raceTime"] or sum(a["laps"])
            tb = bb["raceTime"] or sum(bb["laps"])
            if ta > tb + 0.5:
                out.append(f"P{a['finishPosition']} #{a['driverNumber']} slower than P{bb['finishPosition']} #{bb['driverNumber']} on time ({ta:.1f} vs {tb:.1f})")
    km = b["circuit"]["lengthKm"]
    if winner:
        green = sorted(winner["laps"][1:])
        best = green[0] if green else 0
        if best:
            v = km * 3600 / best
            if not 150 <= v <= 260:
                out.append(f"circuit {km} km at a {best:.1f}s best lap = {v:.0f} km/h average (implausible geometry?)")
    if not 8 <= b["pitLossSeconds"] <= 40:
        out.append(f"pit loss {b['pitLossSeconds']}s out of range")
    for w in b["trackStatus"]:
        if w["endLap"] - w["startLap"] > 12:
            out.append(f"{w['type']} window laps {w['startLap']}-{w['endLap']} unusually long")
    for e in b["events"]:
        if not 1 <= e["lap"] <= T:
            out.append(f"event on lap {e['lap']} outside race: {e['message'][:40]}")
    return out


def main():
    global REFRESH
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignore the on-disk cache")
    args = ap.parse_args()
    REFRESH = args.refresh

    meetings = [m for m in api("meetings", year=YEAR) if "testing" not in m["meeting_name"].lower()]
    meetings.sort(key=lambda m: m["date_start"])
    sessions = api("sessions", year=YEAR)
    now = datetime.now(timezone.utc).timestamp()

    races, bundles = [], {}
    penalties, incidents = [], []
    drivers_meta: dict[int, dict] = {}
    pace_by_round = []
    results_by_round = []
    champ_drivers_by_round, champ_teams_by_round = [], []

    for round_no, m in enumerate(meetings, 1):
        ms = [s for s in sessions if s["meeting_key"] == m["meeting_key"]]
        race = next((s for s in ms if s["session_name"] == "Race"), None)
        quali = next((s for s in ms if s["session_name"] == "Qualifying"), None)
        cname = (race or m).get("circuit_short_name") or m.get("location") or m["meeting_name"]
        slug = slug_for(cname)
        summary = {
            "round": round_no, "slug": slug, "meetingKey": m["meeting_key"],
            "sessionKey": race["session_key"] if race else None,
            "name": m["meeting_name"], "country": m.get("country_name") or "",
            "circuitName": cname, "date": (race or m)["date_start"],
            "status": "upcoming", "totalLaps": None, "podium": [], "pole": None, "qualifyingTop3": [],
            "winnerGapSeconds": None, "safetyCars": 0, "virtualSafetyCars": 0, "redFlags": 0,
            "dnfCount": 0, "overtakeCount": 0, "fastestLap": None, "hasBundle": False,
        }
        pace = None
        results = []
        cd, ct = [], []
        if race and race.get("is_cancelled"):
            summary["status"] = "cancelled"
        elif race and parse_ts(race.get("date_end") or race["date_start"]) < now:
            print(f"  R{round_no:02d} {m['meeting_name']} ({slug}) …", flush=True)
            res = process_race(m, race, quali, round_no, slug, drivers_meta)
            if res:
                extra, bundle, pens, incs, pace, results = res
                summary.update(extra)
                summary["status"] = "completed"
                bundle["summary"] = summary
                bundles[slug] = bundle
                penalties += pens
                incidents += incs
                cd = api("championship_drivers", session_key=race["session_key"])
                ct = api("championship_teams", session_key=race["session_key"])
            else:
                summary["status"] = "cancelled"
        races.append(summary)
        pace_by_round.append(pace)
        results_by_round.append(results)
        champ_drivers_by_round.append(cd)
        champ_teams_by_round.append(ct)

    # official round numbers skip cancelled events (cancelled = 0)
    rnd = 0
    for r in races:
        if r["status"] == "cancelled":
            r["round"] = 0
        else:
            rnd += 1
            r["round"] = rnd
    by_slug = {r["slug"]: r["round"] for r in races}
    for item in penalties + incidents:
        item["round"] = by_slug.get(item["slug"], item["round"])

    # teams / drivers
    teams = {}
    for d in drivers_meta.values():
        tid = kebab(d.get("team_name") or "unknown")
        teams.setdefault(tid, {"id": tid, "name": d.get("team_name") or "Unknown", "color": hexcol(d.get("team_colour"))})
    drivers = []
    for dn, d in sorted(drivers_meta.items()):
        drivers.append({
            "number": dn, "code": d.get("name_acronym") or str(dn),
            "firstName": (d.get("first_name") or "").title(), "lastName": (d.get("last_name") or "").title(),
            "fullName": f"{(d.get('first_name') or '').title()} {(d.get('last_name') or '').title()}".strip(),
            "teamId": kebab(d.get("team_name") or "unknown"), "color": hexcol(d.get("team_colour")),
        })
    team_list = sorted(teams.values(), key=lambda t: t["name"])

    # standings
    n = len(races)
    d_stand = {}
    for d in drivers:
        d_stand[d["number"]] = {"driverNumber": d["number"], "points": 0, "position": 0, "wins": 0, "podiums": 0,
                                "pointsByRound": [None] * n, "finishByRound": [None] * n}
    for i, res in enumerate(results_by_round):
        for r in res:
            s = d_stand.get(r["driver_number"])
            if not s:
                continue
            s["finishByRound"][i] = r.get("position")
            if r.get("position") == 1:
                s["wins"] += 1
            if r.get("position") in (1, 2, 3):
                s["podiums"] += 1
        for row in champ_drivers_by_round[i]:
            s = d_stand.get(row["driver_number"])
            if s:
                s["pointsByRound"][i] = row.get("points_current")
    for s in d_stand.values():
        pts = [p for p in s["pointsByRound"] if p is not None]
        s["points"] = pts[-1] if pts else 0
    d_rows = sorted(d_stand.values(), key=lambda s: (-s["points"], -s["wins"]))
    for i, s in enumerate(d_rows, 1):
        s["position"] = i

    c_stand = {t["id"]: {"teamId": t["id"], "points": 0, "position": 0, "wins": 0, "pointsByRound": [None] * n} for t in team_list}
    team_of = {d["number"]: d["teamId"] for d in drivers}
    for i, rows in enumerate(champ_teams_by_round):
        for row in rows:
            tid = kebab(row.get("team_name") or "")
            if tid in c_stand:
                c_stand[tid]["pointsByRound"][i] = row.get("points_current")
        for r in results_by_round[i]:
            if r.get("position") == 1 and team_of.get(r["driver_number"]) in c_stand:
                c_stand[team_of[r["driver_number"]]]["wins"] += 1
    for s in c_stand.values():
        pts = [p for p in s["pointsByRound"] if p is not None]
        s["points"] = pts[-1] if pts else 0
    c_rows = sorted(c_stand.values(), key=lambda s: (-s["points"], -s["wins"]))
    for i, s in enumerate(c_rows, 1):
        s["position"] = i

    # pace series
    driver_pace = {d["number"]: {"qualifying": [None] * n, "race": [None] * n, "raceFuelCorrected": [None] * n} for d in drivers}
    for i, pace in enumerate(pace_by_round):
        if not pace:
            continue
        for key in ("qualifying", "race", "raceFuelCorrected"):
            for dn, v in pace[key].items():
                if dn in driver_pace:
                    driver_pace[dn][key][i] = v
    team_pace = {t["id"]: {"qualifying": [None] * n, "race": [None] * n, "raceFuelCorrected": [None] * n} for t in team_list}
    for t in team_list:
        mates = [d["number"] for d in drivers if d["teamId"] == t["id"]]
        for key in ("qualifying", "race", "raceFuelCorrected"):
            for i in range(n):
                vals = [driver_pace[m][key][i] for m in mates if driver_pace[m][key][i] is not None]
                team_pace[t["id"]][key][i] = round(min(vals), 3) if vals else None

    season = {
        "year": YEAR,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "teams": team_list,
        "drivers": drivers,
        "races": races,
        "driverStandings": d_rows,
        "constructorStandings": c_rows,
        "penalties": penalties,
        "incidents": incidents,
        "upgrades": detect_upgrades(team_pace, races, team_list),
        "driverPace": {str(k): v for k, v in driver_pace.items()},
        "teamPace": team_pace,
        "partsAllocation": json.loads(PU_FILE.read_text()) if PU_FILE.exists() else {"limits": {}, "usage": [], "source": "none"},
    }

    (OUT / "races").mkdir(parents=True, exist_ok=True)
    SEED_OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "season.json").write_text(json.dumps(season, separators=(",", ":")))
    (SEED_OUT / "season.json").write_text(json.dumps(season, separators=(",", ":")))
    for slug, b in bundles.items():
        for w in validate_bundle(b):
            print(f"  [check] {slug}: {w}")
        ordered = {"summary": b["summary"], **{k: v for k, v in b.items() if k not in ("summary", "_qa")}}
        txt = json.dumps(ordered, separators=(",", ":"))
        (OUT / "races" / f"{slug}.json").write_text(txt)
        if slug in SEED_SLUGS:
            (SEED_OUT / f"{slug}.json").write_text(txt)

    done = sum(1 for r in races if r["status"] == "completed")
    print(f"\n{len(races)} rounds · {done} completed · "
          f"{sum(1 for r in races if r['status'] == 'cancelled')} cancelled · "
          f"{sum(1 for r in races if r['status'] == 'upcoming')} upcoming")
    print(f"{len(drivers)} drivers · {len(team_list)} teams · {len(penalties)} penalties · {len(season['upgrades'])} upgrade markers")
    print(f"wrote {OUT.relative_to(ROOT)}/ and {SEED_OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
