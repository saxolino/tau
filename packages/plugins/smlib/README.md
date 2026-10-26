# @taucad/smlib

[![npm](https://img.shields.io/npm/v/@taucad/smlib)](https://www.npmjs.com/package/@taucad/smlib)
[![downloads](https://img.shields.io/npm/dm/@taucad/smlib)](https://www.npmjs.com/package/@taucad/smlib)
[![size](https://img.shields.io/npm/unpacked-size/@taucad/smlib)](https://www.npmjs.com/package/@taucad/smlib)
[![license](https://img.shields.io/npm/l/@taucad/smlib)](./LICENSE)
[![provenance](https://img.shields.io/badge/provenance-npm-blue)](https://docs.npmjs.com/generating-provenance-statements)

SMLib kernel plugin for Tau

## Why @taucad/smlib?

- **A NURBS B-rep kernel in the browser** — author `.ts`/`.js` models against
  [`@classcad/smlibwasm`](https://www.npmjs.com/package/@classcad/smlibwasm), the WebAssembly build of
  SMLib from NVIDIA's USD BRep with a build123d-style API (`Box`, `fillet`, `GridLocations`).
- **Exact exports** — STEP keeps each body's name and color; STL, GLB, and glTF follow Tau's tessellation presets and budgets.
- **Physical materials and mechanisms** — `@taucad/smlib/model` returns glTF PBR materials and textures; an
  exported `mechanism` animates the model through `@taucad/kinematics`.
- **No module-scope work** — the library and its WebAssembly load in `initialize()`, one instance per worker.

## Install

```bash
npm i @taucad/smlib @taucad/runtime zod
```

`@taucad/runtime` and `zod` are required peers: the runtime parses this package's option schemas, so
one install must hold one runtime and one zod. `@classcad/smlibwasm` is a dependency, pinned to the
release this kernel's version and cache identity describe.

## Quick start

```typescript
import { defineRuntime } from '@taucad/runtime/worker';
import { smlib } from '@taucad/smlib';

const runtime = defineRuntime({ plugins: [smlib()] });
```

A model is a module whose default export returns shapes:

```typescript
import { Box, Cylinder, GridLocations, Z } from '@classcad/smlibwasm';

export const defaultParams = { width: 80, depth: 60, thickness: 10 };

export default function main(params: typeof defaultParams) {
  const plate = Box(params.width, params.depth, params.thickness);
  const rounded = plate.fillet(plate.edges().parallelTo(Z), 3);
  return rounded.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, params.thickness * 2)));
}
```

Hand the definition to a client — `createNodeClient`, `createRuntimeWorker`, or your own host. See
[`@taucad/runtime`](https://www.npmjs.com/package/@taucad/runtime) for the client lifecycle.

## API

### Editable manual profiles

The `@taucad/smlib/manual-operations` sidecar API stores editable geometry rather
than a tessellated approximation. Version 1 histories accept an additive
`{ id, type: 'sketch', name, profile }` operation. It creates an exact native
wire for the Drawing view; it does not create a solid. A separate `extrude`
operation requires a closed profile and creates the STEP-exportable solid.
Drawing-only wires are excluded from STEP and mesh exports.

All profiles carry `plane: 'xy' | 'xz' | 'yz'` and a world-space `origin`.
Their local coordinates use millimetres:

- `polygon` and `spline` retain stable `{ id, x, y }` points. Optional `closed`
  is `false` for open curves. Its absence retains the historical closed
  interpretation, and parsing does not insert this field into old documents.
- `circle` stores `{ center: { x, y }, radius }` and is always closed.
- `arc` stores `{ center: { x, y }, radius, startAngle, sweepAngle }` and is
  always open. Angles are degrees; positive sweeps are counterclockwise.
  A sweep must be nonzero and smaller than a full revolution.

`ManualPointProfile` narrows the union to editable point profiles.
`manualProfileSegments` returns their exact cubic Bézier controls, including
open endpoint tangents. `isManualProfileClosed` provides the shared closure
rule. `offsetManualProfile(profile, distance)` returns new canonical geometry
with the same placement and point identities. Closed positive offsets grow
outward independently of polygon winding; open positive offsets move left
along the authored direction. Circles and arcs remain analytic circles.
Polygon offsets use line mitres and reject intersections, collapsed or
reversed segments, and corners exceeding a 20-times-distance mitre. Spline
offsets fail explicitly. The offset result is stored directly in the profile;
there is no hidden offset modifier or sampled polygon substituted for a circle.

This additive analytic union keeps curve kinds and native error cases explicit.
A single sampled-points representation would simplify callers but discard
circle/arc identities and exact STEP geometry, so it is not used. Saved legacy
payloads retain replay identity `1.3.0`; the expanded kernel cache identity is
`1.5.0`. Manual sketches retain their authored plane for Drawing projection,
while their native geometry and sampled coordinates remain in world space.

| Export         | Kind            | Use                                                                              |
| -------------- | --------------- | -------------------------------------------------------------------------------- |
| `smlib`        | toolkit factory | package-named factory; forwards `kernels.default` options to `smlibKernel`       |
| `plugin`       | toolkit factory | the same factory under its mechanical name, for loaders that read a fixed key    |
| `smlibKernel`  | kernel factory  | direct `kernels` composition; reads `ts`, `js` that import `@classcad/smlibwasm` |
| `SmlibOptions` | type            | `libraryTracing`: `'off'` (default), `'summary'`, or `'per-call'`                |

The `default` preset selects `kernels.default`.

| Subpath               | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `@taucad/smlib`       | the toolkit, alias, and kernel factory                               |
| `@taucad/smlib/model` | `Model`, `ShapeConfig`, `Material`, `Image`, `Resources` for authors |
| `@taucad/smlib/agent` | the agent skill bundle for SMLib authoring                           |

`main` returns a shape, an array or `ShapeList`, `{ shape, name, color, material, ... }` entries, or a
`Model` (`{ shapes, images, textures, samplers }`). Bodies, faces, and meshes render in the model
view; edges and wires render as SVG in the drawing view. A two-parameter `main(smlib, params)` receives
the library as its first argument.

## Limits

- STEP carries names and colors, not density, PMI, or named interfaces.
- Textured and anisotropic materials use box-projected UVs, not the surface's own parameterization.
- Curves are drawings only: they are sampled once at evaluation and do not export to STEP.

## Environment

| Host           | Supported | Notes                                 |
| -------------- | --------- | ------------------------------------- |
| Browser worker | Yes       | one single-threaded WebAssembly build |
| Node.js        | Yes       | `>=24`                                |

## Versioning and stability

Pre-1.0: a minor version may break. Pin `~0.1.0` rather than `^0.1.0`. This package releases in the
fixed version group with `@taucad/runtime`, so the peer range always matches a published runtime.
See [version-policy.md](https://github.com/taucad/tau/blob/main/docs/policy/version-policy.md).

## Security and provenance

Every release is published from GitHub Actions with npm trusted publishing and
[provenance](https://docs.npmjs.com/generating-provenance-statements). Verify a downloaded tree:

```bash
npm audit signatures
```

## License

Apache-2.0 — see [LICENSE](./LICENSE). `@classcad/smlibwasm` is MIT, and its SMLib/USD BRep WebAssembly is Apache-2.0.

## Links

- [Documentation](https://tau.new/docs/runtime)
- [Source](https://github.com/taucad/tau/tree/main/packages/plugins/smlib)
- [Changelog](https://github.com/taucad/tau/blob/main/packages/plugins/smlib/CHANGELOG.md)
- [Issues](https://github.com/taucad/tau/issues)
