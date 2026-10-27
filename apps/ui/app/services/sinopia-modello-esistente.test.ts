import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';

const hooks = vi.hoisted(() => ({
  findRemote: vi.fn(),
  getRow: vi.fn(),
  hint: vi.fn(),
}));
vi.mock('#services/sinopia-cad.js', () => ({
  findSinopiaCadModelForPart: hooks.findRemote,
  getSinopiaCadModel: hooks.getRow,
  sinopiaCadSourceHint: { get: hooks.hint },
  sinopiaCadLocalId: { get: (_user: string, model: string) => `proj_${model.slice(0, 4)}` },
}));
const { cercaModelloEsistente } = await import('#services/sinopia-modello-esistente.js');

const userId = '10000000-0000-4000-8000-000000000001';
const modelId = '30000000-0000-4000-8000-000000000001';
const origine = {
  projectId: '1841f9d7-ee9a-4684-a6d0-742ba0e64b52',
  assetId: 'ce206280-5133-4da0-b62e-84133d86727b',
  partId: 'buckle_frame',
};
const slugs = { workspaceSlug: 'home', projectSlug: 'cornice-fibbia' };
const held = [{ projectId: 'proj_3000', manifest: { name: 'Cornice fibbia (qui)' }, library: {}, slugs }];
const link = (projectId = origine.projectId): SinopiaCadLink => ({ modelId, projectId, userId, baseRevisionId: null });

beforeEach(() => {
  hooks.findRemote.mockResolvedValue(undefined);
  hooks.getRow.mockResolvedValue(undefined);
  hooks.hint.mockReturnValue(undefined);
});

describe('the model a Sinopia part already became', () => {
  it('is none when neither Sinopia nor the device knows one: the piece is built', async () => {
    const found = await cercaModelloEsistente({
      origine,
      userId,
      progettiLocali: async () => held,
      leggiLink: async () => link(),
    });
    expect(found).toBeUndefined();
  });

  it('opens the device’s copy when Sinopia names the model and the copy is still in that project', async () => {
    hooks.findRemote.mockResolvedValue({ id: modelId, name: 'Cornice fibbia', projectId: origine.projectId });
    const found = await cercaModelloEsistente({
      origine,
      userId,
      progettiLocali: async () => held,
      leggiLink: async () => link(),
    });
    expect(found).toEqual({ modelId, name: 'Cornice fibbia', slugs });
  });

  it('opens it from Sinopia when the device’s copy was moved to another project', async () => {
    hooks.findRemote.mockResolvedValue({ id: modelId, name: 'Cornice fibbia', projectId: origine.projectId });
    const found = await cercaModelloEsistente({
      origine,
      userId,
      progettiLocali: async () => held,
      leggiLink: async () => link('20000000-0000-4000-8000-000000000009'),
    });
    expect(found).toEqual({ modelId, name: 'Cornice fibbia' });
  });

  it('works before the migration from the device’s memory, if Sinopia still has the model in the project', async () => {
    hooks.findRemote.mockResolvedValue(undefined);
    hooks.hint.mockReturnValue(modelId);
    hooks.getRow.mockResolvedValue({ id: modelId, name: 'Cornice fibbia' });
    const found = await cercaModelloEsistente({
      origine,
      userId,
      progettiLocali: async () => [],
      leggiLink: async () => undefined,
    });
    expect(found).toEqual({ modelId, name: 'Cornice fibbia' });
    expect(hooks.getRow).toHaveBeenCalledWith(
      expect.objectContaining({ modelId, projectId: origine.projectId, userId }),
    );
  });

  it('forgets a memory whose model is gone', async () => {
    hooks.hint.mockReturnValue(modelId);
    const found = await cercaModelloEsistente({
      origine,
      userId,
      progettiLocali: async () => [],
      leggiLink: async () => undefined,
    });
    expect(found).toBeUndefined();
  });
});
