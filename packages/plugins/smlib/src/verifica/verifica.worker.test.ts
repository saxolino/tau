// @vitest-environment node
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { famiglie } from '#famiglie/registro.js';
import { codificaPng, decodificaPng } from '#verifica/png.js';
import { casoSintetico, fotoSintetica } from '#verifica/sintetico.js';
import type { CasoSintetico, FotoSintetica } from '#verifica/sintetico.js';
import { creaVerificatore } from '#verifica/verifica-client.js';
import type { RichiestaVerifica } from '#verifica/verifica-funzioni.js';

/**
 * T-D3-05, il worker dedicato: la verifica gira in un worker thread con un kernel suo (`KernelWorker`), riceve il PNG
 * della maschera e restituisce numeri e il PNG dell'immagine differenza; l'`AbortSignal` lo ferma subito terminandolo.
 * Node carica il modulo TypeScript del worker da sé (type stripping), come il bundler lo carica nel browser.
 */
vi.setConfig({ testTimeout: 180_000 });
let lib: typeof Smlib;
const verificatore = creaVerificatore(() => new Worker(new URL('verifica.worker.ts', import.meta.url)));
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});
afterAll(() => {
  verificatore.chiudi();
});

const richiesta = async (caso: CasoSintetico, foto: FotoSintetica): Promise<RichiestaVerifica> => ({
  famiglia: caso.famiglia,
  variante: caso.variante,
  stima: { parametri: caso.stima },
  vista: { ...caso.vistaStimata, confidenza: 0.7 },
  scala: { pxPerMmFoto: foto.fotoPxPerMm, fonte: 'misura_nota' },
  maschera: { png: await codificaPng(foto.foto) },
  opzioni: { budgetMs: 60_000 },
});

describe('worker della verifica', () => {
  it('should run a verification in its own kernel and send back numbers and the difference PNG', async () => {
    const caso = casoSintetico(famiglie.borchia!, 'cupola', 4);
    const foto = fotoSintetica(lib, caso);
    const risposta = await verificatore.verifica(await richiesta(caso, foto));
    expect(risposta.iou).toBeGreaterThanOrEqual(0.95);
    expect(risposta.maschera.k).toBeCloseTo(foto.maschera.k, 9);
    expect(risposta.maschera.lato).toBe(256);
    const differenza = await decodificaPng(risposta.differenzaPng);
    expect([differenza.larghezza, differenza.altezza, differenza.canali]).toEqual([256, 256, 3]);
    expect(
      Math.abs(Number((risposta.parametri as { testa: { diametro: number } }).testa.diametro) - 11.56),
    ).toBeLessThan(0.5);
  });

  it('should end a running verification within a second of the abort, and serve the next one', async () => {
    const caso = casoSintetico(famiglie.tacco!, 'stiletto', 1);
    const foto = fotoSintetica(lib, caso);
    const controllo = new AbortController();
    const promessa = verificatore.verifica(await richiesta(caso, foto), { signal: controllo.signal });
    await new Promise((risolvi) => setTimeout(risolvi, 2000));
    const abortito = performance.now();
    controllo.abort(new Error('annullata dall’utente'));
    await expect(promessa).rejects.toThrow(/annullata/);
    expect(performance.now() - abortito).toBeLessThan(1000);
    // A new worker starts for the next call.
    const piccola = casoSintetico(famiglie.occhiello!, 'standard', 5);
    const risposta = await verificatore.verifica(await richiesta(piccola, fotoSintetica(lib, piccola)));
    expect(risposta.iou).toBeGreaterThan(0.9);
  });
});
