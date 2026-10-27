/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { inflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type * as Smlib from '@classcad/smlibwasm';
import { disegniTavola } from '@taucad/smlib/consegna';
import type { EsitoTavola } from '@taucad/smlib/consegna';
import { creaTavolaPdf, scalaTavola, scritturaScala } from './tavola-pdf.js';
import type { DatiTavola, TestiTavola } from './tavola-pdf.js';

vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const testi: TestiTavola = {
  titolo: 'Tavola tecnica',
  progetto: 'Progetto',
  pezzi: 'Pezzi',
  versione: 'Versione',
  data: 'Data',
  scala: 'Scala',
  unita: 'mm',
  proiezione: 'primo diedro (ISO)',
  foglio: 'Foglio',
  fronte: 'Fronte',
  lato: 'Lato sinistro',
  alto: 'Dall’alto',
  isometrica: 'Isometrica',
  nonInScala: 'non in scala',
  colonnaPezzo: 'Pezzo',
  colonnaMateriale: 'Materiale',
  colonnaProcesso: 'Processo',
  colonnaPeso: 'Peso',
  pesoTotale: 'Peso totale',
  misure: 'Misure principali',
  producibilita: 'Producibilità',
  nessunControllo: 'Nessun controllo',
  livelli: { blocco: 'Blocco', avviso: 'Avviso', ok: 'Ok', info: 'Nota' },
  note: 'Note',
  segue: 'Segue al foglio 2',
};

/** WinAnsi differs from Latin-1 between 0x80 and 0x9F. */
const winAnsi: Readonly<Record<number, string>> = {
  0x80: '€',
  0x85: '…',
  0x91: '‘',
  0x92: '’',
  0x95: '•',
  0x96: '–',
  0x97: '—',
};

/** The text a PDF shows: every content stream inflated, every string of its text operators decoded (WinAnsi). */
async function testoDelPdf(byte: Uint8Array): Promise<string> {
  const grezzo = Buffer.from(byte).toString('latin1');
  const testo: string[] = [];
  for (const trovato of grezzo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/gu)) {
    let flusso: string;
    try {
      flusso = inflateSync(Buffer.from(trovato[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const esadecimale of flusso.matchAll(/<([\dA-Fa-f]+)>\s*Tj/gu)) {
      testo.push(
        [...Buffer.from(esadecimale[1]!, 'hex')]
          .map((codice) => winAnsi[codice] ?? String.fromCodePoint(codice))
          .join(''),
      );
    }
  }
  return testo.join('\n');
}

const tavolaDi = (corpi: Smlib.Part[]): Extract<EsitoTavola, { stato: 'pronto' }> => {
  const step = new TextEncoder().encode(lib.toStep(corpi, { name: 'assembly' }));
  const esito = disegniTavola(lib, { step });
  if (esito.stato !== 'pronto') {
    throw new Error('drawings not ready');
  }
  return esito;
};

const dati = (disegni: Extract<EsitoTavola, { stato: 'pronto' }>, extra: Partial<DatiTavola> = {}): DatiTavola => ({
  progetto: 'Fibbia ottone',
  selezione: 'Tutti i pezzi',
  versione: 'v3',
  data: new Date('2026-10-27T10:00:00Z'),
  lingua: 'it',
  viste: disegni.viste,
  ingombro: disegni.ingombro,
  pezzi: [
    { nome: 'Telaio', materiale: 'Ottone', processo: 'Tranciatura lamiera', pesoGrammi: 19.7 },
    { nome: 'Ardiglione', materiale: 'Ottone', processo: 'CNC', pesoGrammi: 1.25 },
  ],
  misure: ['Telaio: 40 × 20 mm · ingombro 40 × 20 × 3 mm', 'Foro: Ø 6 mm'],
  controlli: [
    { livello: 'avviso', testo: 'Telaio: parete 0,8 mm sotto 1 mm consigliato' },
    { livello: 'ok', testo: 'Ardiglione: sformo sufficiente' },
  ],
  testi,
  ...extra,
});

describe('tavola tecnica PDF', () => {
  it('should be one A4 landscape page with the views, the title block and the key texts', async () => {
    const placca = lib
      .Box(40, 20, 3)
      .cut(lib.Cylinder(3, 10).translate([0, 0, -2]))
      .named('Telaio');
    const perno = lib.Cylinder(1, 24).rotate(lib.Axis.X, 90).translate([0, 0, 3]).named('Ardiglione');
    const byte = await creaTavolaPdf(dati(tavolaDi([placca, perno])));
    expect(Buffer.from(byte.subarray(0, 5)).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(byte);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
    expect(pdf.getTitle()).toBe('Tavola tecnica — Fibbia ottone');
    expect(pdf.getCreator()).toBe('SinopiaCAD');
    const testo = await testoDelPdf(byte);
    for (const atteso of [
      'SinopiaCAD',
      'Fibbia ottone',
      'Tutti i pezzi',
      'v3',
      '27/10/2026',
      'Fronte',
      'Lato sinistro',
      'Dall’alto',
      'Isometrica · non in scala',
      'Telaio',
      'Ottone',
      'Tranciatura lamiera',
      '19,7 g',
      'Peso totale: 21 g',
      'Misure principali',
      'Foro: Ø 6 mm',
      'Avviso · Telaio: parete 0,8 mm sotto 1 mm consigliato',
      'Foglio',
      '1/1',
    ]) {
      expect(testo).toContain(atteso);
    }
    // The overall dimensions, written as Italian numbers: 40 wide, 24 deep (the pin), 5,5 high (plate and pin).
    expect(testo).toMatch(/^40$/mu);
    expect(testo).toMatch(/^24$/mu);
    expect(testo).toMatch(/^5,5$/mu);
    // 40 mm wide does not fit a 66 mm cell at 2:1: the drawing is at 1:1.
    expect(testo).toContain('1:1 · mm · primo diedro (ISO)');
  });

  it('should continue on a second page what does not fit, and say so', async () => {
    const cubo = lib.Box(10, 10, 10).named('Cubo');
    const misure = Array.from(
      { length: 30 },
      (_valore, indice) => `Misura ${String(indice + 1)}: ${String(indice)} mm`,
    );
    const byte = await creaTavolaPdf(dati(tavolaDi([cubo]), { misure, controlli: [] }));
    const pdf = await PDFDocument.load(byte);
    expect(pdf.getPageCount()).toBe(2);
    const testo = await testoDelPdf(byte);
    expect(testo).toContain('Segue al foglio 2');
    expect(testo).toContain('Misura 30: 29 mm');
    expect(testo).toContain('1/2');
    expect(testo).toContain('Nessun controllo');
  });

  it('should pick a normalised scale: enlarge a ring, reduce a sole', () => {
    expect(scritturaScala(scalaTavola([22, 22, 6], { larghezza: 65, altezza: 65 }))).toBe('2:1');
    expect(scritturaScala(scalaTavola([8, 8, 4], { larghezza: 65, altezza: 65 }))).toBe('5:1');
    expect(scritturaScala(scalaTavola([270, 95, 30], { larghezza: 65, altezza: 65 }))).toBe('1:5');
    expect(scritturaScala(scalaTavola([60, 40, 10], { larghezza: 65, altezza: 65 }))).toBe('1:1');
  });
});
