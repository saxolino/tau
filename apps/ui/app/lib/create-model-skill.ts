import { resolveKernel } from '@taucad/types/constants';
import { sinopiaKernelIds } from '#lib/sinopia-engines.js';
import type { SinopiaKernelId } from '#lib/sinopia-engines.js';

/** Frontmatter `description`, shared with the catalog row (the person sees it beside `/create-model`). */
export const createModelSkillDescription =
  'Sceglie il motore geometrico adatto al lavoro (gioielli e accessori) e attiva la sua guida. Da usare quando il progetto non ha un motore.';

/** Frontmatter `when_to_use`, shared with the catalog row. */
export const createModelSkillWhenToUse =
  'Usala prima di scrivere un modello nuovo quando il progetto non ha un motore, o quando un pezzo nuovo chiede un motore diverso.';

/** The geometry each engine builds. */
const geometry: Readonly<Record<SinopiaKernelId, string>> = {
  smlib: 'Exact NURBS B-rep; STEP export',
  picovoxel: 'Voxel and implicit (SDF) solids; mesh output',
  replicad: 'Exact OpenCascade B-rep; STEP export',
  manifold: 'Mesh solids with robust booleans',
};

/** What each engine is for in a jeweler's work; the selection table's last column. */
const jewelryUse: Readonly<Record<SinopiaKernelId, string>> = {
  smlib:
    'Default. Precise production pieces: settings and bezels, prongs, shanks and rings, buckles, clasps, hinges, jump rings and findings',
  picovoxel:
    'Sculpted, organic forms: leaves and petals, reliefs, soft surfaces, lattices and filigree-like volumes. Exports a mesh, not exact STEP',
  replicad:
    'Exact fallback: an operation SMLib cannot do (a fillet, shell, loft or sweep it refuses, STEP interfaces) on a precise piece',
  manifold:
    'Mesh work: 3D-print preparation (wax or resin), booleans on meshes, repairing or combining mesh parts. Never a new precise piece',
};

const selectionGuidanceRows = sinopiaKernelIds
  .map((id) => {
    const { name, mainFile } = resolveKernel(id);
    return `| \`cad-${id}\` | ${name} | \`${mainFile}\` | ${geometry[id]} | ${jewelryUse[id]} |`;
  })
  .join('\n');

export const createModelSkillMarkdown = `---
name: create-model
description: ${createModelSkillDescription}
source: system
version: 2.0.0
when_to_use: ${createModelSkillWhenToUse}
enabled: true
---

# Create Model

SinopiaCAD offers four engines. Choose by the job, never by familiarity. The person never picks one and never reads an engine name: talk about pieces.

| Kernel skill | Engine | Main file | Geometry | Use for |
| --- | --- | --- | --- | --- |
${selectionGuidanceRows}

## Rules by job

- Prefer SMLib unless the form is sculptural. Anything drawn with arcs, lines, splines, revolves, lofts and sweeps — even curved, as long as its sections are defined — is SMLib.
- Sculptural means modelled like wax or clay: free relief, organic thickness, textures you cannot draw as sections. Use PicoVoxel.
- Use Replicad only for a precise piece after SMLib refused a specific exact operation; keep the rest of the piece the same.
- Use Manifold only for mesh jobs on existing geometry, such as preparing a piece for printing.

## Mixed pieces

A sculpted body with precise settings (a leaf holding a bezel-set stone, a relief with a clasp): build separate parts, each in its own file with its engine — the settings, prongs and findings in SMLib, the sculpted body in PicoVoxel — in one shared millimetre frame so they line up, and verify each file. Joining them into one exact STEP is not proven yet: say so to the person in plain words (the precise parts and the sculpted body are delivered as separate models).

## Workflow

1. Choose one engine per part with the rules above.
2. Activate its authoring skill next with \`use_skill({ skillName: "cad-<kernel-id>" })\` and follow it. For a piece from reference images, follow \`sinopia-immagine-cad\` too.
3. Write the main file with that engine's import: the import binds the engine. A new project's \`main.ts\` may hold the empty SMLib starter, which is no choice: keep it for SMLib, replace it otherwise.
4. A \`main.ts\` that already builds geometry keeps its engine for changes; a new part that needs another engine goes in its own file.

The file content is the engine selection. Do not call or invent an engine-selection tool.
`;
