// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { formatNamedComponentId } from '@taucad/geometry-core';
import type { IdFamiglia } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import { materialeDelVisore, materialiPerPezzo } from '#riconoscimento/materiali-pezzi.js';

vi.setConfig({ testTimeout: 120_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

describe('materiali per pezzo di un oggetto di famiglia', () => {
  it('should name the components exactly as the kernel does, for every family and variant', () => {
    for (const id of Object.keys(famiglie) as IdFamiglia[]) {
      const famiglia = famiglie[id]!;
      for (const variante of famiglia.varianti) {
        const p = famiglia.normalizza(famiglia.predefiniti(variante), { variante });
        const pezzi = lib.scope(() =>
          famiglia.costruisci(lib, p, { variante }).map((pezzo, indice) => ({
            id: formatNamedComponentId(pezzo.name, indice),
            visore: materialeDelVisore(pezzo.materiale),
            materiale: pezzo.materiale,
          })),
        );
        const attesi = pezzi.flatMap((pezzo) =>
          pezzo.visore === undefined ? [] : [{ id: pezzo.id, material: pezzo.visore }],
        );
        expect(materialiPerPezzo(id, p), `${id} · ${variante}`).toEqual(attesi);
      }
    }
  });

  it('should follow the recognised material of the buckle frame and leave the stone alone', () => {
    const fibbia = famiglie.fibbia!;
    const p = fibbia.normalizza({ costruzione: { processo: 'cnc', materiale: 'inox' } });
    expect(materialiPerPezzo('fibbia', p)).toEqual([
      { id: 'component:telaio', material: 'stainless-steel' },
      { id: 'component:ardiglione', material: 'stainless-steel' },
    ]);
    const anello = famiglie.anello!;
    const oro = anello.normalizza({ lega: 'oro_18kt_rosa' }, { variante: 'griffe' });
    expect(materialiPerPezzo('anello', oro)).toEqual([{ id: 'component:anello', material: 'gold-18k-rose' }]);
  });
});
