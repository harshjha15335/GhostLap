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
def build_circuit(session_key: int, laps_by_driver: dict, slug: str, name: str, totalLaps: int):
    """Extract one clean green-flag lap of location data and resample to a closed loop."""
    candidates = []
    for dn, laps in laps_by_driver.items():
        for lp in laps:
            if (
                lp.get("lap_duration")
                and lp.get("date_start")
                and not lp.get("is_pit_out_lap")
                and 3 <= lp["lap_number"] <= totalLaps - 2
                and lp.get("duration_sector_1")
                and lp.get("duration_sector_2")
            ):
                candidates.append((lp["lap_duration"], dn, lp))
    candidates.sort(key=lambda c: c[0])

    for _, dn, lp in candidates[:6]:
        t0 = parse_ts(lp["date_start"])
        t1 = t0 + lp["lap_duration"]
        lo = datetime.fromtimestamp(t0 - 0.5, timezone.utc).isoformat()
        hi = datetime.fromtimestamp(t1 + 0.5, timezone.utc).isoformat()
        pts = api("location", session_key=session_key, driver_number=dn, **{"date>": lo, "date<": hi})
        pts = [p for p in pts if p.get("x") is not None and not (p["x"] == 0 and p["y"] == 0)]
        if len(pts) < 80:
            continue
        return _resample(pts, t0, lp, slug, name)
    return None


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
RED = re.compile(r"RED FLAG")
RESUME = re.compile(r"RACE WILL RESUME|RESUMPTION|STANDING START PROCEDURE|ROLLING START")
PEN = re.compile(r"FIA STEWARDS:.*?(\d+) SECOND TIME PENALTY FOR CAR (\d+)")
DT = re.compile(r"FIA STEWARDS:.*?DRIVE THROUGH PENALTY FOR CAR (\d+)")
SG = re.compile(r"FIA STEWARDS:.*?(\d+)?\s*SECOND STOP AND GO PENALTY FOR CAR (\d+)")
GRID = re.compile(r"FIA STEWARDS:.*?(\d+) PLACE GRID PENALTY FOR CAR (\d+)")
WARN = re.compile(r"(BLACK AND WHITE FLAG|WARNING).*?CAR (\d+)")
REPR = re.compile(r"FIA STEWARDS:.*?REPRIMAND.*?CAR (\d+)")
INVEST = re.compile(r"FIA STEWARDS:.*?INCIDENT INVOLVING CARS? ([\d ,AND]+?) .*?(WILL BE INVESTIGATED|UNDER INVESTIGATION)")
CRASH = re.compile(r"CRASH|COLLISION|STOPPED ON TRACK|CAR \d+ .*STOPPED|SPUN|CONTACT", re.I)
CAR_NUM = re.compile(r"CARS? (\d+)")


def track_status_windows(rc, total_laps):
    windows = []
    open_sc = open_vsc = open_red = None
    for m in sorted(rc, key=lambda m: m["date"]):
        msg, lap = m["message"].upper(), m.get("lap_number") or 1
        if SC_DEPLOY.search(msg):
            if open_sc is None:
                open_sc = lap
        elif SC_IN.search(msg):
            if open_sc is not None:
                windows.append({"type": "SC", "startLap": open_sc, "endLap": lap})
                open_sc = None
        elif VSC_DEPLOY.search(msg):
            open_vsc = lap
        elif VSC_END.search(msg):
            if open_vsc is not None:
                windows.append({"type": "VSC", "startLap": open_vsc, "endLap": lap})
                open_vsc = None
        elif RED.search(msg) and m.get("category") != "Flag" or (m.get("flag") == "RED" and m.get("scope") == "Track"):
            if open_red is None:
                open_red = lap
        elif RESUME.search(msg) and open_red is not None:
            windows.append({"type": "RED", "startLap": open_red, "endLap": max(open_red, lap)})
            open_red = None
    if open_sc is not None:
        windows.append({"type": "SC", "startLap": open_sc, "endLap": total_laps})
    if open_vsc is not None:
        windows.append({"type": "VSC", "startLap": open_vsc, "endLap": open_vsc})
    if open_red is not None:
        windows.append({"type": "RED", "startLap": open_red, "endLap": open_red})
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


def fill_laps(raw_laps, n_laps, winner_lap1=None):
    """Return gap-free lap times + sectors for laps 1..n_laps."""
    by_n = {lp["lap_number"]: lp for lp in raw_laps}
    times = []
    for i in range(1, n_laps + 1):
        lp = by_n.get(i)
        t = lp.get("lap_duration") if lp else None
        if t is None and lp and by_n.get(i + 1) and lp.get("date_start") and by_n[i + 1].get("date_start"):
            t = parse_ts(by_n[i + 1]["date_start"]) - parse_ts(lp["date_start"])
        times.append(t)
    if times and times[0] is None and winner_lap1:
        times[0] = winner_lap1
    med = median(times, 95.0)
    for i, t in enumerate(times):
        if t is None or t <= 0:
            prev = next((times[j] for j in range(i - 1, -1, -1) if times[j]), None)
            nxt = next((times[j] for j in range(i + 1, len(times)) if times[j]), None)
            times[i] = median([prev, nxt], med) or med
    # sectors
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
    return [r3(t) for t in times], sectors


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

    quali_pos = {r["driver_number"]: to_pos(r.get("position")) for r in quali_results if to_pos(r.get("position"))}
    quali_top3 = [dn for dn, _ in sorted(quali_pos.items(), key=lambda kv: kv[1])[:3]]

    cars = []
    for r in results:
        dn = r["driver_number"]
        n = int(r.get("number_of_laps") or 0)
        raw = laps_by_driver.get(dn, [])
        lap1 = None
        if n >= 2 and t0:
            l2 = next((lp for lp in raw if lp["lap_number"] == 2 and lp.get("date_start")), None)
            if l2:
                lap1 = parse_ts(l2["date_start"]) - t0
        if dn == (winner or {}).get("driver_number"):
            lap1 = winner_lap1
        times, sectors = fill_laps(raw, n, lap1) if n else ([], [])
        stints = []
        for s in sorted([s for s in stints_all if s["driver_number"] == dn], key=lambda s: s["stint_number"]):
            comp = (s.get("compound") or "MEDIUM").upper()
            if comp not in COMPOUNDS:
                comp = "MEDIUM"
            ls, le = s.get("lap_start") or 1, s.get("lap_end") or n
            stints.append({"compound": comp, "lapStart": ls, "lapEnd": min(le, max(n, ls)), "tyreAgeAtStart": s.get("tyre_age_at_start") or 0})
        pits = [
            {"lap": p["lap_number"], "laneSeconds": r3(p.get("lane_duration") or p.get("pit_duration")), "stopSeconds": r3(p.get("stop_duration"))}
            for p in sorted([p for p in pits_all if p["driver_number"] == dn], key=lambda p: p["lap_number"])
            if (p.get("lane_duration") or p.get("pit_duration")) and p["lap_number"] <= n
        ]
        status = "DSQ" if r.get("dsq") else "DNS" if r.get("dns") else "DNF" if r.get("dnf") else "FINISHED"
        cars.append({
            "driverNumber": dn,
            "laps": times,
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

    windows = track_status_windows(rc, total_laps)
    sc_laps = {l for w in windows if w["type"] in ("SC", "VSC", "RED") for l in range(w["startLap"], w["endLap"] + 1)}

    # pit loss: (in-lap + out-lap) - 2 * driver's clean median, green flag only
    losses = []
    for c in cars:
        clean = median([t for i, t in enumerate(c["laps"], 1) if i > 1 and i not in sc_laps])
        for p in c["pits"]:
            L = p["lap"]
            if L in sc_laps or L + 1 in sc_laps or L < 2 or L + 1 > len(c["laps"]) or not clean:
                continue
            loss = c["laps"][L - 1] + c["laps"][L] - 2 * clean
            if 10 < loss < 45:
                losses.append(loss)
    pit_loss = median(losses, median([p["laneSeconds"] for c in cars for p in c["pits"]], 22.0) - 2.0)

    sc_lap_times = [c["laps"][l - 1] for c in cars for l in sc_laps if 1 < l <= len(c["laps"])]
    green_med = median([t for c in cars for i, t in enumerate(c["laps"], 1) if i > 1 and i not in sc_laps], 95.0)
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
            events.append({"lap": p["lap"], "type": "PIT", "driverNumber": c["driverNumber"],
                           "message": f"Pit stop · {p['laneSeconds']:.1f}s in lane" + (f" · {p['stopSeconds']:.1f}s stationary" if p.get("stopSeconds") else "")})
        if c["status"] == "DNF":
            events.append({"lap": max(1, c["dnfLap"] or 1), "type": "DNF", "driverNumber": c["driverNumber"], "message": "Retired from the race"})
    overtake_count = 0
    for o in overtakes:
        a, b = o["overtaking_driver_number"], o["overtaken_driver_number"]
        ts = parse_ts(o["date"])
        lap = lap_at(a, ts)
        pit_related = any((d, l) in pit_laps for d in (a, b) for l in (lap - 1, lap))
        if lap <= 1 or pit_related or lap in sc_laps:
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
                raw_ok = any(lp["lap_number"] == i and lp.get("lap_duration") for lp in laps_by_driver.get(c["driverNumber"], []))
                if raw_ok:
                    fl = (c["driverNumber"], t, i)
    if fl:
        events.append({"lap": fl[2], "type": "FASTEST_LAP", "driverNumber": fl[0], "message": f"Fastest lap {fmt_lap(fl[1])}"})
    events.sort(key=lambda e: (e["lap"], e["type"]))

    circuit = build_circuit(sk, laps_by_driver, slug, race_sess["circuit_short_name"], total_laps) or fallback_circuit(slug, race_sess["circuit_short_name"])

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
    }

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
        ordered = {"summary": b["summary"], **{k: v for k, v in b.items() if k != "summary"}}
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
