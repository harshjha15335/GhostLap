# Race Lab · Airflow and dirty air

How the replay draws the wake of each car, and what it is based on.

## What real aero visualisations show

| Source | What it shows | What we took from it |
|---|---|---|
| [Formula 1: "2026 regulations explained: F1's new aerodynamics"](https://www.formula1.com/en/latest/article/2026-regulations-explained-all-you-need-to-know-about-f1s-new-aerodynamics.7IAt0auc32UkCEFE5ypkTB) | The front wheels make turbulence, and teams push it outboard ("outwash") so cleaner air fills in behind the car. The cost is a turbulent mass trailing the car. | Two front-tyre outwash trails that peel outwards, and a turbulent wake behind the car. |
| [The Race: "Revealed: the data on F1's worsening dirty air problem"](https://www.the-race.com/formula-1/exclusive-new-data-f1-aero-losses-ruining-close-racing) | FIA CFD of a car following another, in a straight line and in corners up to 40 m behind. The 2026 baseline model keeps about 80 % of its downforce one car length behind and about 90 % two lengths behind. | The effect is strongest within about one car length and fades over a few lengths. The colour shift and the extra turbulence follow `downforceLoss(gapAhead)` from `strategySimulator.ts`: full effect at 1 s or less, none at 2 s or more. |
| [Maya HTT: "F1 2026: Dirty air — often talked about, now visualized"](https://www.mayahtt.com/blog/f1-2026-dirty-air-often-talked-about-now-visualized/) | Detached-eddy CFD (DES) of a 2026-style car next to steady RANS. The wake is an unsteady, tumbling, three-dimensional structure, not a smooth cone. | Unsteady motion: dashes stream backwards, vortex strands spiral, and soft puffs tumble along the wake. This is a vendor blog, so we used it for the look only, not for numbers. |
| [Motor Sport: "How F1's 2022 rules should bring closer racing"](https://www.motorsportmagazine.com/articles/single-seaters/f1/behind-the-scenes-of-f1s-new-2021-rules-and-why-they-could-work) / [Autosport: technical changes behind the 2022 rules](https://www.autosport.com/f1/news/unpacking-the-technical-changes-behind-f1-2022s-rules-shakeup/7472432/) | Since 2022 the rear wing, beam wing and diffuser throw the wake up and over the following car (the "mushroom" upwash). Tip vortices from the wing endplates trail behind. Reported CFD: about 55 % downforce one length behind a 2019 car, against 86 % for the 2022 concept. | A rising upwash plume from the diffuser and beam wing, plus a spiralling vortex from each rear-wing tip. |
| [three.js forum: GPGPU particles](https://discourse.threejs.org/t/gpgpu-particles/90558) and instanced-line techniques (e.g. [three.phenomenon](https://github.com/vaneenige/three.phenomenon)) | GPU-side particle and ribbon animation: per-instance attributes, with all motion computed in the vertex shader. | The whole field's airflow is two instanced draw calls, with no CPU geometry updates. |

All figures above come from the sources as reported. The replay does not show numbers from them: the visual intensity is driven only by our own model, `downforceLoss`.

## The effect (`src/components/replay/scene/Airflow.tsx`)

**Budget.** The whole field (24 slots) takes 2 draw calls and one shared shader pair. There are no per-frame allocations. Each frame the CPU writes 2 × 24 `vec4` uniforms and a 16 × 24 float texture.

1. **Streamline ribbons** (`InstancedBufferGeometry`, 8 ribbons per car, 28 segments each). The strips face the camera.
   - 2 × **rear-wing tip vortices**: spiralling cores that drift inboard and up.
   - 2 × **secondary vortex strands**.
   - 2 × **diffuser / beam-wing upwash plumes**: the wake rises, as in the 2022+ and 2026 rules.
   - 2 × **front-tyre outwash** trails that peel outboard.
   - Dashes flow backwards at a rate tied to car speed. A wake gets longer with speed: 7–25 m, car-local.
2. **Turbulent wake volume**: 22 soft billboard puffs per car tumble around two vortex cores. They are faint in clean air and denser when a car is in the wake.

**The wake follows the track.** Every frame `Airflow` samples the track path behind each car (16 points: position and heading, at the car's current lateral offset) into a small float texture. The shader places every ribbon and puff along that path, so a wake curls through a corner instead of cutting across the infield.

**Dirty air "hits" the follower.** `Cars.tsx` writes three values for each car into `frame.air`:
- `loss`: the `downforceLoss(gapAhead)` of the car directly behind, in timeline running order, when that car is physically within about 14 render units.
- `follow`: the distance to that follower's nose.
- `weight`.

When `loss > 0`, the wake stretches to reach the follower's nose and stays visible up to that car. Turbulence rises with `loss`. The colour is deliberately calm: wakes are a translucent **blue-white `#9CC8F2`**, and turn **warm amber `#FF8A3D`** only when the follower is genuinely inside the wake (gap ≤ 1.0 s). That warm strength (`frame.air.heat`) is `downforceLoss(gap)` shaped by how close the follower is, and it is **capped per pack**: the cars of a train of consecutive followers within 1 s share a total heat budget of 1.2, so a queue never turns the screen red. Blending is normal alpha, not additive.

**Weighting and toggle.**
- The focus car and the three cars either side of it in the running order: full weight.
- The rest of the running field: 0.35.
- Pit lane, finished and retired cars: none.
- HUD **Airflow** button, or key `A`: hides both meshes. The choice is remembered per browser in `lib/prefs.ts`.

The old per-car amber cones are gone: 22 meshes and 22 materials removed.

## Quality ladder (adaptive)

`lib/quality.ts`: one level q (High = 1, Low = 0, Auto = drei `PerformanceMonitor` factor). The airflow shader reads `uDensity = 0.3 + 0.7 q`:
below 0.75 the secondary vortex strands are skipped, below 0.4 the front-tyre outwash, and the puff count scales with q. Still 2 draw calls at every level.
The same level drives the canvas DPR (1 … 1.5), soft car contact shadows (1 instanced draw call, off on Low), the shadow-mapped sun on the
environment (top level only) and the sky dome / trackside scatter (off on Low). HUD button (Auto / High / Low, key Q), remembered per viewer.
