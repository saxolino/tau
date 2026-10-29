// oxlint-disable tau-lint/no-time-unit-suffix -- campi dell'API esistente della verifica (`budgetMs`, `tempoMs`…).
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import type { IdFamiglia, ParametriAnnidati } from '#famiglie/famiglia.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';
import { famiglie } from '#famiglie/registro.js';
import { visteOrtogonali } from '#famiglie/viste-ortogonali.js';
import {
  ancoraDiScala,
  cameraDellaFaccia,
  chiaviDelControllo,
  confermaMisure,
  esitoConfronti,
  misureDaConfermare,
  richiestaDaVistaGenerata,
  richiestaDiConfronto,
  richiestaGirata,
  risultatoConfronti,
  rolliDaProvare,
  soglieConfronti,
} from '#verifica/confronti.js';
import { parametriSensibili } from '#verifica/ottimizza.js';
import type { SchedaPerVerifica } from '#verifica/pipeline.js';
import { codificaPng } from '#verifica/png.js';
import { casoSintetico, costruibile, fotoSintetica } from '#verifica/sintetico.js';
import type { CasoSintetico } from '#verifica/sintetico.js';
import { funzioniVerifica } from '#verifica/verifica-funzioni.js';
import type { RispostaVerifica } from '#verifica/verifica-funzioni.js';

/**
 * La verifica sulle tre immagini (piano «viste ortogonali», §2.5): le regole pure, poi pezzi sintetici resi dalle
 * facce note con `sintetico.ts` (la «vista generata» è la silhouette del pezzo vero dalla sua faccia, la «foto» la sua
 * silhouette da una vista di prodotto), senza costi.
 *
 * Taratura delle soglie (29 ottobre 2026, sei casi, principale con budget 20 s, controllo 15 s; IoU):
 *
 * | caso | principale | controllo coerente | controllo di un altro pezzo | foto coerente | foto con l'ancora +40 % |
 * |---|---|---|---|---|---|
 * | tacco blocco 101 | 0,979 | 0,989 | 0,494 (stiletto) | 0,964 | 0,790 |
 * | tacco stiletto 102 | 0,913 | 0,615 | 0,785 (blocco) | 0,855 | 0,740 |
 * | tacco cono 104 | 0,960 | 0,944 | 0,718 (stiletto) | 0,929 | 0,715 |
 * | tacco kitten 105 | 0,933 | 0,909 | 0,438 (stiletto) | 0,915 | 0,768 |
 * | fibbia rettangolare 201 | 0,944 | 0,971 | 0,671 (ovale) | 0,915 | 0,530 |
 * | fibbia doppia 204 | 0,993 | 0,990 | 0,511 (rettangolare) | 0,949 | 0,619 |
 *
 * La foto separa: coerente ≥ 0,855, smentita ≤ 0,790 → soglia 0,85. Il controllo separa tutto tranne lo stiletto
 * (pezzo sottile da dietro) → soglia 0,80, ma decide solo quando la foto non può.
 */

vi.setConfig({ testTimeout: 300_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

// ── Regole pure ────────────────────────────────────────────────────────────────────────────────────────────────────

const schedaTacco: SchedaPerVerifica = {
  famiglia: { id: 'tacco', confidenza: 0.9 },
  variante: { id: 'blocco', confidenza: 0.8 },
  vista: { azimuth: 60, elevation: 10, rollo: 0, confidenza: 0.7, latiOcclusi: ['alto'] },
  scala: { pxPerMm: 4, fonte: 'stima' },
  parametri: [
    { chiave: 'tacco.altezza', valore: 80, confidenza: 0.75, fonte: 'proporzione' },
    { chiave: 'seduta.lunghezza', valore: 55, confidenza: 0.9, fonte: 'taglia' },
    { chiave: 'seduta.larghezza', valore: 48, confidenza: 0.3, fonte: 'non_visibile' },
    { chiave: 'tappo.larghezza', valore: 10, confidenza: 0.4, fonte: 'default_mestiere' },
  ],
};

const risposta = (iou: number, parametri: ParametriAnnidati = {}): RispostaVerifica =>
  ({
    famiglia: 'tacco',
    variante: 'blocco',
    parametri,
    camera: { azimuth: 90, elevation: 0, rollo: 0, pxPerMm: 3, cx: 0, cy: 0 },
    iou,
    chamferMm: 0,
    f: 0,
    chiaviOttimizzate: ['seduta.larghezza', 'vita.scala'],
    fasi: [],
    avvii: [],
    valutazioni: 0,
    ricostruzioni: 0,
    tempoMs: 0,
    interrotto: false,
    sensibilita: [{ chiave: 'vita.scala', sensibilita: 0.1, degrado: 0.1, osservabile: true, banda: [0, 1] }],
    costoCostruzioneMs: 0,
    lento: false,
    differenzaPng: new Uint8Array(),
    maschera: { k: 1, origine: [0, 0], lato: 256 },
    tempoMascheraMs: 0,
  }) satisfies RispostaVerifica;

describe('ancora di scala e richieste', () => {
  it('should anchor the scale on the best critical source, a size or a ratio only when sure', () => {
    // `taglia` 0,9 batte `proporzione` 0,75; un `non_visibile` non è mai un'ancora.
    expect(ancoraDiScala(schedaTacco)).toStrictEqual({ chiave: 'seduta.lunghezza', fonte: 'taglia', confidenza: 0.9 });
    const conMisura: SchedaPerVerifica = {
      ...schedaTacco,
      parametri: [
        ...schedaTacco.parametri,
        { chiave: 'tappo.lunghezza', valore: 9, confidenza: 0.6, fonte: 'catalogo' },
      ],
    };
    expect(ancoraDiScala(conMisura)?.chiave).toBe('tappo.lunghezza');
    const incerta: SchedaPerVerifica = {
      ...schedaTacco,
      parametri: schedaTacco.parametri.map((parametro) => ({ ...parametro, confidenza: 0.5 })),
    };
    expect(ancoraDiScala(incerta)).toBeUndefined();
  });

  it('should look at the main view from its face, free in the plane and in scale, with the anchor held', () => {
    const richiesta = richiestaDaVistaGenerata(schedaTacco, Uint8Array.of(1), 'fianco_esterno', { budgetMs: 9000 })!;
    const camera = cameraDellaFaccia('tacco', 'fianco_esterno')!;
    expect(richiesta.vista).toStrictEqual({ ...camera, confidenza: 1, latiOcclusi: [] });
    expect(richiesta.scala).toStrictEqual({ pxPerMmFoto: null, fonte: 'stima' });
    expect(richiesta.opzioni).toMatchObject({ cameraFaseA: 'piano', avvii: 1, budgetMs: 9000 });
    expect(richiesta.opzioni?.chiavi).not.toContain('seduta.lunghezza');
    expect(richiesta.opzioni?.chiavi).toContain('tacco.altezza');
    // Una famiglia scelta al chip senza quella faccia: nessuna richiesta sulla vista.
    expect(richiestaDaVistaGenerata(schedaTacco, Uint8Array.of(1), 'asse_dito')).toBeUndefined();
  });

  it('should compare the control with only the unseen parameters free, and the photo with all held', () => {
    const principale = risposta(0.95, { tacco: { altezza: 80 } });
    expect(chiaviDelControllo(principale)).toStrictEqual(['seduta.larghezza']);
    const controllo = richiestaDiConfronto(principale, Uint8Array.of(2), {
      tipo: 'controllo',
      faccia: 'dietro',
      liberi: ['seduta.larghezza'],
    })!;
    expect(controllo.opzioni).toMatchObject({
      chiavi: ['seduta.larghezza'],
      giriParametri: 1,
      cameraFaseA: 'piano',
      sensibilita: false,
    });
    expect(controllo.stima.parametri).toStrictEqual({ tacco: { altezza: 80 } });
    const foto = richiestaDiConfronto(principale, Uint8Array.of(3), { tipo: 'sorgente', scheda: schedaTacco })!;
    expect(foto.opzioni).toMatchObject({ chiavi: [], giriParametri: 0, valutazioni: { parametri: 0, congiunta: 0 } });
    expect(foto.scala).toStrictEqual({ pxPerMmFoto: 4, fonte: 'stima' });
    expect(foto.vista.latiOcclusi).toStrictEqual(['alto']);
    expect(
      richiestaDiConfronto(principale, Uint8Array.of(2), { tipo: 'controllo', faccia: 'asse_dito' }),
    ).toBeUndefined();
  });
});

describe('esito dei confronti', () => {
  it('should let the photo decide when the part is whole', () => {
    expect(esitoConfronti({ controllo: 0.95, sorgente: 0.9 }, 'intera')).toStrictEqual({ esito: 'combacia' });
    expect(esitoConfronti({ controllo: 0.95, sorgente: 0.84 }, 'intera')).toStrictEqual({
      esito: 'non_combacia',
      motivo: 'sorgente',
    });
    // Un controllo incoerente con la foto che combacia: le sue misure non si usano, il pezzo combacia.
    expect(esitoConfronti({ controllo: 0.6, sorgente: 0.9 }, 'intera')).toStrictEqual({ esito: 'combacia' });
  });

  it('should leave hypotheses, not a verdict, for a part cut by the edge, unless the views disagree', () => {
    expect(esitoConfronti({ controllo: 0.9, sorgente: 0.5 }, 'parziale')).toStrictEqual({ esito: 'ipotesi' });
    expect(esitoConfronti({ controllo: 0.7, sorgente: 0.95 }, 'parziale')).toStrictEqual({
      esito: 'non_combacia',
      motivo: 'viste_incoerenti',
    });
    expect(esitoConfronti({ controllo: 0.7 }, 'intera')).toStrictEqual({
      esito: 'non_combacia',
      motivo: 'viste_incoerenti',
    });
  });

  it('should use the control’s measures only when the control matches and the photo does not deny them', () => {
    const principale = risposta(0.95, { seduta: { larghezza: 40 } });
    const controllo = { ...risposta(0.93, { seduta: { larghezza: 52 } }) };
    const conControllo = risultatoConfronti(
      {
        principale,
        controllo,
        liberi: ['seduta.larghezza'],
        sorgentePrincipale: risposta(0.88),
        sorgenteControllo: risposta(0.9),
      },
      'intera',
    );
    expect(conControllo).toMatchObject({ esito: 'combacia', parametri: 'controllo' });
    expect(conControllo.iou).toStrictEqual({ principale: 0.95, controllo: 0.93, sorgente: 0.9 });
    expect(conControllo.risposta.parametri).toStrictEqual({ seduta: { larghezza: 52 } });
    expect(conControllo.risposta.sensibilita.find((voce) => voce.chiave === 'seduta.larghezza')?.osservabile).toBe(
      true,
    );
    const smentito = risultatoConfronti(
      {
        principale,
        controllo,
        liberi: ['seduta.larghezza'],
        sorgentePrincipale: risposta(0.9),
        sorgenteControllo: risposta(0.8),
      },
      'intera',
    );
    expect(smentito).toMatchObject({ esito: 'combacia', parametri: 'principale', iou: { sorgente: 0.9 } });
    expect(smentito.risposta).toBe(principale);
  });

  it('should pick at most two critical, undeclared measures, the least sure first, and lower them to hypotheses', () => {
    expect(misureDaConfermare(schedaTacco)).toStrictEqual(['seduta.larghezza', 'tappo.larghezza']);
    const confermata = confermaMisure(schedaTacco, ['tacco.altezza'], 'Da confermare');
    expect(confermata.parametri[0]).toMatchObject({
      chiave: 'tacco.altezza',
      confidenza: 0.5,
      motivo: 'Da confermare',
    });
    expect(confermata.parametri[1]).toBe(schedaTacco.parametri[1]);
  });
});

// ── Pezzi sintetici ───────────────────────────────────────────────────────────────────────────────────────────────

type Prova = Readonly<{
  caso: CasoSintetico;
  scheda: SchedaPerVerifica;
  principale: Uint8Array<ArrayBuffer>;
  controllo: Uint8Array<ArrayBuffer>;
  foto: Uint8Array<ArrayBuffer>;
}>;

/** Il PNG di una silhouette, in un buffer suo (la forma che le richieste vogliono). */
const pngDi = async (immagine: Parameters<typeof codificaPng>[0]): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await codificaPng(immagine));

/** La «vista generata»: la silhouette del pezzo dalla camera della faccia. */
const vistaDa = async (caso: CasoSintetico, faccia: string): Promise<Uint8Array<ArrayBuffer>> =>
  pngDi(fotoSintetica(lib, { ...caso, vista: cameraDellaFaccia(caso.famiglia, faccia)! }).foto);

type CasoProva = Readonly<{ id: IdFamiglia; variante: string; seme: number; ancora: string }>;

const prova = async ({ id, variante, seme, ancora }: CasoProva): Promise<Prova> => {
  const famiglia = famiglie[id]!;
  const caso = casoSintetico(famiglia, variante, seme, {}, costruibile(lib, famiglia, variante));
  const foto = fotoSintetica(lib, caso);
  const scheda: SchedaPerVerifica = {
    famiglia: { id, confidenza: 0.9 },
    variante: { id: variante, confidenza: 0.9 },
    vista: { ...caso.vistaStimata, confidenza: 0.7, latiOcclusi: [] },
    scala: { pxPerMm: foto.fotoPxPerMm, fonte: 'misura_nota' },
    parametri: parametriSensibili(famiglia).map(({ chiave }) =>
      chiave === ancora
        ? { chiave, valore: Number(leggiParametro(caso.veri, chiave)), confidenza: 0.95, fonte: 'misura_nota' }
        : { chiave, valore: Number(leggiParametro(caso.stima, chiave)), confidenza: 0.5, fonte: 'proporzione' },
    ),
  };
  return {
    caso,
    scheda,
    principale: await vistaDa(caso, visteOrtogonali[id].principale),
    controllo: await vistaDa(caso, visteOrtogonali[id].controllo[0]!),
    foto: await pngDi(foto.foto),
  };
};

/** La «foto» dello stesso pezzo con l'ancora più alta del 40 %: la ricostruzione non la spiega. */
const fotoPiuAlta = async (
  caso: CasoSintetico,
  chiave: string,
): Promise<{ png: Uint8Array<ArrayBuffer>; pxPerMm: number }> => {
  const famiglia = famiglie[caso.famiglia]!;
  const definizione = famiglia.parametri.find((voce) => voce.chiave === chiave)!;
  const veri = structuredClone(caso.veri);
  scriviParametro(veri, chiave, Math.min(definizione.max!, Number(leggiParametro(veri, chiave)) * 1.4));
  const foto = fotoSintetica(lib, {
    ...caso,
    veri: famiglia.normalizza(veri, { variante: caso.variante }) as ParametriAnnidati,
  });
  return { png: await pngDi(foto.foto), pxPerMm: foto.fotoPxPerMm };
};

describe.each<CasoProva>([
  { id: 'fibbia', variante: 'rettangolare', seme: 201, ancora: 'cinturino.larghezza' },
  { id: 'tacco', variante: 'blocco', seme: 101, ancora: 'tacco.altezza' },
])('confronti sintetici: $id $variante', (casoProva) => {
  const { id, variante, seme, ancora } = casoProva;
  it('should match coherent views and photo, keep the anchor, and flag a taller photo and a wrong control', async () => {
    const { verifica } = funzioniVerifica(lib);
    const { caso, scheda, principale, controllo, foto } = await prova(casoProva);
    const tabella = visteOrtogonali[id];
    const sullaPrincipale = await verifica(
      richiestaDaVistaGenerata(scheda, principale, tabella.principale, { budgetMs: 20_000 })!,
    );
    expect(sullaPrincipale.iou).toBeGreaterThan(0.9);
    // L'ancora non si muove: la vista dà i rapporti, l'ancora i millimetri.
    expect(leggiParametro(sullaPrincipale.parametri, ancora)).toBe(leggiParametro(caso.veri, ancora));
    const liberi = chiaviDelControllo(sullaPrincipale);
    const sulControllo = await verifica(
      richiestaDiConfronto(sullaPrincipale, controllo, {
        tipo: 'controllo',
        faccia: tabella.controllo[0]!,
        liberi,
        tempoMassimo: 15_000,
      })!,
    );
    const sullaFoto = await verifica(richiestaDiConfronto(sullaPrincipale, foto, { tipo: 'sorgente', scheda })!);
    const coerente = risultatoConfronti(
      { principale: sullaPrincipale, controllo: sulControllo, liberi, sorgentePrincipale: sullaFoto },
      'intera',
    );
    expect(coerente.esito).toBe('combacia');
    expect(coerente.iou.sorgente).toBeGreaterThanOrEqual(soglieConfronti.sorgente);
    expect(coerente.iou.controllo).toBeGreaterThanOrEqual(soglieConfronti.controllo);

    const alta = await fotoPiuAlta(caso, ancora);
    const sullaFotoAlta = await verifica(
      richiestaDiConfronto(sullaPrincipale, alta.png, {
        tipo: 'sorgente',
        scheda: { ...scheda, scala: { pxPerMm: alta.pxPerMm, fonte: 'misura_nota' } },
      })!,
    );
    expect(
      risultatoConfronti({ principale: sullaPrincipale, sorgentePrincipale: sullaFotoAlta }, 'intera'),
    ).toMatchObject({ esito: 'non_combacia', motivo: 'sorgente' });

    // Un controllo di un altro pezzo, con la foto che non decide (parte tagliata dal bordo): viste incoerenti.
    const altraVariante = famiglie[id]!.varianti.find((voce) => voce !== variante)!;
    const altro = casoSintetico(
      famiglie[id]!,
      altraVariante,
      seme + 50,
      {},
      costruibile(lib, famiglie[id]!, altraVariante),
    );
    const sulControlloAltro = await verifica(
      richiestaDiConfronto(sullaPrincipale, await vistaDa(altro, tabella.controllo[0]!), {
        tipo: 'controllo',
        faccia: tabella.controllo[0]!,
        liberi,
        tempoMassimo: 15_000,
      })!,
    );
    expect(
      risultatoConfronti({ principale: sullaPrincipale, controllo: sulControlloAltro, liberi }, 'parziale'),
    ).toMatchObject({ esito: 'non_combacia', motivo: 'viste_incoerenti', parametri: 'principale' });
    // La stessa parte tagliata con viste coerenti: la foto non decide, restano ipotesi e domande.
    expect(risultatoConfronti({ principale: sullaPrincipale, controllo: sulControllo, liberi }, 'parziale').esito).toBe(
      'ipotesi',
    );
  });
});

describe('vista generata girata nel piano', () => {
  it('should probe the four quarter turns only for flat pieces and the ring seen along the finger', () => {
    expect(rolliDaProvare('fibbia', 'sopra')).toStrictEqual([0, 90, 180, 270]);
    expect(rolliDaProvare('placca', 'fianco_esterno')).toStrictEqual([0, 90, 180, 270]);
    expect(rolliDaProvare('anello', 'asse_dito')).toStrictEqual([0, 90, 180, 270]);
    expect(rolliDaProvare('tacco', 'fianco_esterno')).toStrictEqual([0]);
    const base = richiestaDaVistaGenerata(schedaTacco, Uint8Array.of(1), 'fianco_esterno', { budgetMs: 9000 })!;
    const sonda = richiestaGirata(base, 90, true);
    expect(sonda.vista.rollo).toBe(base.vista.rollo + 90);
    expect(sonda.opzioni).toMatchObject({
      giriParametri: 0,
      valutazioni: { parametri: 0, congiunta: 0 },
      sensibilita: false,
    });
    expect(richiestaGirata(base, 90, false).opzioni).toStrictEqual(base.opzioni);
  });

  it('should recover the measures of a buckle the generator drew turned by a quarter, starting from the best probe', async () => {
    const { verifica } = funzioniVerifica(lib);
    const { caso, scheda } = await prova({
      id: 'fibbia',
      variante: 'rettangolare',
      seme: 201,
      ancora: 'cinturino.larghezza',
    });
    const girata = await pngDi(
      fotoSintetica(lib, { ...caso, vista: { ...cameraDellaFaccia('fibbia', 'sopra')!, rollo: 90 } }).foto,
    );
    const richiesta = richiestaDaVistaGenerata(scheda, girata, 'sopra', { budgetMs: 15_000 })!;
    const sonde = await Promise.all(
      rolliDaProvare('fibbia', 'sopra').map(async (rollo) => {
        const sonda = await verifica(richiestaGirata(richiesta, rollo, true));
        return { rollo, iou: sonda.iou };
      }),
    );
    const migliore = sonde.toSorted((a, b) => b.iou - a.iou)[0]!;
    expect(Math.abs(migliore.rollo) % 180).toBe(90);
    const piena = await verifica(richiestaGirata(richiesta, migliore.rollo, false));
    expect(piena.iou).toBeGreaterThan(0.9);
    const vera = Number(leggiParametro(caso.veri, 'telaio.altezzaInterna'));
    expect(Math.abs(Number(leggiParametro(piena.parametri, 'telaio.altezzaInterna')) - vera)).toBeLessThan(1.5);
  });
});
