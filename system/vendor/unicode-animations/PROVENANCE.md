# unicode-animations — vendored provenance

- **Package:** `unicode-animations`
- **Version:** 1.0.3
- **License:** MIT (see `LICENSE`)
- **Author:** gunnargray-dev
- **npm:** https://www.npmjs.com/package/unicode-animations
- **Repository:** https://github.com/gunnargray-dev/unicode-animations
- **Description:** "Unicode spinner animations as raw frame data — no dependencies, works everywhere."

## What this is

`index.js` is a byte-faithful reproduction of the package's authoritative published
source — `dist/chunk-F2BWZODB.js` from `unicode-animations@1.0.3` (the upstream
`dist/index.js` is just a re-export façade over this chunk). It carries the exact
frame data and generators for all **18 spinners** (`braille`, `braillewave`, `dna`,
`scan`, `rain`, `scanline`, `pulse`, `snake`, `sparkle`, `cascade`, `columns`,
`orbit`, `breathe`, `waverows`, `checkerboard`, `helix`, `fillsweep`, `diagswipe`),
plus the `gridToBraille(grid)` and `makeGrid(rows, cols)` utilities. Each spinner
follows the upstream interface `{ frames: readonly string[]; interval: number }`.

## How Hologram uses it

Per ADR-0029 ("adopt OSS standards as content-addressed κ-objects, never run a
foreign runtime"), this vendored file is the **source of truth**, not a runtime
dependency. The OS loading engine — `os/usr/lib/holo/holo-fx.js` — reproduces this
exact frame data and exposes it as `HoloFX.spin` / `HoloFX.spinners` /
`HoloFX.gridToBraille` / `HoloFX.makeGrid`, so every Hologram surface draws its
"sharp and precise" loading vocabulary from one faithful spec.

To re-verify faithfulness against this file:

```js
import { spinners, gridToBraille, makeGrid } from "./index.js";
// spinners.braille.frames, spinners.scan.frames, … must match HoloFX.spinners
```
