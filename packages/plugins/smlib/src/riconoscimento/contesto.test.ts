// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  applicaLimiti,
  convalidaStruttura,
  erroriViste,
  ordineImmagini,
  versioneRisposta,
} from '#riconoscimento/condiviso.js';
import { contestoRiconoscimentoSchema } from '#riconoscimento/contesto.js';
import type { ContestoRiconoscimento } from '#riconoscimento/contesto.js';
import { generaContratto } from '#riconoscimento/contratto.js';

const contesto: ContestoRiconoscimento = {
  versione: 1,
  proporzioni: {
    rapporti: [
      { chiave: 'altezza_su_lunghezza', valore: 0.31 },
      { chiave: 'larghezza_su_lunghezza', valore: 0.12 },
      { chiave: 'altezza_su_altezza', valore: 0.72 },
    ],
    affidabilita: 0.8,
    parti: 5,
  },
  visibilita: { stato: 'intera', motivi: [] },
  viste: [
    { ruolo: 'principale', faccia: 'fianco_esterno' },
    { ruolo: 'controllo', faccia: 'dietro' },
  ],
};

/** Come la funzione di Sinopia convalida un contesto: struttura dello schema JSON gemello, poi i limiti senza correggere. */
const erroriServer = (valore: unknown): string[] => {
  const { schemaContesto, limitiContesto } = generaContratto();
  const struttura = convalidaStruttura(valore, schemaContesto);
  return struttura.length > 0 ? struttura : applicaLimiti(valore, limitiContesto, false).errori;
};

describe('contesto della richiesta (contratto v3)', () => {
  it('should accept a full context on both sides of the contract', () => {
    expect(contestoRiconoscimentoSchema.parse(contesto)).toStrictEqual(contesto);
    expect(erroriServer(contesto)).toStrictEqual([]);
  });

  it.each([
    ['a ratio of zero', { rapporti: [{ chiave: 'altezza_su_lunghezza', valore: 0 }], affidabilita: 0.5, parti: 3 }],
    ['a ratio above 5', { rapporti: [{ chiave: 'altezza_su_lunghezza', valore: 5.5 }], affidabilita: 0.5, parti: 3 }],
    ['a reliability above 1', { rapporti: [], affidabilita: 1.2, parti: 3 }],
    ['a fractional number of parts', { rapporti: [], affidabilita: 0.5, parti: 2.5 }],
  ])('should refuse %s in the CAD and in Sinopia', (_caso, proporzioni) => {
    const valore = { versione: 1, proporzioni };
    expect(contestoRiconoscimentoSchema.safeParse(valore).success).toBe(false);
    expect(erroriServer(valore).length).toBeGreaterThan(0);
  });

  it('should refuse unknown keys, faces, roles and versions', () => {
    for (const valore of [
      { ...contesto, extra: true },
      { ...contesto, versione: 2 },
      { ...contesto, viste: [{ ruolo: 'principale', faccia: 'tre_quarti' }] },
      { ...contesto, viste: [{ ruolo: 'seconda', faccia: 'sopra' }] },
      { ...contesto, visibilita: { stato: 'intera', motivi: ['nebbia'] } },
    ]) {
      expect(contestoRiconoscimentoSchema.safeParse(valore).success).toBe(false);
      expect(erroriServer(valore).length).toBeGreaterThan(0);
    }
  });
});

describe('immagini della richiesta', () => {
  it('should number the crop, the whole picture, the views and the difference in one order', () => {
    expect(ordineImmagini({})).toStrictEqual(['ritaglio', 'intera']);
    expect(ordineImmagini({ differenza: true })).toStrictEqual(['ritaglio', 'intera', 'differenza']);
    expect(ordineImmagini({ principale: true, controllo: true, differenza: true })).toStrictEqual([
      'ritaglio',
      'intera',
      'principale',
      'controllo',
      'differenza',
    ]);
    expect(ordineImmagini({ controllo: true })).toStrictEqual(['ritaglio', 'intera', 'controllo']);
  });

  it('should pair every generated view with its entry in the context', () => {
    expect(erroriViste({ principale: true, controllo: true }, contesto)).toStrictEqual([]);
    expect(erroriViste({ principale: false, controllo: false }, undefined)).toStrictEqual([]);
    expect(erroriViste({ principale: true, controllo: false }, undefined)).toStrictEqual([
      '/immagini/principale: manca la sua voce in contesto.viste',
    ]);
    expect(erroriViste({ principale: true, controllo: false }, contesto)).toStrictEqual([
      '/contesto/viste: «controllo» senza immagine',
    ]);
    expect(
      erroriViste(
        { principale: true, controllo: false },
        {
          viste: [
            { ruolo: 'principale', faccia: 'sopra' },
            { ruolo: 'principale', faccia: 'sotto' },
          ],
        },
      ),
    ).toStrictEqual(['/contesto/viste: «principale» ripetuta']);
  });

  it('should answer version 3 only to a request that declares it', () => {
    expect(versioneRisposta(3)).toBe(3);
    expect(versioneRisposta(undefined)).toBe(2);
    expect(versioneRisposta('3')).toBe(2);
    expect(versioneRisposta(2)).toBe(2);
  });
});
