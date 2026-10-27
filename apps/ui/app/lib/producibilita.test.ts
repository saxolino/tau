/* eslint-disable @typescript-eslint/naming-convention -- process and family keys are the engine's snake_case ids. */
import { describe, expect, it } from 'vitest';
import type { GeometryComponentNode } from '@taucad/types';
import { emettiMainFamiglia, fibbia } from '@taucad/smlib/famiglie';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';
import {
  famigliaDalMain,
  materialeDelPezzo,
  parametriCorrenti,
  pezziProducibilita,
  processoDelMateriale,
  sovrapposizioneControllo,
} from '#lib/producibilita.js';
import { aggiungiScelta, leggiRecordProducibilita, recordVuoto } from '#services/producibilita-record.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const piece = (name: string, extras?: GeometryComponentNode['extras']): GeometryComponentNode => ({
  id: `component:${name}`,
  name,
  kind: 'part',
  extras,
  selector: name,
  childIds: [],
  depth: 0,
  path: [],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
});

const parete: ControlloProducibilita = {
  id: 'PARETE_MIN|Telaio',
  livello: 'blocco',
  codice: 'PARETE_MIN',
  pezzo: 'Telaio',
  valore: 0.4,
  soglia: 1.2,
  unita: 'mm',
  messaggio: 'Parete minima 0,4 mm: sotto il minimo di 1,2 mm.',
  evidenza: 'facce',
  facce: [
    { faccia: 3, livello: 'blocco' },
    { faccia: 7, livello: 'avviso' },
  ],
  fonti: ['geometria'],
};

describe('producibility in the interface', () => {
  it('should read the family a main file written by the family recipe declares', () => {
    const main = emettiMainFamiglia(
      { id: 'fibbia', versione: fibbia.versione, variante: 'ovale' },
      fibbia.predefiniti('ovale'),
      {},
    );
    expect(famigliaDalMain(main)).toEqual({ id: 'fibbia', versione: fibbia.versione, variante: 'ovale' });
    expect(famigliaDalMain('export default function main() { return []; }')).toBeUndefined();
  });

  it('should default a piece to its family process, then to its material, then to lost-wax casting', () => {
    const nodi = [
      piece('Telaio', { density: 6.7 }),
      piece('Ardiglione', { density: 7.85 }),
      piece('Pietra', { ruolo: 'pietra', density: 3.52 }),
      piece('Pezzo libero'),
    ];
    const pezzi = pezziProducibilita({
      nodi,
      materialiScelti: {},
      processiScelti: {},
      famiglia: { parametri: { costruzione: { processo: 'cnc' } } },
    });
    expect(pezzi.map(({ processo }) => processo)).toEqual(['cnc', 'cnc', 'fusione_cera_persa', 'fusione_cera_persa']);
    expect(pezzi[0]).toMatchObject({ materiale: 'zama', scelto: false, componentId: 'component:Telaio' });
    expect(pezzi[2]!.pietra).toBe(true);
    const scelti = pezziProducibilita({
      nodi,
      materialiScelti: { 'component:Telaio': { material: 'gold-18k-yellow' } },
      processiScelti: { Ardiglione: 'stampa_3d_metallo' },
    });
    expect(scelti[0]).toMatchObject({ processo: 'fusione_cera_persa', materiale: 'oro_18kt_giallo' });
    expect(scelti[1]).toMatchObject({ processo: 'stampa_3d_metallo', scelto: true });
  });

  it('should map materials to their usual process', () => {
    expect(processoDelMateriale('argento_925')).toBe('fusione_cera_persa');
    expect(processoDelMateriale('zama')).toBe('pressofusione_zama');
    expect(processoDelMateriale('ottone')).toBe('cnc');
    expect(processoDelMateriale('tr')).toBe('stampaggio_iniezione');
    expect(processoDelMateriale('cuoio')).toBe('taglio_cuoio');
    expect(processoDelMateriale(undefined)).toBeUndefined();
    expect(materialeDelPezzo(piece('Placca', { density: 8.5 }), undefined)).toBe('ottone');
    expect(materialeDelPezzo(piece('Placca', { density: 9.9 }), undefined)).toBeUndefined();
  });

  it('should merge the changed parameters over the defaults, nested per piece', () => {
    expect(
      parametriCorrenti(
        { telaio: { spessore: 3, raggio: 1 }, costruzione: { processo: 'cnc' } },
        { telaio: { spessore: 2 } },
      ),
    ).toEqual({ telaio: { spessore: 2, raggio: 1 }, costruzione: { processo: 'cnc' } });
  });

  it('should tint the faces of a check, the draft map for draft, and nothing for a model check', () => {
    const pezzi = pezziProducibilita({
      nodi: [piece('Telaio', { density: 6.7 })],
      materialiScelti: {},
      processiScelti: {},
    });
    expect(sovrapposizioneControllo({ controllo: parete, pezzi, direzione: 'z', artifactKey: 'render-1' })).toEqual({
      artifactKey: 'render-1',
      pieces: [
        {
          componentId: 'component:Telaio',
          faces: [
            { faceId: 3, level: 'block' },
            { faceId: 7, level: 'warning' },
          ],
        },
      ],
    });
    const sformo: ControlloProducibilita = {
      ...parete,
      id: 'SFORMO|Telaio',
      codice: 'SFORMO',
      livello: 'avviso',
      soglia: 1,
      unita: 'deg',
      evidenza: 'sformo',
      facce: [],
    };
    expect(
      sovrapposizioneControllo({ controllo: sformo, pezzi, direzione: 'x', artifactKey: undefined })?.pieces[0],
    ).toMatchObject({ draft: { direction: [1, 0, 0], minimum: 1 } });
    const luce: ControlloProducibilita = {
      ...parete,
      id: 'LUCE_CINTURINO|',
      codice: 'LUCE_CINTURINO',
      fonti: ['famiglia'],
    };
    delete (luce as { pezzo?: string }).pezzo;
    expect(sovrapposizioneControllo({ controllo: luce, pezzi, direzione: 'z', artifactKey: 'x' })).toBeUndefined();
  });

  it('should keep the latest choices of the register and read an unreadable record as empty', () => {
    let record = recordVuoto();
    for (let indice = 0; indice < 60; indice++) {
      record = aggiungiScelta(record, {
        scelta: indice % 2 === 0 ? 'esporta_comunque' : 'correggi',
        processi: { Telaio: 'pressofusione_zama' },
        blocchi: [parete],
        quando: new Date(Date.UTC(2026, 9, 27, 10, indice)),
      });
    }
    expect(record.registro).toHaveLength(50);
    expect(record.registro.at(-1)).toMatchObject({
      scelta: 'correggi',
      blocchi: [{ codice: 'PARETE_MIN', pezzo: 'Telaio', valore: 0.4, soglia: 1.2 }],
    });
    expect(leggiRecordProducibilita(new TextEncoder().encode('{"version":9}'))).toEqual(recordVuoto());
    expect(leggiRecordProducibilita(undefined)).toEqual(recordVuoto());
  });
});
