# W17 model pipeline

GhostLap's only car is the CC-BY 4.0 **"2026 Mercedes W17" by Dave Love** (Sketchfab, see
`public/models/CREDITS.md`). The 20 MB original lives in `scripts/models/original/w17.glb`
and is **never shipped**: the site only serves the three LODs built from it.

```bash
npm install                                # @gltf-transform/*, meshoptimizer, sharp (devDependencies)
node scripts/models/build-w17.mjs          # → public/models/w17-{high,mid,low}.glb   (~5 s)
node scripts/models/build-w17.mjs low      # one LOD only
# team atlases (only needed when the livery sheets change):
python3 scripts/liveries/build_liveries.py <sheets-dir> --hires   # public/liveries/<team>{,-sm,-2x}.webp
```

| LOD | file | tris | parts / primitives | textures | used by |
|-----|------|------|--------------------|----------|---------|
| high | `w17-high.glb` ~1.5 MB | ~78.5k | 7 part nodes, ~61 primitives, 20 materials | WebP ≤1024 (+ 512 normal maps for tyres/hubs/carbon) | landing hero, season turntable + exploded view |
| mid | `w17-mid.glb` ~0.47 MB | ~17.7k | 7 part nodes, ~46 primitives, 13 materials | WebP ≤512, no normal maps | season podium, phones (`detail="high"` on ≤768 px) |
| low | `w17-low.glb` ~43 KB | ~3.5k | 2 primitives (`body`, `rings`) | none | 22-car replay, ghost car, landing S-curve (instanced), placeholder while high/mid load |

All three: world transforms baked, car conventions (forward +Z, up +Y, origin at the floor
centre, tyres on y = 0, metres), `EXT_meshopt_compression` (decoder bundled via three-stdlib,
no CDN), `KHR_mesh_quantization` (high/mid part nodes carry a dequantisation transform — never
overwrite their position/scale; F1Car wraps them in its own explode groups).

## Steps (`build-w17.mjs`)

1. **Load + normalise** (`lib/load.mjs`): flatten the Sketchfab hierarchy, bake matrices, drop
   `TEXCOORD_1` / tangents.
2. **Drop** interior bits per LOD (LCD, KERS lights, steering-wheel decals …; mid also drops the
   driver belts, steering wheel, chrome, rear light).
3. **Simplify** per material with meshoptimizer (`keep` ratio + error bound per LOD; mid uses the
   sloppy simplifier for the wheel hubs / generics made of many tiny islands).
4. **Team livery UVs** (`lib/atlasuv.mjs`): the W17's own paint UVs overlap (mirrored halves share
   texels, two UV tiles), so team liveries can't be baked into them. Every painted triangle
   (`mercedes_paint`, `mercedes_paint2`) gets a second UV set `TEXCOORD_1` — a planar projection
   into the shared **LIVERY_ATLAS** layout (`src/components/three/liveries.ts`), region picked
   per triangle from face normal + position (`lib/atlas.mjs`, ranges fitted to the W17). The
   existing team atlases in `public/liveries/` therefore skin the W17 directly (stored for
   flipY = true textures). Mercedes keeps the model's original paint and sponsor decals.
5. **Split into sub-assemblies** (`lib/parts.mjs`, `lib/split.mjs`): islands go whole by centroid,
   the big shells (chassis skin, floor tray) are cut per triangle → nodes `frontWing`,
   `monocoque`, `floor`, `sidepodL`, `sidepodR`, `gearbox`, `rearWing`. The model has no engine:
   F1Car adds the procedural ICE / ERS internals (only while exploded).
6. **Textures** → WebP (sharp), resized per material; **meshopt** + quantisation.

**Low LOD** (`lib/low.mjs`): keep paint / carbon / wheels / tyres, drop islands < 8–30 cm,
decimate each material to a triangle budget, merge everything into ONE primitive whose UVs point
into the team atlas (painted surfaces → projection regions, everything else → the flat
"underside" carbon cell) + one `rings` primitive (flat compound-colour bands on the outer
sidewalls, material `tyre_ring`). Positions stay float so the geometry can be instanced.

## Debug tools (dev only, not part of the build)

- `node scripts/models/inspect.mjs <glb>` — node tree, primitives, materials, textures, totals
- `node scripts/models/islands.mjs` — connected islands per material (for `lib/parts.mjs`)
- `node scripts/models/debug-split.mjs` — full-detail part split → `scripts/models/.out/`
- `node scripts/models/dump-textures.mjs <glb> <dir>`
- `npm run dev`, then `/scripts/models/viewer/index.html?file=/public/models/w17-high.glb&parts=1&explode=0.6`
  (part colours / explode) or `&atlas=/public/liveries/ferrari.webp` (livery), and
  `/scripts/models/viewer/sheet.html?detail=high[&team=mclaren]` (all 11 teams on the real `<F1Car>`)
- `node scripts/models/shot.mjs <url> <png>` / `node scripts/models/measure.mjs <url>` — headless
  screenshots, draw calls per frame and bytes per page (Playwright + SwiftShader)
