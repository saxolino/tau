// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createKernelParameterDeclaration } from '@taucad/runtime/kernel';
import { jsonSchemaFromJson } from '@taucad/utils/schema';
import { famiglie } from '#famiglie/registro.js';
import { completaSchemaFamiglia } from '#famiglie/schema-famiglia.js';

const dichiara = async (defaults: Record<string, unknown>, modulo: unknown) =>
  createKernelParameterDeclaration(defaults, completaSchemaFamiglia(await jsonSchemaFromJson(defaults), modulo), {
    id: 'urn:taucad:smlib:parameters',
    name: 'SmlibParameters',
  });

describe('schema dei parametri di una famiglia', () => {
  it('should refuse the schema inferred from an empty outline, and admit the explicit one', async () => {
    const p = famiglie.placca!.predefiniti();
    expect(p.piastra.contorno).toEqual([]);
    await expect(
      Promise.resolve().then(async () =>
        createKernelParameterDeclaration(p, await jsonSchemaFromJson(p), {
          id: 'urn:taucad:smlib:parameters',
          name: 'x',
        }),
      ),
    ).rejects.toThrow(/INVALID_SCHEMA/u);
    await expect(dichiara(p, { famiglia: { id: 'placca' } })).resolves.toBeDefined();
  });

  it('should admit every family with its defaults, and a saved outline of the plate', async () => {
    for (const [id, famiglia] of Object.entries(famiglie)) {
      for (const variante of famiglia!.varianti) {
        await expect(
          dichiara(famiglia!.predefiniti(variante) as Record<string, unknown>, { famiglia: { id } }),
        ).resolves.toBeDefined();
      }
    }
    const p = famiglie.placca!.predefiniti();
    const salvata = {
      ...p,
      piastra: {
        ...p.piastra,
        forma: 'contorno',
        contorno: [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
        ],
      },
    };
    await expect(dichiara(salvata, { famiglia: { id: 'placca' } })).resolves.toBeDefined();
  });

  it('should leave a module that is not a family as it is', () => {
    const schema = { type: 'object' as const };
    expect(completaSchemaFamiglia(schema, { default: () => 1 })).toBe(schema);
  });
});
