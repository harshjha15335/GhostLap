# Race Lab · Retirements, overtakes, circuit seam

## Exact retirement points (`scripts/retirements.py` → `CarRace.retirement`)

For every DNF car (and any car a race-control STOPPED message names that did not finish), the pipeline reads the
OpenF1 `location` feed for that driver from 5 s before the end of its last completed lap, in 5-minute windows (up to 3).
It finds the moment the car comes to rest for good (stays within 4 m for 20 s, or until the feed ends), or the
last sample on the map before the feed jumps to its far-away "parked" coordinates (garage / transponder off).
The rest point is projected onto `circuit.points` (arc-length share = `lapFraction`), with the distance from the
centre line deciding `onTrack` (≤ half-width + 2 m) and the pit lane (> 12 m off the line within 12 % of the lap
either side of start/finish = `pits`).

`kind`: `crash` only when race control names the car in an incident / collision between 90 s before and 15 min
after the stop (the message is stored verbatim); a sudden standstill alone is not enough (the feed can freeze).
`stopped` otherwise, `pits` in the pit lane, `unknown` without location data (Monaco 2026: the race session has no
usable feed for most cars). Speeds around the stop are written to the pipeline's QA log only.

`python3 scripts/fetch_2026_season.py --as-of 2026-11-21T16:52:23Z` reproduces the bundled 20-race dataset.

**Replay** (`lib/incidents.ts`): the plan takes over from the timeline at the end of the last completed lap (or a
little before the stop point if the car stopped short of the line), drives on with the pace of the nearest running
car (a crawling car keeps to the edge as a moving obstacle) and crashes / pulls over / turns into the garage so that
it comes to rest at `lapFraction` at race time `time` (later by a few seconds only when that would need more than
1.25 × the natural pace). The tower (`lib/towerOrder.ts`) keeps the car in the running order until it stops.

## Overtakes (`lib/traffic.ts`)

A follower holds station one car length + 0.5 m behind until the timeline's order swap is predicted within 2.5 s
(smoothed true-progress closing rate). Then it commits; passer and passed car move faster (relax 2.2 / yield 1.4
units/s), so side by side usually lasts 1–4 s. If the swap does not come (prediction drifts past 4 s, or the attempt
runs over 4 s while still behind) it aborts, drops back and rejoins the line (3 s cooldown on that car).
Tests: no side by side over 6 s unless the real gap stays under 0.15 s (Silverstone, Monza, Zandvoort, Baku), the
abort path never overlaps, slipstream station-keeping.

## Circuit seam

Lap traces are cut to exactly one lap in `build_circuit` (start at the lap start, end at the closest approach to
it near the lap end). `engine/circuitCurve.ts` keeps a safety net (`trimClosingOvershoot`, `pointCount`) and
`engine/circuitCurve.test.ts` checks every bundled circuit closes cleanly. The replay-side `cleanCircuit` is gone.
