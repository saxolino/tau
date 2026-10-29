// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { RichiestaVerifica, RispostaVerifica, Verificatore } from '@taucad/smlib/verifica';
import { verificaConRolli } from '#services/riconoscimento-pipeline.js';

const richiesta: RichiestaVerifica = {
  famiglia: 'fibbia',
  variante: 'rettangolare',
  stima: { parametri: {} },
  vista: { azimuth: 0, elevation: 90, rollo: 0, confidenza: 1, latiOcclusi: [] },
  scala: { pxPerMmFoto: null, fonte: 'stima' },
  maschera: { png: Uint8Array.of(1) },
  opzioni: { cameraFaseA: 'piano', avvii: 1 },
};

/** Il verificatore finto: l'IoU dipende dal rollo di partenza (la vista generata è girata di 90°). */
const verificatoreGirato = (): { verificatore: Verificatore; richieste: RichiestaVerifica[] } => {
  const richieste: RichiestaVerifica[] = [];
  const verificatore = mock<Verificatore>();
  verificatore.verifica.mockImplementation(async (ricevuta) => {
    richieste.push(ricevuta);
    // oxlint-disable-next-line typescript/consistent-type-assertions -- only the IoU of the answer is read here.
    return { iou: ricevuta.vista.rollo === 90 ? 0.94 : 0.6 } as RispostaVerifica;
  });
  return { verificatore, richieste };
};

describe('verificaConRolli', () => {
  it('should probe each quarter turn cheaply, then verify in full from the best one', async () => {
    const { verificatore, richieste } = verificatoreGirato();
    const risposta = await verificaConRolli(
      verificatore,
      { richiesta, rolli: [0, 90, 180, 270] },
      new AbortController().signal,
    );
    expect(risposta.iou).toBe(0.94);
    expect(richieste.map((voce) => voce.vista.rollo)).toStrictEqual([0, 90, 180, 270, 90]);
    expect(richieste.slice(0, 4).every((voce) => voce.opzioni?.giriParametri === 0)).toBe(true);
    expect(richieste[4]!.opzioni).toStrictEqual(richiesta.opzioni);
  });

  it('should verify once, as before, without rolls to probe', async () => {
    const { verificatore, richieste } = verificatoreGirato();
    await verificaConRolli(verificatore, { richiesta }, new AbortController().signal);
    expect(richieste).toStrictEqual([richiesta]);
  });
});
