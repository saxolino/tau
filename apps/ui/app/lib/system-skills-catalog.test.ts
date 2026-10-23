import { describe, expect, it } from 'vitest';
import { kernelConfigurations } from '@taucad/types/constants';
import { parseSkillFrontmatter } from '#hooks/use-context-payload.utils.js';
import { createModelSkillMarkdown } from '#lib/create-model-skill.js';
import { sinopiaKernelIds } from '#lib/sinopia-engines.js';
import { createSkillResolver } from '#lib/skill-resolver.js';
import { systemSkillsCatalog } from '#lib/system-skills-catalog.js';

const progressiveDisclosureSkillNames = [
  'create-model',
  'sinopia-immagine-cad',
  'cad-smlib',
  'cad-picovoxel',
  'cad-replicad',
  'cad-manifold',
  'geospec-authoring',
] as const;

/** Tau's kernels SinopiaCAD does not offer: no `cad-*` skill, no create-model row. */
const unofferedKernelIds = kernelConfigurations
  .map(({ id }) => id)
  .filter((id) => !(sinopiaKernelIds as readonly string[]).includes(id));

const emptyResolver = () =>
  createSkillResolver({
    readFile: async () => {
      throw new Error('not found');
    },
    listDirectory: async () => [],
  });

describe('systemSkillsCatalog', () => {
  it('should include a valid create-skill system skill', () => {
    const createSkill = systemSkillsCatalog.find((skill) => skill.slug === 'create-skill');

    if (!createSkill) {
      throw new Error('Expected system create-skill to be registered');
    }

    expect(createSkill.skillMarkdown).toContain('name: create-skill');
    expect(createSkill.skillMarkdown).toContain('source: system');
    expect(createSkill.skillMarkdown).toContain('.agents/skills/<skill-name>/SKILL.md');
    expect(createSkill.source).toBe('system');

    const metadata = parseSkillFrontmatter(createSkill.skillMarkdown, 'system:skills/create-skill/SKILL.md', {
      source: 'system',
      resourceUri: 'system:skills/create-skill/SKILL.md',
    });
    if (!metadata) {
      throw new Error('Expected create-skill frontmatter to parse');
    }

    expect(metadata).toEqual(
      expect.objectContaining({
        name: 'create-skill',
        source: 'system',
        version: '1.0.0',
        enabled: true,
      }),
    );
    expect(metadata.description).toContain('Create or update Tau agent skills');
  });

  it('should resolve every progressive-disclosure skill from priority tier 60', async () => {
    const resolver = emptyResolver();

    const results = await Promise.all(
      progressiveDisclosureSkillNames.map(async (skillName) => ({
        catalogEntry: systemSkillsCatalog.find((skill) => skill.slug === skillName),
        resolved: await resolver.resolveSkill(skillName),
      })),
    );

    for (const { catalogEntry, resolved } of results) {
      expect(catalogEntry).toEqual(expect.objectContaining({ priority: 60, source: 'system' }));
      expect(resolved).toEqual(
        expect.objectContaining({
          success: true,
          skillName: catalogEntry?.slug,
          source: 'system',
        }),
      );
    }
  });

  it('keeps the offered engines, cad-* catalog slugs, and create-model rows set-equal', () => {
    const offered = [...sinopiaKernelIds].toSorted();
    const catalog = systemSkillsCatalog
      .flatMap(({ slug }) => (slug.startsWith('cad-') ? [slug.slice('cad-'.length)] : []))
      .toSorted();
    const createModelRows = [...createModelSkillMarkdown.matchAll(/^\| `cad-([^`]+)` \|/gmu)]
      .flatMap((match) => (match[1] ? [match[1]] : []))
      .toSorted();

    expect(offered).toEqual(['manifold', 'picovoxel', 'replicad', 'smlib']);
    expect(catalog).toEqual(offered);
    expect(createModelRows).toEqual(offered);
  });

  it.each(unofferedKernelIds)('offers no authoring skill for the %s engine', async (kernelId) => {
    expect(systemSkillsCatalog.some(({ slug }) => slug === `cad-${kernelId}`)).toBe(false);
    expect(createModelSkillMarkdown).not.toContain(`cad-${kernelId}\``);
    expect(await emptyResolver().resolveSkill(`cad-${kernelId}`)).toEqual(expect.objectContaining({ success: false }));
  });

  it("teaches create-model the jeweler's choice: SMLib by default, PicoVoxel for sculpted forms, mixed pieces in parts", () => {
    expect(createModelSkillMarkdown).toContain('Prefer SMLib unless the form is sculptural.');
    expect(createModelSkillMarkdown).toMatch(
      /\| `cad-smlib` \| SMLib \| `main\.ts` \| [^|]+\| Default\. Precise production pieces: settings and bezels, prongs/u,
    );
    expect(createModelSkillMarkdown).toMatch(
      /\| `cad-picovoxel` \| PicoVoxel \|[^\n]+Sculpted, organic forms: leaves/u,
    );
    expect(createModelSkillMarkdown).toMatch(/\| `cad-replicad` \| Replicad \|[^\n]+Exact fallback/u);
    expect(createModelSkillMarkdown).toMatch(/\| `cad-manifold` \| Manifold \|[^\n]+Mesh work: 3D-print preparation/u);
    expect(createModelSkillMarkdown).toContain('## Mixed pieces');
    expect(createModelSkillMarkdown).toContain(
      'Joining them into one exact STEP is not proven yet: say so to the person',
    );
    expect(createModelSkillMarkdown).not.toMatch(/Zoo|KCL|tscircuit|OpenSCAD|JSCAD|build123d/u);
  });

  it('registers sinopia-immagine-cad as a model-invocable system skill the agent can discover and activate', async () => {
    const entry = systemSkillsCatalog.find(({ slug }) => slug === 'sinopia-immagine-cad');
    if (!entry) {
      throw new Error('Expected sinopia-immagine-cad to be registered');
    }
    const metadata = parseSkillFrontmatter(entry.skillMarkdown, 'system:skills/sinopia-immagine-cad/SKILL.md', {
      source: 'system',
      resourceUri: 'system:skills/sinopia-immagine-cad/SKILL.md',
    });

    expect(metadata).toEqual(
      expect.objectContaining({ name: 'sinopia-immagine-cad', source: 'system', enabled: true }),
    );
    expect(metadata?.description).toBe(entry.description);
    expect(entry.skillMarkdown).not.toContain('disable-model-invocation');
    expect(entry.skillMarkdown).toContain('fromSmb(toSmb(forma))');
    expect(entry.skillMarkdown).toContain('density: 15.5');
    expect(entry.skillMarkdown).toContain('Al massimo 3 giri');
    expect(entry.skillMarkdown).toContain('`marquise.lunghezza` → «Marquise › Lunghezza»');

    const resolver = emptyResolver();
    const listed = await resolver.getPromptSkillListing();
    expect(listed.map(({ name }) => name)).toContain('sinopia-immagine-cad');
    expect(await resolver.resolveSkill('sinopia-immagine-cad')).toEqual(
      expect.objectContaining({ success: true, skillName: 'sinopia-immagine-cad', source: 'system' }),
    );
  });

  it.each([
    ['cad-smlib', 13],
    ['geospec-authoring', 13],
  ] as const)('returns actionable paths and every supporting file for %s', async (slug, supportingCount) => {
    const resolver = createSkillResolver({
      readFile: async () => {
        throw new Error('package resources stay lazy during activation');
      },
      listDirectory: async () => [],
    });

    const resolved = await resolver.resolveSkill(slug);
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      throw new Error(`Expected ${slug} to resolve`);
    }
    expect(resolved.resourceUri).toBe(`system:skills/${slug}/SKILL.md`);
    expect(resolved.skillPath).toBe(`.agents/skills/${slug}/SKILL.md`);
    expect(resolved.baseDirectory).toBe(`.agents/skills/${slug}`);
    expect(resolved.fingerprint).toMatch(/^[\da-f]{64}$/u);
    expect(resolved.supportingFiles).toHaveLength(supportingCount);
  });
});
