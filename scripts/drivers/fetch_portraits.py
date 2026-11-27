#!/usr/bin/env python3
"""
Download the official formula1.com 2026 driver portraits (transparent full-body cut-outs,
1336x3840 originals from the media.formula1.com image CDN) into
scripts/drivers/source/<CODE>/portrait.png (gitignored), then run
process_driver_media.py to build the web images.

Usage: python3 scripts/drivers/fetch_portraits.py [--only NOR,PIA] [--view front|right|left] [--force]
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'scripts' / 'drivers' / 'source'

# code -> (team path, formula1.com driver id) as used on the CDN
DRIVERS = {
    'ANT': ('mercedes', 'andant01'), 'RUS': ('mercedes', 'georus01'),
    'LEC': ('ferrari', 'chalec01'), 'HAM': ('ferrari', 'lewham01'),
    'VER': ('redbullracing', 'maxver01'), 'HAD': ('redbullracing', 'isahad01'),
    'NOR': ('mclaren', 'lannor01'), 'PIA': ('mclaren', 'oscpia01'),
    'LAW': ('racingbulls', 'lialaw01'), 'LIN': ('racingbulls', 'arvlin01'),
    'GAS': ('alpine', 'piegas01'), 'COL': ('alpine', 'fracol01'),
    'OCO': ('haasf1team', 'estoco01'), 'BEA': ('haasf1team', 'olibea01'),
    'HUL': ('audi', 'nichul01'), 'BOR': ('audi', 'gabbor01'),
    'SAI': ('williams', 'carsai01'), 'ALB': ('williams', 'alealb01'),
    'ALO': ('astonmartin', 'feralo01'), 'STR': ('astonmartin', 'lanstr01'),
    'PER': ('cadillac', 'serper01'), 'BOT': ('cadillac', 'valbot01'),
}


def url(code: str, view: str) -> str:
    team, did = DRIVERS[code]
    return f'https://media.formula1.com/image/upload/v1740000001/common/f1/2026/{team}/{did}/2026{team}{did}{view}.png'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--view', default='front')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    codes = [c.strip().upper() for c in a.only.split(',')] if a.only else list(DRIVERS)
    for code in codes:
        dst = SRC / code / 'portrait.png'
        if dst.exists() and not a.force:
            print(f'{code}: exists, skipped')
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        u = url(code, a.view)
        req = urllib.request.Request(u, headers={'User-Agent': 'GhostLap-fan-project/1.0'})
        try:
            data = urllib.request.urlopen(req, timeout=120).read()
        except Exception as e:  # noqa: BLE001
            print(f'{code}: FAILED {e} {u}', file=sys.stderr)
            continue
        dst.write_bytes(data)
        print(f'{code}: {len(data) / 1e6:.1f} MB  {u}')
        time.sleep(0.5)


if __name__ == '__main__':
    main()
