// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { famiglie } from '#famiglie/registro.js';
import {
  affianca,
  eseguiCaso,
  riassunto,
  SET_SINTETICO,
  tabellaMarkdown,
  tabellaPerMisura,
} from '#verifica/set-sintetico.js';
import type { RisultatoCaso } from '#verifica/set-sintetico.js';

/** T-D3-07: il set sintetico (un caso vero, poi riassunto e tabelle su risultati noti). */
vi.setConfig({ testTimeout: 120_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const caso = (
  famiglia: 'tacco' | 'fibbia',
  iou: number,
  errore: number,
  tempoMs: number,
  nota?: string,
): RisultatoCaso => ({
  id: `${famiglia}-x`,
  famiglia,
  variante: 'x',
  ...(nota ? { nota } : {}),
  vista: { azimuth: 0, elevation: 0, rollo: 0 },
  vistaStimata: { azimuth: 0, elevation: 0, rollo: 0 },
  tentativi: 1,
  cameraFinale: { azimuth: 0, elevation: 0, rollo: 0 },
  iouVerita: 0.99,
  iouPrima: 0.8,
  iouDopo: iou,
  chamferDopoMm: 0.1,
  errori: [
    { chiave: 'a.b', unita: 'mm', critico: true, vero: 10, stima: 12, ottimizzato: 10 + errore },
    { chiave: 'a.c', unita: 'frazione', critico: true, vero: 0.5, stima: 0.6, ottimizzato: 0.9 },
    { chiave: 'a.d', unita: 'mm', critico: false, vero: 3, stima: 4, ottimizzato: 9 },
  ],
  tempoMs,
  valutazioni: 10,
  ricostruzioni: 5,
  interrotto: false,
  fasi: [],
});

describe('set di prova sintetico', () => {
  it('should cover every realised family with five pieces and keep the slow variant apart', () => {
    for (const famiglia of Object.keys(famiglie)) {
      expect(SET_SINTETICO.filter((voce) => voce.famiglia === famiglia && !voce.nota)).toHaveLength(5);
    }
    expect(SET_SINTETICO.filter((voce) => voce.nota).map((voce) => voce.variante)).toEqual(['ovale']);
  });

  it('should run one case end to end and measure it against the truth', () => {
    const { risultato, prima, dopo } = eseguiCaso(lib, { famiglia: 'occhiello', variante: 'standard', seme: 401 });
    expect(risultato.iouVerita).toBeGreaterThan(0.98);
    expect(risultato.iouDopo).toBeGreaterThan(risultato.iouPrima);
    expect(risultato.errori.map((errore) => errore.chiave)).toEqual(['foro.diametro', 'flangia.diametro']);
    expect([prima.larghezza, dopo.larghezza]).toEqual([256, 256]);
    const affiancate = affianca(prima, dopo);
    expect([affiancate.larghezza, affiancate.altezza]).toEqual([256 * 4 + 8, 512]);
  });

  it('should summarise IoU, critical mm errors and times per family', () => {
    const righe = riassunto([
      caso('tacco', 0.95, 0.5, 10_000),
      caso('tacco', 0.97, -1.5, 20_000),
      caso('fibbia', 0.96, 0.2, 5000),
      caso('fibbia', 0.9, 4, 45_000, 'fuori budget'),
    ]);
    expect(righe.map((riga) => riga.famiglia)).toEqual([
      'tacco',
      'fibbia',
      'fibbia x (fuori budget)',
      '**totale (nel budget)**',
    ]);
    // Only critical millimetre measures count: a.b, not the fraction a.c nor the non-critical a.d.
    expect(righe[0]).toMatchObject({
      casi: 2,
      iouMinima: 0.95,
      erroreMedio: 1,
      erroreMassimo: 1.5,
      entroUnMm: 1,
      misure: 2,
    });
    expect(righe[0]!.iouMedia).toBeCloseTo(0.96, 12);
    expect(righe[0]!.tempoMassimo).toBe(20_000);
    expect(righe[3]).toMatchObject({ casi: 3, misure: 3, entroUnMm: 2 });
    const tabella = tabellaMarkdown(righe);
    expect(tabella).toContain(
      '| tacco | 2 | 0,800 | 0,960 / 0,950 | 0,990 | 2,00 | 1,00 / 1,50 | 10,0 | 1/2 | 15,0 / 20,0 |',
    );
    expect(tabellaPerMisura([caso('tacco', 0.95, 0.5, 1)])).toContain('| tacco · a.b | 2,00 | 0,50 | 0,50 | 1/1 |');
  });
});
