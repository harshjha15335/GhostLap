# Drivers page media pipeline

Builds the portrait + helmet images for `/drivers` from photos supplied locally. Every image
folder below is gitignored: photos and processed images are never committed.

```
scripts/drivers/source/<CODE>/portrait.png   transparent cut-out of the driver (head and shoulders)
scripts/drivers/source/<CODE>/helmet.png     transparent cut-out of the helmet, straight front view
scripts/drivers/source/_raw/<CODE>/…         original helmet photos used by prep_helmets.py
scripts/drivers/source/_incoming/            drop-in replacements (see below)
scripts/drivers/source/_check/<CODE>.jpg     fit-check images (portrait | helmet on | 50 % blend)
public/drivers/<code>/{portrait,helmet}-{1600,800}.webp   what the app serves
src/components/drivers/media.generated.json                sizes + head position, bundled into the page
```

Requirements: `pip install pillow "rembg[cpu]"` (rembg downloads its matting model on first use).

## Replace a helmet: one command

1. Save a straight-on front view of the 2026 helmet (any background, PNG / JPG / WebP) as
   `scripts/drivers/source/_incoming/<CODE>.png` (or `.jpg` / `.webp`), e.g. `_incoming/OCO.jpg`.
   Several drivers at once is fine.
2. Run

   ```
   python3 scripts/drivers/process_driver_media.py --incoming
   ```

   For each file this removes the background with rembg (skipped when the image already has a
   transparent background), keeps the largest object, trims it, honours the photo's EXIF
   orientation, writes `source/<CODE>/helmet.png` (the old one is kept as `helmet.prev.png`),
   moves the photo to `_incoming/_done/`, rebuilds that driver's WebP images and the manifest,
   and writes `source/_check/<CODE>.jpg`.
3. Open the check image. The fit is right when, as on RUS: the visor sits over the eyes, the
   chin bar covers the chin (red line) and the shell is about as wide as the face plus a
   little hair. If not, tune the driver in `align_overrides.json` and rerun with
   `--only <CODE> --check`:

   | key             | meaning                                                         |
   | --------------- | --------------------------------------------------------------- |
   | `helmet_scale`  | helmet width / head width (default 1.42); smaller = smaller lid |
   | `helmet_dy`     | vertical shift, fraction of the frame height (+ = down)         |
   | `helmet_dx`     | horizontal shift, fraction of the frame width (+ = right)       |
   | `helmet_rotate` | degrees counter-clockwise, to stand a tilted helmet upright     |
   | `zoom`          | portrait framing zoom (1.0 = default head size)                 |

   An override tuned for the previous image keeps applying to the new one; the run prints it
   so you can retune or delete it.
4. Record where the image came from and your permission to use it in `public/drivers/SOURCES.md`
   (and `helmet_sources.json` if it was prepared from a raw photo).

## Other commands

```
python3 scripts/drivers/process_driver_media.py                    # rebuild every driver
python3 scripts/drivers/process_driver_media.py --only ANT,BOT --check
python3 scripts/drivers/prep_helmets.py --only VER                 # re-cut from _raw/ per helmet_sources.json
python3 scripts/drivers/fetch_portraits.py                         # portraits (see the script header)
```
