---
title: 'WebGPU Rendering Pipeline Policy'
description: 'Canonical Tau WebGPU CAD stack: reversed-Z renderer, lean single-sample scene MRT, spatial GTAO and explicit output/depth ownership'
status: active
created: '2026-05-08'
updated: '2026-10-22'
category: policy
related:
  - docs/research/webgpu-cad-rendering-blueprint.md
  - docs/policy/graphics-backend-policy.md
---

# WebGPU Rendering Pipeline Policy

Internal reference binding the Tau CAD viewer’s **WebGPU** post/lighting topology (R3F + Three.js **r184** TSL and owned frame targets). Divergences belong in ADRs (`docs/architecture/` or follow-up research), not silent refactors.

## Rationale

The interactive viewport runs `frameloop="demand"`. Use one scene acquisition and explicit output/depth ownership; optional AO must not create a second geometry pass or an indefinite temporal convergence loop. [WebGPU Shader and Pipeline Policy](webgpu-shader-and-pipeline-policy.md) owns the detailed graph and lifecycle rules.

## Rules

### 1. Canonical graph

Use the shared viewport renderer factory with reversed depth and no logarithmic depth. The performance-first node candidate explicitly uses single-sample scene attachments (`pass(scene, camera, { samples: 0 })`), and a single-sample renderer frame target (`antialias: false, samples: 0`). When AO is requested, one `PassNode` acquires beauty, depth and packed UNORM8 normals. Feed its depth and decoded normals to GTAO at half CSS resolution (`0.5 / DPR`), eight samples, and `useTemporalFiltering = false`. Keep spatial bilateral filtering at that AO budget and bilinearly sample the filtered visibility into native-resolution beauty. Native-resolution depth/normal gathers are excluded from the lean candidate; AO boundary halos remain an appearance qualification gate.

Composite AO using the selected scene/display boundary while preserving alpha. The default display-space composition is an accepted CAD appearance, not an identity with indirect-only physical occlusion. Keep tone mapping explicit and encode sRGB once. The post owner allocates one native-resolution frame with linear-light blending: hardware-sRGB RGBA8 for Neutral tone mapping, RGBA16F otherwise. Native WebGPU retains separate scene depth and frame depth/stencil; its priority-1 composite writes tone-mapped color and retained scene depth together. Node WebGL2 shares D24S8 between scene and frame, so its composite writes color only. Initialize both users before the scene write, clear scene depth/stencil explicitly, preserve them through composition, and retire both targets together. This saves one nominal 58.98 MB attachment at 5120×2880 without reducing precision; it does not promote node WebGL2 as the compatibility fallback. Caps, highlights, grid, handles and gizmo draw into this target before the priority-3.5 final quad encodes the complete frame once. Suppress Three's implicit output conversion only during that final draw and restore renderer state in `finally`. Never publish the canvas before later CAD draws finish.

The user-authorized lean candidate removes the native-resolution FXAA intermediate and composes tone mapping/AO directly into the owned linear frame target. Grid and transparent line overlays use ordinary linear hardware blending without viewport-copy color compensation. Preserve cap stencil semantics and accumulated frame depth. A separate mask target samples the frame depth after caps; ordinary overlays need no depth copy. Edge antialiasing and classic gamma-space appearance parity remain unqualified; this performance candidate does not promote node WebGL2 or change classic WebGL. Record fresh full/close, both-backend 5K evidence before claiming a gain.

### 2. Disabled AO and demand lifecycle

Allocate only the active graph and retarget it when projection changes. Keep bounded projection-specific MRT identities so Three r184 selects the correct view-direction shader, and update stable AO camera matrices. Do not retain a second full-resolution camera attachment set or release targets independently from a live graph. Measure cold first use separately from warmed retargeting. With AO disabled, acquire beauty/depth without normal MRT or GTAO resources. Retain the necessary output graph for the backend's frame-target/overlay contract; a disabled effect does not require unmounting that owner. Dispose owned resources on topology, backend and lifetime transitions, and retain no borrowed texture ownership.

Keep AO visible during motion when enabled. Do not enable temporal filtering without a separately qualified history, disocclusion and bounded demand-convergence contract. Record cold first-use cost separately from warm interaction.

### 3. WebGPU preference and WebGL compatibility

Prefer native WebGPU on supported devices and fall back to classic WebGL when unavailable or initialization fails. The visible, default-on `webGpu` flag controls preference. Qualify effect-specific quality through each backend's existing owner. Do not force identical concrete passes or infer one backend's performance from the other. Preserve paired shader semantics, native edges, depth, alpha and authored PBR materials.

### 4. Debug Inspector overlay

three.js **`Inspector`** mounts only when the viewer switch **`useViewerFeature('webGpuInspector')`** is **true**. The bulky bundle MUST stay behind **`React.lazy`** (`packages/viewer/src/graphics/three/webgpu-inspector-overlay.tsx` importing **`three-webgpu-inspector-bootstrap.tsx`**). **`Inspector` MUST NOT** be statically imported inside that bootstrap module: load it only from **`useLayoutEffect`** via **`await import('three/addons/inspector/Inspector.js')`** so SSR never evaluates **`examples/jsm/inspector/tabs/Settings.js`**, whose top-level **`_loadState()`** reads **`localStorage`** and crashes Netlify SSR.

**Why**: Production bundles stay slim; WGSL/timeline triage stays opt-in (`apps/ui/app/flags/flag.constants.ts`). Dynamic import keeps Node out of **`localStorage`**-touching evaluator side effects.

### 5. Overlay scene graph

`SceneOverlay` renders after the priority-1 post owner into the same linear color/depth/stencil target. The composite installs scene depth once; caps extend it. Never stamp pre-cap depth over cap writes or replay the scene. Keep the classic depth bridge unchanged. View cube and plane picker must set the explicit target viewport/scissor in device pixels: Three’s canvas `setViewport` does not update a render target. Restore those rectangles after the draw, including on failure.

## Summary Checklist

- [ ] Scene acquisition explicitly selects single-sample attachments; the viewport frame target is also single-sample.
- [ ] One scene acquisition; normals/GTAO exist only when requested.
- [ ] Spatial GTAO uses resolved depth and decoded normals without temporal jitter.
- [ ] Output passes through the frame target; tone mapping and encoding occur once.
- [ ] Overlays receive authoritative depth and retain section-cap stencil semantics.
- [ ] Inspector stays lazy and SSR-safe.
- [ ] Actual backend, dimensions, motion pixels, GPU cost and foreground cadence qualify changes independently.

## References

- Upstream AO example parity: **`repos/three.js/examples/webgpu_postprocessing_ao.html`**
- Research blueprint (non-binding narrative): **`docs/research/webgpu-cad-rendering-blueprint.md`**
