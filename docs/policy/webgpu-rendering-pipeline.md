---
title: 'WebGPU Rendering Pipeline Policy'
description: 'Canonical Tau WebGPU CAD stack: reversed-Z renderer, MSAA viewport, single beauty/normal MRT with spatial GTAO, tauDebug Inspector'
status: active
created: '2026-05-08'
updated: '2026-10-18'
category: policy
related:
  - docs/research/webgpu-cad-rendering-blueprint.md
  - docs/policy/graphics-backend-policy.md
---

# WebGPU Rendering Pipeline Policy

Internal reference binding the Tau CAD viewer’s **WebGPU** post/lighting topology (R3F + three.js **r184** `RenderPipeline` + TSL addons). Divergences belong in ADRs (`docs/architecture/` or follow-up research), not silent refactors.

## Rationale

The interactive viewport runs `frameloop="demand"`. Use one scene acquisition and explicit output/depth ownership; optional AO must not create a second geometry pass or an indefinite temporal convergence loop. [WebGPU Shader and Pipeline Policy](webgpu-shader-and-pipeline-policy.md) owns the detailed graph and lifecycle rules.

## Rules

### 1. Canonical graph

Use the shared viewport renderer factory with reversed depth, hardware MSAA and no logarithmic depth. When AO is requested, one `PassNode` acquires beauty, depth and packed UNORM8 normals. Feed its resolved depth and decoded normals to GTAO at half resolution, eight samples, and `useTemporalFiltering = false`.

Composite AO using the selected scene/display boundary while preserving alpha. The default display-space composition is an accepted CAD appearance, not an identity with indirect-only physical occlusion. Keep tone mapping explicit and encode sRGB once. The output `QuadMesh` must draw through the renderer's frame target so later overlays cannot overwrite it with stale contents. Do not reintroduce `RenderPipeline.render()` as the canvas output owner.

### 2. Disabled AO and demand lifecycle

Allocate only the requested projection endpoint. With AO disabled, acquire beauty/depth without normal MRT or GTAO resources. Retain the necessary output graph for the backend's frame-target/overlay contract; a disabled effect does not require unmounting that owner. Dispose owned resources on topology, backend and lifetime transitions, and retain no borrowed texture ownership.

Keep AO visible during motion when enabled. Do not enable temporal filtering without a separately qualified history, disocclusion and bounded demand-convergence contract. Record cold first-use cost separately from warm interaction.

### 3. WebGL baseline

WebGL remains the default interactive backend. Repair its post-target routing and qualify effect-specific quality alongside WebGPU, using each backend's existing owner. Do not force identical concrete passes or infer one backend's performance from the other. Preserve paired shader semantics, native edges, depth, alpha and authored PBR materials.

### 4. Debug Inspector overlay

three.js **`Inspector`** mounts only when the viewer switch **`useViewerFeature('webGpuInspector')`** is **true**. The bulky bundle MUST stay behind **`React.lazy`** (`packages/viewer/src/graphics/three/webgpu-inspector-overlay.tsx` importing **`three-webgpu-inspector-bootstrap.tsx`**). **`Inspector` MUST NOT** be statically imported inside that bootstrap module: load it only from **`useLayoutEffect`** via **`await import('three/addons/inspector/Inspector.js')`** so SSR never evaluates **`examples/jsm/inspector/tabs/Settings.js`**, whose top-level **`_loadState()`** reads **`localStorage`** and crashes Netlify SSR.

**Why**: Production bundles stay slim; WGSL/timeline triage stays opt-in (`apps/ui/app/flags/flag.constants.ts`). Dynamic import keeps Node out of **`localStorage`**-touching evaluator side effects.

### 5. Overlay scene graph

`SceneOverlay` renders after the priority-1 post owner. Restore authoritative scene depth directly before the overlay; never replay the main scene. Keep stencil caps in that overlay, with the canvas stencil attachment available, as required by [Graphics Backend Policy](graphics-backend-policy.md).

## Summary Checklist

- [ ] Shared viewport factory retains reversed depth and explicit hardware MSAA.
- [ ] One scene acquisition; normals/GTAO exist only when requested.
- [ ] Spatial GTAO uses resolved depth and decoded normals without temporal jitter.
- [ ] Output passes through the frame target; tone mapping and encoding occur once.
- [ ] Overlays receive authoritative depth and retain section-cap stencil semantics.
- [ ] Inspector stays lazy and SSR-safe.
- [ ] Actual backend, dimensions, motion pixels, GPU cost and foreground cadence qualify changes independently.

## References

- Upstream AO example parity: **`repos/three.js/examples/webgpu_postprocessing_ao.html`**
- Research blueprint (non-binding narrative): **`docs/research/webgpu-cad-rendering-blueprint.md`**
