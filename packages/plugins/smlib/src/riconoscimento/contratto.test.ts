// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { famiglie } from '#famiglie/registro.js';
import { generaContratto, testoContratto } from '#riconoscimento/contratto.js';
import { mappaLibreria, mappaPartType, partTypesSinopia, tipiLibreria } from '#riconoscimento/famiglia-da-part-type.js';

const percorsoContratto = fileURLToPath(new URL('riconoscimento.contratto.json', import.meta.url));
const percorsoCondiviso = fileURLToPath(new URL('condiviso.ts', import.meta.url));
const impronta = (percorso: string): string => createHash('sha256').update(readFileSync(percorso)).digest('hex');

/**
 * Le impronte delle due copie gemelle in Sinopia (`supabase/functions/sinopiacad/riconoscimento/{contratto.json,
 * condiviso.ts}`): lo stesso valore è scritto in `recognize.test.ts` di Sinopia. Se cambi uno dei due file, copia
 * entrambi in Sinopia e aggiorna le impronte nei DUE test.
 *
 * 29 ottobre 2026: contratto v3 (viste ortogonali): `contesto` della richiesta (`schemaContesto`, `limitiContesto`),
 * viste generate numerate da `ordineImmagini`, `famiglie[].viste.ortogonali`. L'uscita non cambia; senza contesto il
 * prompt è quello della v2. La copia in Sinopia va aggiornata con la funzione `sinopiacad`.
 */
const impronteGemelle = {
  contratto: 'd7b4eb65c416181c459f3240f2d0bb8597fea59e6717f7f61c6bc9fb872802d5',
  condiviso: '8acc38bed4fd76c2ce3c2091330cd3ed85620c8f9c2b5571966f9d50810972f5',
};

const vietate = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  '$schema',
  'format',
];

const visita = (nodo: unknown, quando: (oggetto: Record<string, unknown>) => void): void => {
  if (Array.isArray(nodo)) {
    for (const figlio of nodo) {
      visita(figlio, quando);
    }
  } else if (typeof nodo === 'object' && nodo !== null) {
    quando(nodo as Record<string, unknown>);
    for (const figlio of Object.values(nodo)) {
      visita(figlio, quando);
    }
  }
};

describe('contratto del riconoscimento con la funzione di Sinopia', () => {
  it('should keep riconoscimento.contratto.json equal to what the schemas and the registry generate', () => {
    const atteso = testoContratto();
    // oxlint-disable-next-line node/no-process-env -- one explicit switch to rewrite the generated file.
    if (process.env['AGGIORNA_CONTRATTO'] === '1') {
      writeFileSync(percorsoContratto, atteso);
    }
    expect(readFileSync(percorsoContratto, 'utf8')).toBe(atteso);
  });

  it('should match the fingerprints of the twin copies in Sinopia', () => {
    expect({ contratto: impronta(percorsoContratto), condiviso: impronta(percorsoCondiviso) }).toStrictEqual(
      impronteGemelle,
    );
  });

  it('should send the API an output schema without the constraints structured outputs refuse', () => {
    const { schemaUscita, limitiUscita } = generaContratto();
    visita(schemaUscita, (oggetto) => {
      for (const parola of vietate) {
        expect(oggetto).not.toHaveProperty(parola);
      }
      if (oggetto['type'] === 'object') {
        expect(oggetto['additionalProperties']).toBe(false);
      }
    });
    expect(limitiUscita).toContainEqual({ percorso: '/famiglia/confidenza', minimum: 0, maximum: 1 });
    expect(limitiUscita).toContainEqual({ percorso: '/parametri/*/motivo', maxLength: 140 });
    expect(limitiUscita).toContainEqual({ percorso: '/domande/*/proposte', minItems: 3, maxItems: 3 });
    expect(limitiUscita).toContainEqual({ percorso: '/famiglia/alternative', maxItems: 2 });
  });

  it('should map every Sinopia part type and library type to a real family, nothing or the classifier', () => {
    const ricette = new Set(Object.keys(famiglie));
    for (const tipo of partTypesSinopia) {
      const destino = mappaPartType[tipo];
      if (tipo === 'other_accessory') {
        expect(destino).toBeUndefined();
        continue;
      }
      expect(destino, tipo).toBeDefined();
      expect(destino!.famiglia === 'non_modellabile' || ricette.has(destino!.famiglia), tipo).toBe(true);
      if (destino!.variante !== undefined) {
        expect(famiglie[destino!.famiglia as keyof typeof famiglie]!.varianti).toContain(destino!.variante);
      }
    }
    expect(partTypesSinopia).toHaveLength(25);
    for (const tipo of tipiLibreria) {
      const destino = mappaLibreria[tipo];
      if (destino) {
        expect(destino.famiglia === 'non_modellabile' || ricette.has(destino.famiglia), tipo).toBe(true);
      }
    }
  });

  it('should be version 3, with the context schema and the orthographic views of every family', () => {
    const contratto = generaContratto();
    expect(contratto.versione).toBe(3);
    expect(contratto.schemaContesto.additionalProperties).toBe(false);
    expect(Object.keys(contratto.schemaContesto.properties ?? {}).toSorted()).toStrictEqual([
      'proporzioni',
      'versione',
      'visibilita',
      'viste',
    ]);
    expect(contratto.limitiContesto).toContainEqual({
      percorso: '/proporzioni/rapporti/*/valore',
      exclusiveMinimum: 0,
      maximum: 5,
    });
    for (const famiglia of contratto.famiglie) {
      const facce = famiglia.viste.facce.map((faccia) => faccia.id);
      expect(famiglia.viste.ortogonali, famiglia.id).toBeDefined();
      expect(facce).toContain(famiglia.viste.ortogonali!.principale);
    }
    const fondo = contratto.famiglie.find((famiglia) => famiglia.id === 'fondo_semplice')!;
    expect(fondo.viste.ortogonali).toStrictEqual({
      principale: 'sotto',
      controllo: ['fianco_esterno'],
      varianti: { zeppa: { principale: 'fianco_esterno', controllo: ['sotto'] } },
    });
  });

  it('should carry every family of the registry in the catalogue, derived parameters flagged', () => {
    const contratto = generaContratto();
    expect(contratto.famiglie.map((famiglia) => famiglia.id).toSorted()).toStrictEqual(
      Object.keys(famiglie).toSorted(),
    );
    const fibbia = contratto.famiglie.find((famiglia) => famiglia.id === 'fibbia')!;
    expect(fibbia.parametri.find((parametro) => parametro.chiave === 'telaio.luce')).toMatchObject({ derivato: true });
    expect(fibbia.parametri.find((parametro) => parametro.chiave === 'cinturino.larghezza')).toMatchObject({
      critico: true,
      min: 8,
      max: 60,
    });
    expect(contratto.modello).toBe('claude-sonnet-5-5');
  });
});
