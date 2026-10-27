import { describe, expect, it } from 'vitest';
import { sinopiaKernelIds } from '#lib/sinopia-engines.js';
import { systemSkillsCatalog } from '#lib/system-skills-catalog.js';

const maxDescriptionCharacters = 160;
// B9 ships the approved workbench draft verbatim; all other bundles retain the original limits.
const workbenchDescriptionCharacters = 540;
const workbenchBodyTokens = 2400;

/*
 * Derived, not listed. This table used to be nine hardcoded
 * `../../../../packages/plugins/<name>/agent/SKILL.md` paths, which meant the
 * test knew the workspace layout — so relocating a bundle broke it with ENOENT
 * rather than a budget failure, and a tenth skill could ship ungated because
 * nobody remembered to add a tenth line. The catalogue is now assembled from
 * each package's own manifest, so asserting over it covers exactly what the app
 * actually loads.
 */
const appSkillSlugs: ReadonlySet<string> = new Set(['create-skill', 'create-model', 'sinopia-immagine-cad']);
const packageSkills = systemSkillsCatalog.filter(({ slug }) => !appSkillSlugs.has(slug));

/** Doctrine plus the generated Core API section and reference map (`maxSkillBodyTokens` in api-extractor). */
const kernelSkillBodyTokens = 6000;
/** A skill without a generated Core API section is doctrine alone and keeps the original ceiling. */
const doctrineSkillBodyTokens = 800;
const maxBodyLines = 500;

const assertSkillBudget = (
  skillName: string,
  skillMarkdown: string,
  maxBodyTokens = skillMarkdown.includes('\n## Core API\n') ? kernelSkillBodyTokens : doctrineSkillBodyTokens,
): void => {
  const description = /^description:\s*(.+)$/m.exec(skillMarkdown)?.[1]?.trim();
  if (!description) {
    throw new Error(`${skillName} has invalid frontmatter`);
  }

  const body = skillMarkdown.replace(/^---\n[\S\s]*?\n---\n?/, '');
  const descriptionLimit = skillName === 'workbench' ? workbenchDescriptionCharacters : maxDescriptionCharacters;
  const bodyLimit = (skillName === 'workbench' ? workbenchBodyTokens : maxBodyTokens) * 4;
  if (description.length > descriptionLimit) {
    throw new Error(`${skillName} description exceeds ${descriptionLimit} characters`);
  }
  if (body.length > bodyLimit) {
    throw new Error(`${skillName} body exceeds ${bodyLimit / 4} estimated tokens`);
  }
  if (body.split('\n').length > maxBodyLines) {
    throw new Error(`${skillName} body exceeds ${maxBodyLines} lines`);
  }
};

const getSkillMarkdown = (slug: string): string => {
  const skillMarkdown = systemSkillsCatalog.find((skill) => skill.slug === slug)?.skillMarkdown;
  if (!skillMarkdown) {
    throw new Error(`${slug} is not registered`);
  }
  return skillMarkdown;
};

const getCreateModelSkillMarkdown = (): string => getSkillMarkdown('create-model');

const assertCreateModelSelectionRows = (skillMarkdown: string): void => {
  const lines = skillMarkdown.split('\n');
  for (const id of sinopiaKernelIds) {
    const rowPrefix = `| \`cad-${id}\` |`;
    if (lines.filter((line) => line.startsWith(rowPrefix)).length !== 1) {
      throw new Error(`create-model requires exactly one selection row for ${id}`);
    }
  }
};

describe('progressive-disclosure system skill budgets', () => {
  it.each(packageSkills.map((skill) => [skill.slug, skill.skillMarkdown] as const))(
    'should keep %s within its body and description budgets',
    (skillName, skillMarkdown) => {
      expect(() => {
        assertSkillBudget(skillName, skillMarkdown);
      }).not.toThrow();
    },
  );

  it('gates every package-owned skill, not a hand-kept subset', () => {
    /* The count this replaced was a literal; if an owner ships a bundle and no
     * row appears above, that is the failure mode worth catching. */
    expect(packageSkills.length).toBeGreaterThanOrEqual(sinopiaKernelIds.length);
    expect(packageSkills.map((skill) => skill.slug)).toContain('geospec-authoring');
    expect(packageSkills.every((skill) => skill.skillMarkdown.startsWith('---\n'))).toBe(true);
  });

  it('should keep create-model within its 900-token body budget', () => {
    expect(() => {
      assertSkillBudget('create-model', getCreateModelSkillMarkdown(), 900);
    }).not.toThrow();
  });

  it('should keep sinopia-immagine-cad within its 1,500-token body budget', () => {
    expect(() => {
      assertSkillBudget('sinopia-immagine-cad', getSkillMarkdown('sinopia-immagine-cad'), 1500);
    }).not.toThrow();
  });

  it('should keep sinopia-producibilita within the doctrine budget and carry the method and the sources', () => {
    const skillMarkdown = getSkillMarkdown('sinopia-producibilita');
    expect(() => {
      assertSkillBudget('sinopia-producibilita', skillMarkdown);
    }).not.toThrow();
    // Measure first, cite the threshold's source, declare what is unverified, and no finding is not an approval.
    for (const rule of [
      'Misura prima di affermare',
      'Cita la fonte',
      'Dichiara cosa non è verificato',
      "non è un'approvazione",
    ]) {
      expect(skillMarkdown).toContain(rule);
    }
    // Our thresholds only: never those of third parties.
    expect(skillMarkdown).toContain('Sinopia');
    expect(skillMarkdown).not.toMatch(/protolabs|hubs|sendcutsend/i);
  });

  it('should include exactly one generated selection row for every offered engine', () => {
    expect(() => {
      assertCreateModelSelectionRows(getCreateModelSkillMarkdown());
    }).not.toThrow();
  });

  it('should reject selection guidance with a deliberately omitted kernel row', () => {
    const skillMarkdown = getCreateModelSkillMarkdown();
    const omittedKernel = { id: sinopiaKernelIds[0] };
    const incompleteSkillMarkdown = skillMarkdown
      .split('\n')
      .filter((line) => !line.startsWith(`| \`cad-${omittedKernel.id}\` |`))
      .join('\n');

    expect(() => {
      assertCreateModelSelectionRows(incompleteSkillMarkdown);
    }).toThrow(`create-model requires exactly one selection row for ${omittedKernel.id}`);
  });

  it('should reject a deliberately oversized fixture body', () => {
    const maxBodyCharacters = kernelSkillBodyTokens * 4;
    const fixture = `---\nname: oversized-fixture\ndescription: Budget guard fixture.\n---\n\n## Core API\n${'x'.repeat(
      maxBodyCharacters,
    )}`;

    expect(() => {
      assertSkillBudget('oversized-fixture', fixture);
    }).toThrow(`body exceeds ${kernelSkillBodyTokens} estimated tokens`);
  });

  it('should hold a skill without a Core API section to the doctrine ceiling', () => {
    const fixture = `---\nname: doctrine-fixture\ndescription: Budget guard fixture.\n---\n\n${'x'.repeat(
      doctrineSkillBodyTokens * 4 + 1,
    )}`;

    expect(() => {
      assertSkillBudget('doctrine-fixture', fixture);
    }).toThrow(`body exceeds ${doctrineSkillBodyTokens} estimated tokens`);
  });

  it('should reject a fixture body over the policy line ceiling', () => {
    const fixture = `---\nname: long-fixture\ndescription: Budget guard fixture.\n---\n\n${'x\n'.repeat(maxBodyLines + 1)}`;

    expect(() => {
      assertSkillBudget('long-fixture', fixture);
    }).toThrow(`body exceeds ${maxBodyLines} lines`);
  });
});
