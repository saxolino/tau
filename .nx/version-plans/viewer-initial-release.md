---
viewer: patch
---

Publish the initial `@taucad/viewer` 0.0.1 package: Tau's interactive CAD viewer, its graphics machines and its model controls, with one export subpath per module.

- **Embedding**: `ViewerEnvironmentProvider` describes the colour scheme, contrast, accent, graphics backend and developer switches; `ExactMeasurementProvider` supplies CAD-exact distances to the measure tool.
- **`ModelViewer`**: takes `sourceFile` and reports a secondary click on a component as a structured `GeometryComponentReference` through `onComponentReference`.
