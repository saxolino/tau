// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createActor, createAsyncLogic, waitFor } from 'xstate';
import { cameraDellaFaccia } from '@taucad/smlib/verifica';
import type {
  RichiestaVerifica,
  RispostaVerifica,
  RisultatoConfronti,
  SchedaPerVerifica,
} from '@taucad/smlib/verifica';
import { riconoscimentoMachine } from '#machines/riconoscimento.machine.js';
import type { IngressoConfronta, IngressoRientro, VisteVerifica } from '#machines/riconoscimento.machine.js';

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
    // The silhouette fixes the height in this view.
    sensibilita: [{ chiave: 'tacco.altezza', sensibilita: 0.2, degrado: 0.1, osservabile: true, banda: [80, 90] }],
    costoCostruzioneMs: 100,
    lento: false,
    differenzaPng: Uint8Array.of(137, 80, 78, 71, iou * 100),
    maschera: { k: 0.3, origine: [10, 20], lato: 256 },
    tempoMascheraMs: 5,
  }) satisfies RispostaVerifica;

/** A pipeline with fake D2 and D3 actors: the verifications answer in order. */
const pipeline = (
  verifiche: RispostaVerifica[],
  opzioni: {
    prima?: SchedaPerVerifica;
    dopo?: SchedaPerVerifica;
    viste?: VisteVerifica;
    confronta?: (ingresso: IngressoConfronta, signal: AbortSignal) => Promise<RisultatoConfronti>;
  } = {},
) => {
  const richieste: RichiestaVerifica[] = [];
  const rientri: IngressoRientro[] = [];
  const confronti: IngressoConfronta[] = [];
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
      confronta: createAsyncLogic<RisultatoConfronti, IngressoConfronta>({
        run: async ({ input, signal }) => {
          confronti.push(input);
          if (!opzioni.confronta) {
            throw new Error('confronto non previsto');
          }
          return opzioni.confronta(input, signal);
        },
      }),
    },
  });
  const actor = createActor(machine, {
    input: {
      progettoId: 'p1',
      parteId: 'tacco-1',
      maschera: Uint8Array.of(1, 2, 3),
      ...(opzioni.viste ? { viste: opzioni.viste } : {}),
    },
  });
  actor.start();
  return { actor, richieste, rientri, riconosci, confronti };
};

const viste: VisteVerifica = {
  principale: { png: Uint8Array.of(7), faccia: 'fianco_esterno' },
  controllo: { png: Uint8Array.of(8), faccia: 'dietro' },
  visibilita: 'intera',
};

const risultato = (esito: RisultatoConfronti['esito'], pezzo: RispostaVerifica): RisultatoConfronti => ({
  esito,
  ...(esito === 'non_combacia' ? { motivo: 'sorgente' as const } : {}),
  iou: { principale: pezzo.iou, controllo: 0.93, sorgente: esito === 'non_combacia' ? 0.7 : 0.9 },
  parametri: 'principale',
  risposta: pezzo,
});

describe('riconoscimentoMachine', () => {
  it('should accept from IoU 0.92 and deliver the silhouette measures', async () => {
    const { actor, richieste } = pipeline([risposta(0.95, 85.2)]);
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(fine.value).toBe('consegnato');
    expect(fine.context.consegna?.esito).toBe('accettato');
    expect(fine.context.consegna?.parametri[0]).toMatchObject({ valore: 85.2, fonte: 'silhouette', confidenza: 0.9 });
    expect(fine.context.rientri).toBe(0);
    // The sheet and the answer the delivery comes from travel with it (the pipeline builds the final sheet from them).
    expect(fine.context.schedaConsegnata?.variante.id).toBe('stiletto');
    expect(fine.context.rispostaConsegnata?.iou).toBe(0.95);
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

  it('should verify on the main view, then compare control and photo before delivering', async () => {
    const { actor, richieste, confronti } = pipeline([risposta(0.95, 85.2)], {
      viste,
      confronta: async ({ principale }) => risultato('combacia', principale),
    });
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(fine.value).toBe('consegnato');
    // The verification looked at the main view from its face, scale free, not at the photo.
    expect(richieste[0]!.maschera.png).toStrictEqual(Uint8Array.of(7));
    expect(richieste[0]!.vista).toMatchObject({ ...cameraDellaFaccia('tacco', 'fianco_esterno'), confidenza: 1 });
    expect(richieste[0]!.scala).toStrictEqual({ pxPerMmFoto: null, fonte: 'stima' });
    expect(confronti).toHaveLength(1);
    expect(confronti[0]!.maschera).toStrictEqual(Uint8Array.of(1, 2, 3));
    expect(confronti[0]!.viste).toBe(viste);
    expect(fine.context.confronti).toMatchObject({ esito: 'combacia', iou: { sorgente: 0.9 } });
    expect(fine.context.consegna?.esito).toBe('accettato');
  });

  it('should deliver the parameters the comparisons chose, and the verdict that they do not match', async () => {
    const conControllo = { ...risposta(0.95, 91), sensibilita: [] };
    const { actor } = pipeline([risposta(0.95, 85.2)], {
      viste,
      confronta: async () => ({ ...risultato('non_combacia', conControllo), parametri: 'controllo' }),
    });
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(fine.context.confronti).toMatchObject({ esito: 'non_combacia', motivo: 'sorgente', parametri: 'controllo' });
    expect(fine.context.rispostaConsegnata).toBe(conControllo);
    expect(fine.context.consegna?.parametri[0]!.valore).toBe(91);
  });

  it('should ask the model again on the main view and compare only the second round', async () => {
    const { actor, richieste, rientri, confronti } = pipeline([risposta(0.8, 90), risposta(0.94, 84.5)], {
      viste,
      confronta: async ({ principale }) => risultato('combacia', principale),
    });
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(rientri).toHaveLength(1);
    expect(richieste.map((richiesta) => richiesta.maschera.png)).toStrictEqual([Uint8Array.of(7), Uint8Array.of(7)]);
    expect(confronti).toHaveLength(1);
    expect(confronti[0]!.principale.iou).toBe(0.94);
    expect(fine.context.confronti?.esito).toBe('combacia');
  });

  it('should verify on the photo as before when the built family has no face of the main view', async () => {
    const { actor, richieste, confronti } = pipeline([risposta(0.95, 85.2)], {
      viste: { ...viste, principale: { png: Uint8Array.of(7), faccia: 'asse_dito' } },
    });
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(richieste[0]!.maschera.png).toStrictEqual(Uint8Array.of(1, 2, 3));
    expect(confronti).toHaveLength(0);
    expect(fine.context.confronti).toBeUndefined();
  });

  it('should deliver the main view’s check when the comparisons fail', async () => {
    const { actor } = pipeline([risposta(0.95, 85.2)], {
      viste,
      confronta: async () => {
        throw new Error('worker caduto');
      },
    });
    actor.send({ type: 'avvia' });
    const fine = await waitFor(actor, (snapshot) => snapshot.status === 'done');
    expect(fine.value).toBe('consegnato');
    expect(fine.context.confronti).toBeUndefined();
    expect(fine.context.consegna?.iou).toBe(0.95);
  });

  it('should abort the comparisons when cancelled during them', async () => {
    let segnale: AbortSignal | undefined;
    const { actor } = pipeline([risposta(0.95, 85.2)], {
      viste,
      confronta: async (_ingresso, signal) => {
        segnale = signal;
        return new Promise<RisultatoConfronti>(() => undefined);
      },
    });
    actor.send({ type: 'avvia' });
    await waitFor(actor, (snapshot) => snapshot.value === 'confrontando' && segnale !== undefined);
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
