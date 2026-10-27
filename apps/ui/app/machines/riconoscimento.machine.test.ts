// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createActor, createAsyncLogic, waitFor } from 'xstate';
import type { RichiestaVerifica, RispostaVerifica, SchedaPerVerifica } from '@taucad/smlib/verifica';
import { riconoscimentoMachine } from '#machines/riconoscimento.machine.js';
import type { IngressoRientro } from '#machines/riconoscimento.machine.js';

const scheda = (variante = 'stiletto', famiglia: SchedaPerVerifica['famiglia']['id'] = 'tacco'): SchedaPerVerifica => ({
  famiglia: { id: famiglia, confidenza: 0.8 },
  variante: { id: variante, confidenza: 0.7 },
  vista: { azimuth: 85, elevation: 5, rollo: 0, confidenza: 0.7, latiOcclusi: [] },
  scala: { pxPerMm: 4, fonte: 'misura_nota' },
  parametri: [
    { chiave: 'tacco.altezza', valore: 84, confidenza: 0.6, fonte: 'proporzione' },
    { chiave: 'anima.diametro', valore: 5, confidenza: 0.4, fonte: 'default_mestiere' },
  ],
});

const risposta = (iou: number, altezza: number): RispostaVerifica =>
  ({
    famiglia: 'tacco',
    variante: 'stiletto',
    parametri: { tacco: { altezza }, anima: { diametro: 5 } },
    camera: { azimuth: 85, elevation: 5, rollo: 0, pxPerMm: 2.2, cx: 0, cy: 45 },
    iou,
    chamferMm: 0.3,
    f: 1 - iou,
    chiaviOttimizzate: ['tacco.altezza'],
    fasi: [],
    avvii: [],
    valutazioni: 120,
    ricostruzioni: 80,
    tempoMs: 12_000,
    interrotto: false,
    differenzaPng: Uint8Array.of(137, 80, 78, 71, iou * 100),
    maschera: { k: 0.3, origine: [10, 20], lato: 256 },
    tempoMascheraMs: 5,
  }) satisfies RispostaVerifica;

/** A pipeline with fake D2 and D3 actors: the verifications answer in order. */
const pipeline = (
  verifiche: RispostaVerifica[],
  opzioni: { prima?: SchedaPerVerifica; dopo?: SchedaPerVerifica } = {},
) => {
  const richieste: RichiestaVerifica[] = [];
  const rientri: IngressoRientro[] = [];
  const riconosci = vi.fn(async () => opzioni.prima ?? scheda());
  const machine = riconoscimentoMachine.provide({
    actors: {
      riconosci: createAsyncLogic({ run: riconosci }),
      verifica: createAsyncLogic({
        run: async ({ input }: { input: { richiesta: RichiestaVerifica } }) => {
          richieste.push(input.richiesta);
          const prossima = verifiche.shift();
          if (!prossima) {
            throw new Error('verifica non prevista');
          }
          return prossima;
        },
      }),
      rientro: createAsyncLogic({
        run: async ({ input }: { input: IngressoRientro }) => {
          rientri.push(input);
          return opzioni.dopo ?? scheda('blocco');
        },
      }),
    },
  });
  const actor = createActor(machine, {
    input: { progettoId: 'p1', parteId: 'tacco-1', maschera: Uint8Array.of(1, 2, 3) },
  });
  actor.start();
  return { actor, richieste, rientri, riconosci };
};

describe('riconoscimentoMachine', () => {
  it('should accept from IoU 0.92 and deliver the silhouette measures', async () => {
    const { actor, richieste } = pipeline([risposta(0.95, 85.2)]);
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(fine.value).toBe('consegnato');
    expect(fine.context.consegna?.esito).toBe('accettato');
    expect(fine.context.consegna?.parametri[0]).toMatchObject({ valore: 85.2, fonte: 'silhouette', confidenza: 0.9 });
    expect(fine.context.rientri).toBe(0);
    expect(richieste[0]!.stima.parametri).toEqual({ tacco: { altezza: 84 }, anima: { diametro: 5 } });
    expect(richieste[0]!.maschera.png).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('should accept with reserve between 0.85 and 0.92 and ask about the view', async () => {
    const { actor } = pipeline([risposta(0.88, 85.2)]);
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(fine.context.consegna?.esito).toBe('riserva');
    expect(fine.context.consegna?.chip.map((chip) => chip.codice)).toEqual(['VISTA']);
  });

  it('should ask the model again once below 0.85, with the difference picture, and verify the new reading in 30 s', async () => {
    const { actor, richieste, rientri } = pipeline([risposta(0.8, 90), risposta(0.94, 84.5)]);
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(rientri).toHaveLength(1);
    expect(rientri[0]!.differenzaPng).toEqual(risposta(0.8, 90).differenzaPng);
    expect(rientri[0]!.testo).toMatch(/rosso.*blu/);
    expect(rientri[0]!.iou).toBe(0.8);
    expect(richieste).toHaveLength(2);
    expect(richieste[1]!.variante).toBe('blocco');
    expect(richieste[1]!.opzioni?.budgetMs).toBe(30_000);
    expect(fine.context.rientri).toBe(1);
    expect(fine.context.consegna).toMatchObject({ esito: 'accettato', iou: 0.94 });
  });

  it('should deliver the better of the two rounds with a warning when it still does not match', async () => {
    const { actor, rientri } = pipeline([risposta(0.83, 88), risposta(0.79, 70)]);
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(rientri).toHaveLength(1);
    expect(fine.context.consegna).toMatchObject({ esito: 'avviso', iou: 0.83, variante: 'stiletto' });
    expect(fine.context.consegna?.parametri[0]!.valore).toBe(88);
    expect(fine.context.consegna?.chip.map((chip) => chip.codice)).toEqual(['TIPO', 'FOTO', 'LIBERO']);
  });

  it('should leave free-form parts to the agent without verifying them', async () => {
    const { actor, richieste } = pipeline([], { prima: scheda('-', 'libero') });
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(fine.value).toBe('pezzoLibero');
    expect(richieste).toHaveLength(0);
  });

  it('should stop in an error state that can retry the verification', async () => {
    const { actor, richieste } = pipeline([]);
    actor.send({ type: 'avvia' });
    const errore = await waitFor(actor, (snapshot) => snapshot.value === 'errore');
    expect(errore.context.errore).toBe('verifica non prevista');
    expect(richieste).toHaveLength(1);
    actor.send({ type: 'riprova' });
    await waitFor(actor, (snapshot) => snapshot.value === 'errore' && richieste.length === 2);
  });

  it('should abort the running verification when cancelled', async () => {
    let segnale: AbortSignal | undefined;
    const machine = riconoscimentoMachine.provide({
      actors: {
        riconosci: createAsyncLogic({ run: async () => scheda() }),
        verifica: createAsyncLogic<RispostaVerifica, { richiesta: RichiestaVerifica }>({
          run: async ({ signal }) => {
            segnale = signal;
            return new Promise<RispostaVerifica>(() => undefined);
          },
        }),
      },
    });
    const actor = createActor(machine, {
      input: { progettoId: 'p1', parteId: 'tacco-1', maschera: Uint8Array.of(1) },
    });
    actor.start();
    actor.send({ type: 'avvia' });
    await waitFor(actor, (snapshot) => snapshot.value === 'verificando' && segnale !== undefined);
    actor.send({ type: 'annulla' });
    expect(actor.getSnapshot().value).toBe('annullato');
    expect(segnale!.aborted).toBe(true);
  });

  it('should refuse to run without the D2 classifier injected', async () => {
    const actor = createActor(riconoscimentoMachine, {
      input: { progettoId: 'p1', parteId: 'x', maschera: Uint8Array.of(1) },
    });
    actor.start();
    actor.send({ type: 'avvia' });
    const errore = await waitFor(actor, (snapshot) => snapshot.value === 'errore');
    expect(errore.context.errore).toMatch(/riconosci.*non fornito/);
  });
});
