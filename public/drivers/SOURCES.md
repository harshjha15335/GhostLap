# Drivers page image sources

Every driver image used on the Drivers page, where it came from, and its status.

> Driver portraits and helmet images © Formula 1 / respective teams. Unofficial fan project, not affiliated with Formula 1.

The page shows this credit line. Using these images is the project owner's decision, for a
credited, non-commercial fan / competition entry. The images are **not committed to git**: they are
downloaded and processed locally (see "Rebuild" below) into gitignored folders.

## Rebuild

```sh
python3 scripts/drivers/fetch_portraits.py          # official portraits -> scripts/drivers/source/<CODE>/portrait.png
# helmet photos: download the image URLs listed below into scripts/drivers/source/_raw/<CODE>/
# (file names as in scripts/drivers/helmet_sources.json), then
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

Season 2026 (main) helmet designs. Searched first on the team's official site and shop and the
driver's own site and store, then on official helmet-maker / F1 memorabilia pages, then
helmetarchive.com (the four helmets kept from the first pass). Most images are product photos of
the licensed Bell 1:2 / team mini-helmet replicas of the 2026 season design, sold by the team or
the driver. Backgrounds are removed with rembg (isnet-general-use); helmet pixels are never
repainted, generated or upscaled by us. Drivers without a usable image show a
"2026 helmet · coming soon" panel in the reveal. Retrieved 2026-11-28.

| Driver | Code | Status | Publisher | Page | Image URL | Date | View | Notes |
|---|---|---|---|---|---|---|---|---|
| Kimi Antonelli | ANT | clean | Mercedes-AMG PETRONAS F1 Team official shop | https://shop.mercedesamgf1.com/products/kimi-antonelli-2026-mini-bell-helmet-replica-1-2 | https://cdn.shopify.com/s/files/1/0563/8314/3997/files/4100527_KA_Mini_Helmet_4.jpg | listed 2026-01-20 | straight front | Bell 1:2 replica, 2026 season design (#12); light-grey studio, 3200x4000 |
| George Russell | RUS | clean | Mercedes-AMG PETRONAS F1 Team official shop | https://shop.mercedesamgf1.com/products/george-russell-2026-mini-bell-helmet-replica-1-2 | https://cdn.shopify.com/s/files/1/0563/8314/3997/files/4100526_GR_Mini_Helmet_4.jpg | listed 2026-01-20 | straight front | Bell 1:2 replica, 2026 season design (#63); studio, 3200x4000 |
| Lando Norris | NOR | clean (render) | supplied by the project owner (source not stated) | — | — | 2026-11-28 | front, from above | studio render of a McLaren helmet design (OKX, Android, LN Kart); 1920x1920. Replaces the three-quarter LN4 store photo |
| Oscar Piastri | PIA | clean | supplied by the project owner (source not stated) | — | — | 2026-11-28 | straight front | McLaren helmet, white studio; 447x447 source (soft at 1600 px). Replaces the store photo |
| Charles Leclerc | LEC | clean | Scuderia Ferrari official store | https://store.ferrari.com/en-ch/collectibles/replica-and-scale-models/helmets/mini-leclerc-replica-2026-helmet-in-12-scale-LA0IGf170.html | https://store.ferrari.com/on/demandware.static/-/Sites-48/default/dw573d2375/images/zoom/LA0IGf_170_1.jpg | 2026 | straight front | Bell 1:2 replica of his 2026 HP77 helmet (#16); studio |
| Lewis Hamilton | HAM | clean | supplied by the project owner (source not stated) | — | — | 2026-11-28 | front, from slightly above | yellow Ferrari helmet; 447x447 source (soft at 1600 px). Replaces the three-quarter Ferrari store photo |
| Isack Hadjar | HAD | clean | Red Bull official shop (redbullshop.com) | https://www.redbullshop.com/en-int/p/1%3A2-Isack-Hadjar-2026-Season-Mini-Helmet/M-RBR26293/ | https://assets.redbullshop.com/images/q_100/products/RBR/2026/M-RBR26293_5_3/1-2-Isack-Hadjar-2026-Season-Mini-Helmet.jpg | 2026 | straight front | 1:2 2026 season mini helmet (#6); white studio, 2250x3000 |
| Arvid Lindblad | LIN | clean | Red Bull official shop (Visa Cash App Racing Bulls) | https://www.redbullshop.com/en-int/p/1%3A2-Arvid-Lindblad-2026-Season-Mini-Helmet/M-RAB26094/ | https://assets.redbullshop.com/images/q_100/products/RAB/2026/M-RAB26094_5_3/1-2-Arvid-Lindblad-2026-Season-Mini-Helmet.jpg | 2026 | straight front | 1:2 2026 season mini helmet (#41); white studio, 2250x3000 |
| Carlos Sainz | SAI | clean | Atlassian Williams F1 Team official store | https://www.williamsf1.com/store/products/carlos-sainz-2026-season-mini-helmet | https://mcprod.williamsf1.com/media/catalog/product/2/6/26stmemhcs_-_picture_1.jpg | 2026 | straight front | 2026 season mini helmet; studio, but only 900x1200 (helmet ~480 px wide, soft at 1600 px) |
| Nico Hulkenberg | HUL | clean | F1 Authentics (official Formula 1 memorabilia) | https://www.f1authentics.com/products/nico-hulkenberg-signed-2026-audi-f1-team-1-2-scale-helmet | https://cdn.shopify.com/s/files/1/0565/1742/7397/files/NicoHulkenberg2026SignedMiniHelmet_3.jpg | listed 2026-09-21 | straight front | signed Bell 1:2 replica, 2026 Audi design; signature is on the crown, not visible from the front. audif1.com was not reachable from the build environment |
| Gabriel Bortoleto | BOR | clean | F1 Authentics (official Formula 1 memorabilia) | https://www.f1authentics.com/products/gabriel-bortoleto-signed-2026-audi-f1-team-1-2-scale-helmet | https://cdn.shopify.com/s/files/1/0565/1742/7397/files/GabrielBortoletto2026SignedMiniHelmet_6.jpg | listed 2026-09-04 | straight front | signed Bell 1:2 replica, 2026 Audi design (#5); signature on the crown, not visible from the front |
| Valtteri Bottas | BOT | clean | F1 Authentics (official Formula 1 memorabilia) | https://www.f1authentics.com/products/valtteri-bottas-2026-cadillac-helmet-australian-gp-used | https://cdn.shopify.com/s/files/1/0565/1742/7397/files/ValtteriBottasCadillacHelmet_2.jpg | listed 2026-04-17 | straight front | his race-used helmet from the 2026 Australian GP (season design), visor tear-off tabs fitted; white studio, 2000x2000 |
| Sergio Perez | PER | clean (render) | Sergio Perez official website | https://checoperez.com/ | https://checo.joinamply.cc/helmetv3/Helmet_Visor172.avif | site live 2026 | straight front | last frame of the site's hero helmet animation: an official 3D render of his 2026 Cadillac helmet (black/green, as revealed at Bahrain testing), already transparent; not a photo |
| Max Verstappen | VER | clean | helmetarchive.com (photo credit as listed there) | — | https://helmetarchive.com/photos/f1-2026-max-verstappen-season-design-rb-3.jpg | 2026 | straight front | white studio |
| Alexander Albon | ALB | clean | helmetarchive.com (photo credit as listed there) | — | https://helmetarchive.com/photos/instagram/f1-2026-alexander-albon-season-design-dvovpgcik5u-4.jpg | 2026 | front, tilted ~15 deg | floating studio shot. Williams store has no Albon 2026 mini helmet listing |
| Pierre Gasly | GAS | clean | helmetarchive.com (photo credit as listed there) | — | https://helmetarchive.com/photos/instagram/f1-2026-pierre-gasly-season-design-dtyfqsajkae-4.jpg | 2026 | straight front | helmet only ~280 px wide in the source (soft at 1600 px). pierregasly.com's 2026 season mini-helmet photos are lifestyle shots (held, worn), not usable |
| Esteban Ocon | OCO | clean (render) | supplied by the project owner; image carries the MM Designs (mmdesigns.co.uk) watermark | — | — | 2026-11-28 | straight front | studio render of a red Haas helmet design with his signature; red-on-red background, so the cut-out outline came from rembg and the inside was filled; 447x447 source (soft at 1600 px). Replaces the helmetarchive photo |
| Fernando Alonso | ALO | clean (render) | supplied by the project owner; image carries the MM Designs (mmdesigns.co.uk) watermark | — | — | 2026-11-28 | straight front | studio render of an Aston Martin helmet design with his signature; 447x447 source (soft at 1600 px); watermark and reflection cropped out |
| Lance Stroll | STR | clean | supplied by the project owner (source not stated) | — | — | 2026-11-28 | straight front | copper Aston Martin helmet (Aramco, Maaden, Krown), light studio; 495x619 source (soft at 1600 px) |
| Franco Colapinto | COL | clean (render) | supplied by the project owner; image carries the MM Designs (mmdesigns.co.uk) watermark | — | — | 2026-11-28 | straight front | studio render of an Alpine helmet design with the FC43 logo; 447x447 source (soft at 1600 px); watermark cropped out |
| Oliver Bearman | BEA | clean | supplied by the project owner (source not stated) | — | — | 2026-11-28 | straight front | Haas helmet photographed in a garage, visor tear-off tabs fitted; 1500x2000 |
| Liam Lawson | LAW | clean | supplied by the project owner (source not stated) | — | — | 2026-11-28 | straight front | Racing Bulls helmet, white studio; 554x554 source (soft at 1600 px) |

Reserves and one-off substitutes in the 2026 data (not shown on the page): Yuki Tsunoda
(TSU, Racing Bulls, 3 race entries), Ryo Hirakawa (HIR, Haas, 1), Rafael Câmara (CAM, Haas, 1).
