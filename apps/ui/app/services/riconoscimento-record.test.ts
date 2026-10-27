// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { schedaParteDiProva, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import type { SchedaRiconoscimento } from '@taucad/smlib/riconoscimento';
import { progettoRiconosciuto } from '#services/riconoscimento-progetto.js';
import {
  aggiornaRecord,
  leggiRecordRiconoscimento,
  percorsoRiconoscimento,
  serializzaRecordRiconoscimento,
} from '#services/riconoscimento-record.js';

const progetto = () =>
  progettoRiconosciuto({
    scheda: schedaRiconoscimentoDiProva,
    schedaParte: schedaParteDiProva,
    immagine: { bytes: new Uint8Array([1, 2, 3]), tipo: 'image/jpeg' },
    maschera: new Uint8Array([4, 5]),
    lingua: 'it',
    adesso: new Date('2026-10-27T10:00:00Z'),
  })!;

describe('recognised piece project', () => {
  it('should write the family main.ts, the record and the references', () => {
    const { files, record, nome, piano } = progetto();
    expect(Object.keys(files).toSorted()).toStrictEqual(
      [
        '.tau/workbench/entries.json',
        '.tau/workbench/riconoscimento.json',
        'main.ts',
        'riferimenti/fibbia.jpg',
        'riferimenti/fibbia.maschera.png',
      ].toSorted(),
    );
    expect(new TextDecoder().decode(files['main.ts']!.content)).toContain("from '@sinopia/famiglie'");
    expect(record).toMatchObject({
      version: 1,
      famiglia: { id: 'fibbia', variante: 'rettangolare', scelta: false },
      risposte: {},
    });
    expect(record.mainScritto).toBe(piano.main);
    // The recognised brass (and the frame's wire in steel) reach the viewer as the material of each piece.
    expect(JSON.parse(new TextDecoder().decode(files['.tau/workbench/entries.json']!.content))).toMatchObject({
      version: 1,
      entries: {
        'main.ts': {
          components: {
            materials: [
              { id: 'component:telaio', material: 'brass' },
              { id: 'component:ardiglione', material: 'stainless-steel' },
            ],
          },
        },
      },
    });
    expect(piano.parametri).toMatchObject({ costruzione: { materiale: 'ottone' } });
    expect(nome).toBe('Fibbia del cinturino');
    expect(percorsoRiconoscimento).toBe('.tau/workbench/riconoscimento.json');
  });

  it('should build the family the designer chose, and nothing for a free piece', () => {
    const scelta = progettoRiconosciuto({ ...progettoIngresso(), famigliaScelta: 'placca' })!;
    expect(scelta.record.famiglia).toStrictEqual({ id: 'placca', variante: 'rettangolo', scelta: true });
    const libero: SchedaRiconoscimento = {
      ...schedaRiconoscimentoDiProva,
      famiglia: { id: 'libero', confidenza: 0.9, alternative: [] },
    };
    expect(progettoRiconosciuto({ ...progettoIngresso(), scheda: libero })).toBeUndefined();
  });
});

const progettoIngresso = (): Parameters<typeof progettoRiconosciuto>[0] => ({
  scheda: schedaRiconoscimentoDiProva,
  schedaParte: schedaParteDiProva,
  immagine: { bytes: new Uint8Array([1]), tipo: 'image/png' },
  lingua: 'it',
});

describe('recognition record', () => {
  it('should survive a write and a read unchanged', () => {
    const { record } = progetto();
    const testo = serializzaRecordRiconoscimento(record);
    expect(testo.endsWith('\n')).toBe(true);
    expect(leggiRecordRiconoscimento(testo)).toStrictEqual({ stato: 'ok', record });
    expect(leggiRecordRiconoscimento(new TextEncoder().encode(testo))).toStrictEqual({ stato: 'ok', record });
  });

  it('should upgrade a record without version, refuse a broken one and leave a newer one alone', () => {
    const { record } = progetto();
    const { version: _version, risposte: _risposte, cronologia: _cronologia, ...vecchio } = record;
    expect(aggiornaRecord(vecchio)).toMatchObject({ version: 1, risposte: {}, cronologia: [] });
    expect(leggiRecordRiconoscimento(JSON.stringify(vecchio))).toMatchObject({ stato: 'ok', record: { version: 1 } });
    expect(leggiRecordRiconoscimento('{nope')).toStrictEqual({ stato: 'non_valido' });
    expect(leggiRecordRiconoscimento(JSON.stringify({ ...record, version: 2 }))).toStrictEqual({
      stato: 'piu_recente',
      version: 2,
    });
    expect(leggiRecordRiconoscimento(undefined)).toStrictEqual({ stato: 'assente' });
  });

  it('should still read a record written before the sheet named the face', () => {
    const { record } = progetto();
    const { faccia: _faccia, ...vistaVecchia } = record.scheda.vista;
    const vecchio = { ...record, scheda: { ...record.scheda, vista: vistaVecchia } };
    const letto = leggiRecordRiconoscimento(JSON.stringify(vecchio));
    expect(letto).toMatchObject({ stato: 'ok', record: { scheda: { vista: { nome: record.scheda.vista.nome } } } });
    expect(letto.stato === 'ok' && letto.record.scheda.vista.faccia).toBe('sopra');
  });
});
