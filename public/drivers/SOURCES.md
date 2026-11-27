# Drivers page image sources

Every driver image used on the Drivers page, where it came from, and its status.

> Driver portraits and helmet images © Formula 1 / respective teams. Unofficial fan project, not affiliated with Formula 1.

The page shows this credit line. Using these images is the project owner's decision, for a
credited, non-commercial fan / competition entry. The images are **not committed to git**: they are
downloaded and processed locally (see "Rebuild" below) into gitignored folders.

## Rebuild

```sh
python3 scripts/drivers/fetch_portraits.py          # official portraits -> scripts/drivers/source/<CODE>/portrait.png
# helmet photos: put the files listed below in scripts/drivers/source/_raw/, then
pip install "rembg[cpu]" && python3 scripts/drivers/prep_helmets.py   # -> scripts/drivers/source/<CODE>/helmet.png
python3 scripts/drivers/process_driver_media.py     # -> public/drivers/<code>/*.webp + src/components/drivers/media.generated.json
```

Better helmet image later? Save a transparent cut-out as `scripts/drivers/source/<CODE>/helmet.png`,
tune `scripts/drivers/align_overrides.json` if needed, and rerun `process_driver_media.py`.

## Portraits

All 22: official formula1.com 2026 driver portraits, front view, transparent full-body cut-outs, 1336-1608 x 3840 px originals
(media.formula1.com image CDN), season 2026. Processed to 4:5 head-and-shoulders WebP at 1600 and 800 px tall.

| Driver | Code | Team | Source URL |
|---|---|---|---|
| Pierre Gasly | GAS | Alpine | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/alpine/piegas01/2026alpinepiegas01front.png |
| Franco Colapinto | COL | Alpine | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/alpine/fracol01/2026alpinefracol01front.png |
| Fernando Alonso | ALO | Aston Martin | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/astonmartin/feralo01/2026astonmartinferalo01front.png |
| Lance Stroll | STR | Aston Martin | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/astonmartin/lanstr01/2026astonmartinlanstr01front.png |
| Gabriel Bortoleto | BOR | Audi | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/audi/gabbor01/2026audigabbor01front.png |
| Nico Hulkenberg | HUL | Audi | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/audi/nichul01/2026audinichul01front.png |
| Sergio Perez | PER | Cadillac | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/cadillac/serper01/2026cadillacserper01front.png |
| Valtteri Bottas | BOT | Cadillac | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/cadillac/valbot01/2026cadillacvalbot01front.png |
| Charles Leclerc | LEC | Ferrari | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/ferrari/chalec01/2026ferrarichalec01front.png |
| Lewis Hamilton | HAM | Ferrari | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/ferrari/lewham01/2026ferrarilewham01front.png |
| Esteban Ocon | OCO | Haas F1 Team | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/haasf1team/estoco01/2026haasf1teamestoco01front.png |
| Oliver Bearman | BEA | Haas F1 Team | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/haasf1team/olibea01/2026haasf1teamolibea01front.png |
| Lando Norris | NOR | McLaren | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/mclaren/lannor01/2026mclarenlannor01front.png |
| Oscar Piastri | PIA | McLaren | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/mclaren/oscpia01/2026mclarenoscpia01front.png |
| Kimi Antonelli | ANT | Mercedes | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/mercedes/andant01/2026mercedesandant01front.png |
| George Russell | RUS | Mercedes | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/mercedes/georus01/2026mercedesgeorus01front.png |
| Liam Lawson | LAW | Racing Bulls | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/racingbulls/lialaw01/2026racingbullslialaw01front.png |
| Arvid Lindblad | LIN | Racing Bulls | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/racingbulls/arvlin01/2026racingbullsarvlin01front.png |
| Max Verstappen | VER | Red Bull Racing | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/redbullracing/maxver01/2026redbullracingmaxver01front.png |
| Isack Hadjar | HAD | Red Bull Racing | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/redbullracing/isahad01/2026redbullracingisahad01front.png |
| Alexander Albon | ALB | Williams | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/williams/alealb01/2026williamsalealb01front.png |
| Carlos Sainz | SAI | Williams | https://media.formula1.com/image/upload/v1740000001/common/f1/2026/williams/carsai01/2026williamscarsai01front.png |

## Helmets

Season 2026 helmet designs from helmetarchive.com (photo credit as listed there). Background removed
with rembg; helmet pixels are never repainted or generated. Drivers without a usable image show a
"2026 helmet · coming soon" panel in the reveal.

| Driver | Code | Status | Source URL | Notes |
|---|---|---|---|---|
| Pierre Gasly | GAS | clean | https://helmetarchive.com/photos/instagram/f1-2026-pierre-gasly-season-design-dtyfqsajkae-4.jpg | helmetarchive.com (photo credit as listed there). floating front shot; helmet is only ~280 px wide in the source (soft at 1600 px) |
| Franco Colapinto | COL | coming soon | — | only on-track crops |
| Fernando Alonso | ALO | coming soon | — | only on-track crops |
| Lance Stroll | STR | coming soon | — | only on-track crops |
| Gabriel Bortoleto | BOR | coming soon | — | the only Audi studio shot (nico-hulkenberg-season-design-dtqygvqiero-5) is filed under Hulkenberg on helmetarchive.com and is a side view; ownership unconfirmed |
| Nico Hulkenberg | HUL | coming soon | — | dtqygvqiero-1: held at the waist, cut-out keeps the hand and background; dtqygvqiero-5 is a pure side view |
| Sergio Perez | PER | coming soon | — | only on-track crops |
| Valtteri Bottas | BOT | coming soon | — | only on-track crops |
| Charles Leclerc | LEC | coming soon | — | only on-track crops |
| Lewis Hamilton | HAM | coming soon | — | only on-track crops |
| Esteban Ocon | OCO | partial | https://helmetarchive.com/photos/instagram/f1-2026-esteban-ocon-season-design-dubphzkdrwb-1.jpg | helmetarchive.com (photo credit as listed there). held at the shoulder, three-quarter front view; the hand in front of the lower-left chin bar is masked out |
| Oliver Bearman | BEA | coming soon | — | duoainpindh-1/-2: helmet seen from above (visor at the bottom) with fingers on the crown; does not read as the face turning into the helmet |
| Lando Norris | NOR | coming soon | — | duiudbjjadz-1: rear three-quarter view, visor not visible, hand over the chin bar |
| Oscar Piastri | PIA | coming soon | — | only on-track crops |
| Kimi Antonelli | ANT | coming soon | — | only in-car shots (driver wearing the helmet in the cockpit) |
| George Russell | RUS | coming soon | — | only in-car shots (driver wearing the helmet in the cockpit) |
| Liam Lawson | LAW | coming soon | — | only on-track crops |
| Arvid Lindblad | LIN | coming soon | — | only in-car shots (driver wearing the helmet in the cockpit) |
| Max Verstappen | VER | clean | https://helmetarchive.com/photos/f1-2026-max-verstappen-season-design-rb-3.jpg | helmetarchive.com (photo credit as listed there). white studio, straight front view |
| Isack Hadjar | HAD | coming soon | — | only on-track crops |
| Alexander Albon | ALB | clean | https://helmetarchive.com/photos/instagram/f1-2026-alexander-albon-season-design-dvovpgcik5u-4.jpg | helmetarchive.com (photo credit as listed there). floating studio shot, front view tilted ~15 deg |
| Carlos Sainz | SAI | coming soon | — | only on-track crops |

Reserves and one-off substitutes in the 2026 data (not shown on the page): Yuki Tsunoda
(TSU, Racing Bulls, 3 race entries), Ryo Hirakawa (HIR, Haas, 1), Rafael Câmara (CAM, Haas, 1).
