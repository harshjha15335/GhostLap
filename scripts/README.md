# Data scripts

`fetch_2026_season.py` builds the offline data bundles from OpenF1 (needs network access to api.openf1.org).

```bash
python3 scripts/fetch_2026_season.py            # uses scripts/.cache
python3 scripts/fetch_2026_season.py --refresh  # re-download everything
```

`track_widths.py` adds `circuit.widths` (left/right half-widths per point, render units) to every bundle. It is called by the fetch script and can also patch the existing bundles on its own, without touching OpenF1:

```bash
python3 scripts/track_widths.py           # write widths into public/data/2026/races + src/data/seed
python3 scripts/track_widths.py --check   # print the alignment report only
```

Widths come from the [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database) (LGPL-3.0; centre lines from OpenStreetMap, widths from satellite imagery; downloads cached in `scripts/.cache/tumftm/`). Its centre line is aligned to our OpenF1 trace (similarity fit over every start offset and both directions, refined with ICP) and only used when the residual, the scale against the data's lap length and the share of matched points pass sanity checks. Short sections where the layouts differ (e.g. removed chicanes) are interpolated. Circuits it does not cover (Baku, Madrid, Miami, Monaco, Singapore, …) get a uniform 12 m.

Credits: Track widths: TUMFTM racetrack-database (LGPL-3.0) · Layout approach inspired by Boxlane/F1TrackViewer (MIT).

Hand-curated inputs (OpenF1 has no feed for these):

- `upgrades_2026.json`: list of `{ "teamId", "round", "title", "area" }`, where `area` is one of AERO, FLOOR, PU, CHASSIS, SUSPENSION. These are merged with the pace steps detected automatically.
- `pu_allocation_2026.json`: FIA power-unit and gearbox usage per driver. While `usage` is empty, the UI shows "no data".
