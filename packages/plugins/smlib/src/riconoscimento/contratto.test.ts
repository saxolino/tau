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
 */
const impronteGemelle = {
  contratto: 'ab3115481f236fc1f2a7b16f0a1c0d7ffc5a3ae2d205fff6b4044ccd4433611f',
  condiviso: 'e99749c95a17ad2e5de5bdc1ad490b2ae3339861fdb0a08abef9f47200cc381f',
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
