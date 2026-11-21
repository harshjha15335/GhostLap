# Data scripts

`fetch_2026_season.py` builds the offline data bundles from OpenF1 (needs network access to api.openf1.org).

```bash
python3 scripts/fetch_2026_season.py            # uses scripts/.cache
python3 scripts/fetch_2026_season.py --refresh  # re-download everything
```

Hand-curated inputs (OpenF1 has no feed for these):

- `upgrades_2026.json`: list of `{ "teamId", "round", "title", "area" }`, where `area` is one of AERO, FLOOR, PU, CHASSIS, SUSPENSION. These are merged with the pace steps detected automatically.
- `pu_allocation_2026.json`: FIA power-unit and gearbox usage per driver. While `usage` is empty, the UI shows "no data".
